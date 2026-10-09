import type { SymbolRef } from "@effx/ir";
import type { RefLike } from "../generate/term.ts";
import { schemaName } from "../generate/emit.ts";

/** The member path comes from the same SchemaRef conversion the generator uses. */
const memberOf = (reference: RefLike): string =>
  "symbolId" in reference
    ? schemaName(reference).slice(reference.export.length).replace(/^\./u, "")
    : (reference.member ?? "");

/** The exported symbol identity, including a SchemaRef static-member suffix. */
export const refIdentity = (reference: RefLike): string =>
  `${reference.module}\u0000${reference.export}\u0000${memberOf(reference)}`;

/** Two references name the same exported symbol (and static member). */
export const sameRef = (left: RefLike, right: RefLike): boolean =>
  refIdentity(left) === refIdentity(right);

/** The value symbol a reference names, without the `symbolId` of a `SchemaRef`. */
export const symbolRefOf = (reference: RefLike): SymbolRef => {
  const member = memberOf(reference);

  return member === ""
    ? { module: reference.module, export: reference.export }
    : { module: reference.module, export: reference.export, member };
};
