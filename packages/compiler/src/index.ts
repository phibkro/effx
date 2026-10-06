// Public extension-author API.
export type {
  Extension,
  Interpreter,
  Analysis,
  Generator,
  GeneratedFile,
  Expand,
  Expansion,
  EndpointFragment,
  EndpointFragmentPart,
  FragmentImports,
} from "./Extension.ts";

export { Contribution } from "./Extension.ts";

export { Diagnostic, Severity, Location, hasErrors } from "./Diagnostic.ts";

export {
  DiagnosticEntry,
  DiagnosticExample,
  SeverityPolicy,
  RegistryError,
  composeRegistry,
  defineDiagnostic,
  renderEntry,
  renderCatalogue,
} from "@effx/diagnostics";

export type { Registry, Definition, EmitOptions } from "@effx/diagnostics";

export {
  bundledDiagnosticEntries,
  DiagnosticDefinitions,
  CoreDiagnostics,
  HttpDiagnostics,
} from "./diagnostics/index.ts";

export { ProjectConfig, EmitMode, TargetProfile } from "./Collected.ts";

export { CompilerFault } from "./CompilerFault.ts";

export { compile } from "./pipeline.ts";

export { decodeArgs } from "./args.ts";

export * as Extensions from "./extensions/index.ts";

// Typed annotation definitions (spec 0020): the compiler half of `Annotation.define`.
export { dataOf, extension, implement } from "./annotation.ts";

export type {
  ImplementOptions,
  Implementation,
  ReadArgs,
  ReadContext,
  Resolved,
} from "./annotation.ts";

export { LawViolation, laws } from "./laws.ts";

export type { Law, LawDefinition, LawOptions } from "./laws.ts";

export {
  LOCAL_WIRING,
  Surface,
  SurfaceJson,
  decodeSurfaceUnknown,
  surfaceOf,
  surfaceText,
} from "./surface.ts";

export * from "./surface-check.ts";

export {
  AccessContractProjection,
  DEFAULT_CEDAR_NAMESPACE,
  cedarOf,
  type CedarFiles,
  type CedarOptions,
  type CedarProjection,
  type FieldDisposition,
} from "./cedar.ts";

// INTERNAL: retained for the CLI, frontend, built-ins, and existing test callers.
export {
  AnnotationArg,
  Annotation,
  TypeRef,
  HandlerSignature,
  DeclarationKind,
  Declaration,
  ProjectResolution,
  Naming,
  Collected,
  SpreadSource,
  symbolOf,
} from "./Collected.ts";

export { DiagnosticCode, StageResult } from "./Diagnostic.ts";

export type {
  GroupBinding,
  GroupBindingReference,
  GroupBindingTypeParameter,
  HttpApiGroupInventory,
} from "./Collected.ts";

export { defaultGenerationContext } from "./Extension.ts";

export type { InterpretContext, AnalysisContext, GenerationContext } from "./Extension.ts";

export { SourceFrontend, type AnalyzeOptions, type DefinitionEntry } from "./SourceFrontend.ts";

export { interpret, analyze, generate, compileCollected } from "./pipeline.ts";

export type { CompileResult } from "./pipeline.ts";

export { findAnnotation, SchemaArg, SymbolArg } from "./args.ts";

// INTERNAL (spec 0020): the derivations behind `implement`; the public typed entry points are above.
export { argsSchemaOf, decodeSchemaOf, decoderOf, schemaOfPlan } from "./annotation.ts";

export type { ArgsCodec } from "./annotation.ts";

// Symbol-preserving, target-aware primitives for third-party file generators.
export {
  Imports as GeneratedImports,
  HEADER as GENERATED_HEADER,
  identifier as generatedIdentifier,
  schemaExpr,
  schemaName,
  errorsExpr,
  render as renderGenerated,
} from "./generate/emit.ts";

/** @internal Shared project-boundary validation for the declared naming policy. */
export { problemNamingIssue } from "./problem-naming.ts";
