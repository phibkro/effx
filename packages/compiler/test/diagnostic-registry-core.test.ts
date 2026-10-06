import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import type { Diagnostic } from "@effx/diagnostics";
import { annotationSchemaLowering } from "@effx/runtime/diagnostics";
import { A, Annotation } from "@effx/runtime";
import { CoreDiagnostics, coreEntries } from "../src/diagnostics/core.ts";

const diagnosticCases = [
  {
    code: "EFFX0001",
    diagnostic: () =>
      CoreDiagnostics.EFFX0001.emit({ analysisVersion: "6.0.2", projectPin: "~6.0.1" }),
    severity: "info",
  },
  {
    code: "EFFX0001",
    diagnostic: () =>
      CoreDiagnostics.EFFX0001.emit({ analysisVersion: "6.0.2", projectPin: "^7.0.2" }),
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
    severity: "error",
  },
  {
    code: "EFFX0010",
    diagnostic: () =>
      CoreDiagnostics.EFFX0010.emit({ _tag: "UndeclaredCode", owner: "plugin", code: "EFFX9999" }),
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
    severity: "error",
  },
  {
    code: "EFFX1001",
    diagnostic: () => CoreDiagnostics.EFFX1001.emit({ id: "operation/User.Get" }),
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
    severity: "error",
  },
  {
    code: "EFFX1003",
    diagnostic: () => CoreDiagnostics.EFFX1003.emit({ id: "ext/Audit/Get" }),
    severity: "error",
  },
  {
    code: "EFFX1101",
    diagnostic: () => CoreDiagnostics.EFFX1101.emit({ subject: "User.get", annotation: "Audit" }),
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
    severity: "error",
  },
  {
    code: "EFFX1103",
    diagnostic: () =>
      CoreDiagnostics.EFFX1103.emit({ subject: "User.get", annotation: "Http.Get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "GroupExport", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "ModelExport", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "ModelOptions", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "GroupMethod", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "StaticMethod", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () =>
      CoreDiagnostics.EFFX1104.emit({ _tag: "OperationClassExport", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "BuilderExport", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "ModelBuilder", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "GroupBuilder", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "ChainEnd", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () => CoreDiagnostics.EFFX1104.emit({ _tag: "AppliedCall", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () =>
      CoreDiagnostics.EFFX1104.emit({ _tag: "HandlerFunction", subject: "User.get" }),
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
    severity: "error",
  },
  {
    code: "EFFX1104",
    diagnostic: () =>
      CoreDiagnostics.EFFX1104.emit({ _tag: "UnknownStep", subject: "User.get", step: "wat" }),
    severity: "error",
  },
  {
    code: "EFFX1105",
    diagnostic: () =>
      CoreDiagnostics.EFFX1105.emit({ subject: "User.get", returnType: "Promise<User>" }),
    severity: "error",
  },
  {
    code: "EFFX1106",
    diagnostic: () =>
      CoreDiagnostics.EFFX1106.emit({ _tag: "RuntimeResolution", from: "/project/src/users.ts" }),
    severity: "warning",
  },
  {
    code: "EFFX1106",
    diagnostic: () =>
      CoreDiagnostics.EFFX1106.emit({ _tag: "ExternalSource", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1106",
    diagnostic: () => CoreDiagnostics.EFFX1106.emit({ _tag: "LocalSource", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX1106",
    diagnostic: () => CoreDiagnostics.EFFX1106.emit({ _tag: "IrBinding", subject: "User.Get" }),
    severity: "error",
  },
  {
    code: "EFFX1107",
    diagnostic: () =>
      CoreDiagnostics.EFFX1107.emit({ _tag: "Transport", subject: "User.Get", transport: "rpc" }),
    severity: "error",
  },
  {
    code: "EFFX1107",
    diagnostic: () => CoreDiagnostics.EFFX1107.emit({ _tag: "Foldkit", subject: "User.Get" }),
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
    severity: "error",
  },
  {
    code: "EFFX1302",
    diagnostic: () =>
      CoreDiagnostics.EFFX1302.emit({ _tag: "Grammar", name: "bad name", extension: "audit" }),
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
    severity: "error",
  },
  {
    code: "EFFX1303",
    diagnostic: () =>
      CoreDiagnostics.EFFX1303.emit({ _tag: "Class", subject: "User", annotation: "app.Audit" }),
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
    severity: "error",
  },
  {
    code: "EFFX2201",
    diagnostic: () => CoreDiagnostics.EFFX2201.emit({ subject: "User.Get", name: "Opaque" }),
    severity: "error",
  },
  {
    code: "EFFX2202",
    diagnostic: () => CoreDiagnostics.EFFX2202.emit({ subject: "User.Get", name: "Opaque" }),
    severity: "error",
  },
  {
    code: "EFFX2203",
    diagnostic: () => CoreDiagnostics.EFFX2203.emit({ subject: "User.Get", name: "Opaque" }),
    severity: "error",
  },
  {
    code: "EFFX2204",
    diagnostic: () => CoreDiagnostics.EFFX2204.emit({ subject: "User.Get" }),
    severity: "warning",
  },
  {
    code: "EFFX2302",
    diagnostic: () => CoreDiagnostics.EFFX2302.emit({ subject: "User.Get", name: "Opaque" }),
    severity: "error",
  },
  {
    code: "EFFX2303",
    diagnostic: () => CoreDiagnostics.EFFX2303.emit({ subject: "User.Get", name: "Opaque" }),
    severity: "error",
  },
  {
    code: "EFFX2304",
    diagnostic: () => CoreDiagnostics.EFFX2304.emit({ subject: "User.Get", name: "Opaque" }),
    severity: "error",
  },
  {
    code: "EFFX2205",
    diagnostic: () =>
      CoreDiagnostics.EFFX2205.emit({ _tag: "NotError", subject: "User.Get", tag: "Conflict" }),
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
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () => CoreDiagnostics.EFFX2601.emit({ _tag: "OwnerEdge", subject: "User.Save" }),
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () =>
      CoreDiagnostics.EFFX2601.emit({ _tag: "OperationOwner", subject: "User.Save" }),
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () =>
      CoreDiagnostics.EFFX2601.emit({ _tag: "DuplicateDeclarations", subject: "User.Save" }),
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () => CoreDiagnostics.EFFX2601.emit({ _tag: "HttpExposure", subject: "User.Save" }),
    severity: "error",
  },
  {
    code: "EFFX2601",
    diagnostic: () => CoreDiagnostics.EFFX2601.emit({ _tag: "ExternalRoot", subject: "User.Save" }),
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
    severity: "error",
  },
  {
    code: "EFFX2701",
    diagnostic: () => CoreDiagnostics.EFFX2701.emit({ _tag: "Settings" }),
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
    severity: "error",
  },
  {
    code: "EFFX2701",
    diagnostic: () =>
      CoreDiagnostics.EFFX2701.emit({ _tag: "EffectUnresolved", directory: "/project" }),
    severity: "error",
  },
  {
    code: "EFFX2701",
    diagnostic: () =>
      CoreDiagnostics.EFFX2701.emit({
        _tag: "EffectPackage",
        packagePath: "/project/effect/package.json",
      }),
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
    severity: "error",
  },
  {
    code: "EFFX2801",
    diagnostic: () => CoreDiagnostics.EFFX2801.emit({ entry: "deploy.ts" }),
    severity: "error",
  },
  {
    code: "EFFX2802",
    diagnostic: () =>
      CoreDiagnostics.EFFX2802.emit({ name: "AppRoutes", file: "rpc.ts", entry: "deploy.ts" }),
    severity: "error",
  },
  {
    code: "EFFX2803",
    diagnostic: () =>
      CoreDiagnostics.EFFX2803.emit({ name: "RemovedApiHandlers", file: "removed.ts" }),
    severity: "error",
  },
  {
    code: "EFFX2804",
    diagnostic: () => CoreDiagnostics.EFFX2804.emit({ against: "missing.ts" }),
    severity: "error",
  },
  {
    code: "EFFX2805",
    diagnostic: () => CoreDiagnostics.EFFX2805.emit({ file: "/project/.effx/surface.json" }),
    severity: "warning",
  },
  {
    code: "EFFX2806",
    diagnostic: () => CoreDiagnostics.EFFX2806.emit({ _tag: "DynamicImport" }),
    severity: "warning",
  },
  {
    code: "EFFX2806",
    diagnostic: () =>
      CoreDiagnostics.EFFX2806.emit({ _tag: "NamespaceAccess", namespace: "generated" }),
    severity: "warning",
  },
  { code: "EFFX2807", diagnostic: () => CoreDiagnostics.EFFX2807.emit({}), severity: "info" },
  {
    code: "EFFX3401",
    diagnostic: () => CoreDiagnostics.EFFX3401.emit({ subject: "Store.Get" }),
    severity: "error",
  },
  {
    code: "EFFX3402",
    diagnostic: () => CoreDiagnostics.EFFX3402.emit({ subject: "Store.Get" }),
    severity: "error",
  },
  {
    code: "EFFX3403",
    diagnostic: () =>
      CoreDiagnostics.EFFX3403.emit({ _tag: "Ownership", subject: "ext/persistence/Store.Get" }),
    severity: "error",
  },
  {
    code: "EFFX3403",
    diagnostic: () =>
      CoreDiagnostics.EFFX3403.emit({ _tag: "MethodName", subject: "Get", port: "Store" }),
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
    severity: "error",
  },
  {
    code: "EFFX3403",
    diagnostic: () =>
      CoreDiagnostics.EFFX3403.emit({ _tag: "Filename", port: "STORE", otherPort: "Store" }),
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
    severity: "error",
  },
  {
    code: "EFFX3404",
    diagnostic: () => CoreDiagnostics.EFFX3404.emit({ port: "Store" }),
    severity: "warning",
  },
  {
    code: "EFFX4101",
    diagnostic: () => CoreDiagnostics.EFFX4101.emit({ _tag: "Namespace", namespace: "1bad" }),
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
    severity: "error",
  },
  {
    code: "EFFX4101",
    diagnostic: () => CoreDiagnostics.EFFX4101.emit({ _tag: "PolicyId", id: "app:same" }),
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
    severity: "warning",
  },
  {
    code: "EFFX4103",
    diagnostic: () =>
      CoreDiagnostics.EFFX4103.emit({ subject: "User.Get", requirement: "workspace.member" }),
    severity: "warning",
  },
  {
    code: "EFFX4104",
    diagnostic: () => CoreDiagnostics.EFFX4104.emit({ _tag: "Contract", subject: "User.Save" }),
    severity: "warning",
  },
  {
    code: "EFFX4104",
    diagnostic: () =>
      CoreDiagnostics.EFFX4104.emit({ _tag: "LinkedCapabilities", subject: "User.Save", count: 2 }),
    severity: "warning",
  },
  {
    code: "EFFX4105",
    diagnostic: () => CoreDiagnostics.EFFX4105.emit({ subject: "User.Get" }),
    severity: "info",
  },
  { code: "EFFX4107", diagnostic: () => CoreDiagnostics.EFFX4107.emit({}), severity: "info" },
  {
    code: "EFFX2901",
    diagnostic: () => CoreDiagnostics.EFFX2901.emit({ operation: "User.Get", reason: "Use GetV2" }),
    severity: "warning",
  },
  {
    code: "EFFX2902",
    diagnostic: () => CoreDiagnostics.EFFX2902.emit({ _tag: "Arguments", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX2902",
    diagnostic: () => CoreDiagnostics.EFFX2902.emit({ _tag: "Operation", subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX9001",
    diagnostic: () => CoreDiagnostics.EFFX9001.emit({ subject: "User.Save" }),
    severity: "warning",
  },
  {
    code: "EFFX9002",
    diagnostic: () => CoreDiagnostics.EFFX9002.emit({ subject: "User.get" }),
    severity: "error",
  },
  {
    code: "EFFX9101",
    diagnostic: () => CoreDiagnostics.EFFX9101.emit({ subject: "User.Get" }),
    severity: "error",
  },
  {
    code: "EFFX9102",
    diagnostic: () => CoreDiagnostics.EFFX9102.emit({ subject: "User.Get", perMinute: 20000 }),
    severity: "warning",
  },
] as const;

describe("core diagnostic registry", () => {
  it.each(diagnosticCases)(
    "emits the semantic diagnostic code and severity %# $code",
    ({ code, diagnostic, severity }) => {
      const emitted = diagnostic();
      assert.strictEqual(emitted.code, code);
      assert.strictEqual(emitted.severity, severity);
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

  it("declares exactly the existing named severity outcomes", () => {
    assert.deepStrictEqual(CoreDiagnostics.EFFX0001.entry.severityPolicy.allowedSeverities, [
      "info",
      "warning",
    ]);
    assert.deepStrictEqual(CoreDiagnostics.EFFX1106.entry.severityPolicy.allowedSeverities, [
      "warning",
      "error",
    ]);
    expectTypeOf<
      (typeof CoreDiagnostics.EFFX0001.entry.severityPolicy.allowedSeverities)[number]
    >().toEqualTypeOf<"info" | "warning">();
  });

  it("projects runtime definition diagnostics with only their code and message data", () => {
    const definition = Annotation.define({
      name: "test.UnsupportedSchema",
      target: "operation",
      args: { value: A.fromSchema(Schema.DateTimeUtcFromString) },
    });

    assert.isNotEmpty(definition.diagnostics);

    for (const diagnostic of definition.diagnostics) {
      assert.deepStrictEqual(Object.keys(diagnostic).toSorted(), ["code", "message"]);
      assert.strictEqual(diagnostic.code, annotationSchemaLowering.entry.code);
    }
  });

  it("preserves caller-authored symbol expectation data", () => {
    assert.propertyVal(
      A.symbol({ check: "callable", message: "custom expectation" }).plan,
      "message",
      "custom expectation",
    );
    assert.notProperty(A.symbol({ check: "generic" }).plan, "message");
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
