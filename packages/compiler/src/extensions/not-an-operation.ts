import type { Declaration } from "../Collected.ts";
import { type Diagnostic, error } from "../Diagnostic.ts";

/**
 * The guard diagnostic of every operation-target annotation. A leaf module so definitions that `implement`
 * at load time can name it without the `core` ↔ `http-contract` import cycle.
 */
export const notAnOperation = (
  annotation: { readonly name: string },
  declaration: Declaration,
): Diagnostic =>
  error(
    "EFFX1103",
    `@${annotation.name} on ${declaration.id}: declaration has no @Query/@Command, so there is no operation to attach to`,
  );
