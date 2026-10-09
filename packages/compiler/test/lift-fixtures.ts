import { StableId } from "@effx/ir";
import type { LiftInput, LiftRule } from "@effx/compiler";
import { profileRules } from "./lift-profile.ts";
import type { SourceFile, Universe } from "./lift-source.ts";

/*
 * Source text for the lift core, in the shapes of spec 0019 §3.3: the mono-web Profile group (a supported
 * read, a mutation that needs two refactors) and a negative inventory with one endpoint per way a declaration
 * can be unsupported. The modules are real text that a frontend would lower; only the support modules'
 * bodies are placeholders, because lift reads which symbols they export and never evaluates them.
 */

const file = (path: string, lines: ReadonlyArray<string>): SourceFile => ({
  path,
  contents: `${lines.join("\n")}\n`,
});

export const supportFiles: ReadonlyArray<SourceFile> = [
  file("src/http-semantics.ts", [
    'import { Schema } from "effect";',
    'import { HttpApiSchema } from "effect/unstable/httpapi";',
    "",
    'export const ConditionalReadHeaders = Schema.Struct({ "if-none-match": Schema.String });',
    "",
    "export const EntityMutationResponseHeaders = Schema.Struct({ etag: Schema.String });",
    "",
    "export const privateConditionalResponses = (schema) =>",
    "  HttpApiSchema.WithHeaders(schema, { etag: Schema.String });",
    "",
    "export const entityMutationResponse = (schema) =>",
    "  HttpApiSchema.WithHeaders(schema, EntityMutationResponseHeaders);",
    "",
    "export const documentMutationResponse = (contentType) => contentType;",
    "",
    "export const endpointProblemResponses = (union) => union;",
    "",
    "export const problemUnion = (identifier) => identifier;",
  ]),
  file("src/common.ts", [
    'export const PersonSecurity = "person";',
    "",
    "export const operationAnnotations = (summary) => summary;",
    "",
    "export const nativeOperationAnnotations = (summary) => summary;",
  ]),
  file("src/access.ts", [
    "export const annotateAccessSpec = (endpoint) => endpoint;",
    "",
    "export const personNativeAccess = (spec) => spec;",
    "",
    'export const PUBLIC_ACCESS = "public";',
  ]),
  file("src/profile-effx-adapters.ts", [
    "export const profileAccessAnnotations = (spec) => spec;",
    "",
    'export const ProfileCurrentPerson = "resolver";',
  ]),
  file("src/mystery.ts", [
    "export const mysteryWrapper = (schema) => schema;",
    "",
    "export const mysteryAnnotations = (summary) => summary;",
    "",
    "export const mysteryAccess = (spec) => spec;",
    "",
    "export const mysteryProblems = (union) => union;",
  ]),
  file("src/v2-schemas.ts", [
    'import { Schema } from "effect";',
    "",
    "export const UserProfileResponse = Schema.Struct({ id: Schema.String });",
    "",
    "export const ProfileMergePatch = Schema.Struct({ firstName: Schema.optional(Schema.String) });",
    "",
    "export const EmptyInput = Schema.Struct({});",
  ]),
  file("src/endpoint-problems.ts", [
    'import { problemUnion } from "./http-semantics.js";',
    "",
    'export const nativeProblems = "registry";',
    "",
    'export const ProfileReadOwnProfileProblem = problemUnion("ProfileReadOwnProfileProblem", [',
    '  "request.malformed",',
    '  "precondition.failed",',
    "]);",
    "",
    'export const ProfileUpdateOwnProfileProblem = problemUnion("ProfileUpdateOwnProfileProblem", [',
    '  "request.malformed",',
    '  "validation.failed",',
    "]);",
  ]),
];

const httpApiImports = [
  'import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";',
  'import { Schema } from "effect";',
];

/** `src/profile.ts`: a conditional read that is supported as written, and a patch that needs two refactors. */
export const profileFile = file("src/profile.ts", [
  ...httpApiImports,
  'import { annotateAccessSpec, personNativeAccess } from "./access.js";',
  'import { PersonSecurity, operationAnnotations } from "./common.js";',
  'import { ProfileReadOwnProfileProblem, ProfileUpdateOwnProfileProblem } from "./endpoint-problems.js";',
  "import {",
  "  ConditionalReadHeaders,",
  "  endpointProblemResponses,",
  "  entityMutationResponse,",
  "  privateConditionalResponses,",
  '} from "./http-semantics.js";',
  'import { ProfileMergePatch, UserProfileResponse } from "./v2-schemas.js";',
  "",
  'export const ReadOwnProfileEndpoint = HttpApiEndpoint.get("readOwnProfile", "/api/profile", {',
  "  headers: ConditionalReadHeaders,",
  "  success: privateConditionalResponses(UserProfileResponse),",
  "  error: endpointProblemResponses(ProfileReadOwnProfileProblem),",
  "})",
  "  .middleware(PersonSecurity)",
  "  .pipe((e) =>",
  "    annotateAccessSpec(",
  "      e,",
  "      personNativeAccess({",
  '        capability: "profile.read-self",',
  '        canonicalScopeResolver: "profile.current-person",',
  '        requirements: ["profile.owner"],',
  '        decisionTime: "SnapshotRead",',
  "      }),",
  "    ),",
  "  )",
  '  .annotateMerge(operationAnnotations("Read own profile", "Returns the current profile."));',
  "",
  'export const UpdateOwnProfileEndpoint = HttpApiEndpoint.patch("updateOwnProfile", "/api/profile", {',
  "  query: { dryRun: Schema.String },",
  '  payload: ProfileMergePatch.pipe(HttpApiSchema.asJson({ contentType: "application/merge-patch+json" })),',
  "  success: entityMutationResponse(UserProfileResponse),",
  "  error: endpointProblemResponses(ProfileUpdateOwnProfileProblem),",
  "})",
  "  .middleware(PersonSecurity)",
  "  .pipe((e) =>",
  "    annotateAccessSpec(",
  "      e,",
  "      personNativeAccess({",
  '        capability: "profile.update-self",',
  '        canonicalScopeResolver: "profile.current-person",',
  "        requirements: [],",
  '        decisionTime: "Transaction",',
  "      }),",
  "    ),",
  "  )",
  '  .annotateMerge(operationAnnotations("Update own profile", "Applies a merge patch."));',
  "",
  'export const ProfileApi = HttpApiGroup.make("profile")',
  "  .add(ReadOwnProfileEndpoint, UpdateOwnProfileEndpoint)",
  '  .annotateMerge(OpenApi.annotations({ title: "Profile", description: "Self service profile API." }));',
  "",
  'export const ExternalNativeApi = HttpApi.make("external-native-api").add(ProfileApi);',
]);

export const profileFiles: ReadonlyArray<SourceFile> = [...supportFiles, profileFile];

const schemaRef = (module: string, name: string) => ({
  module,
  export: name,
  symbolId: StableId.make("schema", `${module.replace(/^\.\//u, "")}/${name}`),
});

export const sourceUniverse: Universe = {
  target: "effect-4.0-rc",
  schemas: [],
  facts: [],
  markers: [{ ref: { module: "./src/common", export: "PersonSecurity" }, security: true }],
  root: { symbol: { module: "./src/api", export: "ExternalNativeApi" }, id: "external-native-api" },
};

const mutationRule: LiftRule = {
  _tag: "SuccessWrapper",
  callee: { module: "./src/http-semantics", export: "entityMutationResponse" },
  responseHeaders: schemaRef("./src/http-semantics", "EntityMutationResponseHeaders"),
};

const documentRule: LiftRule = {
  _tag: "NoSchemaSuccess",
  callee: { module: "./src/http-semantics", export: "documentMutationResponse" },
};

export const sourceInput = (group: string): LiftInput => ({
  group,
  rules: [...profileRules, mutationRule, documentRule],
  names: {
    "profile.current-person": {
      module: "./src/profile-effx-adapters",
      export: "ProfileCurrentPerson",
    },
  },
  emptyInput: schemaRef("./src/v2-schemas", "EmptyInput"),
  output: { module: "./src/lifted.effx" },
  project: {
    target: "effect-4.0-rc",
    emit: "contract",
    allowImportingTsExtensions: false,
    canonicalImportBase: "/app",
    outputDir: "/app/.effx/generated",
  },
});

/** A negative endpoint: its source, and what lifting it must report (the primary code and the related ones). */
export interface Negative {
  readonly name: string;
  readonly lines: ReadonlyArray<string>;
  /** The text whose first occurrence is where the primary diagnostic points. */
  readonly at: string;
  readonly primary: string;
  readonly related?: ReadonlyArray<string>;
}

const stub = (key: string, path: string, options: ReadonlyArray<string>): ReadonlyArray<string> => [
  `HttpApiEndpoint.get("${key}", "${path}", {`,
  ...options,
  ...(options.some((option) => option.trimStart().startsWith("error:"))
    ? []
    : ["  error: Schema.Never,"]),
  "})",
];

const success = "  success: UserProfileResponse,";

/** Each way an endpoint can be unsupported, one endpoint each (spec 0019 §3.2 level U, §6). */
export const negatives: ReadonlyArray<Negative> = [
  {
    name: "options spread",
    lines: stub("spreadOptions", "/n/spread", ["  ...sharedOptions,", success]),
    at: "...sharedOptions",
    primary: "EFFX3001",
  },
  {
    name: "a key that is a local constant",
    lines: ['HttpApiEndpoint.get(localKey, "/n/key", {', success, "  error: Schema.Never,", "})"],
    at: "localKey",
    primary: "EFFX3001",
  },
  {
    name: "an unknown step",
    lines: [...stub("unknownStep", "/n/step", [success]), "  .setHeaders(UserProfileResponse)"],
    at: ".setHeaders(",
    primary: "EFFX3001",
  },
  {
    name: "an unknown annotation key",
    lines: [...stub("annotateKey", "/n/annotate", [success]), '  .annotate(SomeKey, "value")'],
    at: ".annotate(",
    primary: "EFFX3001",
  },
  {
    name: "an inline payload that Effect form encodes",
    lines: stub("formPayload", "/n/form", ["  payload: { name: Schema.String },", success]),
    at: "{ name: Schema.String }",
    primary: "EFFX3001",
  },
  {
    name: "a registered metadata call with a non-literal argument",
    lines: [
      ...stub("nonLiteralMetadata", "/n/meta", [success]),
      '  .annotateMerge(operationAnnotations(localSummary, "described"))',
    ],
    at: "localSummary",
    primary: "EFFX3001",
  },
  {
    name: "a success without a schema",
    lines: stub("noSuccess", "/n/nosuccess", ["  headers: ConditionalReadHeaders,"]),
    at: "{\n  headers",
    primary: "EFFX3007",
  },
  {
    name: "a document body of a runtime content type",
    lines: stub("documentBody", "/n/document", [
      '  success: documentMutationResponse("application/pdf"),',
    ]),
    at: "documentMutationResponse(",
    primary: "EFFX3007",
  },
  {
    name: "an unregistered success wrapper",
    lines: stub("unregisteredSuccess", "/n/wrapper", [
      "  success: mysteryWrapper(UserProfileResponse),",
    ]),
    at: "mysteryWrapper(",
    primary: "EFFX3006",
  },
  {
    name: "an unregistered metadata helper",
    lines: [
      ...stub("unregisteredMetadata", "/n/metahelper", [success]),
      '  .annotateMerge(mysteryAnnotations("x"))',
    ],
    at: "mysteryAnnotations(",
    primary: "EFFX3006",
  },
  {
    name: "an unregistered access builder",
    lines: [
      ...stub("unregisteredAccess", "/n/access", [success]),
      '  .pipe((e) => annotateAccessSpec(e, mysteryAccess({ capability: "x" })))',
    ],
    at: "mysteryAccess(",
    primary: "EFFX3006",
  },
  {
    name: "an unregistered problem helper",
    lines: stub("unregisteredProblems", "/n/problems", [
      success,
      "  error: mysteryProblems(ProfileReadOwnProfileProblem),",
    ]),
    at: "mysteryProblems(",
    primary: "EFFX3006",
  },
  {
    name: "access written as a local closure",
    lines: [
      ...stub("accessClosure", "/n/closure", [success]),
      "  .pipe((e) => annotateAccessSpec(e, localAccess(true)))",
    ],
    at: "localAccess(",
    primary: "EFFX3005",
  },
  {
    name: "access written as an exported constant",
    lines: [
      ...stub("accessConstant", "/n/constant", [success]),
      "  .pipe((e) => annotateAccessSpec(e, PUBLIC_ACCESS))",
    ],
    at: "PUBLIC_ACCESS)",
    primary: "EFFX3005",
  },
  {
    name: "access whose argument object spreads",
    lines: [
      ...stub("accessSpread", "/n/accessspread", [success]),
      '  .pipe((e) => annotateAccessSpec(e, personNativeAccess({ ...baseAccess, capability: "x" })))',
    ],
    at: "...baseAccess",
    primary: "EFFX3005",
  },
  {
    name: "problem codes that are not literal strings",
    lines: stub("nonLiteralCodes", "/n/codes", [
      success,
      "  error: endpointProblemResponses(NonLiteralProblem),",
    ]),
    at: "export const NonLiteralProblem",
    primary: "EFFX3004",
  },
  {
    name: "a POST with no request channel",
    lines: [
      'HttpApiEndpoint.post("noChannelPost", "/n/nochannel", {',
      success,
      "  error: Schema.Never,",
      "})",
    ],
    at: "{\n  success",
    primary: "EFFX3001",
  },
  {
    name: "every cause at once, ordered by where they are",
    lines: [
      'HttpApiEndpoint.get("everything", "/n/everything", {',
      "  ...sharedOptions,",
      "  success: mysteryWrapper(UserProfileResponse),",
      "})",
      "  .setHeaders(UserProfileResponse)",
      '  .annotateMerge(mysteryAnnotations("x"))',
    ],
    at: "...sharedOptions",
    primary: "EFFX3001",
    related: ["EFFX3006", "EFFX3001", "EFFX3006"],
  },
];

/** The source of one negative endpoint exactly as it appears in `src/negative.ts` (after its export). */
export const chunkOf = (negative: Negative): string => negative.lines.join("\n");

export const exportNameOf = (negative: Negative): string =>
  negative.name.replace(
    /[^A-Za-z]+(.)?/gu,
    (_, next: string | undefined) => next?.toUpperCase() ?? "",
  );

/** `<group>.<key>` as lift names the endpoint: the key literal, else the declared export (a computed key). */
export const subjectOf = (negative: Negative): string =>
  `negative.${/^HttpApiEndpoint\.\w+\("([^"]+)"/u.exec(negative.lines[0] ?? "")?.[1] ?? exportNameOf(negative)}`;

const groupOf = (negative: Negative): string =>
  `export const ${exportNameOf(negative)} = ${chunkOf(negative)};`;

/** `src/negative.ts`: every negative endpoint, one group, plus the declarations they refer to. */
export const negativeFile = file("src/negative.ts", [
  ...httpApiImports,
  'import { annotateAccessSpec, personNativeAccess, PUBLIC_ACCESS } from "./access.js";',
  'import { PersonSecurity, operationAnnotations } from "./common.js";',
  'import { ProfileReadOwnProfileProblem } from "./endpoint-problems.js";',
  'import { ConditionalReadHeaders, documentMutationResponse, endpointProblemResponses, problemUnion } from "./http-semantics.js";',
  'import { UserProfileResponse } from "./v2-schemas.js";',
  'import { mysteryAccess, mysteryAnnotations, mysteryProblems, mysteryWrapper } from "./mystery.js";',
  "",
  'const localKey = "localKey";',
  'const localSummary = "summary";',
  "const localAccess = (flag) => flag;",
  "const baseAccess = {};",
  "const sharedOptions = {};",
  "",
  'export const SomeKey = "some-key";',
  'export const CodeA = "code.a";',
  'export const NonLiteralProblem = problemUnion("NonLiteralProblem", [CodeA, "code.b"]);',
  "",
  ...negatives.flatMap((negative) => [groupOf(negative), ""]),
  'export const NegativeApi = HttpApiGroup.make("negative").add(',
  ...negatives.map((negative) => `  ${exportNameOf(negative)},`),
  ");",
  "",
  'export const NegativeRoot = HttpApi.make("negative-root").add(NegativeApi);',
]);

export const negativeFiles: ReadonlyArray<SourceFile> = [...supportFiles, negativeFile];

export const negativeUniverse: Universe = {
  ...sourceUniverse,
  root: { symbol: { module: "./src/negative", export: "NegativeRoot" }, id: "negative-root" },
};
