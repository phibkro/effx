import { Effect, Option, Predicate } from "effect";
import type { ApplicationIR } from "@effx/ir";
import {
  defaultGenerationContext,
  type EndpointFragmentPart,
  type GeneratedFile,
  type GenerationContext,
  type Generator,
} from "../Extension.ts";
import {
  type Exposed,
  type RpcTransport,
  Imports,
  errorsExpr,
  exposed,
  generated,
  handlerCall,
  header,
  identifier,
  indent,
  pathParams,
  render,
  schemaExpr,
} from "./emit.ts";
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

/** Legacy projections keep their original query-as-payload convention. */
const legacyPayload = (imports: Imports, item: HttpItem): string => {
  const input = schemaExpr(imports, item.operation.input);

  return item.transport.method === "GET" ? `${input}.fields` : input;
};

const problemErrors = (imports: Imports, item: HttpItem): string => {
  const problems = item.problems;

  if (problems === undefined) return errorsExpr(imports, item.operation.errors.values);
  const registry = imports.add(problems.registry.module, problems.registry.export);

  const derivation =
    problems.registry.member === undefined ? registry : `${registry}.${problems.registry.member}`;

  const codes = problems.codes.map((code) => JSON.stringify(code)).join(", ");

  return `${derivation}(${JSON.stringify(problems.identifier ?? `${endpointKey(item)}Problem`)}, [${codes}])`;
};

const contractSuccess = (imports: Imports, item: HttpItem): string => {
  const contract = item.contract;

  if (contract === undefined) return schemaExpr(imports, item.operation.success);
  let success = schemaExpr(imports, contract.success);

  if (contract.responseHeaders !== undefined) {
    const apiSchema = imports.add("effect/http-api", "HttpApiSchema");
    success = `${apiSchema}.WithHeaders(${success}, ${schemaExpr(imports, contract.responseHeaders)})`;

    if (contract.status !== undefined)
      success = `${success}.pipe(${apiSchema}.status(${contract.status}))`;
  } else if (contract.status === 200) {
    const apiSchema = imports.add("effect/http-api", "HttpApiSchema");
    const ast = imports.add("effect", "SchemaAST");
    success = `((${ast}.resolve(${success}.ast)?.httpApiStatus ?? 200) === 200 ? ${success} : ${apiSchema}.status(200)(${success}))`;
  } else if (contract.status !== undefined) {
    const apiSchema = imports.add("effect/http-api", "HttpApiSchema");
    success = `${success}.pipe(${apiSchema}.status(${contract.status}))`;
  }

  if (contract.conditional && contract.responseHeaders !== undefined) {
    const apiSchema = imports.add("effect/http-api", "HttpApiSchema");
    const headers = schemaExpr(imports, contract.responseHeaders);
    success = `[${success}, ${apiSchema}.WithHeaders(${apiSchema}.NoContent.pipe(${apiSchema}.status(304)), ${headers})]`;
  }

  return success;
};

/** The fragments the extensions contribute to one endpoint (spec 0020 §6), in extension-list order. */
type EndpointFragments = (item: HttpItem) => ReadonlyArray<EndpointFragmentPart>;

const endpointExpr = (imports: Imports, item: HttpItem, fragments: EndpointFragments): string => {
  const name = endpointKey(item);
  const contract = item.contract;
  const options: Array<string> = [];

  if (contract === undefined) {
    const params = pathParams(item.transport.path);

    if (params.length > 0) {
      const schema = imports.add("effect", "Schema");
      options.push(
        `params: { ${params.map((param) => `${param}: ${schema}.String`).join(", ")} },`,
      );
    }

    options.push(`payload: ${legacyPayload(imports, item)},`);
  } else {
    for (const channel of ["params", "query", "headers"] as const) {
      const ref = contract[channel];

      if (ref !== undefined) options.push(`${channel}: ${schemaExpr(imports, ref)},`);
    }

    if (contract.payload !== undefined) {
      let payload = schemaExpr(imports, contract.payload);

      if (contract.mediaType !== undefined) {
        const apiSchema = imports.add("effect/http-api", "HttpApiSchema");
        payload = `${payload}.pipe(${apiSchema}.asJson({ contentType: ${JSON.stringify(contract.mediaType)} }))`;
      }

      options.push(`payload: ${payload},`);
    }
  }

  options.push(`success: ${contractSuccess(imports, item)},`);
  options.push(`error: ${problemErrors(imports, item)},`);
  const endpoint = imports.add("effect/http-api", "HttpApiEndpoint");
  let expression = `${endpoint}.${item.transport.method.toLowerCase()}(${JSON.stringify(name)}, ${JSON.stringify(item.transport.path)}, {\n${indent(options).join("\n")}\n})`;

  if (contract !== undefined) {
    for (const marker of contract.middleware) {
      const symbol = imports.add(marker.module, marker.export);
      expression += `.middleware(${marker.member === undefined ? symbol : `${symbol}.${marker.member}`})`;
    }

    if (contract.metadata !== undefined) {
      const metadata = contract.metadata;
      const annotations: Array<string> = [];

      if (metadata.operationId !== undefined)
        annotations.push(`identifier: ${JSON.stringify(metadata.operationId)}`);

      if (metadata.summary !== undefined)
        annotations.push(`summary: ${JSON.stringify(metadata.summary)}`);

      if (metadata.description !== undefined)
        annotations.push(`description: ${JSON.stringify(metadata.description)}`);

      if (metadata.tags !== undefined)
        annotations.push(`override: { tags: ${JSON.stringify(metadata.tags)} }`);
      const openApi = imports.add("effect/http-api", "OpenApi");
      expression += `.annotateMerge(${openApi}.annotations({ ${annotations.join(", ")} }))`;

      if (metadata.annotator !== undefined) {
        const ref = metadata.annotator;
        const imported = imports.add(ref.module, ref.export);
        const annotator = ref.member === undefined ? imported : `${imported}.${ref.member}`;
        const values: Array<string> = [];

        for (const key of ["operationId", "summary", "description", "tags"] as const) {
          const value = metadata[key];

          if (value !== undefined) values.push(`${key}: ${JSON.stringify(value)}`);
        }

        const args = values.length === 0 ? "{}" : `{ ${values.join(", ")} }`;
        expression += `.annotateMerge(${annotator}(${args}))`;
      }
    }
  }

  if (item.access !== undefined) {
    const data = item.access;
    const annotatorExport = imports.add(data.annotator.module, data.annotator.export);

    const annotator =
      data.annotator.member === undefined
        ? annotatorExport
        : `${annotatorExport}.${data.annotator.member}`;

    const resolverExport = imports.add(
      data.canonicalScopeResolver.module,
      data.canonicalScopeResolver.export,
    );

    const resolver =
      data.canonicalScopeResolver.member === undefined
        ? resolverExport
        : `${resolverExport}.${data.canonicalScopeResolver.member}`;

    expression += `.annotateMerge(${annotator}({ exposure: ${JSON.stringify(data.exposure)}, acceptedCredentials: ${JSON.stringify(data.acceptedCredentials)}, principalKinds: ${JSON.stringify(data.principalKinds)}, capabilities: ${JSON.stringify(data.capabilities)}, requirements: ${JSON.stringify(data.requirements)}, canonicalScopeResolver: ${resolver}, concealment: ${JSON.stringify(data.concealment)}, decisionTime: ${JSON.stringify(data.decisionTime)} }))`;
  }

  return fragments(item).reduce((chain, part) => chain + part.render(imports), expression);
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

const groupAnnotation = (imports: Imports, group: HttpGroup): string => {
  const metadata = group.metadata;

  if (metadata === undefined) return "";
  const fields: Array<string> = [];

  if (metadata.title !== undefined) fields.push(`title: ${JSON.stringify(metadata.title)}`);

  if (metadata.description !== undefined)
    fields.push(`description: ${JSON.stringify(metadata.description)}`);

  if (metadata.displayName !== undefined)
    fields.push(`override: { "x-displayName": ${JSON.stringify(metadata.displayName)} }`);

  return fields.length === 0
    ? ""
    : `.annotateMerge(${imports.add("effect/http-api", "OpenApi")}.annotations({ ${fields.join(", ")} }))`;
};

const groupLines = (
  imports: Imports,
  group: HttpGroup,
  fragments: EndpointFragments,
): ReadonlyArray<string> => {
  const groupType = imports.add("effect/http-api", "HttpApiGroup");

  return [
    `export class ${groupClassName(group.root, group.group)} extends ${groupType}.make(${JSON.stringify(group.group)}).add(`,
    ...indent(group.items.map((item) => `${endpointExpr(imports, item, fragments)},`)),
    `)${groupAnnotation(imports, group)} {}`,
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
  imports: Imports,
  group: HttpGroup,
  fragments: EndpointFragments,
): ReadonlyArray<string> => {
  const groupType = imports.add("effect/http-api", "HttpApiGroup");
  const name = groupApiName(group.group);

  const expressions = new Map(
    group.items.map((item) => [item, endpointExpr(imports, item, fragments)] as const),
  );

  const annotation = groupAnnotation(imports, group);

  // The collector's import bindings occupy the same module scope as the exports.
  const imported = new Set(
    imports.render().flatMap((line) => {
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
    `export const ${name} = ${groupType}.make(${JSON.stringify(group.group)}).add(`,
    ...indent(group.items.map((item) => `${constants.get(item)},`)),
    `)${annotation};`,
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
const externalHandlersLines = (imports: Imports, group: HttpGroup): ReadonlyArray<string> => {
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
    ...groups.flatMap((group) => [...groupLines(imports, group, fragments), ""]),
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
            render(header(group.items), imports, contractLines(imports, group, fragments)),
          ),
        );
      }
    }

    if (context.emit !== "contract") {
      for (const group of externalGroups) {
        const imports = new Imports(context);
        files.push(
          generated(
            filename(group, "handlers"),
            render(header(group.items), imports, externalHandlersLines(imports, group)),
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
