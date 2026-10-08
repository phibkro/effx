import { Schema } from "effect";
import { defineDiagnostic, type DiagnosticEntry } from "@effx/diagnostics";

/*
 * The EFFX30xx/31xx/32xx families of spec 0019 §6. Every entry describes a source or check outcome as data:
 * unsupported source is never a `CompilerFault`. `subject` names the declaration the way the user wrote it
 * (`<group>.<endpointKey>`); the occurrence location and the related causes stay caller-owned.
 */

const Subject = Schema.String;

const UnsupportedParams = Schema.TaggedUnion({
  ComputedKey: { subject: Subject, construct: Schema.String },
  Spread: { subject: Subject, construct: Schema.String },
  UnknownStep: { subject: Subject, step: Schema.String },
  UnknownPipeStep: { subject: Subject, construct: Schema.String },
  UnknownAnnotationKey: { subject: Subject, key: Schema.String },
  FormEncodedPayload: { subject: Subject },
  GroupConstruct: { subject: Subject, construct: Schema.String },
  NonLiteralArgument: { subject: Subject, callee: Schema.String, argument: Schema.String },
  UnsupportedOption: { subject: Subject, callee: Schema.String, option: Schema.String },
  UnrecognizedConstruct: { subject: Subject, construct: Schema.String },
});

const renderUnsupported = UnsupportedParams.match({
  ComputedKey: ({ subject, construct }) =>
    `${subject}: computed ${construct} is not a literal; lift reads only literal keys, paths and option objects`,
  Spread: ({ subject, construct }) =>
    `${subject}: spread in ${construct} is not supported; lift never evaluates or partially evaluates a spread`,
  UnknownStep: ({ subject, step }) =>
    `${subject}: endpoint step .${step}(...) is not part of the supported declaration grammar`,
  UnknownPipeStep: ({ subject, construct }) =>
    `${subject}: .pipe step ${construct} is not a registered application wrapper`,
  UnknownAnnotationKey: ({ subject, key }) =>
    `${subject}: .annotate key ${key} is not a registered annotation definition`,
  FormEncodedPayload: ({ subject }) =>
    `${subject}: an inline payload field object is form encoded by Effect and has no effx media type`,
  GroupConstruct: ({ subject, construct }) =>
    `${subject}: ${construct} is outside the supported group and root declaration grammar`,
  NonLiteralArgument: ({ subject, callee, argument }) =>
    `${subject}: registered call ${callee}(...) has a non-literal ${argument}; lift never evaluates arguments`,
  UnsupportedOption: ({ subject, callee, option }) =>
    `${subject}: ${callee}(...) option ${option} has no effx declaration`,
  UnrecognizedConstruct: ({ subject, construct }) =>
    `${subject}: unsupported Effect construct ${construct}`,
});

const d3001 = defineDiagnostic(
  {
    code: "EFFX3001",
    owner: "lift",
    title: "Unsupported Effect construct",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "Lift reads only the exact declaration grammar of the spec: literal keys, paths and option objects; registered application wrappers; registered metadata calls with literal arguments; registered annotation keys. A computed key, path or option object, a spread, an unknown endpoint step, an unknown pipe step, an unregistered annotation key, a form-encoded inline payload, a group prefix, group middleware or group addError, and a registered metadata call with a non-literal argument are all reported with the construct named. The endpoint is omitted from every suggestion: lift never guesses and never evaluates source.",
    examples: [
      {
        before:
          'HttpApiEndpoint.get("list", "/items", { success: ItemsResponse }).setHeaders(CustomHeaders)',
        after: 'HttpApiEndpoint.get("list", "/items", { success: ItemsResponse })',
        explanation:
          "Remove the unsupported step or move the behavior into a registered wrapper; lift reports the construct instead of dropping it.",
      },
    ],
  } as const,
  UnsupportedParams,
  renderUnsupported,
);

const RefactorChannel = Schema.Literals(["params", "query", "headers", "payload", "success"]);

const RefactorForm = Schema.Literals(["inline-fields", "fields-access", "schema-call"]);

const d3002 = defineDiagnostic(
  {
    code: "EFFX3002",
    owner: "lift",
    title: "Channel schema must be an exported named schema",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "A request channel or the success of an endpoint is written as inline fields, as the bare fields of another schema, or as an inline Schema expression, so it has no exported name. An effx declaration references schemas by exported name, so lift suggests a wire-preserving refactor that exports a named schema and points the channel at it. The diagnostic carries the source edits; it blocks --check unless the overlay applies it.",
    examples: [
      {
        before: "query: ScopeQuery.fields",
        after:
          "export const ScopeQuerySchema = Schema.Struct(ScopeQuery.fields);\n// query: ScopeQuerySchema",
        explanation:
          "The bare fields are not the schema itself, because the named schema carries an identifier annotation that would add an OpenAPI component.",
      },
    ],
  } as const,
  Schema.Struct({
    subject: Subject,
    channel: RefactorChannel,
    form: RefactorForm,
    planned: Schema.String,
  }),
  ({ subject, channel, form, planned }) =>
    `${subject}: ${channel} is ${form === "inline-fields" ? "inline fields" : form === "fields-access" ? "bare .fields" : "an inline Schema expression"}; export ${planned} and reference it`,
);

const d3003 = defineDiagnostic(
  {
    code: "EFFX3003",
    owner: "lift",
    title: "Response header schema must be an exported named schema",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "A registered success wrapper builds its response headers inline, so no exported schema names them. Lift suggests exporting the header schema from the wrapper's module and making the wrapper use it, a wire-preserving refactor that the overlay check proves. The diagnostic carries the source edits.",
    examples: [
      {
        before:
          "export const privateRead = (success) => HttpApiSchema.WithHeaders(success, { cache: Cache })",
        after:
          "export const PrivateReadHeaders = Schema.Struct({ cache: Cache });\nexport const privateRead = (success) => HttpApiSchema.WithHeaders(success, PrivateReadHeaders)",
        explanation: "Export the headers once and reference the export from the wrapper.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Subject, wrapper: Schema.String, planned: Schema.String }),
  ({ subject, wrapper, planned }) =>
    `${subject}: wrapper ${wrapper} builds its response headers inline; export ${planned} and make the wrapper use it`,
);

const CodesParams = Schema.TaggedUnion({
  ExportCodes: { subject: Subject, union: Schema.String, planned: Schema.String },
  NonLiteralCodes: { subject: Subject, union: Schema.String },
});

const d3004 = defineDiagnostic(
  {
    code: "EFFX3004",
    owner: "lift",
    title: "Problem codes must be an exported const tuple",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "The code list of a problem union is written inline, so the effx declaration would duplicate it. Lift suggests extracting the list into an exported const tuple that both the union and the declaration reference. A list that is not a literal array of string literals cannot be read without evaluating source and is unliftable until it is named.",
    examples: [
      {
        before: 'problemUnion("ReadProblem", ["not-found", "forbidden"])',
        after:
          'export const ReadProblemCodes = ["not-found", "forbidden"] as const;\nproblemUnion("ReadProblem", ReadProblemCodes)',
        explanation: "One exported tuple is the single source of truth for the codes.",
      },
    ],
  } as const,
  CodesParams,
  CodesParams.match({
    ExportCodes: ({ subject, union, planned }) =>
      `${subject}: the codes of ${union} are inline; export ${planned} and reference it`,
    NonLiteralCodes: ({ subject, union }) =>
      `${subject}: the codes of ${union} are not a literal array of string literals`,
  }),
);

const AccessForm = Schema.Literals(["closure", "constant", "spread", "non-literal-argument"]);

const d3005 = defineDiagnostic(
  {
    code: "EFFX3005",
    owner: "lift",
    title: "Access annotation is not a registered builder call with literal arguments",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "Access is lifted only from a registered access builder called with literal arguments. A local closure, a named constant, a spread or a non-literal builder argument would require partial evaluation, which lift never performs. The endpoint is omitted from every suggestion.",
    examples: [
      {
        before: ".pipe((endpoint) => annotateAccessSpec(endpoint, access(true)))",
        after:
          '.pipe((endpoint) => annotateAccessSpec(endpoint, personNativeAccess({ capability: "profile.read-self", canonicalScopeResolver: "profile.current-person", decisionTime: "SnapshotRead" })))',
        explanation: "Write the access with a registered builder and literal arguments.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Subject, form: AccessForm, builder: Schema.optionalKey(Schema.String) }),
  ({ subject, form, builder }) =>
    `${subject}: access is ${form === "closure" ? "a local closure call" : form === "constant" ? "a named constant" : form === "spread" ? "a spread" : `a call of ${builder ?? "a registered builder"} with a non-literal argument`}, not a registered builder call with literal arguments`,
);

const Position = Schema.Literals(["success", "metadata", "access", "problems"]);

const d3006 = defineDiagnostic(
  {
    code: "EFFX3006",
    owner: "lift",
    title: "No lifter rule for callee",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "An application helper is used as a success wrapper, metadata, access or problem helper, but no lifter rule registers it. Rules are data supplied through the definition-owned lift hook; lift never guesses a helper's meaning and never unfolds its body as authority.",
    examples: [
      {
        before: "success: customResponse(UserResponse)",
        after:
          "// register customResponse as a SuccessWrapper rule, or write the schema directly\nsuccess: UserResponse",
        explanation: "Register the helper with a lift rule so lift can map it.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Subject, position: Position, callee: Schema.String }),
  ({ subject, position, callee }) =>
    `${subject}: no lifter rule for ${callee} used as a ${position} helper`,
);

const d3007 = defineDiagnostic(
  {
    code: "EFFX3007",
    owner: "lift",
    title: "Success has no schema",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "The success of the endpoint is a document body of a runtime content type, or another construct with no Schema. effx declares a success only by a schema, so the endpoint is not liftable. A body-less success such as HttpApiSchema.NoContent is liftable and does not produce this diagnostic.",
    examples: [
      {
        before: 'success: documentMutationResponse("application/pdf")',
        after: "success: ReceiptResponse",
        explanation:
          "Declare the response with a schema, or keep the endpoint as handwritten Effect.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Subject, construct: Schema.String }),
  ({ subject, construct }) => `${subject}: success ${construct} has no schema`,
);

const RootParams = Schema.TaggedUnion({
  NotFound: { group: Schema.String },
  AmbiguousGroup: { group: Schema.String, declarations: Schema.Array(Schema.String) },
  NoRoot: { group: Schema.String },
  AmbiguousRoots: { group: Schema.String, roots: Schema.Array(Schema.String) },
});

const d3008 = defineDiagnostic(
  {
    code: "EFFX3008",
    owner: "lift",
    title: "Group not found, or not in exactly one root",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "The requested group id matches no HttpApiGroup.make declaration, or the group is not added to exactly one HttpApi root. The root is the unique HttpApi.make value whose .add contains the group; zero or several roots cannot select a unique root identity.",
    examples: [
      {
        before: "effx lift --group profile  // the group is added to two roots",
        after: "effx lift --group profile  // the group is added to one root",
        explanation: "Add the group to exactly one root declaration.",
      },
    ],
  } as const,
  RootParams,
  RootParams.match({
    NotFound: ({ group }) => `group ${group} matches no HttpApiGroup.make declaration`,
    AmbiguousGroup: ({ group, declarations }) =>
      `group ${group} matches several HttpApiGroup.make declarations: ${declarations.join(", ")}`,
    NoRoot: ({ group }) => `group ${group} is not added to any HttpApi root`,
    AmbiguousRoots: ({ group, roots }) =>
      `group ${group} is added to several HttpApi roots: ${roots.join(", ")}`,
  }),
);

const d3009 = defineDiagnostic(
  {
    code: "EFFX3009",
    owner: "lift",
    title: "No request channel to serve as operation input",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "An effx operation requires a fully resolved input. The endpoint declares no params, query, headers or payload schema, and no emptyInput schema is configured, so lift cannot choose an input without inventing one. Configure a real exported emptyInput schema.",
    examples: [
      {
        before: 'HttpApiEndpoint.get("health", "/health", { success: Health })',
        after: "// configure emptyInput: an exported Schema for no input",
        explanation: "Name a real exported schema as the lifter's emptyInput.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Subject }),
  ({ subject }) =>
    `${subject}: no params, query, headers or payload schema to serve as the operation input, and no emptyInput is configured`,
);

const Decision = Schema.Literals(["kind", "input", "export"]);

const d3010 = defineDiagnostic(
  {
    code: "EFFX3010",
    owner: "lift",
    title: "Lift decision requires review",
    severity: "warning",
    severityPolicy: { kind: "fixed" },
    explanation:
      "The effx IR contains facts with no Effect twin: the operation kind, the operation input and the real names of new exports. They cannot be validated by comparing wire contracts, so lift prints them as decisions to review and never reports them as verified.",
    examples: [
      {
        before: "POST /search  // lifted as a Command",
        after: "// review: the read-only POST may be a Query with payloadIsQuery",
        explanation: "Review each decision before accepting the suggestion.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Subject, decision: Decision, value: Schema.String }),
  ({ subject, decision, value }) => `${subject}: review ${decision} decision ${value}`,
);

const d3101 = defineDiagnostic(
  {
    code: "EFFX3101",
    owner: "lift",
    title: "Wire contracts differ",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "The check built the Reflection of the untouched original group and of the generated group and found a difference outside the closed set of tolerated deltas. The difference is the payload of the report.",
    examples: [
      {
        before: "original summary: Read own profile",
        after: "generated summary: Read my profile",
        explanation: "Any difference in a wire-visible field fails the check.",
      },
    ],
  } as const,
  Schema.Struct({ group: Schema.String, difference: Schema.String }),
  ({ group, difference }) => `group ${group}: wire contracts differ: ${difference}`,
);

const Delta = Schema.Literals(["ref-suffix", "explicit-default-identifier", "endpoint-order"]);

const d3102 = defineDiagnostic(
  {
    code: "EFFX3102",
    owner: "lift",
    title: "Check passed",
    severity: "info",
    severityPolicy: { kind: "fixed" },
    explanation:
      "The Reflections of the original and the generated group are equal after the closed set of delta normalizers. The applied delta classes are listed.",
    examples: [
      {
        before: "effx lift --check --group profile",
        after: "PASS(ref-suffix)",
        explanation: "The only tolerated differences were the named deltas.",
      },
    ],
  } as const,
  Schema.Struct({ group: Schema.String, applied: Schema.Array(Delta) }),
  ({ group, applied }) =>
    applied.length === 0
      ? `group ${group}: check passed with no delta applied`
      : `group ${group}: check passed after applying ${applied.join(", ")}`,
);

const CheckReason = Schema.Literals([
  "overlay-compile",
  "root-build",
  "projection-hook",
  "rule-exception",
]);

const d3103 = defineDiagnostic(
  {
    code: "EFFX3103",
    owner: "lift",
    title: "Check could not run",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "The overlay does not compile, a root cannot be built, a registered projection hook threw, or a trusted lifter-rule hook raised an exception. Lift stays total: a rule exception becomes this diagnostic and never an exit by exception. It is not a pass.",
    examples: [
      {
        before: "effx lift --check  // the overlay has a type error",
        after: "effx lift --check  // the overlay compiles",
        explanation: "Fix the overlay or the hook, then run the check again.",
      },
    ],
  } as const,
  Schema.Struct({ reason: CheckReason, detail: Schema.String }),
  ({ reason, detail }) => `check could not run (${reason}): ${detail}`,
);

const d3201 = defineDiagnostic(
  {
    code: "EFFX3201",
    owner: "lift",
    title: "Binding keys differ from the group's endpoint keys",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "The handler keys registered by the application's HttpApiBuilder.group call are not exactly the endpoint keys of the group. The key sets are compared statically without executing source.",
    examples: [
      {
        before: 'h.handleRaw("read", fn)  // the group also declares update',
        after: 'h.handleRaw("read", fn).handleRaw("update", fn)',
        explanation: "Register exactly the group's endpoint keys.",
      },
    ],
  } as const,
  Schema.Struct({
    group: Schema.String,
    missing: Schema.Array(Schema.String),
    extra: Schema.Array(Schema.String),
  }),
  ({ group, missing, extra }) =>
    `group ${group}: binding keys differ (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"})`,
);

const AdaptationSite = Schema.Literals(["authorize", "payload-decode", "handle"]);

const d3202 = defineDiagnostic(
  {
    code: "EFFX3202",
    owner: "lift",
    title: "Binding needs hand adaptation",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "A handler calls the application's authorization function directly, decodes the payload itself, or registers with .handle instead of .handleRaw. Moving an authorization call behind the lazy authorize callback cannot be mechanical. Lift lists each site and never invents handler code.",
    examples: [
      {
        before: "yield* authorize(request)  // inside the handler",
        after: "(input, authorize) => ... // lazy authorize callback",
        explanation: "Adapt the site by hand; the binding report stays unverified until then.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Subject, site: AdaptationSite }),
  ({ subject, site }) => `${subject}: ${site} site needs hand adaptation`,
);

/** Typed factories; occurrence locations and related diagnostics remain caller-owned. */
export const LiftDiagnostics = {
  [d3001.entry.code]: d3001,
  [d3002.entry.code]: d3002,
  [d3003.entry.code]: d3003,
  [d3004.entry.code]: d3004,
  [d3005.entry.code]: d3005,
  [d3006.entry.code]: d3006,
  [d3007.entry.code]: d3007,
  [d3008.entry.code]: d3008,
  [d3009.entry.code]: d3009,
  [d3010.entry.code]: d3010,
  [d3101.entry.code]: d3101,
  [d3102.entry.code]: d3102,
  [d3103.entry.code]: d3103,
  [d3201.entry.code]: d3201,
  [d3202.entry.code]: d3202,
};

/** Declaration list retained before indexing so composition can detect duplicates. */
export const liftEntries: ReadonlyArray<DiagnosticEntry> = [
  d3001.entry,
  d3002.entry,
  d3003.entry,
  d3004.entry,
  d3005.entry,
  d3006.entry,
  d3007.entry,
  d3008.entry,
  d3009.entry,
  d3010.entry,
  d3101.entry,
  d3102.entry,
  d3103.entry,
  d3201.entry,
  d3202.entry,
];
