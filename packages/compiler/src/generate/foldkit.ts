import { Effect } from "effect";
import { defaultGenerationContext, type Generator } from "../Extension.ts";
import { Imports, generated, header, indent, pathParams, render, schemaExpr } from "./emit.ts";
import { clientOperationName } from "./client.ts";
import {
  type HttpGroup,
  type HttpItem,
  clientName,
  endpointKey,
  handlerName,
  httpGroups,
  httpItems,
} from "./http-contracts.ts";
import { moduleSpecifier } from "./target.ts";

/** The request fields come from the same validated HTTP channel refs as http.ts. */
const requestFields = (imports: Imports, item: HttpItem): ReadonlyArray<string> => {
  const contract = item.contract;

  if (contract !== undefined)
    return (["params", "query", "headers", "payload"] as const).flatMap((channel) => {
      const ref = contract[channel];

      return ref === undefined ? [] : [`${channel}: ${schemaExpr(imports, ref)},`];
    });

  // Legacy HTTP endpoints declare their input as payload; GET takes its Struct fields.
  const params = pathParams(item.transport.path);
  const schema = imports.add("effect", "Schema");
  const input = schemaExpr(imports, item.operation.input);

  return [
    ...(params.length === 0
      ? []
      : [
          `params: ${schema}.Struct({ ${params.map((param) => `${JSON.stringify(param)}: ${schema}.String`).join(", ")} }),`,
        ]),
    `payload: ${item.transport.method === "GET" ? `${schema}.Struct(${input}.fields)` : input},`,
  ];
};

const groupBody = (
  imports: Imports,
  group: HttpGroup,
  external: ReadonlyArray<HttpItem>,
): ReadonlyArray<string> => {
  const effect = imports.add("effect", "Effect");
  const schema = imports.add("effect", "Schema");
  const command = imports.add("foldkit", "Command");
  const service = imports.add("./client.ts", clientName(group.root));
  const failureType = "EffectSdkFailure";
  const successType = "EffectSdkSuccess";

  const entries = group.items.map((item) => {
    // groupBody receives only httpGroups(annotated); each item has a UiCommand.
    const messages = item.uiCommand!;
    const name = clientOperationName(item, external);
    const operation = imports.add("./client.ts", name);
    const success = schemaExpr(imports, messages.success);
    const failure = schemaExpr(imports, messages.failure);
    const result = `${successType}<${JSON.stringify(item.root)}, ${JSON.stringify(item.group)}, ${JSON.stringify(endpointKey(item))}>`;
    const error = `${failureType}<${JSON.stringify(item.root)}, ${JSON.stringify(item.group)}, ${JSON.stringify(endpointKey(item))}>`;

    return {
      adapter: [
        `readonly ${name}: {`,
        ...indent([
          `readonly success: (value: { readonly requestId: number; readonly result: ${result} }) => typeof ${success}.Type;`,
          `readonly failure: (value: { readonly requestId: number; readonly failure: ${error} }) => typeof ${success}.Type | typeof ${failure}.Type;`,
        ]),
        "};",
      ],
      definition: [
        `${name}: ${command}.define(${JSON.stringify(name)}, {`,
        ...indent([
          "args: {",
          ...indent([
            `requestId: ${schema}.Int,`,
            `request: ${schema}.Struct({`,
            ...indent(requestFields(imports, item), 2),
            "}),",
          ]),
          "},",
          `messages: [${success}, ${failure}],`,
          "execute: ({ requestId, request }) =>",
          ...indent([
            `${operation}(request).pipe(`,
            ...indent([
              `${effect}.provideService(${service}, client),`,
              `${effect}.map((result) => adapters.${name}.success({ requestId, result })),`,
              `${effect}.catch((failure) =>`,
              ...indent([`${effect}.succeed(adapters.${name}.failure({ requestId, failure })),`]),
              "),",
            ]),
            "),",
          ]),
        ]),
        "}),",
      ],
    };
  });

  return [
    `/** One-shot Commands; the Foldkit runtime owns execution and cancellation. */`,
    `export const ${handlerName(group.root, group.group).replace(/Handlers$/, "CommandsFor")} = (`,
    `  client: ${service}["Service"],`,
    "  adapters: {",
    ...indent(
      entries.flatMap((entry) => entry.adapter),
      2,
    ),
    "  },",
    ") => ({",
    ...indent(entries.flatMap((entry) => entry.definition)),
    "});",
    "",
  ];
};

/** Opt-in projection: no Foldkit import or generated file for unannotated operations. */
export const foldkitGenerator: Generator = (ir, index, context = defaultGenerationContext) =>
  context.emit !== "all"
    ? Effect.succeed([])
    : Effect.map(httpItems(ir, index), (items) => {
        const callable = items.filter(
          (item) => item.operation.handler !== undefined && item.access?.exposure !== "Internal",
        );

        const annotated = callable.filter((item) => item.uiCommand !== undefined);

        if (annotated.length === 0) return [];

        const imports = new Imports(context);

        const body = [
          `import type { EffectSdkFailure, EffectSdkSuccess } from "${moduleSpecifier(context, "./client.ts")}";`,
          "",
          ...httpGroups(annotated).flatMap((group) => groupBody(imports, group, callable)),
        ];

        return [generated("foldkit.ts", render(header(annotated), imports, body.slice(0, -1)))];
      });
