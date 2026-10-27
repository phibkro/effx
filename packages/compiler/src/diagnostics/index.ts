import { coreEntries, CoreDiagnostics } from "./core.ts";
import { httpEntries, HttpDiagnostics } from "./http.ts";
import { liftEntries, LiftDiagnostics } from "./lift.ts";
import { domainEntries, DomainDiagnostics } from "./domain-model.ts";

/** The complete distribution catalogue, independent of selected project extensions. */
export const bundledDiagnosticEntries = [
  ...coreEntries,
  ...httpEntries,
  ...liftEntries,
  ...domainEntries,
];

/** Typed code-level factories; legacy emitters migrate in spec 0016 phase 2. */
export const DiagnosticDefinitions = {
  ...CoreDiagnostics,
  ...HttpDiagnostics,
  ...LiftDiagnostics,
  ...DomainDiagnostics,
};

export { CoreDiagnostics, HttpDiagnostics, LiftDiagnostics, DomainDiagnostics };
