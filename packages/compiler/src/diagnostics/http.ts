import { Schema } from "effect";
import { defineDiagnostic, type DiagnosticEntry } from "@effx/diagnostics";

const subject = Schema.Struct({ subject: Schema.String });

const ContractParams = Schema.TaggedUnion({
  InvalidData: { subject: Schema.String },
  InvalidEdge: { subject: Schema.String },
  NotOperation: { subject: Schema.String },
  ExposureCount: { subject: Schema.String },
  PayloadIsQuery: { subject: Schema.String },
  GetPayload: { subject: Schema.String },
  Conditional: { subject: Schema.String },
  MediaType: { subject: Schema.String },
  Status: { subject: Schema.String },
  Identifiers: { subject: Schema.String },
  ParamsRequired: { subject: Schema.String },
  ParamsMismatch: { subject: Schema.String },
  CommandIdentityKind: { subject: Schema.String },
  CommandIdentityHeaders: { subject: Schema.String },
  GroupTarget: { subject: Schema.String },
  GroupIdentity: { subject: Schema.String },
  GroupConflict: { subject: Schema.String },
  AnnotationTarget: { subject: Schema.String, annotation: Schema.String },
  DuplicateAnnotation: { subject: Schema.String, annotation: Schema.String },
  ExternalGroup: {
    subject: Schema.String,
    root: Schema.String,
    group: Schema.String,
    missing: Schema.Literals(["group", "root"]),
  },
});

const renderContract = ContractParams.match({
  InvalidData: ({ subject }) => `${subject}: invalid HttpContract extension data`,
  InvalidEdge: ({ subject }) =>
    `${subject}: expected one ExtensionOf edge with HttpContract qualifier`,
  NotOperation: ({ subject }) => `${subject}: HTTP contract must attach to an operation`,
  ExposureCount: ({ subject }) => `${subject}: requires exactly one HTTP exposure`,
  PayloadIsQuery: ({ subject }) =>
    `${subject}: payloadIsQuery requires a Query over POST with an explicit payload schema`,
  GetPayload: ({ subject }) => `${subject}: GET cannot declare an explicit payload`,
  Conditional: ({ subject }) => `${subject}: conditional requires GET and responseHeaders`,
  MediaType: ({ subject }) => `${subject}: mediaType requires an explicit payload schema`,
  Status: ({ subject }) => `${subject}: status must be an HTTP status from 100 to 599`,
  Identifiers: ({ subject }) => `${subject}: root and group must be safe identifiers`,
  ParamsRequired: ({ subject }) => `${subject}: path params require a params schema and vice versa`,
  ParamsMismatch: ({ subject }) =>
    `${subject}: params schema fields must match path parameters exactly`,
  CommandIdentityKind: ({ subject }) => `${subject}: commandIdentity requires a Command operation`,
  CommandIdentityHeaders: ({ subject }) =>
    `${subject}: commandIdentity requires headers with idempotency-key and if-match`,
  GroupTarget: ({ subject }) => `${subject}: @Http.Group requires an exported class or builder`,
  GroupIdentity: ({ subject }) => `${subject}: invalid HTTP group identity`,
  GroupConflict: ({ subject }) => `${subject}: conflicting @Http.Group definitions`,
  AnnotationTarget: ({ subject, annotation }) =>
    `${subject}: @${annotation} requires an operation declaration`,
  DuplicateAnnotation: ({ subject, annotation }) =>
    `${subject}: duplicate @${annotation} annotations`,
  ExternalGroup: ({ subject, root, group, missing }) =>
    `${subject}: external HTTP group ${root}/${group} needs ${missing === "group" ? "@Http.Group" : "a concrete HttpApi root"}`,
});

const AssociationParams = Schema.TaggedUnion({
  NotOperation: { subject: Schema.String },
  MultipleAssociations: { subject: Schema.String },
  MalformedAssociation: { subject: Schema.String },
  UnresolvedReference: { subject: Schema.String },
  InvalidAssociation: { subject: Schema.String },
  MultipleDeclarations: { subject: Schema.String },
  MultipleIn: { subject: Schema.String },
  InTarget: { subject: Schema.String },
});

const renderAssociation = AssociationParams.match({
  NotOperation: ({ subject }) => `${subject}: HTTP group association requires an operation`,
  MultipleAssociations: ({ subject }) => `${subject}: multiple or repeated HTTP group associations`,
  MalformedAssociation: ({ subject }) => `${subject}: malformed HTTP group association`,
  UnresolvedReference: ({ subject }) =>
    `${subject}: group reference must resolve to one exported group declaration`,
  InvalidAssociation: ({ subject }) =>
    `${subject}: association does not identify one exported HTTP group`,
  MultipleDeclarations: ({ subject }) => `${subject}: multiple @Http.Group declarations`,
  MultipleIn: ({ subject }) => `${subject}: exactly one group may be associated with .in(Group)`,
  InTarget: ({ subject }) =>
    `${subject}: .in(...) requires an exported Http.group value or @Http.Group class`,
});

const DefaultsParams = Schema.TaggedUnion({
  MissingContract: { subject: Schema.String },
  RootConflict: { subject: Schema.String },
  GroupConflict: { subject: Schema.String },
  QueryDefault: { subject: Schema.String },
});

const renderDefaults = DefaultsParams.match({
  MissingContract: ({ subject }) =>
    `${subject}: associated HTTP operation requires an explicit Http.Contract`,
  RootConflict: ({ subject }) => `${subject}: HTTP root conflicts with associated group`,
  GroupConflict: ({ subject }) => `${subject}: HTTP group conflicts with associated group`,
  QueryDefault: ({ subject }) =>
    `${subject}: query: true requires a GET Query input not assigned elsewhere`,
});

const BindingParams = Schema.TaggedUnion({
  MissingId: { subject: Schema.String },
  InvalidId: { subject: Schema.String, group: Schema.String },
  DuplicateKey: { subject: Schema.String, operationId: Schema.String, previous: Schema.String },
  MixedBindings: {
    subject: Schema.String,
    root: Schema.String,
    group: Schema.String,
    previous: Schema.String,
  },
  MissingContract: { subject: Schema.String },
});

const renderBinding = BindingParams.match({
  MissingId: ({ subject }) => `${subject}: externally bound HTTP requires metadata.operationId`,
  InvalidId: ({ subject, group }) =>
    `${subject}: operationId must be ${group}.<identifier-safe endpoint key>`,
  DuplicateKey: ({ subject, operationId, previous }) =>
    `${subject}: duplicate HTTP endpoint key ${operationId} (also ${previous})`,
  MixedBindings: ({ subject, root, group, previous }) =>
    `${subject}: mixed local/external bindings in ${root}/${group} (also ${previous})`,
  MissingContract: ({ subject }) =>
    `${subject}: externally bound HTTP requires a contract and metadata.operationId`,
});

const ChannelParams = Schema.TaggedUnion({
  HeaderConflict: { subject: Schema.String },
  MixedFields: {
    subject: Schema.String,
    params: Schema.Array(Schema.String),
    fields: Schema.Array(Schema.String),
    body: Schema.Literals(["query", "payload"]),
  },
});

const renderChannels = ChannelParams.match({
  HeaderConflict: ({ subject }) =>
    `${subject}: the input is a header schema (Http.headers) but Http.Contract.headers names another schema; an input that is a header schema cannot also be a body`,
  MixedFields: ({ subject, params, fields, body }) =>
    `${subject}: the input mixes path parameters (${params.toSorted().join(", ")}) with other fields (${fields.filter((field) => !params.includes(field)).join(", ")}); declare params and ${body} explicitly`,
});

const InventoryParams = Schema.TaggedUnion({
  NonFiniteKeys: {},
  MissingInventory: { root: Schema.String, group: Schema.String },
  MissingEndpoint: {
    subject: Schema.String,
    root: Schema.String,
    group: Schema.String,
    key: Schema.String,
  },
});

const renderInventory = InventoryParams.match({
  NonFiniteKeys: () =>
    "HTTP root endpoint inventory must have finite required group and endpoint keys with matching literal identifiers",
  MissingInventory: ({ root, group }) =>
    `HTTP group ${root}/${group}: concrete root endpoint inventory is missing or ambiguous`,
  MissingEndpoint: ({ subject, root, group, key }) =>
    `${subject}: concrete root ${root}/${group} has no declared endpoint ${key}`,
});

const AccessParams = Schema.TaggedUnion({
  DuplicateAnnotation: { subject: Schema.String, annotation: Schema.String },
  DuplicateContract: { subject: Schema.String },
  Malformed: { subject: Schema.String, validationMessage: Schema.String },
});

const renderAccess = AccessParams.match({
  DuplicateAnnotation: ({ subject, annotation }) =>
    `${subject}: duplicate @${annotation} annotations`,
  DuplicateContract: ({ subject }) => `${subject}: duplicate @Http.Access contracts`,
  Malformed: ({ subject, validationMessage }) =>
    `${subject}: malformed AccessContract data — ${validationMessage}`,
});

const SnapshotParams = Schema.Struct({
  subject: Schema.String,
  violations: Schema.Array(
    Schema.Literals([
      "only a Command may claim a snapshot decision",
      'decisionTime must be "SnapshotRead"',
      "requirements must be empty",
      'acceptedCredentials must be exactly ["ObjectCapability"]',
      'principalKinds must be exactly ["CapabilityHolder"]',
    ]),
  ),
});

const d2401 = defineDiagnostic(
  {
    code: "EFFX2401",
    owner: "http",
    title: "Query uses a mutating HTTP verb",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "A Query normally uses GET. A Query over POST needs the explicit payloadIsQuery contract; other verbs require a Command.",
    examples: [
      {
        before: '@Query(...)\n@Http.Put("/users")',
        after: '@Query(...)\n@Http.Get("/users")',
        explanation: "Use GET for reads, or declare a Command for mutation.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Schema.String, method: Schema.String, path: Schema.String }),
  ({ subject, method, path }) =>
    `${subject} is a Query but is exposed as HTTP ${method} ${path}; use GET or declare a Command`,
);

const d2402 = defineDiagnostic(
  {
    code: "EFFX2402",
    owner: "http",
    title: "Invalid HTTP contract or group",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "This umbrella covers annotation target/cardinality, malformed contract data or ownership edges, missing or repeated exposures, unsafe group/root identifiers, conflicting group definitions, missing external group/root declarations, request and response channel constraints, status bounds, and command identity headers. Match path parameters exactly; GET cannot carry payload. conditional requires GET and responseHeaders; mediaType requires payload. payloadIsQuery requires a POST Query with explicit payload. commandIdentity belongs to a Command and requires idempotency-key and if-match headers.",
    examples: [
      {
        before: '@Http.Get("/users/:id")\n@Http.Contract({ group: "users", success: User })',
        after:
          '@Http.Get("/users/:id")\n@Http.Contract({ group: "users", params: UserId, success: User })',
        explanation:
          "Declare params with exactly the id field. For other variants, correct the named contract constraint; attach a single contract to one operation, export one valid group and supply its concrete root when external.",
      },
    ],
  } as const,
  ContractParams,
  renderContract,
);

const d2403 = defineDiagnostic(
  {
    code: "EFFX2403",
    owner: "http",
    title: "Invalid external HTTP binding",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "Externally bound operations need a contract and metadata.operationId of the form group.endpointKey. Endpoint keys are identifier-safe and unique. A root/group cannot mix local and external bindings.",
    examples: [
      {
        before: 'metadata: { operationId: "get-user" }',
        after: 'metadata: { operationId: "users.getUser" }',
        explanation:
          "Use the declared group prefix and a unique identifier-safe endpoint key; keep every binding in a group consistently local or external.",
      },
    ],
  } as const,
  BindingParams,
  renderBinding,
);

const d2404 = defineDiagnostic(
  {
    code: "EFFX2404",
    owner: "http",
    title: "Invalid HTTP group association",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "Group associations require an operation and exactly one exported Http.group value or @Http.Group class. Multiple group declarations, repeated .in(Group), unresolved references and malformed associations are rejected.",
    examples: [
      {
        before: "Operation.query({ input: Input, output: Output }).in(Users).in(Users)",
        after: "Operation.query({ input: Input, output: Output }).in(Users)",
        explanation:
          "Associate the operation once with one exported group; remove duplicate decorators and ensure the reference resolves to the group itself.",
      },
    ],
  } as const,
  AssociationParams,
  renderAssociation,
);

const d2405 = defineDiagnostic(
  {
    code: "EFFX2405",
    owner: "http",
    title: "Conflicting HTTP group defaults",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "An associated HTTP operation still requires an explicit Http.Contract. Its explicit root/group must agree with its group. query: true only derives a GET Query input not already assigned to another channel.",
    examples: [
      {
        before: '@Http.Contract({ root: "other", group: "users", success: User })',
        after: '@Http.Contract({ root: "api", group: "users", success: User })',
        explanation:
          "Align the contract with the associated group whose root is api; remove an invalid query default or specify its channel explicitly.",
      },
    ],
  } as const,
  DefaultsParams,
  renderDefaults,
);

const d2406 = defineDiagnostic(
  {
    code: "EFFX2406",
    owner: "http",
    title: "Generated HTTP export collision",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "Different root/group identities can normalize to the same generated class, API or handler export. Empty groups are checked too.",
    examples: [
      {
        before:
          'Http.group({ root: "api", group: "user-list" })\nHttp.group({ root: "api", group: "user_list" })',
        after:
          'Http.group({ root: "api", group: "user-list" })\nHttp.group({ root: "api", group: "accounts" })',
        explanation: "Rename one group so its generated export names no longer collide.",
      },
    ],
  } as const,
  Schema.Struct({ name: Schema.String, first: Schema.String, second: Schema.String }),
  ({ name, first, second }) => `HTTP export ${name} collides for ${first} and ${second}`,
);

const d2410 = defineDiagnostic(
  {
    code: "EFFX2410",
    owner: "http",
    title: "Ambiguous or conflicting request channels",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "An input marked Http.headers cannot also be a body or compete with another headers schema. When input fields mix route parameters and other fields, the compiler will not invent split schemas: explicitly declare params and query or payload.",
    examples: [
      {
        before: '@Http.Get("/users/:id")\n@Http.Contract({ group: "users", success: User })',
        after:
          '@Http.Get("/users/:id")\n@Http.Contract({ group: "users", params: UserId, query: Search, success: User })',
        explanation:
          "Split id into UserId and search fields into Search; for mutating verbs declare payload instead of query. A headers-marked input must use the same headers channel.",
      },
    ],
  } as const,
  ChannelParams,
  renderChannels,
);

const d2411 = defineDiagnostic(
  {
    code: "EFFX2411",
    owner: "http",
    title: "Unknown request input field keys",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "GET or DELETE with path parameters and input keys unavailable to static analysis cannot distinguish params from query. Either explicit channel resolves this ambiguity.",
    examples: [
      {
        before: '@Http.Get("/users/:id")\n@Http.Contract({ group: "users", success: User })',
        after:
          '@Http.Get("/users/:id")\n@Http.Contract({ group: "users", params: UserId, query: Search, success: User })',
        explanation:
          "Declare the request channels explicitly rather than relying on inaccessible input keys.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Schema.String, verb: Schema.Literals(["Get", "Delete"]) }),
  ({ subject, verb }) =>
    `${subject}: ${verb.toUpperCase()} with path parameters needs an input with static field keys to tell params from query; declare params and query explicitly`,
);

const d2414 = defineDiagnostic(
  {
    code: "EFFX2414",
    owner: "http",
    title: "Access decision time cannot be inferred",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "Http.Access omits decisionTime, but its declaration has no single Query or Command from which to infer SnapshotRead or Transaction.",
    examples: [
      {
        before: "@Http.Access({ ...accessOptions })",
        after: '@Http.Access({ ...accessOptions, decisionTime: "Transaction" })',
        explanation:
          "Write decisionTime explicitly, or attach access to exactly one operation of the intended kind.",
      },
    ],
  } as const,
  subject,
  ({ subject }) =>
    `${subject}: Http.Access omits decisionTime but the declaration has no single Query or Command to default it from; write decisionTime`,
);

const d2415 = defineDiagnostic(
  {
    code: "EFFX2415",
    owner: "http",
    title: "Concrete HTTP endpoint inventory unavailable",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "The concrete HttpApi root must have finite required group and endpoint keys with matching literal identifiers. The group inventory must resolve unambiguously, and every bound endpoint key must exist in the declared group.",
    examples: [
      {
        before: 'HttpApi.make("api").add(HttpApiGroup.make("other"))',
        after:
          'HttpApi.make("api").add(HttpApiGroup.make("users").add(HttpApiEndpoint.get("getUser", "/users/:id")))',
        explanation:
          "Declare the users group and getUser endpoint in the exported root, matching metadata.operationId users.getUser. Keep finite required literal inventory keys rather than dynamic or optional keys.",
      },
    ],
  } as const,
  InventoryParams,
  renderInventory,
);

const d2500 = defineDiagnostic(
  {
    code: "EFFX2500",
    owner: "access",
    title: "Malformed or duplicate access contract",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "Access annotations and semantic contracts must be singular. Malformed AccessContract data includes the Schema validator detail after the stable prefix.",
    examples: [
      {
        before: "@Http.Access(accessOptions)\n@Http.Access(accessOptions)",
        after: "@Http.Access(accessOptions)",
        explanation:
          "Remove the duplicate. For malformed data, correct the fields named by the validator; extension producers must conform to AccessContractData.",
      },
    ],
  } as const,
  AccessParams,
  renderAccess,
);

const d2501 = defineDiagnostic(
  {
    code: "EFFX2501",
    owner: "access",
    title: "Command access decides in a read snapshot",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "A Command cannot authorize from a read snapshot unless it makes the constrained snapshotDecisionForCommand claim. Ordinary command decisions belong in its transaction.",
    examples: [
      {
        before: 'decisionTime: "SnapshotRead"',
        after: 'decisionTime: "Transaction"',
        explanation:
          "Decide access inside the mutation transaction, so the decision and write share the relevant state.",
      },
    ],
  } as const,
  subject,
  ({ subject }) => `${subject}: Command access cannot decide in a read snapshot`,
);

const d2502 = defineDiagnostic(
  {
    code: "EFFX2502",
    owner: "access",
    title: "Query declares a transaction decision",
    severity: "warning",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "A Query with decisionTime Transaction is accepted with a warning: the usual read-only access decision uses SnapshotRead.",
    examples: [
      {
        before: 'decisionTime: "Transaction"',
        after: 'decisionTime: "SnapshotRead"',
        explanation:
          "Use a snapshot read decision unless the query intentionally needs transactional decision semantics.",
      },
    ],
  } as const,
  subject,
  ({ subject }) => `${subject}: Query access declares a transaction decision`,
);

const d2503 = defineDiagnostic(
  {
    code: "EFFX2503",
    owner: "access",
    title: "Protected access lacks security middleware",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "Protected HTTP access needs a security middleware marker in Http.Contract. Declaring capabilities alone does not authenticate requests.",
    examples: [
      {
        before: '@Http.Contract({ group: "users", success: User })',
        after: '@Http.Contract({ group: "users", success: User, middleware: [Security] })',
        explanation:
          "Include the exported middleware marker declared with security: true, whose application implementation authenticates the accepted credentials.",
      },
    ],
  } as const,
  subject,
  ({ subject }) =>
    `${subject}: protected access requires an Http.Contract security middleware marker`,
);

const d2504 = defineDiagnostic(
  {
    code: "EFFX2504",
    owner: "access",
    title: "HTTP exposure lacks access declaration",
    severity: "warning",
    severityPolicy: {
      kind: "named",
      name: "strictAccess",
      description: "Warning by default; error when strictAccess is true.",
    },
    explanation:
      "HTTP exposure requires an explicit @Http.Access contract. This is a warning by default and an error under strictAccess (including --strict-access). Declare public access explicitly too; absence is not a public-access contract.",
    examples: [
      {
        before: '@Query(...)\n@Http.Get("/users")',
        after: '@Query(...)\n@Http.Get("/users")\n@Http.Access(accessOptions)',
        explanation:
          "Declare an access contract with the intended credentials, principal kinds, capabilities, scope resolver and decision time. Do not disable strict mode to hide missing access.",
      },
    ],
  } as const,
  Schema.Struct({ subject: Schema.String, strictAccess: Schema.Boolean }),
  ({ subject }) => `${subject}: HTTP exposure requires @Http.Access`,
  ({ strictAccess }) => (strictAccess ? "error" : "warning"),
);

const d2505 = defineDiagnostic(
  {
    code: "EFFX2505",
    owner: "access",
    title: "HTTP root mixes visibility modes",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "A generated ForApi client exposes its entire root. Internal and External operations cannot share a root; visibility must be uniform.",
    examples: [
      {
        before: 'root: "api", exposure: "Internal"\nroot: "api", exposure: "External"',
        after: 'root: "internalApi", exposure: "Internal"\nroot: "api", exposure: "External"',
        explanation:
          "Separate internal and external operations into different roots, or align their intended visibility.",
      },
    ],
  } as const,
  Schema.Struct({ root: Schema.String }),
  ({ root }) => `${root}: an HTTP root cannot mix Internal and External operations`,
);

const d2506 = defineDiagnostic(
  {
    code: "EFFX2506",
    owner: "access",
    title: "Invalid command snapshot decision claim",
    severity: "error",
    severityPolicy: {
      kind: "fixed",
    },
    explanation:
      "snapshotDecisionForCommand requires a Command, SnapshotRead decision time, no requirements, exactly ObjectCapability credentials and exactly CapabilityHolder principals. All violated conditions are reported in their original order. An accepted shape is a reviewable assertion, not proof of resolver or guard behavior.",
    examples: [
      {
        before: 'snapshotDecisionForCommand: true, decisionTime: "Transaction"',
        after: 'snapshotDecisionForCommand: false, decisionTime: "Transaction"',
        explanation:
          "Remove the claim and use transactional command authorization. Only retain a snapshot claim when every narrow capability-only condition holds and the resolver/guard have been reviewed.",
      },
    ],
  } as const,
  SnapshotParams,
  ({ subject, violations }) =>
    `${subject}: snapshotDecisionForCommand is invalid — ${violations.join("; ")}`,
);

/** Typed factories; occurrence locations and related diagnostics remain caller-owned. */
export const HttpDiagnostics = {
  [d2401.entry.code]: d2401,
  [d2402.entry.code]: d2402,
  [d2403.entry.code]: d2403,
  [d2404.entry.code]: d2404,
  [d2405.entry.code]: d2405,
  [d2406.entry.code]: d2406,
  [d2410.entry.code]: d2410,
  [d2411.entry.code]: d2411,
  [d2414.entry.code]: d2414,
  [d2415.entry.code]: d2415,
  [d2500.entry.code]: d2500,
  [d2501.entry.code]: d2501,
  [d2502.entry.code]: d2502,
  [d2503.entry.code]: d2503,
  [d2504.entry.code]: d2504,
  [d2505.entry.code]: d2505,
  [d2506.entry.code]: d2506,
};

/** Declaration list retained before indexing so composition can detect duplicates. */
export const httpEntries: ReadonlyArray<DiagnosticEntry> = [
  d2401.entry,
  d2402.entry,
  d2403.entry,
  d2404.entry,
  d2405.entry,
  d2406.entry,
  d2410.entry,
  d2411.entry,
  d2414.entry,
  d2415.entry,
  d2500.entry,
  d2501.entry,
  d2502.entry,
  d2503.entry,
  d2504.entry,
  d2505.entry,
  d2506.entry,
];
