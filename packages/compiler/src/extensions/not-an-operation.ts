import type { Declaration } from "../Collected.ts";
import type { Diagnostic } from "../Diagnostic.ts";
import { CoreDiagnostics } from "../diagnostics/core.ts";

/**
 * The guard diagnostic of every operation-target annotation. A leaf module so definitions that `implement`
 * at load time can name it without the `core` ↔ `http-contract` import cycle.
 */
export const notAnOperation = (
  annotation: { readonly name: string },
  declaration: Declaration,
): Diagnostic =>
  CoreDiagnostics.EFFX1103.emit({ annotation: annotation.name, subject: declaration.id });
