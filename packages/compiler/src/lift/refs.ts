import type { RefLike } from "../generate/term.ts";

/**
 * The identity a reference names: module, export and static member. A `SchemaRef`'s `symbolId` is
 * derived from the same triple, so it never takes part in identity.
 */
export const refIdentity = (reference: RefLike): string =>
  `${reference.module}\u0000${reference.export}\u0000${"member" in reference ? (reference.member ?? "") : ""}`;

/** Two references name the same exported symbol (and static member). */
export const sameRef = (left: RefLike, right: RefLike): boolean =>
  refIdentity(left) === refIdentity(right);
