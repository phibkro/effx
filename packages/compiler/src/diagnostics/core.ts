import { Schema } from "effect";
import { defineDiagnostic, type DiagnosticEntry } from "@effx/diagnostics";
import { annotationSchemaLowering } from "@effx/runtime/diagnostics";

// Pure catalogue data and trusted-parameter renderers. No decoding, runtime or resources at emission.
const entry = <const Code extends string>(
  code: Code,
  owner: string,
  title: string,
  explanation: string,
  before: string,
  after: string,
  fix: string,
  severity: DiagnosticEntry["severity"] = "error",
) => ({
  code,
  owner,
  title,
  severity,
  severityPolicy: { kind: "fixed" as const },
  explanation,
  examples: [{ before, after, explanation: fix, language: "ts" }],
});

const subject = { subject: Schema.String };

const named = { subject: Schema.String, name: Schema.String };

const strings = Schema.Array(Schema.String);

const d0001 = defineDiagnostic(
  {
    ...entry(
      "EFFX0001",
      "frontend",
      "Analysis and project TypeScript versions differ",
      "The frontend analyses with its bundled TypeScript version while the project pins another. tsc/tsgo remains authoritative. Same-major skew is informational; different-major skew warns. A package range is compared using its first numeric major, not by resolving that range.",
      "effx TypeScript 6.0.2; project typescript 7.0.2",
      "effx TypeScript 6.0.2; project typescript 6.0.2",
      "Align the project's pin with the analysis version when practical, and always run the project's type gate.",
      "info",
    ),
    severityPolicy: {
      kind: "named",
      name: "typescript-major-skew",
      description: "Same-major skew is info; different-major skew is warning.",
    },
  },
  Schema.Struct({ analysisVersion: Schema.String, projectPin: Schema.String }),
  ({ analysisVersion, projectPin }) =>
    `effx analyses with TypeScript ${analysisVersion} but the project pins typescript ${projectPin}; tsc/tsgo remains the authoritative type gate`,
  ({ analysisVersion, projectPin }) =>
    major(analysisVersion) === major(projectPin) ? "info" : "warning",
);

const major = (version: string): string => version.replace(/^[^\d]*/, "").split(".")[0] ?? version;

const d0010 = defineDiagnostic(
  entry(
    "EFFX0010",
    "registry",
    "Diagnostic registry contract violated",
    "Registry data must decode as DiagnosticEntry, codes must be unique across owners, and reported diagnostics (including related diagnostics) must have a registered code and a permitted severity. Invalid registry data, duplicate codes, undeclared emissions and severity-policy mismatches stop generation; they are user or extension contract diagnostics, not CompilerFault.",
    "extensions: [firstCopy, secondCopy]",
    "extensions: [firstCopy]",
    "Load each owner once, declare every emitted code, and emit severity using its named policy.",
    "error",
  ),
  Schema.TaggedUnion({
    InvalidRegistry: { owner: Schema.String, registryIssue: Schema.String },
    InvalidEntry: { owner: Schema.String, schemaIssue: Schema.String },
    DuplicateCode: { code: Schema.String, firstOwner: Schema.String, secondOwner: Schema.String },
    UndeclaredCode: { owner: Schema.String, code: Schema.String },
    SeverityMismatch: {
      owner: Schema.String,
      code: Schema.String,
      actualSeverity: Schema.String,
      policy: Schema.String,
    },
  }),
  (params) => {
    switch (params._tag) {
      case "InvalidRegistry":
        return `diagnostic registry from ${params.owner} is invalid: ${params.registryIssue}`;
      case "InvalidEntry":
        return `diagnostic registry entry from ${params.owner} is invalid: ${params.schemaIssue}`;
      case "DuplicateCode":
        return `diagnostic code ${params.code} is declared by ${params.firstOwner} and by ${params.secondOwner}`;
      case "UndeclaredCode":
        return `extension ${params.owner} emitted undeclared diagnostic code ${params.code}`;
      case "SeverityMismatch":
        return `extension ${params.owner} emitted ${params.code} with severity ${params.actualSeverity}, contrary to ${params.policy}`;
    }
  },
);

const d1001 = defineDiagnostic(
  entry(
    "EFFX1001",
    "kernel",
    "Stable identity has conflicting content",
    "Two nodes with the same StableId have different semantic content. Equivalent duplicate contributions can normalize together, but differing nodes cannot share an identity.",
    'Operation.query({ name: "User.Get", input: A, success: A }); Operation.query({ name: "User.Get", input: B, success: B });',
    'Operation.query({ name: "User.GetA", input: A, success: A }); Operation.query({ name: "User.GetB", input: B, success: B });',
    "Give distinct operations distinct names, or make duplicate contributions identical.",
    "error",
  ),
  Schema.Struct({ id: Schema.String }),
  ({ id }) => `duplicate StableId ${id} with differing content`,
);

const d1002 = defineDiagnostic(
  entry(
    "EFFX1002",
    "kernel",
    "Graph edge references an absent node",
    "An IR edge names a source or target that is absent from the node set. This covers either or both endpoints and every edge kind.",
    '{ nodes: [operation], edges: [{ kind: "Requires", from: operation.id, to: missingService.id }] }',
    '{ nodes: [operation, service], edges: [{ kind: "Requires", from: operation.id, to: service.id }] }',
    "Contribute each referenced node, or remove the edge when removing its node.",
    "error",
  ),
  Schema.Struct({ kind: Schema.String, from: Schema.String, to: Schema.String, missing: strings }),
  ({ kind, from, to, missing }) =>
    `edge ${kind} ${from} → ${to} references missing node(s) ${missing.join(", ")}`,
);

const d1003 = defineDiagnostic(
  entry(
    "EFFX1003",
    "kernel",
    "Extension node has no owner",
    "Every Extension node needs an outgoing ExtensionOf edge to its semantic owner. An orphan extension cannot be safely interpreted or generated.",
    "Contribution.make([extensionNode], [])",
    'Contribution.make([extensionNode], [{ kind: "ExtensionOf", from: extensionNode.id, to: operationId }])',
    "Contribute the owner edge with the extension node.",
    "error",
  ),
  Schema.Struct({ id: Schema.String }),
  ({ id }) => `extension ${id} has no ExtensionOf owner edge`,
);

const d1101 = defineDiagnostic(
  entry(
    "EFFX1101",
    "annotation",
    "No interpreter for annotation",
    "The frontend collected an annotation name, but no selected extension owns an interpreter for it. This includes generic Annotate and extension-defined spellings.",
    '@Annotate("Audit", { level: "sensitive" })',
    "extensions: [...builtin, auditExtension]",
    "Register the interpreter through the selected config, and check the exact case-sensitive annotation name.",
    "error",
  ),
  Schema.Struct({ annotation: Schema.String, subject: Schema.String }),
  ({ annotation, subject }) =>
    `@${annotation} on ${subject}: no extension interprets this annotation`,
);

const LoweringReason = Schema.TaggedUnion({
  FocusSegments: {},
  CapabilityOptions: {},
  ResourceModel: {},
  FocusPath: {},
  ObjectProperty: {},
  ComputedKey: {},
  AnnotateNameMissing: {},
  AnnotateNameLiteral: {},
  SchemaFields: {},
  RuntimeCall: {},
  UnresolvedSymbol: {},
  HttpRoot: {},
  HttpRootIdentifier: {},
  SchemaExport: {},
  ServiceExport: {},
  TupleUnresolved: {},
  TupleCycle: {},
  TupleConst: {},
  TupleLiteral: {},
  TupleReadonly: {},
  TupleMismatch: {},
  StaticStrings: {
    constructor: Schema.Literals([
      "Capability.one",
      "Capability.any",
      "Capability.all",
      "Concealment.notFound",
    ]),
  },
  StringArity: {
    constructor: Schema.Literals([
      "Capability.one",
      "Capability.any",
      "Capability.all",
      "Concealment.notFound",
    ]),
  },
  DuplicateField: { field: Schema.String },
  DefinitionSymbol: { expectation: Schema.String },
  TupleElement: { source: Schema.String },
  UnsupportedType: { display: Schema.String },
  ExpressionKind: { kind: Schema.String },
});

const loweringReason = LoweringReason.match({
  FocusSegments: () => "Focus.key path segments must be string literals",
  CapabilityOptions: () => 'expected Capability.make("name", { resource, focus? })',
  ResourceModel: () => "resource must be an exported Schema model class",
  FocusPath: () => "focus must be a Focus.key(...) path",
  ObjectProperty: () => "only `key: value` and shorthand properties are supported",
  ComputedKey: () => "computed keys are not supported",
  AnnotateNameMissing: () => "Annotate requires a literal annotation name",
  AnnotateNameLiteral: () => "annotation name must be a string literal",
  SchemaFields: () => "schema must expose static fields",
  RuntimeCall: () => "unsupported runtime constructor call",
  UnresolvedSymbol: () => "unresolved symbol",
  HttpRoot: () => "HTTP root must be an exported concrete HttpApi value",
  HttpRootIdentifier: () => "HTTP root identifier must be a string literal",
  SchemaExport: () =>
    "schema must be an exported top-level symbol or an exported class's static member",
  ServiceExport: () => "service must be an exported class",
  TupleUnresolved: () => "unresolved tuple operand",
  TupleCycle: () => "cyclic tuple initializer",
  TupleConst: () => "operand must resolve to a const tuple initializer",
  TupleLiteral: () => "operand must resolve to a readonly const tuple of string literals",
  TupleReadonly: () => "operand is not a readonly const tuple",
  TupleMismatch: () => "tuple type disagrees with its runtime initializer elements or order",
  StaticStrings: ({ constructor }) => `${constructor} requires static nonempty string arguments`,
  StringArity: ({ constructor }) =>
    `${constructor} requires ${constructor === "Capability.one" ? "one" : "at least one"} string argument`,
  DuplicateField: ({ field }) => `duplicate ${field} declaration`,
  DefinitionSymbol: ({ expectation }) => expectation,
  TupleElement: ({ source }) => `tuple element \u0060${source}\u0060 must be a string literal`,
  UnsupportedType: ({ display }) =>
    `\u0060${display}\u0060 is neither a Schema, a service class, nor a runtime value`,
  ExpressionKind: ({ kind }) => `unsupported expression kind ${kind}`,
});

const d1102 = defineDiagnostic(
  entry(
    "EFFX1102",
    "annotation",
    "Malformed or unlowerable annotation arguments",
    "An annotation argument does not decode against its definition, cannot be represented by source lowering, or cannot be printed for an effect clause. Source lowering accepts supported literals, object properties and exported Schema/service/runtime references, not arbitrary evaluation. It rejects computed keys, unsupported expressions and runtime calls, unresolved or unexported symbols, invalid capability/focus construction, invalid Schema/HTTP root shapes and tuple spreads whose readonly const runtime initializers disagree with their types, cycle or contain non-string elements. Definition-specific symbol checks retain the declared expectation; Schema issue text retains the decoder detail. Effect clauses additionally reject lambdas and non-finite numbers that the writer cannot print.",
    '@RateLimit({ perMinute: "many" })',
    "@RateLimit({ perMinute: 60 })",
    "Match the argument Schema, use literal source data and exported references, repair readonly tuple initializers, and replace unprintable effect-clause arguments.",
    "error",
  ),
  Schema.TaggedUnion({
    Decode: { annotation: Schema.String, subject: Schema.String, schemaIssue: Schema.String },
    Lowering: { subject: Schema.String, source: Schema.String, reason: LoweringReason },
    EffectArgument: {
      subject: Schema.String,
      annotation: Schema.String,
      path: Schema.String,
      kind: Schema.String,
    },
  }),
  (params) => {
    switch (params._tag) {
      case "Decode":
        return `@${params.annotation} on ${params.subject}: malformed arguments — ${params.schemaIssue}`;
      case "Lowering":
        return `${params.subject}: cannot lower \u0060${params.source}\u0060 to an annotation argument: ${loweringReason(params.reason)}`;
      case "EffectArgument":
        return `${params.subject}: @${params.annotation} has an effect clause, but its argument ${params.path} is a ${params.kind} and cannot be written as source`;
    }
  },
);

const d1103 = defineDiagnostic(
  entry(
    "EFFX1103",
    "annotation",
    "Annotation needs an operation",
    "An operation-target built-in annotation was applied to a declaration without Query or Command. There is no operation node to own the contribution.",
    '@Http.Get("/users") static get() { return handler(); }',
    '@Query({ input: Input, success: User }) @Http.Get("/users") static get() { return handler(); }',
    "Add the operation declaration, or remove the operation-target annotation.",
    "error",
  ),
  Schema.Struct({ annotation: Schema.String, subject: Schema.String }),
  ({ annotation, subject }) =>
    `@${annotation} on ${subject}: declaration has no @Query/@Command, so there is no operation to attach to`,
);

const UnsupportedSyntax = Schema.TaggedUnion({
  GroupExport: subject,
  ModelExport: subject,
  ModelOptions: subject,
  GroupMethod: subject,
  StaticMethod: subject,
  OperationClassExport: subject,
  BuilderExport: subject,
  ModelBuilder: subject,
  GroupBuilder: subject,
  ChainEnd: subject,
  AppliedCall: subject,
  HandlerFunction: subject,
  BareDecorator: { ...subject, annotation: Schema.String },
  ClassDecorator: { ...subject, annotation: Schema.String },
  UnknownStep: { ...subject, step: Schema.String },
});

const d1104 = defineDiagnostic(
  entry(
    "EFFX1104",
    "annotation",
    "Unsupported declaration syntax",
    "Source collection requires called decorators on static methods in exported classes, exported group/model classes and exported builder values. Persistent models need one options object; group/model builders need their defined constructor forms. Operation chains must terminate with handler(fn) or declare(), with a callable handler and recognized steps. with(...) accepts one applied annotation call. Class-only decorators cannot decorate methods and operation decorators cannot decorate arbitrary class members.",
    "class UserOps { @Query(options) get() { return handler(); } }",
    "export class UserOps { @Query(options) static get() { return handler(); } }",
    "Export the declaration, use the supported decorator target and call shape, and terminate the builder chain correctly.",
    "error",
  ),
  UnsupportedSyntax,
  UnsupportedSyntax.match({
    GroupExport: ({ subject }) => `${subject}: a @Http.Group class must be exported`,
    ModelExport: ({ subject }) => `${subject}: a @PersistentModel class must be exported`,
    ModelOptions: ({ subject }) => `${subject}: @PersistentModel takes exactly one options object`,
    GroupMethod: ({ subject }) =>
      `${subject}: @Http.Group is a class decorator, not a method decorator`,
    StaticMethod: ({ subject }) =>
      `${subject}: effx decorators are supported on static methods only (spec 0002)`,
    OperationClassExport: ({ subject }) =>
      `${subject}: the class holding effx operations must be exported`,
    BuilderExport: ({ subject }) => `${subject}: effx builder values must be exported`,
    ModelBuilder: ({ subject }) => `${subject}: expected Model.persistent(Schema, options)`,
    GroupBuilder: ({ subject }) => `${subject}: expected Http.group(options)`,
    ChainEnd: ({ subject }) =>
      `${subject}: an Operation chain must end with .handler(fn) or .declare()`,
    AppliedCall: ({ subject }) =>
      `${subject}: .with(...) takes one applied annotation call, e.g. .with(RateLimit({ ... }))`,
    HandlerFunction: ({ subject }) => `${subject}: .handler(...) expects a function`,
    BareDecorator: ({ subject, annotation }) =>
      `${subject}: @${annotation} must be called, e.g. @${annotation}(...)`,
    ClassDecorator: ({ subject, annotation }) =>
      `${subject}: @${annotation} is not a class decorator`,
    UnknownStep: ({ subject, step }) => `${subject}: unknown builder step .${step}(...)`,
  }),
);

const d1105 = defineDiagnostic(
  entry(
    "EFFX1105",
    "annotation",
    "Handler return type is not Effect",
    "Handler signature inference requires Effect.Effect<A, E, R>. Promise, plain values and other return types do not expose the required success/error/service channels.",
    "handler: () => Promise.resolve(user)",
    "handler: () => Effect.succeed(user)",
    "Return an Effect with the intended channels.",
    "error",
  ),
  Schema.Struct({ ...subject, returnType: Schema.String }),
  ({ subject, returnType }) =>
    subject + ": handler returns `" + returnType + "`, not an Effect.Effect<A, E, R>",
);

const BindingParams = Schema.TaggedUnion({
  RuntimeResolution: { from: Schema.String },
  ExternalSource: subject,
  LocalSource: subject,
  IrBinding: subject,
});

const d1106 = defineDiagnostic(
  {
    ...entry(
      "EFFX1106",
      "annotation",
      "Runtime resolution or handler binding mismatch",
      "Frontend resolution warns when @effx/runtime cannot be resolved, because no effx declarations can be recognized. Core interpretation rejects an external operation carrying a local handler or signature, or a local operation lacking an authored typed handler. IR analysis also rejects either invalid binding/handler pair. These are phase-specific policies under one legacy code, not interchangeable severities.",
      "Operation.query(options).declare() /* local handler intended */",
      "Operation.query(options).handler(handler)",
      "Install and resolve @effx/runtime for frontend warnings; use declare() for external bindings and a typed handler for local operations.",
    ),
    severityPolicy: {
      kind: "named",
      name: "frontend-resolution-versus-core-contract",
      description:
        "Frontend runtime resolution is warning; source and IR binding contract violations are error.",
    },
  },
  BindingParams,
  BindingParams.match({
    RuntimeResolution: ({ from }) =>
      `@effx/runtime is not resolvable from ${from}; no effx declarations can be recognised`,
    ExternalSource: ({ subject }) =>
      `${subject}: external operation must not carry a local handler or signature`,
    LocalSource: ({ subject }) => `${subject}: local operation requires an authored, typed handler`,
    IrBinding: ({ subject }) =>
      `${subject}: external bindings cannot have a handler; local operations require one`,
  }),
  (params) => (params._tag === "RuntimeResolution" ? "warning" : "error"),
);

const d1107 = defineDiagnostic(
  entry(
    "EFFX1107",
    "annotation",
    "External binding cannot implement an executable projection",
    "An external HTTP operation has no local implementation for RPC, CLI or Foldkit.Command. Each unsupported transport and Foldkit contribution is diagnosed separately.",
    "Operation.query(options).rpc.expose().declare()",
    "Operation.query(options).rpc.expose().handler(handler)",
    "Supply a local typed handler for executable projections, or keep the declaration HTTP-only.",
    "error",
  ),
  Schema.TaggedUnion({
    Transport: { ...subject, transport: Schema.Literals(["rpc", "cli"]) },
    Foldkit: subject,
  }),
  (params) =>
    `${params.subject}: external HTTP binding cannot implement ${params._tag === "Foldkit" ? "Foldkit.Command" : params.transport}`,
);

const d1302 = defineDiagnostic(
  entry(
    "EFFX1302",
    "annotation",
    "Annotation name invalid or declared twice",
    "Annotation names must match [A-Za-z][A-Za-z0-9._-]* and have exactly one selected definition owner. Both invalid grammar and duplicate definitions share this code.",
    'Annotation.define({ name: "bad name", target: "operation", args: {} })',
    'Annotation.define({ name: "app.Valid", target: "operation", args: {} })',
    "Choose a valid namespaced name and register only one definition for it.",
    "error",
  ),
  Schema.TaggedUnion({
    Grammar: { name: Schema.String, extension: Schema.String },
    Duplicate: { name: Schema.String, firstOwner: Schema.String, secondOwner: Schema.String },
  }),
  (params) =>
    params._tag === "Grammar"
      ? `annotation name ${JSON.stringify(params.name)} (extension ${params.extension}) must match [A-Za-z][A-Za-z0-9._-]*`
      : `annotation name ${params.name} is defined by extension ${params.firstOwner} and by extension ${params.secondOwner}`,
);

const d1303 = defineDiagnostic(
  entry(
    "EFFX1303",
    "annotation",
    "Annotation target does not fit syntax",
    "An operation-target user annotation cannot decorate a class. A builder with(...) application must also target operation, not another declared target. This guard is based on the definition, not the spelling of the use.",
    "@RateLimit({ perMinute: 60 }) export class UserOps {}",
    "export class UserOps { @Query(options) @RateLimit({ perMinute: 60 }) static get() { return handler(); } }",
    "Apply the annotation to an operation, or declare the target that fits the intended syntax.",
    "error",
  ),
  Schema.TaggedUnion({
    Class: { ...subject, annotation: Schema.String },
    Builder: { ...subject, annotation: Schema.String, target: Schema.String },
  }),
  (params) =>
    params._tag === "Class"
      ? `${params.subject}: @${params.annotation} targets "operation" and cannot decorate a class`
      : `${params.subject}: .with(${params.annotation}(...)) applies an annotation whose target is "${params.target}", not "operation"`,
);

const d1304 = defineDiagnostic(
  entry(
    "EFFX1304",
    "annotation",
    "Annotation effect key identity collision",
    "Two selected annotation definitions use the same effect.key id. That id is the runtime identity, so one contribution would overwrite another on an endpoint. Key ids must be literal source identities; the currently emitted form reports duplicate owners.",
    'const first = Context.Reference("app/key", { defaultValue: () => 0 }); const second = Context.Reference("app/key", { defaultValue: () => 0 });',
    'const first = Context.Reference("app/first", { defaultValue: () => 0 }); const second = Context.Reference("app/second", { defaultValue: () => 0 });',
    "Give each distinct annotation a unique literal key id, or share one annotation definition instead of duplicating it.",
    "error",
  ),
  Schema.Struct({
    key: Schema.String,
    firstAnnotation: Schema.String,
    secondAnnotation: Schema.String,
    extension: Schema.String,
  }),
  ({ key, firstAnnotation, secondAnnotation, extension }) =>
    `effect key ${JSON.stringify(key)} is used by annotation ${firstAnnotation} and by annotation ${secondAnnotation} (extension ${extension})`,
);

const d1306 = defineDiagnostic(
  entry(
    "EFFX1306",
    "annotation",
    "Definition module reaches application code",
    "Config evaluation loads definition modules, so their runtime import closure must not reach a module declaring application operations or groups. Transitive imports count; external Effect/@effx modules and definition modules form the safe boundary.",
    '// rate-limit.ts\nimport { UserOperations } from "./users.ts";',
    '// rate-limit.ts\nimport { A, Annotation } from "@effx/runtime";',
    "Move shared argument definitions into a leaf module without application imports, and keep operation modules downstream.",
    "error",
  ),
  Schema.Struct({
    definitionModule: Schema.String,
    annotation: Schema.String,
    applicationModule: Schema.String,
  }),
  ({ definitionModule, annotation, applicationModule }) =>
    `definition module ${definitionModule} of @${annotation} reaches application module ${applicationModule}; a definition module may import only effect, @effx/* and other definition modules`,
);

const d2201 = defineDiagnostic(
  entry(
    "EFFX2201",
    "contracts",
    "Inferred error missing from assertion",
    "A local handler can fail with an inferred Schema error absent from @Errors. The assertion must exactly match the handler error channel.",
    "@Errors(NotFound) // handler also fails with Conflict",
    "@Errors(NotFound, Conflict)",
    "Add the inferred error Schema or remove that handler failure.",
    "error",
  ),
  Schema.Struct(named),
  ({ subject, name }) => `${subject}: handler fails with ${name} but @Errors does not declare it`,
);

const d2202 = defineDiagnostic(
  entry(
    "EFFX2202",
    "contracts",
    "Declared error no longer inferred",
    "@Errors declares a Schema that the local handler cannot fail with. It is an exact assertion, not permission to expose extra errors.",
    "@Errors(NotFound, Conflict) // handler fails only with NotFound",
    "@Errors(NotFound)",
    "Remove the stale declaration or restore the intentional typed handler failure.",
    "error",
  ),
  Schema.Struct(named),
  ({ subject, name }) => `${subject}: @Errors declares ${name} but the handler cannot fail with it`,
);

const d2203 = defineDiagnostic(
  entry(
    "EFFX2203",
    "contracts",
    "Inferred error lacks a Schema address",
    "An inferred opaque error cannot become a stable exported Schema reference for generation. This is not the same as a missing @Errors member.",
    "handler: (): Effect.Effect<User, string> => effect",
    "@Errors(NotFound) // map the handler error to the exported Schema",
    "Map the opaque error to an exported Schema and declare it with @Errors.",
    "error",
  ),
  Schema.Struct(named),
  ({ subject, name }) =>
    `${subject}: inferred error \u0060${name}\u0060 is not schema-addressable; map it with @Errors`,
);

const d2204 = defineDiagnostic(
  entry(
    "EFFX2204",
    "contracts",
    "Boundary has no inferred addressable errors",
    "The operation uses inferred errors, but no Schema-addressable errors survived inference. The generated boundary exposes none; this warning does not invent a response contract.",
    "Operation.query(options).handler(opaqueErrorHandler)",
    "Operation.query(options).errors(NotFound).handler(schemaErrorHandler)",
    "Use an exported error Schema when the boundary must expose a failure, or accept that it exposes none.",
    "warning",
  ),
  Schema.Struct(subject),
  ({ subject }) => `${subject}: no schema-addressable errors inferred; boundary will expose none`,
);

const d2302 = defineDiagnostic(
  entry(
    "EFFX2302",
    "contracts",
    "Inferred requirement missing from assertion",
    "A local handler requires a service absent from @Requirements. The assertion must exactly match its inferred requirement channel.",
    "@Requirements(Store) // handler also requires ClockService",
    "@Requirements(Store, ClockService)",
    "Add the required service or remove its use from the handler.",
    "error",
  ),
  Schema.Struct(named),
  ({ subject, name }) =>
    `${subject}: handler requires ${name} but @Requirements does not declare it`,
);

const d2303 = defineDiagnostic(
  entry(
    "EFFX2303",
    "contracts",
    "Declared requirement no longer inferred",
    "@Requirements names a service the local handler no longer requires. External declarations have different semantics; this is a local exact-assertion mismatch.",
    "@Requirements(Store, ClockService) // handler only uses Store",
    "@Requirements(Store)",
    "Remove the stale assertion or restore the intended service use.",
    "error",
  ),
  Schema.Struct(named),
  ({ subject, name }) =>
    `${subject}: @Requirements declares ${name} but the handler no longer requires it`,
);

const d2304 = defineDiagnostic(
  entry(
    "EFFX2304",
    "contracts",
    "Requirement has no stable identity",
    "An opaque inferred requirement cannot be assigned a stable effx service identity. Declare or register an exported service so the graph can address it.",
    "handler: (): Effect.Effect<User, never, AnonymousRequirement> => effect",
    'export class Store extends Context.Service<Store, StoreApi>()("app/Store") {}',
    "Use or register an exported service with a stable key and source reference.",
    "error",
  ),
  Schema.Struct(named),
  ({ subject, name }) =>
    `${subject}: cannot assign a stable effx identity to requirement \u0060${name}\u0060; declare or register the service`,
);

const d2205 = defineDiagnostic(
  entry(
    "EFFX2205",
    "contracts",
    "Problem mapping does not cover operation errors",
    "Http.Problems either maps a tag that is not an operation error, or leaves an operation error without a mapping or sourced HTTP status. Tags use the sourced _tag where available, not necessarily the Schema export name.",
    '@Http.Problems({ registry: Problems, codes: ["user.not-found"], map: {} })',
    '@Http.Problems({ registry: Problems, codes: ["user.not-found"], map: { UserNotFound: "user.not-found" } })',
    "Remove map keys outside the error set and map every unsourced-status error tag.",
    "error",
  ),
  Schema.TaggedUnion({
    NotError: { ...subject, tag: Schema.String },
    MissingMapping: { ...subject, tag: Schema.String },
  }),
  (params) =>
    params._tag === "NotError"
      ? `${params.subject}: @Http.Problems maps ${params.tag}, which is not an operation error`
      : `${params.subject}: ${params.tag} has no @Http.Problems mapping or sourced HTTP status`,
);

const d2206 = defineDiagnostic(
  entry(
    "EFFX2206",
    "contracts",
    "Problem mapping points outside declared codes",
    "A Http.Problems map value is absent from its codes list. The map associates an operation error tag with a code already declared by that contract.",
    'codes: ["user.not-found"], map: { Conflict: "user.conflict" }',
    'codes: ["user.not-found", "user.conflict"], map: { Conflict: "user.conflict" }',
    "Add the mapped code to codes or point the tag at an existing declared code.",
    "error",
  ),
  Schema.Struct({ ...subject, tag: Schema.String, code: Schema.String }),
  ({ subject, tag, code }) =>
    `${subject}: @Http.Problems maps ${tag} to ${code}, which is absent from codes`,
);

const FoldkitParams = Schema.TaggedUnion({
  InvalidData: { ...subject, schemaIssue: Schema.String },
  OwnerEdge: subject,
  OperationOwner: subject,
  DuplicateDeclarations: subject,
  HttpExposure: subject,
  ExternalRoot: subject,
  DuplicateAnnotation: { ...subject, annotation: Schema.String },
  TaggedMessage: { ...subject, annotation: Schema.optional(Schema.String), field: Schema.String },
});

const d2601 = defineDiagnostic(
  entry(
    "EFFX2601",
    "foldkit",
    "Foldkit command or tagged Message contract invalid",
    "This legacy code covers both Foldkit IR validation and frontend Message-schema lowering. Foldkit.Command needs valid UiCommand data, exactly one qualified owner edge to an operation, one command contribution, exactly one HTTP exposure and an external (not Internal) HTTP root. The interpreter also rejects duplicate annotations. Independently, frontend success/failure Message fields must reference exported tagged Schemas whose Type has a literal-union _tag. Preserve both meanings; this number is not a new target-only diagnostic.",
    "@Foldkit.Command({ success: Schema.String, failure: Schema.String })",
    "@Foldkit.Command({ success: Saved, failure: SaveFailed }) // exported tagged Message Schemas",
    "Use exported tagged Messages, attach one command to one operation and one external HTTP exposure, and repair malformed IR ownership/data.",
    "error",
  ),
  FoldkitParams,
  FoldkitParams.match({
    InvalidData: ({ subject, schemaIssue }) =>
      `${subject}: invalid UiCommand data — ${schemaIssue}`,
    OwnerEdge: ({ subject }) => `${subject}: requires one UiCommand owner edge`,
    OperationOwner: ({ subject }) => `${subject}: must attach to an operation`,
    DuplicateDeclarations: ({ subject }) => `${subject}: duplicate Foldkit.Command declarations`,
    HttpExposure: ({ subject }) => `${subject}: Foldkit.Command requires exactly one HTTP exposure`,
    ExternalRoot: ({ subject }) => `${subject}: Foldkit.Command requires an external HTTP root`,
    DuplicateAnnotation: ({ subject, annotation }) =>
      `${subject}: duplicate @${annotation} annotations`,
    TaggedMessage: ({ subject, annotation, field }) =>
      `${subject}: ${annotation ?? "annotation"} ${field} must be an exported tagged Message schema`,
  }),
);

const d2701 = defineDiagnostic(
  entry(
    "EFFX2701",
    "project",
    "Project target or Effect installation unsupported",
    "The tsconfig effx settings may be invalid, effect/package.json may be unresolved or invalid, the installed Effect version may not select a supported target, or a generated source module may be unsupported for the selected target. These are configuration/target diagnostics, not arbitrary generator failures.",
    '"effx": { "target": "unknown" }',
    '"effx": { "target": "effect-4.0" }',
    "Select a supported target, install a supported Effect cohort, resolve its package from the project and use source modules available in that target.",
    "error",
  ),
  Schema.TaggedUnion({
    Settings: {},
    EffectVersion: { version: Schema.String, packagePath: Schema.String },
    EffectUnresolved: { directory: Schema.String },
    EffectPackage: { packagePath: Schema.String },
    SourceModule: { target: Schema.String, module: Schema.String },
  }),
  (params) => {
    switch (params._tag) {
      case "Settings":
        return "invalid tsconfig effx settings";
      case "EffectVersion":
        return `unsupported effect version ${params.version} at ${params.packagePath}`;
      case "EffectUnresolved":
        return `effect/package.json is not resolvable from ${params.directory}`;
      case "EffectPackage":
        return `invalid effect/package.json at ${params.packagePath}`;
      case "SourceModule":
        return `unsupported ${params.target} source module ${params.module}`;
    }
  },
);

const d2801 = defineDiagnostic(
  entry(
    "EFFX2801",
    "surface",
    "Deployment entry does not reach a Worker",
    "The against entry neither is nor reaches a recognized Alchemy Worker program: recognition is a call of Cloudflare.Worker imported from alchemy/Cloudflare. Arbitrary similarly named functions do not count.",
    "effx surface check --against src/schema.ts",
    "effx surface check --against alchemy.run.ts",
    "Point --against at the deployment program that reaches the recognized Worker call.",
    "error",
  ),
  Schema.Struct({ entry: Schema.String }),
  ({ entry }) =>
    `${entry} is not, and does not reach, a recognized Alchemy Worker program (a call of Cloudflare.Worker imported from "alchemy/Cloudflare")`,
);

const d2802 = defineDiagnostic(
  entry(
    "EFFX2802",
    "surface",
    "Required generated wiring is not referenced",
    "The current surface requires a generated wiring export, but the selected deployment entry never references that export. A type-only import does not wire runtime behavior. The message uses the generated file basename.",
    'import type { AppRoutes } from "./.effx/generated/http.ts";',
    'import { AppRoutes } from "./.effx/generated/http.ts"; // use in Worker wiring',
    "Reference the generated runtime wiring from the deployment entry.",
    "error",
  ),
  Schema.Struct({ name: Schema.String, file: Schema.String, entry: Schema.String }),
  ({ name, file, entry }) =>
    `missing wiring: the surface requires ${name} (from ${file}) but ${entry} never references it`,
);

const d2803 = defineDiagnostic(
  entry(
    "EFFX2803",
    "surface",
    "Deployment references obsolete generated wiring",
    "The deployment references a generated wiring export that the current build does not produce. This includes removed groups and stale modules. The message uses the generated file basename.",
    'import { RemovedApiHandlers } from "./.effx/generated/removed.ts";',
    'import { UsersApiHandlers } from "./.effx/generated/users.ts";',
    "Remove obsolete wiring or replace it with the current generated export.",
    "error",
  ),
  Schema.Struct({ name: Schema.String, file: Schema.String }),
  ({ name, file }) =>
    `extra wiring: ${name} from ${file} is referenced but the current build does not produce it`,
);

const d2804 = defineDiagnostic(
  entry(
    "EFFX2804",
    "surface",
    "Surface comparison entry cannot be read",
    "The file selected with --against does not exist at the resolved path. This data diagnostic covers the existence check; other filesystem failures retain their existing failure taxonomy.",
    "effx surface check --against missing.ts",
    "effx surface check --against alchemy.run.ts",
    "Supply an existing deployment entry and resolve its path from the command directory.",
    "error",
  ),
  Schema.Struct({ against: Schema.String }),
  ({ against }) => `cannot read the --against file ${against}`,
);

const d2805 = defineDiagnostic(
  entry(
    "EFFX2805",
    "surface",
    "Persisted surface differs from current IR",
    "The existing .effx/surface.json contents differ from the current normalized IR projection. Surface checking does not write or repair that file itself.",
    "// .effx/surface.json from before operation changes",
    "effx build",
    "Regenerate the persisted surface with effx build and review the updated wiring.",
    "warning",
  ),
  Schema.Struct({ file: Schema.String }),
  ({ file }) => `${file} differs from the current IR; run effx build`,
);

const d2806 = defineDiagnostic(
  entry(
    "EFFX2806",
    "surface",
    "Wiring cannot be decided statically",
    "A dynamic import with a non-literal specifier or computed namespace access into a generated module prevents static wiring analysis. The source location belongs to the undecidable expression; the warning does not claim the wiring is absent.",
    "const routes = generated[key];",
    "const routes = generated.AppRoutes;",
    "Use a literal module specifier and a statically named export so the checker can follow runtime references.",
    "warning",
  ),
  Schema.TaggedUnion({ DynamicImport: {}, NamespaceAccess: { namespace: Schema.String } }),
  (params) =>
    `wiring is not statically decidable here: ${params._tag === "DynamicImport" ? "import() with a non-literal specifier" : `computed access on the namespace import ${params.namespace} of a generated module`}`,
);

const d2807 = defineDiagnostic(
  entry(
    "EFFX2807",
    "surface",
    "Emit mode has no wiring to check",
    "The selected emit mode generates no AppRoutes or group ApiHandlers exports. Surface checking has nothing to compare for wiring in this mode.",
    "effx surface check --emit contract",
    "effx surface check --emit all",
    "Use a wiring-producing emit mode when deployment wiring verification is intended.",
    "info",
  ),
  Schema.Struct({}),
  () =>
    "the selected emit mode generates no wiring exports (AppRoutes / <Group>ApiHandlers); nothing to check",
);

const d3401 = defineDiagnostic(
  entry(
    "EFFX3401",
    "persistence",
    "Persistence method must be declaration-only",
    "A persistence port method has a local handler or local binding. Ports describe an adapter capability and must not embed an application implementation.",
    'Operation.query({ name: "Store.Get", input: Input, success: User }).with(Port({ port: "Store" })).handler(handler)',
    'Operation.query({ name: "Store.Get", input: Input, success: User }).with(Port({ port: "Store" })).declare()',
    "Use declare() and place implementation in the adapter, not the port definition.",
    "error",
  ),
  Schema.Struct(subject),
  ({ subject }) =>
    `${subject}: persistence port methods must be declaration-only, without a local handler`,
);

const d3402 = defineDiagnostic(
  entry(
    "EFFX3402",
    "persistence",
    "Persistence port method has transport exposure",
    "Persistence port methods cannot have HTTP, RPC or CLI exposures. They are an internal adapter interface, not an application transport boundary.",
    'Operation.query(options).with(Port({ port: "Store" })).http.get("/users").declare()',
    'Operation.query(options).with(Port({ port: "Store" })).declare()',
    "Expose a separate application operation that calls the port.",
    "error",
  ),
  Schema.Struct(subject),
  ({ subject }) => `${subject}: persistence port methods cannot have HTTP, RPC or CLI exposures`,
);

const d3403 = defineDiagnostic(
  entry(
    "EFFX3403",
    "persistence",
    "Persistence port shape or identity invalid",
    "A Port contribution needs one operation owner and { port: string }. Methods must have the port-name prefix and a nonempty method name, without duplicates. Different port names cannot collapse to the same generated filename. Duplicate Port annotations on a declaration are also rejected under this code.",
    'Operation.query({ ...options, name: "Get" }).with(Port({ port: "Store" })).declare()',
    'Operation.query({ ...options, name: "Store.Get" }).with(Port({ port: "Store" })).declare()',
    "Repair ownership/data, use PortName.method naming, declare each method once and choose port names whose escaped lowercase filenames differ.",
    "error",
  ),
  Schema.TaggedUnion({
    Ownership: subject,
    MethodName: { ...subject, port: Schema.String },
    DuplicateMethod: { ...subject, method: Schema.String, port: Schema.String },
    Filename: { port: Schema.String, otherPort: Schema.String },
    DuplicateAnnotation: { ...subject, annotation: Schema.String },
  }),
  (params) => {
    switch (params._tag) {
      case "Ownership":
        return `${params.subject}: persistence.Port requires one operation owner and { port: string }`;
      case "MethodName":
        return `${params.subject}: port methods must be named ${params.port}.<method>`;
      case "DuplicateMethod":
        return `${params.subject}: duplicate method ${params.method} in port ${params.port}`;
      case "Filename":
        return `${params.port}: generated filename collides with port ${params.otherPort}`;
      case "DuplicateAnnotation":
        return `${params.subject}: duplicate @${params.annotation} annotations`;
    }
  },
);

const d3404 = defineDiagnostic(
  entry(
    "EFFX3404",
    "persistence",
    "Query-only port has vacuous transaction laws",
    "The port declares only Queries. Generated rollback and atomicity properties are vacuous because no Command mutation exists to exercise them. This is not evidence that an adapter supports transactional writes.",
    "Store: { Get: Query }",
    "Store: { Get: Query, Put: Command }",
    "Add a real Command if transactional write conformance is required; otherwise accept the query-only limitation.",
    "warning",
  ),
  Schema.Struct({ port: Schema.String }),
  ({ port }) => `${port}: only Queries are declared; rollback and atomicity properties are vacuous`,
);

const d4101 = defineDiagnostic(
  entry(
    "EFFX4101",
    "cedar",
    "Cedar projection identity invalid or ambiguous",
    "The namespace must consist of unreserved Cedar identifiers joined by ::. Entity type names must be valid, nonreserved and not Action, and cannot merge distinct source identities into one name. Generated policy ids must also be unique. Each variant blocks projection rather than silently renaming or dropping a source.",
    "effx cedar --namespace 1bad",
    "effx cedar --namespace App::Authz",
    "Use valid unreserved namespace/entity names, disambiguate source exports and ensure distinct policy identities.",
    "error",
  ),
  Schema.TaggedUnion({
    Namespace: { namespace: Schema.String },
    EntityName: { name: Schema.String, sources: strings },
    EntityCollision: { name: Schema.String, sources: strings },
    PolicyId: { id: Schema.String },
  }),
  (params) => {
    switch (params._tag) {
      case "Namespace":
        return `--namespace ${JSON.stringify(params.namespace)} is not a Cedar namespace (unreserved identifiers joined by "::")`;
      case "EntityName":
        return `${JSON.stringify(params.name)} (${params.sources.toSorted(byCodeUnit).join(", ")}) is not a valid Cedar entity type name`;
      case "EntityCollision":
        return `entity type ${params.name} would name distinct sources: ${params.sources.toSorted(byCodeUnit).join(", ")}`;
      case "PolicyId":
        return `policy id ${JSON.stringify(params.id)} is not unique`;
    }
  },
);

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const CedarIssueParams = Schema.TaggedUnion({
  File: { file: Schema.String, validatorMessage: Schema.String },
  FileHelp: { file: Schema.String, validatorMessage: Schema.String, help: Schema.String },
  Policy: { file: Schema.String, policyId: Schema.String, validatorMessage: Schema.String },
  PolicyHelp: {
    file: Schema.String,
    policyId: Schema.String,
    validatorMessage: Schema.String,
    help: Schema.String,
  },
});

const cedarIssue = (params: typeof CedarIssueParams.Type): string => {
  const subject =
    params._tag === "Policy" || params._tag === "PolicyHelp"
      ? `${params.file}: policy ${params.policyId}`
      : params.file;

  return params._tag === "FileHelp" || params._tag === "PolicyHelp"
    ? `${subject}: ${params.validatorMessage} (${params.help})`
    : `${subject}: ${params.validatorMessage}`;
};

const d4102 = defineDiagnostic(
  entry(
    "EFFX4102",
    "cedar",
    "Application Cedar policy validation error",
    "The Cedar validator rejected an application-authored --policies file against the emitted schema. Findings retain the file, optional policy id, exact validator message and optional help. Generated Cedar validation failures remain CompilerFault invariant failures, not this diagnostic.",
    'permit(principal, action == Effx::Action::"operation/User.Gett", resource);',
    'permit(principal, action == Effx::Action::"operation/User.Get", resource);',
    "Repair the policy using the emitted actions/entity types and the validator help, then validate again.",
    "error",
  ),
  CedarIssueParams,
  cedarIssue,
);

const d4103 = defineDiagnostic(
  entry(
    "EFFX4103",
    "cedar",
    "Parameterized requirement projected by id only",
    "An AccessContract requirement has parameters. The Cedar projection records its id but does not enforce parameter constraints. Do not mistake successful projection for full authorization equivalence.",
    'requirements: [{ id: "workspace.member", parameters: { role: "admin" } }]',
    "// enforce role parameters in the application authorization decision",
    "Keep parameter enforcement in the application or an explicitly authored policy; the emitted id-only model is insufficient.",
    "warning",
  ),
  Schema.Struct({ ...subject, requirement: Schema.String }),
  ({ subject, requirement }) =>
    `${subject}: requirement ${JSON.stringify(requirement)} has parameters; projected id-only, the Cedar model does not enforce them`,
);

const d4104 = defineDiagnostic(
  entry(
    "EFFX4104",
    "cedar",
    "All capabilities cannot be one Cedar request",
    "An AccessContract capabilities All expression, or several linked capabilities without a contract, requires all capabilities at once. One Cedar request cannot represent that conjunction, so the operation action has no capability-group parent. The legacy no-contract form reports the capability count.",
    'capabilities: Capability.all("read", "write")',
    "// authorize the required conjunction explicitly in application policy/decision logic",
    "Retain the conjunction in application authorization; do not change All to Any just to silence the warning.",
    "warning",
  ),
  Schema.TaggedUnion({ Contract: subject, LinkedCapabilities: { ...subject, count: Schema.Int } }),
  (params) =>
    params._tag === "Contract"
      ? `${params.subject}: capabilities All cannot be one Cedar request; the operation action has no capability group parent`
      : `${params.subject}: ${params.count} capabilities are all required, which one Cedar request cannot express; the operation action has no capability group parent`,
);

const d4105 = defineDiagnostic(
  entry(
    "EFFX4105",
    "cedar",
    "Capability uses generic Cedar principal",
    "An operation declares a capability without an AccessContract. The projection falls back to the generic Principal entity type because no principalKinds contract exists. This is informational, not a statement that credentials have been checked.",
    "@Authorize(ReadCapability) // no Http.Access",
    '@Http.Access({ ...accessContract, principalKinds: ["User"] })',
    "Declare an AccessContract when the Cedar model needs the actual principal kinds.",
    "info",
  ),
  Schema.Struct(subject),
  ({ subject }) =>
    `${subject}: capability without an AccessContract; principal type is the generic Principal`,
);

const d4106 = defineDiagnostic(
  entry(
    "EFFX4106",
    "cedar",
    "Application Cedar policy validation warning",
    "The Cedar validator warned about an application-authored --policies file. Findings preserve file, optional policy id, exact validator message and optional help. Warnings do not block by default, but --deny-warnings makes the command fail without changing diagnostic severity.",
    'permit(principal, action == Effx::Action::"operation/User.Get", resource) when { false };',
    'permit(principal, action == Effx::Action::"operation/User.Get", resource);',
    "Review and repair the validator finding; use --deny-warnings when policy warnings must fail the command.",
    "warning",
  ),
  CedarIssueParams,
  cedarIssue,
);

const d4107 = defineDiagnostic(
  entry(
    "EFFX4107",
    "cedar",
    "No authorization facts to project",
    "No operation has a capability or AccessContract. Cedar writes nothing because there is no authorization model to project, rather than emitting an empty misleading schema.",
    "@Query(options) static get() { return handler(); }",
    "@Query(options) @Authorize(ReadCapability) static get() { return handler(); }",
    "Declare the intended capability/access facts before requesting a Cedar projection, or accept that nothing is written.",
    "info",
  ),
  Schema.Struct({}),
  () => "nothing to project: no operation has a capability or an AccessContract",
);

const d2901 = defineDiagnostic(
  entry(
    "EFFX2901",
    "example.deprecated",
    "Example operation is deprecated",
    "The shipped example.deprecated extension found a deprecated annotation and reports its authored reason for each operation owner. This numeric code is a grandfathered example reservation, not a general third-party range.",
    '@Annotate("example.deprecated", { reason: "Use User.GetV2" })',
    "// switch callers to User.GetV2 and remove the obsolete operation",
    "Follow the authored replacement reason before removing the deprecated operation.",
    "warning",
  ),
  Schema.Struct({ operation: Schema.String, reason: Schema.String }),
  ({ operation, reason }) => `${operation} is deprecated: ${reason}`,
);

const d2902 = defineDiagnostic(
  entry(
    "EFFX2902",
    "example.deprecated",
    "Example deprecated annotation is malformed",
    "The deprecated example requires one argument shaped { reason: string } and an operation declaration to own it. Both malformed arguments and missing operation ownership are diagnosed.",
    '@Annotate("example.deprecated", { reason: 42 })',
    '@Query(options) @Annotate("example.deprecated", { reason: "Use User.GetV2" })',
    "Supply a string reason and apply the annotation to a Query or Command.",
    "error",
  ),
  Schema.TaggedUnion({ Arguments: subject, Operation: subject }),
  (params) =>
    `${params.subject}: example.deprecated ${params._tag === "Arguments" ? "expects { reason: string }" : "requires an operation"}`,
);

const d9001 = defineDiagnostic(
  entry(
    "EFFX9001",
    "ai-docs",
    "Example Command lacks Audit annotation",
    "The shipped handwritten Audit extension warns for each Command without its Audit ExtensionOf contribution. Queries do not trigger this rule. This is an example-owned numeric reservation only.",
    "Operation.command(options).handler(handler)",
    'Operation.command(options).annotate("Audit", { level: "sensitive" }).handler(handler)',
    "Attach an Audit annotation and select auditExtension if the example audit policy is intended.",
    "warning",
  ),
  Schema.Struct(subject),
  ({ subject }) => `${subject}: Command has no Audit annotation`,
);

const d9002 = defineDiagnostic(
  entry(
    "EFFX9002",
    "ai-docs",
    "Example Audit annotation needs an operation",
    "The shipped handwritten Audit interpreter cannot attach an Audit contribution when no operation id exists. This reservation is specific to the authoring example.",
    '@Annotate("Audit", { level: "standard" }) static get() { return handler(); }',
    '@Query(options) @Annotate("Audit", { level: "standard" }) static get() { return handler(); }',
    "Add Query or Command so the Audit node has an operation owner.",
    "error",
  ),
  Schema.Struct(subject),
  ({ subject }) => `${subject}: the Audit annotation requires an operation`,
);

const d9101 = defineDiagnostic(
  entry(
    "EFFX9101",
    "ai-docs",
    "Example RateLimit requires HTTP exposure",
    "The shipped implement(RateLimit) example checks for an HTTP exposure on the annotated operation. RPC-only and unexposed operations cannot use that example rate-limit policy.",
    "Operation.query(options).with(RateLimit({ perMinute: 60 })).handler(handler)",
    'Operation.query(options).http.get("/users").with(RateLimit({ perMinute: 60 })).handler(handler)',
    "Expose the operation through HTTP or remove this HTTP-specific example annotation.",
    "error",
  ),
  Schema.Struct(subject),
  ({ subject }) => `${subject}: @RateLimit needs an HTTP exposure`,
);

const d9102 = defineDiagnostic(
  entry(
    "EFFX9102",
    "ai-docs",
    "Example rate limit is effectively unlimited",
    "The shipped RateLimit example warns when perMinute exceeds 10,000. At or below that threshold this analysis emits nothing; the warning does not itself enforce requests.",
    "@RateLimit({ perMinute: 20000 })",
    "@RateLimit({ perMinute: 60 })",
    "Choose the intended finite policy value and enforce it in the relevant runtime boundary.",
    "warning",
  ),
  Schema.Struct({ ...subject, perMinute: Schema.Int }),
  ({ subject, perMinute }) => `${subject}: perMinute ${perMinute} is effectively unlimited`,
);

/** Declaration sequence retains every entry before collision-checking composition. */
export const coreEntries = [
  d0001.entry,
  d0010.entry,
  d1001.entry,
  d1002.entry,
  d1003.entry,
  d1101.entry,
  d1102.entry,
  d1103.entry,
  d1104.entry,
  d1105.entry,
  d1106.entry,
  d1107.entry,
  d1302.entry,
  d1303.entry,
  d1304.entry,
  d1306.entry,
  d2201.entry,
  d2202.entry,
  d2203.entry,
  d2204.entry,
  d2302.entry,
  d2303.entry,
  d2304.entry,
  d2205.entry,
  d2206.entry,
  d2601.entry,
  d2701.entry,
  d2801.entry,
  d2802.entry,
  d2803.entry,
  d2804.entry,
  d2805.entry,
  d2806.entry,
  d2807.entry,
  d3401.entry,
  d3402.entry,
  d3403.entry,
  d3404.entry,
  d4101.entry,
  d4102.entry,
  d4103.entry,
  d4104.entry,
  d4105.entry,
  d4106.entry,
  d4107.entry,
  d2901.entry,
  d2902.entry,
  d9001.entry,
  d9002.entry,
  d9101.entry,
  d9102.entry,
  annotationSchemaLowering.entry,
] as const;

/** Code keys are derived from each entry, never copied beside the code field. */
export const CoreDiagnostics = {
  [d0001.entry.code]: d0001,
  [d0010.entry.code]: d0010,
  [d1001.entry.code]: d1001,
  [d1002.entry.code]: d1002,
  [d1003.entry.code]: d1003,
  [d1101.entry.code]: d1101,
  [d1102.entry.code]: d1102,
  [d1103.entry.code]: d1103,
  [d1104.entry.code]: d1104,
  [d1105.entry.code]: d1105,
  [d1106.entry.code]: d1106,
  [d1107.entry.code]: d1107,
  [d1302.entry.code]: d1302,
  [d1303.entry.code]: d1303,
  [d1304.entry.code]: d1304,
  [d1306.entry.code]: d1306,
  [d2201.entry.code]: d2201,
  [d2202.entry.code]: d2202,
  [d2203.entry.code]: d2203,
  [d2204.entry.code]: d2204,
  [d2302.entry.code]: d2302,
  [d2303.entry.code]: d2303,
  [d2304.entry.code]: d2304,
  [d2205.entry.code]: d2205,
  [d2206.entry.code]: d2206,
  [d2601.entry.code]: d2601,
  [d2701.entry.code]: d2701,
  [d2801.entry.code]: d2801,
  [d2802.entry.code]: d2802,
  [d2803.entry.code]: d2803,
  [d2804.entry.code]: d2804,
  [d2805.entry.code]: d2805,
  [d2806.entry.code]: d2806,
  [d2807.entry.code]: d2807,
  [d3401.entry.code]: d3401,
  [d3402.entry.code]: d3402,
  [d3403.entry.code]: d3403,
  [d3404.entry.code]: d3404,
  [d4101.entry.code]: d4101,
  [d4102.entry.code]: d4102,
  [d4103.entry.code]: d4103,
  [d4104.entry.code]: d4104,
  [d4105.entry.code]: d4105,
  [d4106.entry.code]: d4106,
  [d4107.entry.code]: d4107,
  [d2901.entry.code]: d2901,
  [d2902.entry.code]: d2902,
  [d9001.entry.code]: d9001,
  [d9002.entry.code]: d9002,
  [d9101.entry.code]: d9101,
  [d9102.entry.code]: d9102,
  [annotationSchemaLowering.entry.code]: annotationSchemaLowering,
};
