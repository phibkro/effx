import { coreEntries, CoreDiagnostics } from "./core.ts";
import { httpEntries, HttpDiagnostics } from "./http.ts";

/** The complete distribution catalogue, independent of selected project extensions. */
export const bundledDiagnosticEntries = [...coreEntries, ...httpEntries];

/** Typed code-level factories; legacy emitters migrate in spec 0016 phase 2. */
export const DiagnosticDefinitions = { ...CoreDiagnostics, ...HttpDiagnostics };

export { CoreDiagnostics, HttpDiagnostics };
