// Public extension-author API.
export type { Extension, Interpreter, Analysis, Generator, GeneratedFile } from "./Extension.ts";

export { Contribution } from "./Extension.ts";

export { Diagnostic, Severity, Location, error, warning, hasErrors } from "./Diagnostic.ts";

export { ProjectConfig, EmitMode, TargetProfile } from "./Collected.ts";

export { CompilerFault } from "./CompilerFault.ts";

export { compile } from "./pipeline.ts";

export { decodeArgs } from "./args.ts";

export * as Extensions from "./extensions/index.ts";

export {
  LOCAL_WIRING,
  Surface,
  SurfaceJson,
  decodeSurfaceUnknown,
  surfaceOf,
  surfaceText,
} from "./surface.ts";

export * from "./surface-check.ts";

// INTERNAL: retained for the CLI, frontend, built-ins, and existing test callers.
export {
  AnnotationArg,
  Annotation,
  TypeRef,
  HandlerSignature,
  DeclarationKind,
  Declaration,
  ProjectResolution,
  Collected,
  symbolOf,
} from "./Collected.ts";

export { DiagnosticCode, StageResult } from "./Diagnostic.ts";

export { defaultGenerationContext } from "./Extension.ts";

export type { InterpretContext, AnalysisContext, GenerationContext } from "./Extension.ts";

export { SourceFrontend } from "./SourceFrontend.ts";

export { interpret, analyze, generate, compileCollected } from "./pipeline.ts";

export type { CompileResult } from "./pipeline.ts";

export { findAnnotation, SchemaArg, SymbolArg } from "./args.ts";
