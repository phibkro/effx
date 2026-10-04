import { Effect, Schema } from "effect";
import {
  type ApplicationIR,
  type GraphIndex,
  OperationKind,
  type SymbolRef,
  canonicalJson,
} from "@effx/ir";
import type { CompilerFault } from "./CompilerFault.ts";
import { AccessContractData } from "./extensions/access-contract.ts";
import { type Exposed, exposed } from "./generate/emit.ts";
import {
  type HttpItem,
  endpointKey,
  groupApiHandlersName,
  httpGroups,
  toHttpItems,
} from "./generate/http-contracts.ts";

/*
 * Spec 0021: a deterministic projection of everything the application exposes. Derived only from
 * the IR and the generators' exported naming helpers; it never reads a GenerationContext, so its
 * bytes are independent of emit mode and output directory, like `semanticHash`.
 */

const Binding = Schema.Literals(["local", "external"]);

const SurfaceAccess = Schema.Struct({
  exposure: AccessContractData.fields.exposure,
  acceptedCredentials: AccessContractData.fields.acceptedCredentials,
  principalKinds: AccessContractData.fields.principalKinds,
  decisionTime: AccessContractData.fields.decisionTime,
  capabilities: AccessContractData.fields.capabilities,
  concealment: AccessContractData.fields.concealment,
});

const SurfaceEndpoint = Schema.Struct({
  operation: Schema.String,
  endpoint: Schema.String,
  operationId: Schema.String,
  method: Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: Schema.String,
  status: Schema.optionalKey(Schema.Int),
  conditional: Schema.Boolean,
  middleware: Schema.Array(Schema.String),
  security: Schema.Array(Schema.String),
  access: Schema.optionalKey(SurfaceAccess),
});

const SurfaceGroup = Schema.Struct({
  root: Schema.String,
  group: Schema.String,
  title: Schema.optionalKey(Schema.String),
  binding: Binding,
  /** The generated export a deployment program references to mount this group (spec 0021 §4.2). */
  wiring: Schema.String,
  endpoints: Schema.Array(SurfaceEndpoint),
});

export const Surface = Schema.Struct({
  format: Schema.Literal("effx-surface"),
  version: Schema.Literal(1),
  semanticHash: Schema.String,
  operations: Schema.Array(
    Schema.Struct({ name: Schema.String, kind: OperationKind, binding: Binding }),
  ),
  http: Schema.Array(SurfaceGroup),
  rpc: Schema.Array(
    Schema.Struct({ name: Schema.String, operation: Schema.String, wiring: Schema.String }),
  ),
  cli: Schema.Array(
    Schema.Struct({ command: Schema.Array(Schema.String), operation: Schema.String }),
  ),
  foldkit: Schema.Array(Schema.Struct({ operation: Schema.String })),
});

export type Surface = typeof Surface.Type;

/** The one local-wiring export (`generate/http.ts` `AppRoutes`): it mounts every local root, group and `/rpc`. */
export const LOCAL_WIRING = "AppRoutes";

/** The wire shape is the Schema's `Type` (as for the IR), so encoding to canonical JSON is the identity. */
export const SurfaceJson = Schema.fromJsonString(Surface);

/** Canonical JSON text (RFC 8785) plus a trailing newline, like `ir.json`. */
export const surfaceText = (surface: Surface): string => canonicalJson(surface) + "\n";

export const decodeSurfaceUnknown = Schema.decodeUnknownEffect(Surface);

type Draft<T> = { -readonly [K in keyof T]: T[K] };

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const symbolText = (symbol: SymbolRef): string =>
  symbol.member === undefined
    ? `${symbol.module}#${symbol.export}`
    : `${symbol.module}#${symbol.export}.${symbol.member}`;

const endpointOf = (item: HttpItem): typeof SurfaceEndpoint.Type => {
  const endpoint = endpointKey(item);

  const result: Draft<typeof SurfaceEndpoint.Type> = {
    operation: item.operation.name,
    endpoint,
    operationId: item.contract?.metadata?.operationId ?? `${item.group}.${endpoint}`,
    method: item.transport.method,
    path: item.transport.path,
    conditional: item.contract?.conditional ?? false,
    middleware: (item.contract?.middleware ?? []).map(symbolText),
    security: (item.contract?.securityMiddleware ?? []).map(symbolText),
  };

  if (item.contract?.status !== undefined) result.status = item.contract.status;

  if (item.access !== undefined) {
    result.access = {
      exposure: item.access.exposure,
      acceptedCredentials: item.access.acceptedCredentials,
      principalKinds: item.access.principalKinds,
      decisionTime: item.access.decisionTime,
      capabilities: item.access.capabilities,
      concealment: item.access.concealment,
    };
  }

  return result;
};

const operationsOf = (ir: ApplicationIR): Surface["operations"] =>
  ir.nodes
    .flatMap((node) =>
      node._tag === "Operation"
        ? [
            {
              name: node.name,
              kind: node.kind,
              binding: node.handler === undefined ? ("external" as const) : ("local" as const),
            },
          ]
        : [],
    )
    .toSorted((a, b) => byCodeUnit(a.name, b.name));

export const surfaceOf = (
  ir: ApplicationIR,
  index: GraphIndex,
  semanticHash: string,
): Effect.Effect<Surface, CompilerFault> =>
  Effect.map(exposed(ir, index), (all: ReadonlyArray<Exposed>) => {
    const items = toHttpItems(ir, all);

    const http = httpGroups(items, ir).map((group) => {
      const external = group.items.every((item) => item.operation.handler === undefined);

      const entry: Draft<Surface["http"][number]> = {
        root: group.root,
        group: group.group,
        binding: external ? "external" : "local",
        wiring: external ? groupApiHandlersName(group.group) : LOCAL_WIRING,
        endpoints: group.items
          .map(endpointOf)
          .toSorted(
            (a, b) =>
              byCodeUnit(a.path, b.path) ||
              byCodeUnit(a.method, b.method) ||
              byCodeUnit(a.endpoint, b.endpoint),
          ),
      };

      if (group.metadata?.title !== undefined) entry.title = group.metadata.title;

      return entry;
    });

    const rpc = all.flatMap((item) =>
      item.transport._tag === "rpc"
        ? [{ name: item.transport.name, operation: item.operation.name, wiring: LOCAL_WIRING }]
        : [],
    );

    const cli = all.flatMap((item) =>
      item.transport._tag === "cli"
        ? [{ command: [...item.transport.command], operation: item.operation.name }]
        : [],
    );

    const foldkit = items.flatMap((item) =>
      item.uiCommand === undefined ? [] : [{ operation: item.operation.name }],
    );

    return {
      format: "effx-surface" as const,
      version: 1 as const,
      semanticHash,
      operations: operationsOf(ir),
      http,
      rpc: rpc.toSorted((a, b) => byCodeUnit(a.name, b.name)),
      cli: cli.toSorted((a, b) => byCodeUnit(a.command.join(" "), b.command.join(" "))),
      foldkit: foldkit.toSorted((a, b) => byCodeUnit(a.operation, b.operation)),
    };
  });
