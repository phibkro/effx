import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Effect } from "effect";
import { composeRegistry, type Diagnostic } from "@effx/diagnostics";
import { annotationSchemaLowering } from "@effx/runtime/diagnostics";
import { CoreDiagnostics, coreEntries } from "../src/diagnostics/core.ts";

// Frozen spec0016 producer inventory, excluding HTTP/access (17 codes) and adding0010.
const expectedCodes = [
  "EFFX0001",
  "EFFX0010",
  "EFFX1001",
  "EFFX1002",
  "EFFX1003",
  "EFFX1101",
  "EFFX1102",
  "EFFX1103",
  "EFFX1104",
  "EFFX1105",
  "EFFX1106",
  "EFFX1107",
  "EFFX1301",
  "EFFX1302",
  "EFFX1303",
  "EFFX1304",
  "EFFX1306",
  "EFFX2201",
  "EFFX2202",
  "EFFX2203",
  "EFFX2204",
  "EFFX2205",
  "EFFX2206",
  "EFFX2302",
  "EFFX2303",
  "EFFX2304",
  "EFFX2601",
  "EFFX2701",
  "EFFX2801",
  "EFFX2802",
  "EFFX2803",
  "EFFX2804",
  "EFFX2805",
  "EFFX2806",
  "EFFX2807",
  "EFFX2901",
  "EFFX2902",
  "EFFX3401",
  "EFFX3402",
  "EFFX3403",
  "EFFX3404",
  "EFFX4101",
  "EFFX4102",
  "EFFX4103",
  "EFFX4104",
  "EFFX4105",
  "EFFX4106",
  "EFFX4107",
  "EFFX9001",
  "EFFX9002",
  "EFFX9101",
  "EFFX9102",
] as const;

const compatibilityCases = [
  {
    code: "EFFX0001",
    diagnostic: () =>
      CoreDiagnostics.EFFX0001.emit({ analysisVersion: "6.0.2", projectPin: "~6.0.1" }),
    message:
      "effx analyses with TypeScript 6.0.2 but the project pins typescript ~6.0.1; tsc/tsgo remains the authoritative type gate",
    severity: "info",
  },
  {
    code: "EFFX0001",
    diagnostic: () =>
      CoreDiagnostics.EFFX0001.emit({ analysisVersion: "6.0.2", projectPin: "^7.0.2" }),
    message:
      "effx analyses with TypeScript 6.0.2 but the project pins typescript ^7.0.2; tsc/tsgo remains the authoritative type gate",
    severity: "warning",
  },
  {
    code: "EFFX0010",
    diagnostic: () =>
      CoreDiagnostics.EFFX0010.emit({
        _tag: "InvalidRegistry",
        owner: "effx.config.ts",
        registryIssue: "Duplicate diagnostic EFFX1001: owners kernel and plugin",
      }),
    message:
      "diagnostic registry from effx.config.ts is invalid: Duplicate diagnostic EFFX1001: owners kernel and plugin",
    severity: "error",
  },
  {
    code: "EFFX0010",
    diagnostic: () =>
      CoreDiagnostics.EFFX0010.emit({
        _tag: "InvalidEntry",
        owner: "plugin",
        schemaIssue: "missing title",
      }),
    message: "diagnostic registry entry from plugin is invalid: missing title",
    severity: "error",
  },
  {
    code: "EFFX0010",
    diagnostic: () =>
      CoreDiagnostics.EFFX0010.emit({
        _tag: "DuplicateCode",
        code: "EFFX1001",
        firstOwner: "kernel",
        secondOwner: "plugin",
      }),
    message: "diagnostic code EFFX1001 is declared by kernel and by plugin",
    severity: "error",
  },
  {
    code: "EFFX0010",
    diagnostic: () =>
      CoreDiagnostics.EFFX0010.emit({ _tag: "UndeclaredCode", owner: "plugin", code: "EFFX9999" }),
    message: "extension plugin emitted undeclared diagnostic code EFFX9999",
    severity: "error",
  },
  {
    code: "EFFX0010",
    diagnostic: () =>
      CoreDiagnostics.EFFX0010.emit({
        _tag: "SeverityMismatch",
        owner: "plugin",
        code: "EFFX1001",
        actualSeverity: "warning",
        policy: "fixed",
      }),
    message: "extension plugin emitted EFFX1001 with severity warning, contrary to fixed",
    severity: "error",
  },
  {
    code: "EFFX1001",
    diagnostic: () => CoreDiagnostics.EFFX1001.emit({ id: "operation/User.Get" }),
    message: "duplicate StableId operation/User.Get with differing content",
    severity: "error",
  },
  {
    code: "EFFX1002",
    diagnostic: () =>
      CoreDiagnostics.EFFX1002.emit({
        kind: "Requires",
        from: "operation/User.Get",
        to: "service/Store",
        missing: ["service/Store", "operation/User.Get"],
      }),
    message:
      "edge Requires operation/User.Get → service/Store references missing node(s) service/Store, operation/User.Get",
    severity: "error",
  },
  {
    code: "EFFX1003",
    diagnostic: () => CoreDiagnostics.EFFX1003.emit({ id: "ext/Audit/Get" }),
    message: "extension ext/Audit/Get has no ExtensionOf owner edge",
    severity: "error",
  },
  {
    code: "EFFX1101",
    diagnostic: () => CoreDiagnostics.EFFX1101.emit({ subject: "User.get", annotation: "Audit" }),
    message: "@Audit on User.get: no extension interprets this annotation",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Decode",
        subject: "User.get",
        annotation: "RateLimit",
        schemaIssue: "Expected number",
      }),
    message: "@RateLimit on User.get: malformed arguments — Expected number",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "EffectArgument",
        subject: "operation/User.Get",
        annotation: "RateLimit",
        path: "$[0].burst",
        kind: "non-finite number",
      }),
    message:
      "operation/User.Get: @RateLimit has an effect clause, but its argument $[0].burst is a non-finite number and cannot be written as source",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "EffectArgument",
        subject: "operation/User.Get",
        annotation: "RateLimit",
        path: "$[0].burst",
        kind: "Lambda",
      }),
    message:
      "operation/User.Get: @RateLimit has an effect clause, but its argument $[0].burst is a Lambda and cannot be written as source",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "FocusSegments" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: Focus.key path segments must be string literals",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "CapabilityOptions" },
      }),
    message:
      'User.get: cannot lower `bad` to an annotation argument: expected Capability.make("name", { resource, focus? })',
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "ResourceModel" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: resource must be an exported Schema model class",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "FocusPath" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: focus must be a Focus.key(...) path",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "ObjectProperty" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: only `key: value` and shorthand properties are supported",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "ComputedKey" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: computed keys are not supported",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "AnnotateNameMissing" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: Annotate requires a literal annotation name",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "AnnotateNameLiteral" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: annotation name must be a string literal",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "SchemaFields" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: schema must expose static fields",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "RuntimeCall" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: unsupported runtime constructor call",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "UnresolvedSymbol" },
      }),
    message: "User.get: cannot lower `bad` to an annotation argument: unresolved symbol",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "HttpRoot" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: HTTP root must be an exported concrete HttpApi value",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "HttpRootIdentifier" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: HTTP root identifier must be a string literal",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "SchemaExport" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: schema must be an exported top-level symbol or an exported class's static member",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "ServiceExport" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: service must be an exported class",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "TupleUnresolved" },
      }),
    message: "User.get: cannot lower `bad` to an annotation argument: unresolved tuple operand",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "TupleCycle" },
      }),
    message: "User.get: cannot lower `bad` to an annotation argument: cyclic tuple initializer",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "TupleConst" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: operand must resolve to a const tuple initializer",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "TupleLiteral" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: operand must resolve to a readonly const tuple of string literals",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "TupleReadonly" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: operand is not a readonly const tuple",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "TupleMismatch" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: tuple type disagrees with its runtime initializer elements or order",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "StaticStrings", constructor: "Capability.one" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: Capability.one requires static nonempty string arguments",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "StringArity", constructor: "Capability.one" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: Capability.one requires one string argument",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "StringArity", constructor: "Capability.all" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: Capability.all requires at least one string argument",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "DuplicateField", field: "input" },
      }),
    message: "User.get: cannot lower `bad` to an annotation argument: duplicate input declaration",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: {
          _tag: "DefinitionSymbol",
          expectation: "registry must be an exported value symbol",
        },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: registry must be an exported value symbol",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "TupleElement", source: "42" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: tuple element `42` must be a string literal",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "UnsupportedType", display: "unknown" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: `unknown` is neither a Schema, a service class, nor a runtime value",
    severity: "error",
  },
  {
    code: "EFFX1102",
    diagnostic: () =>
      CoreDiagnostics.EFFX1102.emit({
        _tag: "Lowering",
        subject: "User.get",
        source: "bad",
        reason: { _tag: "ExpressionKind", kind: "BinaryExpression" },
      }),
    message:
      "User.get: cannot lower `bad` to an annotation argument: unsupported expression kind BinaryExpression",
    severity: "error",
  },
  {
    code: "EFFX1103",
    diagnostic: () =>
      CoreDiagnostics.EFFX1103.emit({ subject: "User.get", annotation: "Http.Get" }),
    message:
      "@Http.Get on User.get: declaration has no @Query/@Command, so there is no operation to attach to",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "GroupExport", subject: "User.get" }),
    message: "User.get: a @Http.Group class must be exported",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "ModelExport", subject: "User.get" }),
    message: "User.get: a @PersistentModel class must be exported",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "ModelOptions", subject: "User.get" }),
    message: "User.get: @PersistentModel takes exactly one options object",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "GroupMethod", subject: "User.get" }),
    message: "User.get: @Http.Group is a class decorator, not a method decorator",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "StaticMethod", subject: "User.get" }),
    message: "User.get: effx decorators are supported on static methods only (spec 0002)",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () =>
      CoreDiagnostics.EFFX1104.emit({ _tag: "OperationClassExport", subject: "User.get" }),
    message: "User.get: the class holding effx operations must be exported",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "BuilderExport", subject: "User.get" }),
    message: "User.get: effx builder values must be exported",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "ModelBuilder", subject: "User.get" }),
    message: "User.get: expected Model.persistent(Schema, options)",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "GroupBuilder", subject: "User.get" }),
    message: "User.get: expected Http.group(options)",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "ChainEnd", subject: "User.get" }),
    message: "User.get: an Operation chain must end with .handler(fn) or .declare()",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "AppliedCall", subject: "User.get" }),
    message:
      "User.get: .with(...) takes one applied annotation call, e.g. .with(RateLimit({ ... }))",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () =>
      CoreDiagnostics.EFFX1104.emit({ _tag: "HandlerFunction", subject: "User.get" }),
    message: "User.get: .handler(...) expects a function",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () =>
      CoreDiagnostics.EFFX1104.emit({
        _tag: "BareDecorator",
        subject: "User.get",
        annotation: "Query",
      }),
    message: "User.get: @Query must be called, e.g. @Query(...)",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () =>
      CoreDiagnostics.EFFX1104.emit({
        _tag: "ClassDecorator",
        subject: "User",
        annotation: "Query",
      }),
    message: "User: @Query is not a class decorator",
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () =>
      CoreDiagnostics.EFFX1104.emit({ _tag: "UnknownStep", subject: "User.get", step: "wat" }),
    message: "User.get: unknown builder step .wat(...)",
    severity: "error",
  },
  {
    code: "EFFX1105",
    diagnostic: () =>
      CoreDiagnostics.EFFX1105.emit({ subject: "User.get", returnType: "Promise<User>" }),
    message: "User.get: handler returns `Promise<User>`, not an Effect.Effect<A, E, R>",
    severity: "error",
  },
  {
    code: "EFFX1106",
    diagnostic: () =>
      CoreDiagnostics.EFFX1106.emit({ _tag: "RuntimeResolution", from: "/project/src/users.ts" }),
    message:
      "@effx/runtime is not resolvable from /project/src/users.ts; no effx declarations can be recognised",
    severity: "warning",
  },
  {
    code: "EFFX1106",
    diagnostic: () =>
      CoreDiagnostics.EFFX1106.emit({ _tag: "ExternalSource", subject: "User.get" }),
    message: "User.get: external operation must not carry a local handler or signature",
    severity: "error",
  },
  {
    code: "EFFX1106",
    diagnostic: () => CoreDiagnostics.EFFX1106.emit({ _tag: "LocalSource", subject: "User.get" }),
    message: "User.get: local operation requires an authored, typed handler",
    severity: "error",
  },
  {
    code: "EFFX1106",
    diagnostic: () => CoreDiagnostics.EFFX1106.emit({ _tag: "IrBinding", subject: "User.Get" }),
    message: "User.Get: external bindings cannot have a handler; local operations require one",
    severity: "error",
  },
  {
    code: "EFFX1107",
    diagnostic: () =>
      CoreDiagnostics.EFFX1107.emit({ _tag: "Transport", subject: "User.Get", transport: "rpc" }),
    message: "User.Get: external HTTP binding cannot implement rpc",
    severity: "error",
  },
  {
    code: "EFFX1107",
    diagnostic: () => CoreDiagnostics.EFFX1107.emit({ _tag: "Foldkit", subject: "User.Get" }),
    message: "User.Get: external HTTP binding cannot implement Foldkit.Command",
    severity: "error",
  },
  {
    code: "EFFX1301",
    diagnostic: () =>
      CoreDiagnostics.EFFX1301.emit({
        annotation: "app.Audit",
        path: "$[0].value",
        nodeKind: "Transformation",
      }),
    message:
      "annotation app.Audit: args $[0].value: Schema node Transformation cannot be lowered from source (A.fromSchema)",
    severity: "error",
  },
  {
    code: "EFFX1302",
    diagnostic: () =>
      CoreDiagnostics.EFFX1302.emit({ _tag: "Grammar", name: "bad name", extension: "audit" }),
    message: 'annotation name "bad name" (extension audit) must match [A-Za-z][A-Za-z0-9._-]*',
    severity: "error",
  },
  {
    code: "EFFX1302",
    diagnostic: () =>
      CoreDiagnostics.EFFX1302.emit({
        _tag: "Duplicate",
        name: "app.Audit",
        firstOwner: "one",
        secondOwner: "two",
      }),
    message: "annotation name app.Audit is defined by extension one and by extension two",
    severity: "error",
  },
  {
    code: "EFFX1303",
    diagnostic: () =>
      CoreDiagnostics.EFFX1303.emit({ _tag: "Class", subject: "User", annotation: "app.Audit" }),
    message: 'User: @app.Audit targets "operation" and cannot decorate a class',
    severity: "error",
  },
  {
    code: "EFFX1303",
    diagnostic: () =>
      CoreDiagnostics.EFFX1303.emit({
        _tag: "Builder",
        subject: "User.get",
        annotation: "app.Model",
        target: "model",
      }),
    message:
      'User.get: .with(app.Model(...)) applies an annotation whose target is "model", not "operation"',
    severity: "error",
  },
  {
    code: "EFFX1304",
    diagnostic: () =>
      CoreDiagnostics.EFFX1304.emit({
        key: "app/key",
        firstAnnotation: "app.One",
        secondAnnotation: "app.Two",
        extension: "two",
      }),
    message:
      'effect key "app/key" is used by annotation app.One and by annotation app.Two (extension two)',
    severity: "error",
  },
  {
    code: "EFFX1306",
    diagnostic: () =>
      CoreDiagnostics.EFFX1306.emit({
        definitionModule: "/project/rate.ts",
        annotation: "RateLimit",
        applicationModule: "/project/users.ts",
      }),
    message:
      "definition module /project/rate.ts of @RateLimit reaches application module /project/users.ts; a definition module may import only effect, @effx/* and other definition modules",
    severity: "error",
  },
  {
    code: "EFFX2201",
    diagnostic: () => CoreDiagnostics.EFFX2201.emit({ subject: "User.Get", name: "Opaque" }),
    message: "User.Get: handler fails with Opaque but @Errors does not declare it",
    severity: "error",
  },
  {
    code: "EFFX2202",
    diagnostic: () => CoreDiagnostics.EFFX2202.emit({ subject: "User.Get", name: "Opaque" }),
    message: "User.Get: @Errors declares Opaque but the handler cannot fail with it",
    severity: "error",
  },
  {
    code: "EFFX2203",
    diagnostic: () => CoreDiagnostics.EFFX2203.emit({ subject: "User.Get", name: "Opaque" }),
    message: "User.Get: inferred error `Opaque` is not schema-addressable; map it with @Errors",
    severity: "error",
  },
  {
    code: "EFFX2204",
    diagnostic: () => CoreDiagnostics.EFFX2204.emit({ subject: "User.Get" }),
    message: "User.Get: no schema-addressable errors inferred; boundary will expose none",
    severity: "warning",
  },
  {
    code: "EFFX2302",
    diagnostic: () => CoreDiagnostics.EFFX2302.emit({ subject: "User.Get", name: "Opaque" }),
    message: "User.Get: handler requires Opaque but @Requirements does not declare it",
    severity: "error",
  },
  {
    code: "EFFX2303",
    diagnostic: () => CoreDiagnostics.EFFX2303.emit({ subject: "User.Get", name: "Opaque" }),
    message: "User.Get: @Requirements declares Opaque but the handler no longer requires it",
    severity: "error",
  },
  {
    code: "EFFX2304",
    diagnostic: () => CoreDiagnostics.EFFX2304.emit({ subject: "User.Get", name: "Opaque" }),
    message:
      "User.Get: cannot assign a stable effx identity to requirement `Opaque`; declare or register the service",
    severity: "error",
  },
  {
    code: "EFFX2205",
    diagnostic: () =>
      CoreDiagnostics.EFFX2205.emit({ _tag: "NotError", subject: "User.Get", tag: "Conflict" }),
    message: "User.Get: @Http.Problems maps Conflict, which is not an operation error",
    severity: "error",
  },
  {
    code: "EFFX2205",
    diagnostic: () =>
      CoreDiagnostics.EFFX2205.emit({
        _tag: "MissingMapping",
        subject: "User.Get",
        tag: "NotFound",
      }),
    message: "User.Get: NotFound has no @Http.Problems mapping or sourced HTTP status",
    severity: "error",
  },
  {
    code: "EFFX2206",
    diagnostic: () =>
      CoreDiagnostics.EFFX2206.emit({
        subject: "User.Get",
        tag: "NotFound",
        code: "user.not-found",
      }),
    message: "User.Get: @Http.Problems maps NotFound to user.not-found, which is absent from codes",
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () =>
      CoreDiagnostics.EFFX2601.emit({
        _tag: "InvalidData",
        subject: "User.Save",
        schemaIssue: "Expected Symbol",
      }),
    message: "User.Save: invalid UiCommand data — Expected Symbol",
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () => CoreDiagnostics.EFFX2601.emit({ _tag: "OwnerEdge", subject: "User.Save" }),
    message: "User.Save: requires one UiCommand owner edge",
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () =>
      CoreDiagnostics.EFFX2601.emit({ _tag: "OperationOwner", subject: "User.Save" }),
    message: "User.Save: must attach to an operation",
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () =>
      CoreDiagnostics.EFFX2601.emit({ _tag: "DuplicateDeclarations", subject: "User.Save" }),
    message: "User.Save: duplicate Foldkit.Command declarations",
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () => CoreDiagnostics.EFFX2601.emit({ _tag: "HttpExposure", subject: "User.Save" }),
    message: "User.Save: Foldkit.Command requires exactly one HTTP exposure",
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () => CoreDiagnostics.EFFX2601.emit({ _tag: "ExternalRoot", subject: "User.Save" }),
    message: "User.Save: Foldkit.Command requires an external HTTP root",
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () =>
      CoreDiagnostics.EFFX2601.emit({
        _tag: "DuplicateAnnotation",
        subject: "User.Save",
        annotation: "Foldkit.Command",
      }),
    message: "User.Save: duplicate @Foldkit.Command annotations",
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () =>
      CoreDiagnostics.EFFX2601.emit({
        _tag: "TaggedMessage",
        subject: "User.Save",
        annotation: "Foldkit.Command",
        field: "success",
      }),
    message: "User.Save: Foldkit.Command success must be an exported tagged Message schema",
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () =>
      CoreDiagnostics.EFFX2601.emit({
        _tag: "TaggedMessage",
        subject: "User.Save",
        field: "failure",
      }),
    message: "User.Save: annotation failure must be an exported tagged Message schema",
    severity: "error",
  },
  {
    code: "EFFX2701",
    diagnostic: () => CoreDiagnostics.EFFX2701.emit({ _tag: "Settings" }),
    message: "invalid tsconfig effx settings",
    severity: "error",
  },
  {
    code: "EFFX2701",
    diagnostic: () =>
      CoreDiagnostics.EFFX2701.emit({
        _tag: "EffectVersion",
        version: "3.0.0",
        packagePath: "/project/effect/package.json",
      }),
    message: "unsupported effect version 3.0.0 at /project/effect/package.json",
    severity: "error",
  },
  {
    code: "EFFX2701",
    diagnostic: () =>
      CoreDiagnostics.EFFX2701.emit({ _tag: "EffectUnresolved", directory: "/project" }),
    message: "effect/package.json is not resolvable from /project",
    severity: "error",
  },
  {
    code: "EFFX2701",
    diagnostic: () =>
      CoreDiagnostics.EFFX2701.emit({
        _tag: "EffectPackage",
        packagePath: "/project/effect/package.json",
      }),
    message: "invalid effect/package.json at /project/effect/package.json",
    severity: "error",
  },
  {
    code: "EFFX2701",
    diagnostic: () =>
      CoreDiagnostics.EFFX2701.emit({
        _tag: "SourceModule",
        target: "v4",
        module: "effect/unsupported",
      }),
    message: "unsupported v4 source module effect/unsupported",
    severity: "error",
  },
  {
    code: "EFFX2801",
    diagnostic: () => CoreDiagnostics.EFFX2801.emit({ entry: "deploy.ts" }),
    message:
      'deploy.ts is not, and does not reach, a recognized Alchemy Worker program (a call of Cloudflare.Worker imported from "alchemy/Cloudflare")',
    severity: "error",
  },
  {
    code: "EFFX2802",
    diagnostic: () =>
      CoreDiagnostics.EFFX2802.emit({ name: "AppRoutes", file: "rpc.ts", entry: "deploy.ts" }),
    message:
      "missing wiring: the surface requires AppRoutes (from rpc.ts) but deploy.ts never references it",
    severity: "error",
  },
  {
    code: "EFFX2803",
    diagnostic: () =>
      CoreDiagnostics.EFFX2803.emit({ name: "RemovedApiHandlers", file: "removed.ts" }),
    message:
      "extra wiring: RemovedApiHandlers from removed.ts is referenced but the current build does not produce it",
    severity: "error",
  },
  {
    code: "EFFX2804",
    diagnostic: () => CoreDiagnostics.EFFX2804.emit({ against: "missing.ts" }),
    message: "cannot read the --against file missing.ts",
    severity: "error",
  },
  {
    code: "EFFX2805",
    diagnostic: () => CoreDiagnostics.EFFX2805.emit({ file: "/project/.effx/surface.json" }),
    message: "/project/.effx/surface.json differs from the current IR; run effx build",
    severity: "warning",
  },
  {
    code: "EFFX2806",
    diagnostic: () => CoreDiagnostics.EFFX2806.emit({ _tag: "DynamicImport" }),
    message: "wiring is not statically decidable here: import() with a non-literal specifier",
    severity: "warning",
  },
  {
    code: "EFFX2806",
    diagnostic: () =>
      CoreDiagnostics.EFFX2806.emit({ _tag: "NamespaceAccess", namespace: "generated" }),
    message:
      "wiring is not statically decidable here: computed access on the namespace import generated of a generated module",
    severity: "warning",
  },
  {
    code: "EFFX2807",
    diagnostic: () => CoreDiagnostics.EFFX2807.emit({}),
    message:
      "the selected emit mode generates no wiring exports (AppRoutes / <Group>ApiHandlers); nothing to check",
    severity: "info",
  },
  {
    code: "EFFX3401",
    diagnostic: () => CoreDiagnostics.EFFX3401.emit({ subject: "Store.Get" }),
    message:
      "Store.Get: persistence port methods must be declaration-only, without a local handler",
    severity: "error",
  },
  {
    code: "EFFX3402",
    diagnostic: () => CoreDiagnostics.EFFX3402.emit({ subject: "Store.Get" }),
    message: "Store.Get: persistence port methods cannot have HTTP, RPC or CLI exposures",
    severity: "error",
  },
  {
    code: "EFFX3403",
    diagnostic: () =>
      CoreDiagnostics.EFFX3403.emit({ _tag: "Ownership", subject: "ext/persistence/Store.Get" }),
    message:
      "ext/persistence/Store.Get: persistence.Port requires one operation owner and { port: string }",
    severity: "error",
  },
  {
    code: "EFFX3403",
    diagnostic: () =>
      CoreDiagnostics.EFFX3403.emit({ _tag: "MethodName", subject: "Get", port: "Store" }),
    message: "Get: port methods must be named Store.<method>",
    severity: "error",
  },
  {
    code: "EFFX3403",
    diagnostic: () =>
      CoreDiagnostics.EFFX3403.emit({
        _tag: "DuplicateMethod",
        subject: "Store.Get",
        method: "Get",
        port: "Store",
      }),
    message: "Store.Get: duplicate method Get in port Store",
    severity: "error",
  },
  {
    code: "EFFX3403",
    diagnostic: () =>
      CoreDiagnostics.EFFX3403.emit({ _tag: "Filename", port: "STORE", otherPort: "Store" }),
    message: "STORE: generated filename collides with port Store",
    severity: "error",
  },
  {
    code: "EFFX3403",
    diagnostic: () =>
      CoreDiagnostics.EFFX3403.emit({
        _tag: "DuplicateAnnotation",
        subject: "Store.Get",
        annotation: "persistence.Port",
      }),
    message: "Store.Get: duplicate @persistence.Port annotations",
    severity: "error",
  },
  {
    code: "EFFX3404",
    diagnostic: () => CoreDiagnostics.EFFX3404.emit({ port: "Store" }),
    message: "Store: only Queries are declared; rollback and atomicity properties are vacuous",
    severity: "warning",
  },
  {
    code: "EFFX4101",
    diagnostic: () => CoreDiagnostics.EFFX4101.emit({ _tag: "Namespace", namespace: "1bad" }),
    message: '--namespace "1bad" is not a Cedar namespace (unreserved identifiers joined by "::")',
    severity: "error",
  },
  {
    code: "EFFX4101",
    diagnostic: () =>
      CoreDiagnostics.EFFX4101.emit({
        _tag: "EntityName",
        name: "Action",
        sources: ["schema:Z", "schema:A"],
      }),
    message: '"Action" (schema:A, schema:Z) is not a valid Cedar entity type name',
    severity: "error",
  },
  {
    code: "EFFX4101",
    diagnostic: () =>
      CoreDiagnostics.EFFX4101.emit({
        _tag: "EntityCollision",
        name: "User",
        sources: ["schema:Z", "schema:A"],
      }),
    message: "entity type User would name distinct sources: schema:A, schema:Z",
    severity: "error",
  },
  {
    code: "EFFX4101",
    diagnostic: () => CoreDiagnostics.EFFX4101.emit({ _tag: "PolicyId", id: "app:same" }),
    message: 'policy id "app:same" is not unique',
    severity: "error",
  },
  {
    code: "EFFX4102",
    diagnostic: () =>
      CoreDiagnostics.EFFX4102.emit({
        _tag: "File",
        file: "app.cedar",
        validatorMessage: "unrecognized action",
      }),
    message: "app.cedar: unrecognized action",
    severity: "error",
  },
  {
    code: "EFFX4102",
    diagnostic: () =>
      CoreDiagnostics.EFFX4102.emit({
        _tag: "FileHelp",
        file: "app.cedar",
        validatorMessage: "unrecognized action",
        help: "did you mean read?",
      }),
    message: "app.cedar: unrecognized action (did you mean read?)",
    severity: "error",
  },
  {
    code: "EFFX4102",
    diagnostic: () =>
      CoreDiagnostics.EFFX4102.emit({
        _tag: "Policy",
        file: "app.cedar",
        policyId: "app:read",
        validatorMessage: "unrecognized action",
      }),
    message: "app.cedar: policy app:read: unrecognized action",
    severity: "error",
  },
  {
    code: "EFFX4102",
    diagnostic: () =>
      CoreDiagnostics.EFFX4102.emit({
        _tag: "PolicyHelp",
        file: "app.cedar",
        policyId: "app:read",
        validatorMessage: "unrecognized action",
        help: "did you mean read?",
      }),
    message: "app.cedar: policy app:read: unrecognized action (did you mean read?)",
    severity: "error",
  },
  {
    code: "EFFX4106",
    diagnostic: () =>
      CoreDiagnostics.EFFX4106.emit({
        _tag: "File",
        file: "app.cedar",
        validatorMessage: "unrecognized action",
      }),
    message: "app.cedar: unrecognized action",
    severity: "warning",
  },
  {
    code: "EFFX4106",
    diagnostic: () =>
      CoreDiagnostics.EFFX4106.emit({
        _tag: "FileHelp",
        file: "app.cedar",
        validatorMessage: "unrecognized action",
        help: "did you mean read?",
      }),
    message: "app.cedar: unrecognized action (did you mean read?)",
    severity: "warning",
  },
  {
    code: "EFFX4106",
    diagnostic: () =>
      CoreDiagnostics.EFFX4106.emit({
        _tag: "Policy",
        file: "app.cedar",
        policyId: "app:read",
        validatorMessage: "unrecognized action",
      }),
    message: "app.cedar: policy app:read: unrecognized action",
    severity: "warning",
  },
  {
    code: "EFFX4106",
    diagnostic: () =>
      CoreDiagnostics.EFFX4106.emit({
        _tag: "PolicyHelp",
        file: "app.cedar",
        policyId: "app:read",
        validatorMessage: "unrecognized action",
        help: "did you mean read?",
      }),
    message: "app.cedar: policy app:read: unrecognized action (did you mean read?)",
    severity: "warning",
  },
  {
    code: "EFFX4103",
    diagnostic: () =>
      CoreDiagnostics.EFFX4103.emit({ subject: "User.Get", requirement: "workspace.member" }),
    message:
      'User.Get: requirement "workspace.member" has parameters; projected id-only, the Cedar model does not enforce them',
    severity: "warning",
  },
  {
    code: "EFFX4104",
    diagnostic: () => CoreDiagnostics.EFFX4104.emit({ _tag: "Contract", subject: "User.Save" }),
    message:
      "User.Save: capabilities All cannot be one Cedar request; the operation action has no capability group parent",
    severity: "warning",
  },
  {
    code: "EFFX4104",
    diagnostic: () =>
      CoreDiagnostics.EFFX4104.emit({ _tag: "LinkedCapabilities", subject: "User.Save", count: 2 }),
    message:
      "User.Save: 2 capabilities are all required, which one Cedar request cannot express; the operation action has no capability group parent",
    severity: "warning",
  },
  {
    code: "EFFX4105",
    diagnostic: () => CoreDiagnostics.EFFX4105.emit({ subject: "User.Get" }),
    message:
      "User.Get: capability without an AccessContract; principal type is the generic Principal",
    severity: "info",
  },
  {
    code: "EFFX4107",
    diagnostic: () => CoreDiagnostics.EFFX4107.emit({}),
    message: "nothing to project: no operation has a capability or an AccessContract",
    severity: "info",
  },
  {
    code: "EFFX2901",
    diagnostic: () => CoreDiagnostics.EFFX2901.emit({ operation: "User.Get", reason: "Use GetV2" }),
    message: "User.Get is deprecated: Use GetV2",
    severity: "warning",
  },
  {
    code: "EFFX2902",
    diagnostic: () => CoreDiagnostics.EFFX2902.emit({ _tag: "Arguments", subject: "User.get" }),
    message: "User.get: example.deprecated expects { reason: string }",
    severity: "error",
  },
  {
    code: "EFFX2902",
    diagnostic: () => CoreDiagnostics.EFFX2902.emit({ _tag: "Operation", subject: "User.get" }),
    message: "User.get: example.deprecated requires an operation",
    severity: "error",
  },
  {
    code: "EFFX9001",
    diagnostic: () => CoreDiagnostics.EFFX9001.emit({ subject: "User.Save" }),
    message: "User.Save: Command has no Audit annotation",
    severity: "warning",
  },
  {
    code: "EFFX9002",
    diagnostic: () => CoreDiagnostics.EFFX9002.emit({ subject: "User.get" }),
    message: "User.get: the Audit annotation requires an operation",
    severity: "error",
  },
  {
    code: "EFFX9101",
    diagnostic: () => CoreDiagnostics.EFFX9101.emit({ subject: "User.Get" }),
    message: "User.Get: @RateLimit needs an HTTP exposure",
    severity: "error",
  },
  {
    code: "EFFX9102",
    diagnostic: () => CoreDiagnostics.EFFX9102.emit({ subject: "User.Get", perMinute: 20000 }),
    message: "User.Get: perMinute 20000 is effectively unlimited",
    severity: "warning",
  },
] as const;

describe("core diagnostic registry", () => {
  it.effect("contains exactly the52 non-HTTP/access entries without overwritten duplicates", () =>
    Effect.gen(function* () {
      const registry = yield* composeRegistry(coreEntries);

      assert.deepStrictEqual<ReadonlyArray<string>>(
        registry.entries.map((entry) => entry.code).toSorted(),
        expectedCodes,
      );
      assert.strictEqual(coreEntries.length, 52);
      assert.strictEqual(new Set(coreEntries.map((entry) => entry.code)).size, 52);
      assert.deepStrictEqual<ReadonlyArray<string>>(
        Object.keys(CoreDiagnostics).toSorted(),
        expectedCodes,
      );
      assert.deepStrictEqual<ReadonlyArray<string>>(
        [...new Set(compatibilityCases.map((test) => test.code))].toSorted(),
        expectedCodes,
      );

      for (const entry of coreEntries) {
        assert.isNotEmpty(entry.explanation);
        assert.isAtLeast(entry.examples.length, 1);

        for (const example of entry.examples) {
          assert.isNotEmpty(example.before);
          assert.isNotEmpty(example.after);
          assert.isNotEmpty(example.explanation);
        }
      }
    }),
  );

  it.each(compatibilityCases)(
    "preserves exact legacy message and policy %# $code",
    ({ code, diagnostic, message, severity }) => {
      assert.deepStrictEqual<Diagnostic>(diagnostic(), { code, message, severity });
    },
  );

  it("shares runtime1301 by reference without a runtime-to-compiler cycle", () => {
    assert.strictEqual(CoreDiagnostics.EFFX1301, annotationSchemaLowering);
    assert.strictEqual(
      coreEntries.filter((entry) => entry.code === "EFFX1301")[0],
      annotationSchemaLowering.entry,
    );
  });

  it("preserves occurrence locations and related diagnostics without catalogue state", () => {
    const location = { file: "users.ts", line: 7, col: 3 };
    const related = [CoreDiagnostics.EFFX1003.emit({ id: "ext/orphan" })];

    const emitted = CoreDiagnostics.EFFX1001.emit(
      { id: "operation/User.Get" },
      { location, related },
    );

    assert.strictEqual(emitted.location, location);
    assert.strictEqual(emitted.related, related);
    assert.notProperty(CoreDiagnostics.EFFX1001.entry, "location");
    assert.notProperty(CoreDiagnostics.EFFX1001.emit({ id: "operation/User.Get" }), "location");
  });

  it("keeps literal keys and typed variant facts", () => {
    expectTypeOf<
      Extract<
        Parameters<typeof CoreDiagnostics.EFFX1102.emit>[0],
        { readonly _tag: "EffectArgument" }
      >["kind"]
    >().toEqualTypeOf<"Lambda" | "non-finite number">();
    expectTypeOf(CoreDiagnostics.EFFX1001.entry.code).toEqualTypeOf<"EFFX1001">();
    expectTypeOf(
      CoreDiagnostics.EFFX1001.emit({ id: "operation/User.Get" }),
    ).toExtend<Diagnostic>();
    expectTypeOf<Parameters<typeof CoreDiagnostics.EFFX1106.emit>[0]>().toEqualTypeOf<
      | { readonly _tag: "RuntimeResolution"; readonly from: string }
      | { readonly _tag: "ExternalSource"; readonly subject: string }
      | { readonly _tag: "LocalSource"; readonly subject: string }
      | { readonly _tag: "IrBinding"; readonly subject: string }
    >();
    expectTypeOf<Parameters<typeof CoreDiagnostics.EFFX2601.emit>[0]>().not.toExtend<{
      message: string;
    }>();
    expectTypeOf<Parameters<typeof CoreDiagnostics.EFFX1106.emit>[0]>().not.toExtend<{
      severity: string;
    }>();
  });
});
