/** Shared registry data, typed factories and pure projections (spec 0016). */
export {
  DiagnosticCode,
  DiagnosticEntry,
  DiagnosticExample,
  Location,
  Severity,
  SeverityPolicy,
  type Diagnostic,
} from "./model.ts";

export { defineDiagnostic, type Definition, type EmitOptions } from "./definition.ts";

export { composeRegistry, RegistryError, type Registry } from "./registry.ts";

export { renderEntry, renderCatalogue } from "./render.ts";
