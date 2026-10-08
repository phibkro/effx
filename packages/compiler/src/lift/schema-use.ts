import type { SchemaRef } from "@effx/ir";
import type { RefLike } from "../generate/term.ts";
import type { Context } from "./context.ts";
import { refIdentity } from "./refs.ts";
import type { SchemaUse } from "./types.ts";

/** A reference that names an Effect Schema value (it carries the identity the IR records). */
export const isSchemaRef = (reference: RefLike): reference is SchemaRef => "symbolId" in reference;

/** A schema reference together with the type-derived facts the frontend recorded for it. */
export const schemaUseOf = (ctx: Context, ref: SchemaRef): SchemaUse => {
  const fact = ctx.schemaFacts.get(refIdentity(ref));

  return {
    ref,
    allKeys: fact?.allKeys,
    requiredKeys: fact?.requiredKeys,
    headers: fact?.headers === true,
  };
};
