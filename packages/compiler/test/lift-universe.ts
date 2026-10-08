import { Schema } from "effect";
import { StableId, type SchemaRef, type SymbolRef } from "@effx/ir";
import type {
  Annotation,
  AnnotationArg,
  Collected,
  Declaration,
  LiftInput,
  LiftRule,
  MiddlewareFact,
  SchemaFact,
} from "@effx/compiler";
import type { Universe } from "./lift-source.ts";

/*
 * A universe of generated HTTP groups for the laws of spec 0019 §2.5. `EndpointSpec` and `GroupSpec` are
 * Schemas, so the existing Arbitrary adapter draws them (seeded, shrinking, replayable); `collectedOf` turns a
 * spec into the exact `Collected` a frontend would collect from the verbose builder declarations of it. The
 * rules below are the application adapters the generator's own spellings go through (`annotator({ … })`,
 * `registry(identifier, [codes])`).
 */

export const APP = "@app/support";

export const OUTPUT = "@app/items.effx";

export const ROOT_ID = "external-api";

export const GROUP_ID = "items";

const schemaRef = (name: string): SchemaRef => ({
  module: APP,
  export: name,
  symbolId: StableId.make("schema", `app/${name}`),
});

const symbolRef = (name: string): SymbolRef => ({ module: APP, export: name });

const schemaArg = (name: string, fields?: ReadonlyArray<string>): AnnotationArg =>
  fields === undefined
    ? { _tag: "Schema", ref: schemaRef(name) }
    : { _tag: "Schema", ref: schemaRef(name), fields: [...fields] };

const symbolArg = (name: string, security?: boolean): AnnotationArg =>
  security === true
    ? { _tag: "Symbol", ref: symbolRef(name), security }
    : { _tag: "Symbol", ref: symbolRef(name) };

/** The static facts the application's schemas carry (what a frontend reads from their types). */
export const facts: ReadonlyArray<SchemaFact> = [
  { ref: schemaRef("ItemParams"), allKeys: ["id"] },
  { ref: schemaRef("ItemQuery"), allKeys: ["page", "size"] },
  { ref: schemaRef("ItemHeaders"), allKeys: ["x-token", "x-extra"], requiredKeys: ["x-token"] },
  { ref: schemaRef("ItemBody"), allKeys: ["name"] },
  { ref: schemaRef("EmptyInput"), allKeys: [] },
];

export const markers: ReadonlyArray<MiddlewareFact> = [
  { ref: symbolRef("PersonSecurity"), security: true },
  { ref: symbolRef("RateLimit"), security: false },
];

const schemaNames = [
  "ItemParams",
  "ItemQuery",
  "ItemHeaders",
  "ItemBody",
  "EmptyInput",
  "ItemResponse",
  "ItemResponseHeaders",
];

export const universe: Universe = {
  target: "effect-4.0-rc",
  schemas: schemaNames.map(schemaRef),
  facts,
  markers,
  root: { symbol: symbolRef("ExternalApi"), id: ROOT_ID },
};

export const EndpointSpec = Schema.Struct({
  verb: Schema.Literals(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  params: Schema.Boolean,
  query: Schema.Boolean,
  headers: Schema.Boolean,
  payload: Schema.Boolean,
  merge: Schema.Boolean,
  response: Schema.Literals(["plain", "headers", "conditional"]),
  status: Schema.Literals(["default", 200, 201, 202]),
  middleware: Schema.Literals(["none", "plain", "security", "both"]),
  annotator: Schema.Boolean,
  details: Schema.Boolean,
  problems: Schema.Boolean,
  access: Schema.Literals(["none", "one", "any", "all", "open"]),
  concealment: Schema.Boolean,
});

export type EndpointSpec = typeof EndpointSpec.Type;

export const GroupSpec = Schema.Struct({
  title: Schema.Boolean,
  endpoints: Schema.Array(EndpointSpec).check(Schema.isMinLength(1), Schema.isMaxLength(4)),
});

export type GroupSpec = typeof GroupSpec.Type;

const options = (
  entries: ReadonlyArray<readonly [string, AnnotationArg | undefined]>,
): AnnotationArg =>
  Object.fromEntries(
    entries.flatMap(([key, value]) => (value === undefined ? [] : [[key, value] as const])),
  );

const annotation = (name: string, arg: AnnotationArg): Annotation => ({ name, args: [arg] });

const accessArgs = (
  spec: EndpointSpec,
  index: number,
  kind: "Query" | "Command",
): AnnotationArg => {
  const capabilities: AnnotationArg =
    spec.access === "one"
      ? { _tag: "One", capability: `items.cap${index}` }
      : spec.access === "any"
        ? { _tag: "Any", capabilities: [`items.a${index}`, `items.b${index}`] }
        : spec.access === "all"
          ? { _tag: "All", capabilities: [`items.a${index}`, `items.b${index}`] }
          : { _tag: "None" };

  return options([
    ["annotator", symbolArg("accessAnnotations")],
    ["exposure", "External"],
    ["acceptedCredentials", ["Cookie", "Bearer"]],
    ["principalKinds", ["Person"]],
    ["capabilities", capabilities],
    ["requirements", spec.access === "open" ? [] : [{ id: "items.owner" }]],
    ["canonicalScopeResolver", symbolArg("CurrentPerson")],
    [
      "concealment",
      spec.concealment ? { _tag: "NotFound", stages: ["denied"] } : { _tag: "Reveal" },
    ],
    ["decisionTime", kind === "Query" ? "SnapshotRead" : "Transaction"],
  ]);
};

const declarationOf = (spec: EndpointSpec, index: number): Declaration => {
  const kind = spec.verb === "GET" ? "Query" : "Command";
  const key = `op${index}`;
  const name = `${GROUP_ID}.${key}`;
  const body = spec.payload && spec.verb !== "GET" && spec.verb !== "DELETE";

  const secured =
    spec.access !== "none" || spec.middleware === "security" || spec.middleware === "both";

  const middleware: ReadonlyArray<AnnotationArg> = [
    ...(spec.middleware === "plain" || spec.middleware === "both" ? [symbolArg("RateLimit")] : []),
    ...(secured ? [symbolArg("PersonSecurity", true)] : []),
  ];

  // The channel that serves as `Operation.input`: payload, query, headers, params, else the empty input.
  const input: AnnotationArg = body
    ? schemaArg("ItemBody", ["name"])
    : spec.query
      ? schemaArg("ItemQuery", ["page", "size"])
      : spec.headers
        ? schemaArg("ItemHeaders", ["x-token", "x-extra"])
        : spec.params
          ? schemaArg("ItemParams", ["id"])
          : schemaArg("EmptyInput", []);

  const contract = options([
    ["root", ROOT_ID],
    ["group", GROUP_ID],
    ["params", spec.params ? schemaArg("ItemParams", ["id"]) : undefined],
    ["query", spec.query ? schemaArg("ItemQuery") : undefined],
    ["headers", spec.headers ? schemaArg("ItemHeaders", ["x-token"]) : undefined],
    ["payload", body ? schemaArg("ItemBody") : undefined],
    ["mediaType", body && spec.merge ? "application/merge-patch+json" : undefined],
    ["success", schemaArg("ItemResponse")],
    // An explicit 200 written as `status(200)` is the dense default: lift drops it, so it is not in the image.
    [
      "status",
      spec.status === "default" || (spec.status === 200 && spec.response !== "plain")
        ? undefined
        : spec.status,
    ],
    ["responseHeaders", spec.response === "plain" ? undefined : schemaArg("ItemResponseHeaders")],
    ["conditional", spec.response === "conditional" && spec.verb === "GET" ? true : undefined],
    ["middleware", middleware.length === 0 ? undefined : [...middleware]],
    [
      "metadata",
      options([
        ["annotator", spec.annotator ? symbolArg("operationAnnotations") : undefined],
        ["operationId", name],
        ["summary", spec.details ? `Operation ${index}` : undefined],
        ["description", spec.details ? `Does what operation ${index} says.` : undefined],
        ["tags", spec.details ? ["Items"] : undefined],
      ]),
    ],
  ]);

  return {
    id: `Op${index}`,
    kind: "builder",
    module: OUTPUT,
    export: `Op${index}`,
    binding: "external",
    annotations: [
      annotation(
        kind,
        options([
          ["name", name],
          ["input", input],
          ["success", schemaArg("ItemResponse")],
        ]),
      ),
      annotation(
        `Http.${spec.verb.charAt(0)}${spec.verb.slice(1).toLowerCase()}`,
        spec.params ? `/items/${index}/:id` : `/items/${index}`,
      ),
      annotation("Http.Contract", contract),
      ...(spec.problems
        ? [
            annotation(
              "Http.Problems",
              options([
                ["registry", symbolArg("problems")],
                ["codes", [`items.missing${index}`, "internal.error"]],
                ["identifier", `Op${index}Problem`],
              ]),
            ),
          ]
        : []),
      ...(spec.access === "none" ? [] : [annotation("Http.Access", accessArgs(spec, index, kind))]),
    ],
  };
};

/** The verbose `Collected` of a group spec: the group declaration first, then one operation per endpoint. */
export const collectedOf = (spec: GroupSpec): Collected => ({
  diagnostics: [],
  project: {
    target: "effect-4.0-rc",
    emit: "contract",
    allowImportingTsExtensions: false,
    canonicalImportBase: "/app",
    outputDir: "/app/.effx/generated",
  },
  declarations: [
    {
      id: "ItemsGroup",
      kind: "builder",
      module: OUTPUT,
      export: "ItemsGroup",
      annotations: [
        annotation(
          "Http.Group",
          options([
            ["root", { _tag: "Symbol", ref: universe.root.symbol, identifier: ROOT_ID }],
            ["group", GROUP_ID],
            ["title", spec.title ? "Items" : undefined],
            ["description", spec.title ? "Item operations." : undefined],
            ["displayName", spec.title ? "Items" : undefined],
          ]),
        ),
      ],
    },
    ...spec.endpoints.map(declarationOf),
  ],
});

/** The rules for the application adapters of the generated spellings. */
export const rules: ReadonlyArray<LiftRule> = [
  {
    _tag: "Metadata",
    callee: symbolRef("operationAnnotationsOf"),
    annotator: symbolRef("operationAnnotations"),
    positional: ["summary", "description"],
  },
  {
    _tag: "ProblemRegistry",
    response: symbolRef("problemResponses"),
    union: symbolRef("problemUnion"),
    registry: symbolRef("problems"),
  },
  {
    _tag: "Access",
    callee: symbolRef("itemAccess"),
    annotator: symbolRef("accessAnnotations"),
    arguments: {
      _tag: "Object",
      fields: [{ name: "capability", kind: "string", required: true }],
    },
    resolver: { _tag: "Const", value: "current-person" },
    emit: {
      exposure: { _tag: "Const", value: "External" },
      acceptedCredentials: { _tag: "Const", value: ["Cookie", "Bearer"] },
      principalKinds: { _tag: "Const", value: ["Person"] },
      capabilities: {
        _tag: "Object",
        fields: [
          { key: "_tag", value: { _tag: "Const", value: "One" } },
          { key: "capability", value: { _tag: "Arg", name: "capability" } },
        ],
      },
      requirements: { _tag: "Const", value: [] },
      concealment: {
        _tag: "Object",
        fields: [{ key: "_tag", value: { _tag: "Const", value: "Reveal" } }],
      },
      decisionTime: { _tag: "Const", value: "SnapshotRead" },
    },
  },
];

export const liftInput: LiftInput = {
  group: GROUP_ID,
  rules,
  names: { "current-person": symbolRef("CurrentPerson") },
  emptyInput: schemaRef("EmptyInput"),
  output: { module: OUTPUT },
  project: {
    target: "effect-4.0-rc",
    emit: "contract",
    allowImportingTsExtensions: false,
    canonicalImportBase: "/app",
    outputDir: "/app/.effx/generated",
  },
};
