import { Effect, Predicate } from "effect";
import type { SymbolRef } from "@effx/ir";
import { defaultGenerationContext, type Generator } from "../Extension.ts";
import {
  type Exposed,
  Imports,
  type RpcTransport,
  errorsExpr,
  exposed,
  generated,
  handlerCall,
  header,
  identifier,
  indent,
  operationName,
  render,
  schemaExpr,
} from "./emit.ts";

const isRpc = Predicate.isTagged("rpc");

type BoundRpc = Exposed<RpcTransport> & {
  readonly operation: Exposed<RpcTransport>["operation"] & { readonly handler: SymbolRef };
};

const hasHandler = (item: Exposed<RpcTransport>): item is BoundRpc =>
  item.operation.handler !== undefined;

const rpcLines = (imports: Imports, item: Exposed<RpcTransport>): ReadonlyArray<string> => {
  const rpc = imports.add("effect/rpc", "Rpc");

  return [
    `export const ${identifier(operationName(item.operation))} = ${rpc}.make("${item.transport.name}", {`,
    ...indent([
      `payload: ${schemaExpr(imports, item.operation.input)},`,
      `success: ${schemaExpr(imports, item.operation.success)},`,
      `error: ${errorsExpr(imports, item.operation.errors.values)},`,
    ]),
    "});",
    "",
  ];
};

/** `RpcGroup.toLayer` handlers receive the decoded payload positionally (see emit.ts for the source lines). */
const handlerLine = (imports: Imports, item: BoundRpc): string =>
  `"${item.transport.name}": (payload) => ${handlerCall(imports, item.operation.handler, "payload")},`;

const body = (imports: Imports, rpcs: ReadonlyArray<BoundRpc>): ReadonlyArray<string> => {
  const group = imports.add("effect/rpc", "RpcGroup");
  const layer = imports.add("effect", "Layer");
  const effect = imports.add("effect", "Effect");
  const rpcClient = imports.add("effect/rpc", "RpcClient");
  const rpcSerialization = imports.add("effect/rpc", "RpcSerialization");
  const httpServer = imports.add("effect/http", "HttpServer");
  const netAddress = imports.add("effect/net", "NetAddress");
  const fetchHttpClient = imports.add("effect/http", "FetchHttpClient");
  const idents = rpcs.map((item) => identifier(operationName(item.operation)));

  return [
    ...rpcs.flatMap((item) => rpcLines(imports, item)),
    "export const Operations = " + group + ".make(" + idents.join(", ") + ");",
    "",
    "export const OperationsHandlers = Operations.toLayer({",
    ...indent(rpcs.map((item) => handlerLine(imports, item))),
    "});",
    "",
    "const operationsClientLayerAt = (baseUrl: string) =>",
    "  " + rpcClient + '.layerProtocolHttp({ url: new URL("/rpc", baseUrl).toString() }).pipe(',
    "    " + layer + ".provide(" + fetchHttpClient + ".layer),",
    "    " + layer + ".provide(" + rpcSerialization + ".layerJson),",
    "  );",
    "",
    "export const OperationsClient = {",
    "  make: " + rpcClient + ".make(Operations),",
    "  layerAt: operationsClientLayerAt,",
    "  layerTest: " + layer + ".unwrap(",
    "    " + effect + ".gen(function* () {",
    "      const server = yield* " + httpServer + ".HttpServer;",
    "      const address = server.address;",
    "",
    "      if (" +
      netAddress +
      ".isUnixPathAddress(address)) return yield* " +
      effect +
      '.die("expected TCP test server");',
    "      const url = yield* " + effect + ".fromResult(" + netAddress + ".toUrl(address));",
    "",
    "      return operationsClientLayerAt(url.origin);",
    "    }),",
    "  ),",
    "};",
  ];
};

/** `rpc.ts`: one `Rpc.make` per locally bound RPC exposure, with its handlers layer. */
export const rpcGenerator: Generator = (ir, index, context = defaultGenerationContext) =>
  context.emit !== "all"
    ? Effect.succeed([])
    : Effect.map(exposed(ir, index), (all) => {
        const rpcs = all
          .flatMap((item) =>
            isRpc(item.transport) ? [{ ...item, transport: item.transport }] : [],
          )
          .filter(hasHandler);

        if (rpcs.length === 0) return [];
        const imports = new Imports(context);
        const lines = body(imports, rpcs);

        return [generated("rpc.ts", render(header(rpcs), imports, lines))];
      });
