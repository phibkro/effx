import { Effect, Option, Predicate } from "effect";
import type { ApplicationIR } from "@effx/ir";
import {
  defaultGenerationContext,
  type EndpointFragmentPart,
  type GeneratedFile,
  type GenerationContext,
  type Generator,
} from "../Extension.ts";
import { findHttpApiGroupInventory } from "../http-api-inventory.ts";
import { boundHandlersLines } from "./bindings.ts";
import {
  type Exposed,
  type RpcTransport,
  Imports,
  bindCallRefs,
  bindRef,
  errorsBuilt,
  exposed,
  generated,
  handlerCall,
  header,
  identifier,
  indent,
  nameOf,
  pathParams,
  refTerm,
  render,
} from "./emit.ts";
import {
  type MethodCall,
  type ObjEntry,
  type RefLike,
  type Term,
  arr,
  call,
  chain,
  cond,
  lit,
  member,
  methodCall,
  nullish,
  obj,
  optionalMember,
  paren,
  printMethodCall,
  printTerm,
  strictEqual,
} from "./term.ts";
import {
  type HttpGroup,
  type HttpItem,
  endpointKey,
  groupApiHandlersName,
  groupApiName,
  groupClassName,
  guardTypeName,
  handlerName,
  httpGroups,
  rootClassName,
  toHttpItems,
} from "./http-contracts.ts";
import { moduleSpecifier } from "./target.ts";
import { groupNeedsGuards, isProtected } from "./guards.ts";

const isRpc = Predicate.isTagged("rpc");

/** Import registration plus the local-name table the printer resolves against; one per generated file. */
interface Scope {
  readonly imports: Imports;
  readonly names: Map<string, string>;
}

const scopeOf = (imports: Imports): Scope => ({ imports, names: new Map() });

/** Registers a reference at the boundary and returns it as a term: a builder's only touch of the imports. */
const use =
  (scope: Scope) =>
  (reference: RefLike): Term => {
    bindRef(scope.imports, scope.names, reference);

    return refTerm(reference);
  };

/** Registers a module export the generator names directly (`HttpApiSchema`, `SchemaAST`, …) as a term. */
const symbol =
  (scope: Scope) =>
  (module: string, exported: string): Term =>
    use(scope)({ module, export: exported });

const print = (scope: Scope, term: Term): string => printTerm(nameOf(scope.names), term);

/** Legacy projections keep their original query-as-payload convention. */
const legacyPayload = (scope: Scope, item: HttpItem): Term => {
  const input = use(scope)(item.operation.input);

  return item.transport.method === "GET" ? member(input, "fields") : input;
};

const problemErrors = (scope: Scope, item: HttpItem): Term => {
  const problems = item.problems;

  if (problems === undefined) {
    const built = errorsBuilt(item.operation.errors.values);

    for (const reference of built.references) bindRef(scope.imports, scope.names, reference);

    return built.term;
  }

  const registry = use(scope)(problems.registry);
  const codes = problems.codes.map((code) => lit(code));

  return call(registry, [lit(problems.identifier ?? `${endpointKey(item)}Problem`), arr(codes)]);
};

const contractSuccess = (scope: Scope, item: HttpItem): Term => {
  const contract = item.contract;

  if (contract === undefined) return use(scope)(item.operation.success);
  let success = use(scope)(contract.success);

  if (contract.responseHeaders !== undefined) {
    const apiSchema = symbol(scope)("effect/http-api", "HttpApiSchema");

    success = call(member(apiSchema, "WithHeaders"), [
      success,
      use(scope)(contract.responseHeaders),
    ]);

    if (contract.status !== undefined)
      success = call(member(success, "pipe"), [
        call(member(apiSchema, "status"), [lit(contract.status)]),
      ]);
  } else if (contract.status === 200) {
    const apiSchema = symbol(scope)("effect/http-api", "HttpApiSchema");
    const ast = symbol(scope)("effect", "SchemaAST");

    const observed = nullish(
      optionalMember(call(member(ast, "resolve"), [member(success, "ast")]), "httpApiStatus"),
      [lit(200)],
    );

    success = paren(
      cond(
        strictEqual(paren(observed), lit(200)),
        success,
        call(call(member(apiSchema, "status"), [lit(200)]), [success]),
      ),
    );
  } else if (contract.status !== undefined) {
    const apiSchema = symbol(scope)("effect/http-api", "HttpApiSchema");

    success = call(member(success, "pipe"), [
      call(member(apiSchema, "status"), [lit(contract.status)]),
    ]);
  }

  if (contract.conditional && contract.responseHeaders !== undefined) {
    const apiSchema = symbol(scope)("effect/http-api", "HttpApiSchema");
    const headers = use(scope)(contract.responseHeaders);

    success = arr([
      success,
      call(member(apiSchema, "WithHeaders"), [
        call(member(member(apiSchema, "NoContent"), "pipe"), [
          call(member(apiSchema, "status"), [lit(304)]),
        ]),
        headers,
      ]),
    ]);
  }

  return success;
};

/** The fragments the extensions contribute to one endpoint (spec 0020 §6), in extension-list order. */
type EndpointFragments = (item: HttpItem) => ReadonlyArray<EndpointFragmentPart>;

const endpointTerm = (scope: Scope, item: HttpItem, fragments: EndpointFragments): Term => {
  const name = endpointKey(item);
  const contract = item.contract;
  const options: Array<ObjEntry> = [];

  if (contract === undefined) {
    const params = pathParams(item.transport.path);

    if (params.length > 0) {
      const schema = symbol(scope)("effect", "Schema");

      options.push({
        key: "params",
        value: obj(
          params.map((param): ObjEntry => ({ key: param, value: member(schema, "String") })),
        ),
      });
    }

    options.push({ key: "payload", value: legacyPayload(scope, item) });
  } else {
    for (const channel of ["params", "query", "headers"] as const) {
      const reference = contract[channel];

      if (reference !== undefined) options.push({ key: channel, value: use(scope)(reference) });
    }

    if (contract.payload !== undefined) {
      let payload = use(scope)(contract.payload);

      if (contract.mediaType !== undefined) {
        const apiSchema = symbol(scope)("effect/http-api", "HttpApiSchema");

        payload = call(member(payload, "pipe"), [
          call(member(apiSchema, "asJson"), [
            obj([{ key: "contentType", value: lit(contract.mediaType) }]),
          ]),
        ]);
      }

      options.push({ key: "payload", value: payload });
    }
  }

  options.push({ key: "success", value: contractSuccess(scope, item) });
  options.push({ key: "error", value: problemErrors(scope, item) });

  const endpoint = symbol(scope)("effect/http-api", "HttpApiEndpoint");
  const suffixes: Array<MethodCall> = [];

  if (contract !== undefined) {
    for (const marker of contract.middleware)
      suffixes.push(methodCall("middleware", [use(scope)(marker)]));

    if (contract.metadata !== undefined) {
      const metadata = contract.metadata;
      const annotations: Array<ObjEntry> = [];

      if (metadata.operationId !== undefined)
        annotations.push({ key: "identifier", value: lit(metadata.operationId) });

      if (metadata.summary !== undefined)
        annotations.push({ key: "summary", value: lit(metadata.summary) });

      if (metadata.description !== undefined)
        annotations.push({ key: "description", value: lit(metadata.description) });

      if (metadata.tags !== undefined)
        annotations.push({
          key: "override",
          value: obj([{ key: "tags", value: lit(metadata.tags) }]),
        });

      const openApi = symbol(scope)("effect/http-api", "OpenApi");

      suffixes.push(
        methodCall("annotateMerge", [
          call(member(openApi, "annotations"), [obj(annotations, "inline")]),
        ]),
      );

      if (metadata.annotator !== undefined) {
        const annotator = use(scope)(metadata.annotator);
        const values: Array<ObjEntry> = [];

        for (const key of ["operationId", "summary", "description", "tags"] as const) {
          const value = metadata[key];

          if (value !== undefined) values.push({ key, value: lit(value) });
        }

        suffixes.push(methodCall("annotateMerge", [call(annotator, [obj(values)])]));
      }
    }
  }

  if (item.access !== undefined) {
    const data = item.access;
    const annotator = use(scope)(data.annotator);
    const resolver = use(scope)(data.canonicalScopeResolver);

    suffixes.push(
      methodCall("annotateMerge", [
        call(annotator, [
          obj([
            { key: "exposure", value: lit(data.exposure) },
            { key: "acceptedCredentials", value: lit(data.acceptedCredentials) },
            { key: "principalKinds", value: lit(data.principalKinds) },
            { key: "capabilities", value: lit(data.capabilities) },
            { key: "requirements", value: lit(data.requirements) },
            { key: "canonicalScopeResolver", value: resolver },
            { key: "concealment", value: lit(data.concealment) },
            { key: "decisionTime", value: lit(data.decisionTime) },
          ]),
        ]),
      ]),
    );
  }

  for (const part of fragments(item)) {
    bindCallRefs(scope.imports, scope.names, part.call);
    suffixes.push(part.call);
  }

  return chain(
    call(member(endpoint, item.transport.method.toLowerCase()), [
      lit(name),
      lit(item.transport.path),
      obj(options, "block"),
    ]),
    suffixes,
  );
};

const handlerLine = (imports: Imports, item: HttpItem): string => {
  const name = endpointKey(item);

  const guard = isProtected(item) ? `() => guards[${JSON.stringify(name)}](request)` : undefined;

  if (item.contract === undefined) {
    const hasParams = pathParams(item.transport.path).length > 0;

    const request = hasParams
      ? `{ ${guard === undefined ? "" : "request, "}params, payload }`
      : `{ ${guard === undefined ? "" : "request, "}payload }`;

    const args = hasParams ? "{ ...params, ...payload }" : "payload";

    return `${JSON.stringify(name)}: (${request}) => ${handlerCall(imports, Option.getOrThrow(Option.fromUndefinedOr(item.operation.handler)), args, guard)},`;
  }

  const parts = (["params", "query", "headers", "payload"] as const).filter(
    (key) => item.contract?.[key] !== undefined,
  );

  const requested = guard === undefined ? parts : ["request", ...parts];
  const request = requested.length === 0 ? "{}" : `{ ${requested.join(", ")} }`;
  const args = parts.length === 0 ? "{}" : `{ ${parts.map((part) => `...${part}`).join(", ")} }`;

  return `${JSON.stringify(name)}: (${request}) => ${handlerCall(imports, Option.getOrThrow(Option.fromUndefinedOr(item.operation.handler)), args, guard)},`;
};

const groupAnnotation = (scope: Scope, group: HttpGroup): Option.Option<MethodCall> => {
  const metadata = group.metadata;

  if (metadata === undefined) return Option.none();
  const fields: Array<ObjEntry> = [];

  if (metadata.title !== undefined) fields.push({ key: "title", value: lit(metadata.title) });

  if (metadata.description !== undefined)
    fields.push({ key: "description", value: lit(metadata.description) });

  if (metadata.displayName !== undefined)
    fields.push({
      key: "override",
      value: obj([{ key: '"x-displayName"', value: lit(metadata.displayName) }]),
    });

  if (fields.length === 0) return Option.none();
  const openApi = symbol(scope)("effect/http-api", "OpenApi");

  return Option.some(
    methodCall("annotateMerge", [call(member(openApi, "annotations"), [obj(fields)])]),
  );
};

const groupLines = (
  scope: Scope,
  group: HttpGroup,
  fragments: EndpointFragments,
): ReadonlyArray<string> => {
  const groupType = symbol(scope)("effect/http-api", "HttpApiGroup");

  return [
    `export class ${groupClassName(group.root, group.group)} extends ${print(scope, groupType)}.make(${JSON.stringify(group.group)}).add(`,
    ...indent(group.items.map((item) => `${print(scope, endpointTerm(scope, item, fragments))},`)),
    `)${Option.match(groupAnnotation(scope, group), {
      onNone: () => "",
      onSome: (annotation) => printMethodCall(nameOf(scope.names), annotation),
    })} {}`,
  ];
};

const rootLines = (imports: Imports, root: string, groups: ReadonlyArray<HttpGroup>): string => {
  const api = imports.add("effect/http-api", "HttpApi");

  const classes = groups.flatMap((group) =>
    group.root === root ? [groupClassName(group.root, group.group)] : [],
  );

  return `export class ${rootClassName(root)} extends ${api}.make(${JSON.stringify(root)})${classes.length === 0 ? "" : `.add(${classes.join(", ")})`} {}`;
};

const handlersLines = (imports: Imports, group: HttpGroup): ReadonlyArray<string> => {
  const effect = imports.add("effect", "Effect");
  const builder = imports.add("effect/http-api", "HttpApiBuilder");

  const binding = groupNeedsGuards(group)
    ? `(guards: ${guardTypeName(group.root, group.group)}) => `
    : "";

  return [
    `export const ${handlerName(group.root, group.group)} = ${binding}${builder}.group(`,
    `  ${rootClassName(group.root)},`,
    `  ${JSON.stringify(group.group)},`,
    `  ${effect}.fn(function* (handlers) {`,
    "    return handlers.handleAll({",
    ...indent(
      group.items.map((item) => handlerLine(imports, item)),
      3,
    ),
    "    });",
    "  }),",
    ");",
  ];
};

/** A standalone group contract has no root or executable implementation imports. */
const contractLines = (
  scope: Scope,
  group: HttpGroup,
  fragments: EndpointFragments,
): ReadonlyArray<string> => {
  const groupType = symbol(scope)("effect/http-api", "HttpApiGroup");
  const name = groupApiName(group.group);

  const expressions = new Map(
    group.items.map((item) => [item, print(scope, endpointTerm(scope, item, fragments))] as const),
  );

  const annotation = groupAnnotation(scope, group);

  // The collector's import bindings occupy the same module scope as the exports.
  const imported = new Set(
    scope.imports.render().flatMap((line) => {
      const match = /^import \{ ([^}]+) \} from /.exec(line);

      return match === null ? [] : match[1]!.split(", ");
    }),
  );

  const reservedWords = new Set(
    "arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(
      " ",
    ),
  );

  const isIdentifier = (key: string): boolean =>
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) && !reservedWords.has(key);

  // Reserve readable names first: User.Get must not take UserGet's wire-key name.
  const used = new Set([name, ...imported, ...group.items.map(endpointKey).filter(isIdentifier)]);
  const constants = new Map<HttpItem, string>();

  for (const item of group.items.toSorted((a, b) => endpointKey(a).localeCompare(endpointKey(b)))) {
    const key = endpointKey(item);
    let candidate = key;

    if (!isIdentifier(key) || key === name || imported.has(key)) {
      const base = `_${identifier(key)}`;
      candidate = base;

      for (let suffix = 2; used.has(candidate); suffix++) candidate = `${base}_${suffix}`;
    }

    used.add(candidate);
    constants.set(item, candidate);
  }

  return [
    ...group.items.flatMap((item) => [
      `export const ${constants.get(item)} = ${expressions.get(item)};`,
      "",
    ]),
    `export const ${name} = ${print(scope, groupType)}.make(${JSON.stringify(group.group)}).add(`,
    ...indent(group.items.map((item) => `${constants.get(item)},`)),
    `)${Option.match(annotation, {
      onNone: () => "",
      onSome: (suffix) => printMethodCall(nameOf(scope.names), suffix),
    })};`,
  ];
};

/** A raw callback is checked against its canonical endpoint, including guard errors. */
const externalTypes = (imports: Imports, group: HttpGroup): ReadonlyArray<string> => {
  const endpoint = imports.add("effect/http-api", "HttpApiEndpoint");
  const effect = imports.add("effect", "Effect");
  const request = imports.add("effect/http", "HttpServerRequest");
  const response = imports.add("effect/http", "HttpServerResponse");
  const name = groupApiName(group.group).slice(0, -"Api".length);
  const guards = `${name}Guards`;
  const guardBindings = `${name}GuardBindings`;
  const raw = `${name}RawHandlers`;

  return [
    `export type ${guards}<Endpoints extends ${endpoint}.Constraint> = {`,
    ...group.items.map((item) => {
      const key = JSON.stringify(endpointKey(item));

      return `  readonly ${JSON.stringify(`${group.group}.${endpointKey(item)}`)}: (request: ${request}.HttpServerRequest) => ${effect}.Effect<unknown, ${endpoint}.ErrorsWithIdentifier<Endpoints, ${key}>, unknown>;`;
    }),
    "};",
    "",
    `type ${guardBindings}<`,
    `  Endpoints extends ${endpoint}.Constraint,`,
    ...group.items.map(
      (item, index) =>
        `  Authorization${index} extends ${effect}.Effect<unknown, ${endpoint}.ErrorsWithIdentifier<Endpoints, ${JSON.stringify(endpointKey(item))}>, unknown>,`,
    ),
    "> = {",
    ...group.items.map(
      (item, index) =>
        `  readonly ${JSON.stringify(`${group.group}.${endpointKey(item)}`)}: (request: ${request}.HttpServerRequest) => Authorization${index};`,
    ),
    "};",

    `export type ${raw}<Endpoints extends ${endpoint}.Constraint, Guards extends ${guards}<Endpoints>, ${group.items.map((_, index) => `R${index} = unknown`).join(", ")}> = {`,
    ...group.items.flatMap((item, index) => {
      const key = JSON.stringify(endpointKey(item));
      const guard = JSON.stringify(`${group.group}.${endpointKey(item)}`);

      return [
        `  readonly ${key}: (`,
        `    request: Parameters<${endpoint}.HandlerRawWithIdentifier<Endpoints, ${key}, never, never>>[0],`,
        `    authorize: () => ReturnType<Guards[${guard}]>,`,
        `  ) => ${effect}.Effect<${response}.HttpServerResponse, ${endpoint}.ErrorsWithIdentifier<Endpoints, ${key}>, ${effect}.Services<ReturnType<Guards[${guard}]>> | R${index}>;`,
      ];
    }),
    "};",
  ];
};

/** Bind on the exported concrete application root; no generic partial root can prove endpoint keys. */
const externalHandlersLines = (
  imports: Imports,
  group: HttpGroup,
  mixed: boolean,
): ReadonlyArray<string> => {
  const typeLines = externalTypes(imports, group);
  const apiGroup = imports.add("effect/http-api", "HttpApiGroup");
  const endpoint = imports.add("effect/http-api", "HttpApiEndpoint");
  const builder = imports.add("effect/http-api", "HttpApiBuilder");
  const effect = imports.add("effect", "Effect");
  // Analysis requires an importable root for external groups. Missing metadata is an IR invariant breach.
  const rootSymbol = Option.getOrThrow(Option.fromUndefinedOr(group.metadata?.rootSymbol));
  const exportedRoot = imports.addAliased(rootSymbol.module, rootSymbol.export, "__effxRootApi");

  const root =
    rootSymbol.member === undefined ? exportedRoot : `${exportedRoot}.${rootSymbol.member}`;

  const name = groupApiName(group.group).slice(0, -"Api".length);
  const endpoints = `${name}Endpoints`;
  const authorizations = group.items.map((_, index) => `Authorization${index}`);
  const rawServices = group.items.map((_, index) => `RawR${index}`);
  const guardBindings = `${name}GuardBindings<${endpoints}, ${authorizations.join(", ")}>`;
  const raw = `${name}RawHandlers`;

  // Infer pending handlers from native registration so its requirement markers survive.
  if (mixed) {
    const layer = imports.add("effect", "Layer");
    const scope = imports.add("effect", "Scope");
    const concreteGroup = `(typeof ${root})["groups"][${JSON.stringify(group.group)}]`;

    return [
      ...typeLines,
      "",
      `type ${endpoints} = ${apiGroup}.Endpoints<${concreteGroup}>;`,
      "",
      `export const ${groupApiHandlersName(group.group)} = <`,
      ...group.items.map(
        (item, index) =>
          `  Authorization${index} extends ${effect}.Effect<unknown, ${endpoint}.ErrorsWithIdentifier<${endpoints}, ${JSON.stringify(endpointKey(item))}>, unknown>,`,
      ),
      ...rawServices.map((service) => `  ${service},`),
      ">(",
      `  { raw, guards }: { readonly raw: ${raw}<${endpoints}, ${guardBindings}, ${rawServices.join(", ")}>; readonly guards: ${guardBindings} },`,
      ") => {",
      `  const register = (handlers: ${builder}.Handlers.FromGroup<${concreteGroup}>) =>`,
      "    handlers",
      ...group.items.map((item, index) => {
        const key = JSON.stringify(endpointKey(item));
        const guard = JSON.stringify(`${group.group}.${endpointKey(item)}`);
        const end = index === group.items.length - 1 ? ";" : "";

        return `      .handleRaw(${key}, (input) => raw[${key}](input, () => guards[${guard}](input.request)))${end}`;
      }),
      "",
      "  return <Return>(",
      `    complete: (handlers: ReturnType<typeof register>) => ${builder}.Handlers.ValidateReturn<Return>,`,
      `  ): ${layer}.Layer<`,
      `    ${apiGroup}.Service<(typeof ${root})["identifier"], ${JSON.stringify(group.group)}>,`,
      `    ${builder}.Handlers.Error<Return>,`,
      `    Exclude<${builder}.Handlers.Context<Return>, ${scope}.Scope>`,
      `  > => ${builder}.group<(typeof ${root})["identifier"], (typeof ${root})["groups"][keyof (typeof ${root})["groups"]], ${JSON.stringify(group.group)}, Return>(`,
      `    ${root},`,
      `    ${JSON.stringify(group.group)},`,
      "    (handlers) => complete(register(handlers)),",
      "  );",
      "};",
    ];
  }

  return [
    ...typeLines,
    "",
    `type ${endpoints} = ${apiGroup}.Endpoints<(typeof ${root})["groups"][${JSON.stringify(group.group)}]>;`,
    "",
    `export const ${groupApiHandlersName(group.group)} = <`,
    ...group.items.map(
      (item, index) =>
        `  Authorization${index} extends ${effect}.Effect<unknown, ${endpoint}.ErrorsWithIdentifier<${endpoints}, ${JSON.stringify(endpointKey(item))}>, unknown>,`,
    ),
    ...rawServices.map((service) => `  ${service},`),
    ">(",
    `  { raw, guards }: { readonly raw: ${raw}<${endpoints}, ${guardBindings}, ${rawServices.join(", ")}>; readonly guards: ${guardBindings} },`,
    `) => ${builder}.group(${root}, ${JSON.stringify(group.group)}, (handlers) =>`,
    "  handlers",
    ...group.items.map((item) => {
      const key = JSON.stringify(endpointKey(item));
      const guard = JSON.stringify(`${group.group}.${endpointKey(item)}`);

      return `    .handleRaw(${key}, (input) => raw[${key}](input, () => guards[${guard}](input.request)))`;
    }),
    ");",
  ];
};

const body = (
  imports: Imports,
  ir: ApplicationIR,
  items: ReadonlyArray<HttpItem>,
  rpcs: ReadonlyArray<Exposed<RpcTransport>>,
  context: GenerationContext,
  fragments: EndpointFragments,
): ReadonlyArray<string> => {
  if (items.length === 0 && rpcs.length === 0) return [];

  const scope = scopeOf(imports);
  const groups = httpGroups(items, ir);
  const guardedGroups = groups.filter(groupNeedsGuards);

  const roots =
    items.length === 0
      ? []
      : [
          "effx",
          ...new Set(groups.flatMap((group) => (group.root === "effx" ? [] : [group.root]))),
        ].toSorted((a, b) => (a === "effx" ? -1 : b === "effx" ? 1 : a.localeCompare(b)));

  const layers: Array<string> = [];

  for (const root of roots) {
    const rootGroups = groups.filter((group) => group.root === root);

    if (rootGroups.length === 0) continue;
    const builder = imports.add("effect/http-api", "HttpApiBuilder");
    const layer = imports.add("effect", "Layer");

    const handlers = rootGroups.map((group) =>
      groupNeedsGuards(group)
        ? `${handlerName(group.root, group.group)}(guards[${JSON.stringify(`${group.root}/${group.group}`)}])`
        : handlerName(group.root, group.group),
    );

    layers.push(
      `${builder}.layer(${rootClassName(root)}).pipe(${layer}.provide([${handlers.join(", ")}]))`,
    );
  }

  if (rpcs.length > 0) {
    const rpcServer = imports.add("effect/rpc", "RpcServer");
    const rpcSerialization = imports.add("effect/rpc", "RpcSerialization");
    const operations = imports.add("./rpc.ts", "Operations");
    const operationsHandlers = imports.add("./rpc.ts", "OperationsHandlers");
    const layer = imports.add("effect", "Layer");
    layers.push(
      `${rpcServer}.layerHttp({ group: ${operations}, path: "/rpc", protocol: "http" }).pipe(${layer}.provide(${operationsHandlers}), ${layer}.provide(${rpcSerialization}.layerJson))`,
    );
  }

  const routes = imports.add("effect/http", "HttpRouter");
  const layer = imports.add("effect", "Layer");

  const guardImports =
    guardedGroups.length === 0
      ? []
      : [
          `import type { AppGuards, ${guardedGroups.map((group) => guardTypeName(group.root, group.group)).join(", ")} } from "${moduleSpecifier(context, "./guards.ts")}";`,
          "",
        ];

  const binding = guardedGroups.length === 0 ? "" : "(guards: AppGuards) => ";

  return [
    ...guardImports,
    ...groups.flatMap((group) => [...groupLines(scope, group, fragments), ""]),
    ...roots.map((root) => rootLines(imports, root, groups)),
    "",
    ...groups.flatMap((group) => [...handlersLines(imports, group), ""]),
    `export const AppRoutes = ${binding}${routes}.serve(${layer}.mergeAll(${layers.join(", ")}));`,
  ];
};

/** Local all-mode wiring remains compatible; external groups emit independent projections. */
export const httpGenerator: Generator = (ir, index, context = defaultGenerationContext) =>
  Effect.map(exposed(ir, index), (all) => {
    const items = toHttpItems(ir, all);
    const groups = httpGroups(items, ir);

    const externalGroups = groups.filter((group) =>
      group.items.every((item) => item.operation.handler === undefined),
    );

    const localItems = items.filter((item) => item.operation.handler !== undefined);

    const rpcs = all.flatMap((item): ReadonlyArray<Exposed<RpcTransport>> =>
      isRpc(item.transport) ? [{ ...item, transport: item.transport }] : [],
    );

    const fragments: EndpointFragments = (item) =>
      (context.fragments ?? []).flatMap((fragment) => fragment(item.operation, { ir, index }));

    const files: Array<GeneratedFile> = [];

    const baseName = (group: HttpGroup): string => {
      const duplicateName = groups.some(
        (other) => other.group === group.group && other.root !== group.root,
      );

      return `${duplicateName ? `${group.root}-` : ""}${group.group}`;
    };

    // Reserve every preferred basename before disambiguating: a fallback must
    // not steal another group's preferred name (including a root-prefixed one).
    const reserved = new Set(groups.map(baseName));
    const usedNames = new Set<string>();
    const names = new Map<HttpGroup, string>();

    for (const group of groups) {
      const preferred = baseName(group);
      let selected = preferred;

      if (usedNames.has(selected)) {
        for (let suffix = 2; reserved.has(selected) || usedNames.has(selected); suffix++) {
          selected = `${preferred}-${suffix}`;
        }
      }

      usedNames.add(selected);
      names.set(group, selected);
    }

    const filename = (group: HttpGroup, suffix: "contract" | "handlers"): string =>
      `${names.get(group)}-${suffix}.ts`;

    if (context.emit !== "handlers") {
      for (const group of context.emit === "contract" ? groups : externalGroups) {
        const imports = new Imports(context);
        files.push(
          generated(
            filename(group, "contract"),
            render(header(group.items), imports, contractLines(scopeOf(imports), group, fragments)),
          ),
        );
      }
    }

    if (context.emit !== "contract") {
      for (const group of externalGroups) {
        const root = group.metadata?.rootSymbol;

        const inventory =
          root === undefined
            ? undefined
            : findHttpApiGroupInventory(root, group.group, context.httpApiGroups);

        // compileCollected diagnoses this precondition; direct generators must stay safe too.
        if (
          inventory === undefined ||
          group.items.some((item) => !inventory.endpoints.includes(endpointKey(item)))
        )
          continue;

        const imports = new Imports(context);

        const binding = context.bindings?.find(
          (entry) => entry.root === group.root && entry.group === group.group,
        )?.binding;

        const unbound = externalHandlersLines(
          imports,
          group,
          inventory.endpoints.some((key) => !group.items.some((item) => endpointKey(item) === key)),
        );

        files.push(
          generated(
            filename(group, "handlers"),
            render(
              header(group.items),
              imports,
              binding === undefined
                ? unbound
                : boundHandlersLines(imports, group, binding, unbound),
            ),
          ),
        );
      }
    }

    if (context.emit === "all" && (localItems.length > 0 || rpcs.length > 0)) {
      const imports = new Imports(context);
      files.push(
        generated(
          "http.ts",
          render(
            header([...localItems, ...rpcs]),
            imports,
            body(imports, ir, localItems, rpcs, context, fragments),
          ),
        ),
      );
    }

    return files;
  });
