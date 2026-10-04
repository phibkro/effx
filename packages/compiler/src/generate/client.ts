import { Effect } from "effect";
import { defaultGenerationContext, type Generator } from "../Extension.ts";
import {
  Imports,
  errorsExpr,
  generated,
  header,
  identifier,
  indent,
  operationName,
  pathParams,
  render,
  schemaExpr,
} from "./emit.ts";
import {
  type HttpItem,
  clientName,
  endpointKey,
  groupExportPart,
  httpItems,
  rootClassName,
} from "./http-contracts.ts";

const classPart = (value: string): string => {
  const name = identifier(value);

  return name.charAt(0).toUpperCase() + name.slice(1);
};

/** Keep the familiar operation name when unique; qualify collisions by HTTP root/group. */
export const clientOperationName = (
  item: HttpItem,
  externalItems: ReadonlyArray<HttpItem>,
): string => {
  const base = identifier(operationName(item.operation));

  if (
    !externalItems.some(
      (other) =>
        other.exposure.id !== item.exposure.id &&
        identifier(operationName(other.operation)) === base,
    )
  )
    return base;

  const qualified = `${classPart(item.root)}${groupExportPart(item.group)}${base}`;

  if (
    !externalItems.some(
      (other) =>
        other.exposure.id !== item.exposure.id &&
        `${classPart(other.root)}${groupExportPart(other.group)}${identifier(operationName(other.operation))}` ===
          qualified,
    )
  )
    return qualified;

  // Distinct source IDs stay distinct even if punctuation was lost in an export name.
  const suffix = item.exposure.id
    .split("")
    .map((character) => character.charCodeAt(0).toString(16))
    .join("_");

  return `${qualified}_${suffix}`;
};

const operationId = (item: HttpItem): string =>
  item.contract?.metadata?.operationId === undefined
    ? item.operation.id
    : `${item.group}.${endpointKey(item)}`;

const requestType = (imports: Imports, item: HttpItem): string => {
  const api = imports.add("./http.ts", rootClassName(item.root));
  const client = imports.add("effect/http-api", "HttpApiClient");
  const operation = endpointKey(item);

  return `Parameters<${client}.ForApi<typeof ${api}>[${JSON.stringify(item.group)}][${JSON.stringify(operation)}]>[0]`;
};

const middlewareSymbols = (imports: Imports, item: HttpItem): ReadonlyArray<string> =>
  (item.contract?.middleware ?? []).map((ref) => {
    const symbol = imports.add(ref.module, ref.export);

    return ref.member === undefined ? symbol : `${symbol}.${ref.member}`;
  });

/** Narrow the native client's failure at the response boundary, not at construction. */
const mappedFailure = (imports: Imports, item: HttpItem, exportedName: string): string => {
  const schema = imports.add("effect", "Schema");
  const clientError = imports.add("effect/http", "HttpClientError");

  const known =
    [
      ...(item.operation.errors.values.length === 0
        ? []
        : [`${schema}.is(${errorsExpr(imports, item.operation.errors.values)})(failure)`]),
      ...(item.contract?.middleware.length === 0 || item.contract === undefined
        ? []
        : [`${exportedName}MiddlewareFailure(failure)`]),
    ].join(" || ") || "false";

  return [
    "Effect.mapError((failure) =>",
    `  !${clientError}.isHttpClientError(failure) && (${schema}.isSchemaError(failure) || ${known})`,
    "    ? failure",
    `    : new TransportFailure({ operationId: ${JSON.stringify(operationId(item))}, cause: failure }),`,
    ")",
  ].join("\n");
};

const middlewareFailureLines = (
  imports: Imports,
  item: HttpItem,
  name: string,
): ReadonlyArray<string> => {
  const symbols = middlewareSymbols(imports, item);

  if (symbols.length === 0) return [];

  const middleware = imports.add("effect/http-api", "HttpApiMiddleware");
  const schema = imports.add("effect", "Schema");
  const failureType = symbols.map((symbol) => `${middleware}.Error<typeof ${symbol}>`).join(" | ");

  return [
    `const ${name}MiddlewareFailure = (failure: unknown): failure is ${failureType} => {`,
    ...symbols.flatMap((symbol) => [
      `  for (const codec of ${symbol}.error) {`,
      `    if (${schema}.is(codec)(failure)) return true;`,
      "  }",
    ]),
    "  return false;",
    "};",
    "",
  ];
};

const legacyCall = (
  imports: Imports,
  item: HttpItem,
  exportedName: string,
): ReadonlyArray<string> => {
  const operation = endpointKey(item);
  const input = schemaExpr(imports, item.operation.input);
  const params = pathParams(item.transport.path);

  const request =
    params.length === 0
      ? "{ payload: input }"
      : `{ params: { ${params.map((param) => `${param}: input.${param}`).join(", ")} }, payload: input }`;

  return [
    `export const ${exportedName} = (input: typeof ${input}["Type"]) =>`,
    `  ${clientName(item.root)}.use((client) => client.operations[${JSON.stringify(operation)}](${request}).pipe(`,
    ...indent(mappedFailure(imports, item, exportedName).split("\n"), 2),
    "  ));",
    "",
  ];
};

/** Native HttpApiClient owns the path/query/headers/payload codecs and response decoder. */
const contractCall = (
  imports: Imports,
  item: HttpItem,
  exportedName: string,
): ReadonlyArray<string> => {
  const operation = endpointKey(item);
  const request = requestType(imports, item);

  return [
    `export const ${exportedName} = (request: ${request}) =>`,
    `  ${clientName(item.root)}.use((client) => client[${JSON.stringify(item.group)}][${JSON.stringify(operation)}](`,
    `    typeof request !== "object" || request === null ||`,
    `    request.responseMode === undefined || request.responseMode === "decoded-only"`,
    "      ? request",
    `      : { ...request, responseMode: "decoded-only" },`,
    "  ).pipe(",
    ...indent(mappedFailure(imports, item, exportedName).split("\n"), 2),
    "  ));",
    "",
  ];
};

const identityCall = (
  imports: Imports,
  item: HttpItem,
  exportedName: string,
): ReadonlyArray<string> => {
  const ref = item.contract?.metadata?.commandIdentity;

  if (ref === undefined) return [];

  const request = requestType(imports, item);

  const key = item.contract?.headersKeys?.find(
    (header) => header.toLowerCase() === "idempotency-key",
  );

  const precondition = item.contract?.headersKeys?.find(
    (header) => header.toLowerCase() === "if-match",
  );

  // Analysis rejects a missing header before generation.
  if (key === undefined || precondition === undefined) return [];

  const symbol = imports.add(ref.module, ref.export);
  const callee = ref.member === undefined ? symbol : `${symbol}.${ref.member}`;
  const identityName = `${exportedName}CommandIdentity`;
  const identityType = `${identityName}Result`;
  const keyExpr = `request.headers[${JSON.stringify(key)}]`;
  const preconditionExpr = `request.headers[${JSON.stringify(precondition)}]`;

  return [
    `export type ${identityType} = {`,
    `  readonly key: ${request}["headers"][${JSON.stringify(key)}];`,
    `  readonly input: ${request};`,
    `  readonly precondition: ${request}["headers"][${JSON.stringify(precondition)}];`,
    "};",
    `export const ${identityName} = (request: ${request}): ${identityType} => {`,
    `  const identity: ${identityType} = ${callee}(request);`,
    `  return { key: ${keyExpr}, input: identity.input, precondition: ${preconditionExpr} };`,
    "};",
    "",
  ];
};

const indexLines = (items: ReadonlyArray<HttpItem>): ReadonlyArray<string> => {
  const entries = items
    .map((item) => ({
      group: item.group,
      operationId: operationId(item),
      method: item.transport.method,
      path: item.transport.path,
    }))
    .toSorted(
      (a, b) =>
        (a.operationId < b.operationId ? -1 : a.operationId > b.operationId ? 1 : 0) ||
        (a.group < b.group ? -1 : a.group > b.group ? 1 : 0) ||
        (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
    );

  return [
    "export const operationIndex = [",
    ...indent(entries.map((entry) => `${JSON.stringify(entry)},`)),
    "] as const satisfies ReadonlyArray<{",
    "  readonly group: string;",
    "  readonly operationId: string;",
    "  readonly method: string;",
    "  readonly path: string;",
    "}>;",
    "",
  ];
};

const serviceLines = (imports: Imports, root: string): ReadonlyArray<string> => {
  const api = imports.add("./http.ts", rootClassName(root));
  const name = clientName(root);
  const context = imports.add("effect", "Context");
  const layer = imports.add("effect", "Layer");
  const client = imports.add("effect/http-api", "HttpApiClient");
  const fetch = imports.add("effect/http", "FetchHttpClient");

  return [
    `export class ${name} extends ${context}.Service<${name}, ${client}.ForApi<typeof ${api}>>()(`,
    `  ${JSON.stringify(`effx/generated/${name}`)},`,
    ") {",
    ...indent([
      `static readonly layer = ${layer}.effect(${name}, ${client}.make(${api}));`,
      "static readonly layerWith = (options: ClientOptions) => {",
      "  const credentials = options.credentials;",
      `  return ${layer}.effect(`,
      `    ${name},`,
      `    ${client}.make(${api}, {`,
      "      baseUrl: options.baseUrl,",
      "      transformClient: credentials === undefined",
      "        ? undefined",
      "        : (httpClient) => withCredentials(httpClient, credentials),",
      "    }),",
      "  );",
      "};",
      `static readonly layerAt = (baseUrl: string) => ${name}.layerWith({ baseUrl }).pipe(`,
      `  ${layer}.provide(${fetch}.layer),`,
      ");",
    ]),
    "}",
    "",
  ];
};

const body = (imports: Imports, items: ReadonlyArray<HttpItem>): ReadonlyArray<string> => {
  const index = indexLines(items);

  const effect = imports.add("effect", "Effect");
  const schema = imports.add("effect", "Schema");
  const http = imports.add("effect/http", "HttpClient");
  const request = imports.add("effect/http", "HttpClientRequest");
  const apiClient = imports.add("effect/http-api", "HttpApiClient");
  const clientError = imports.add("effect/http", "HttpClientError");
  const roots = [...new Set(items.map((item) => item.root))].toSorted();

  const declarations = roots.flatMap((root) => {
    const rootItems = items.filter((item) => item.root === root);
    const groups = [...new Set(rootItems.map((item) => item.group))].toSorted();

    return [
      `  readonly ${JSON.stringify(root)}: {`,
      ...indent(
        groups.flatMap((group) => [
          `readonly ${JSON.stringify(group)}: {`,
          ...indent(
            rootItems.flatMap((item) => {
              if (item.group !== group) return [];

              const declared = [
                ...item.operation.errors.values.map(
                  (ref) => `typeof ${schemaExpr(imports, ref)}["Type"]`,
                ),
                ...middlewareSymbols(imports, item).map(
                  (symbol) =>
                    `${imports.add("effect/http-api", "HttpApiMiddleware")}.Error<typeof ${symbol}>`,
                ),
              ];

              return [
                `readonly ${JSON.stringify(endpointKey(item))}: ${declared.join(" | ") || "never"};`,
              ];
            }),
          ),
          "};",
        ]),
        2,
      ),
      "  };",
    ];
  });

  return [
    ...index,
    `export class TransportFailure extends ${schema}.TaggedError<TransportFailure>()(`,
    '  "TransportFailure",',
    `  { operationId: ${schema}.String, cause: ${schema}.Defect() },`,
    ") {}",
    "",
    `export type ClientCredentials =`,
    '  | { readonly kind: "cookie"; readonly cookie: string | (() => string | undefined) }',
    '  | { readonly kind: "bearer"; readonly token: string | (() => string | undefined) }',
    `  | { readonly kind: "custom"; readonly transformClient: (client: ${http}.HttpClient) => ${http}.HttpClient };`,
    "",
    "export interface ClientOptions {",
    "  readonly baseUrl?: string;",
    "  readonly credentials?: ClientCredentials;",
    "}",
    "",
    `const withCredentials = (client: ${http}.HttpClient, credentials: ClientCredentials): ${http}.HttpClient => {`,
    '  if (credentials.kind === "custom") return credentials.transformClient(client);',
    `  return ${http}.mapRequest(client, (outgoing) => {`,
    '    if (credentials.kind === "cookie") {',
    '      const cookie = typeof credentials.cookie === "function" ? credentials.cookie() : credentials.cookie;',
    `      return cookie === undefined || cookie === "" ? outgoing : ${request}.setHeader(outgoing, "cookie", cookie);`,
    "    }",
    '    const token = typeof credentials.token === "function" ? credentials.token() : credentials.token;',
    `    return token === undefined || token === "" ? outgoing : ${request}.bearerToken(outgoing, token);`,
    "  });",
    "};",
    "",
    "type ApiClients = {",
    ...indent(
      roots.map((root) => {
        const api = imports.add("./http.ts", rootClassName(root));

        return `readonly ${JSON.stringify(root)}: ${apiClient}.ForApi<typeof ${api}>;`;
      }),
    ),
    "};",
    "",
    "type DeclaredFailures = {",
    ...declarations,
    "};",
    "",
    "type MethodEffect<",
    "  Root extends keyof ApiClients,",
    "  Group extends keyof ApiClients[Root],",
    "  Operation extends keyof ApiClients[Root][Group],",
    `> = ApiClients[Root][Group][Operation] extends (...args: never[]) => infer Result ? Result : never;`,
    "",
    "export type EffectSdkSuccess<",
    "  Root extends keyof ApiClients,",
    "  Group extends keyof ApiClients[Root],",
    "  Operation extends keyof ApiClients[Root][Group],",
    `> = ${effect}.Success<MethodEffect<Root, Group, Operation>>;`,
    "",
    `type KnownNativeFailure<E> = unknown extends E ? never : Exclude<E, ${clientError}.HttpClientError>;`,
    "",
    "export type EffectSdkFailure<",
    "  Root extends keyof ApiClients,",
    "  Group extends keyof ApiClients[Root] & keyof DeclaredFailures[Root],",
    "  Operation extends keyof ApiClients[Root][Group] & keyof DeclaredFailures[Root][Group],",
    "> =",
    `  | KnownNativeFailure<${effect}.Error<MethodEffect<Root, Group, Operation>>>`,
    "  | DeclaredFailures[Root][Group][Operation]",
    `  | ${schema}.SchemaError`,
    "  | TransportFailure;",
    "",
    ...roots.flatMap((root) => serviceLines(imports, root)),
    ...items
      .flatMap((item) => {
        const name = clientOperationName(item, items);

        const lines =
          item.contract === undefined
            ? legacyCall(imports, item, name)
            : contractCall(imports, item, name);

        return [
          ...middlewareFailureLines(imports, item, name),
          ...lines,
          ...identityCall(imports, item, name),
        ];
      })
      .slice(0, -1),
  ];
};

/** Server and client derive their endpoint lookup from the same normalized IR. */
export const clientGenerator: Generator = (ir, index, context = defaultGenerationContext) =>
  context.emit !== "all"
    ? Effect.succeed([])
    : Effect.map(httpItems(ir, index), (all) => {
        const items = all.filter(
          (item) => item.operation.handler !== undefined && item.access?.exposure !== "Internal",
        );

        if (items.length === 0) return [];
        const imports = new Imports(context);

        return [generated("client.ts", render(header(items), imports, body(imports, items)))];
      });
