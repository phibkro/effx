import { Schema } from "effect";
import { SchemaRef, SymbolRef } from "@effx/ir";
import type { MethodCall, ObjEntry, Term } from "../generate/term.ts";

/*
 * The Schema of the ONE existing `Term` type (spec 0019 §3.1, S2 `generate/term.ts`). It is a derivation with
 * a compile-time edge back to the type: `Schema.Codec<Term>` only accepts a schema whose decoded and encoded
 * forms are exactly `Term`, so a tag or field added to `Term` breaks this module until the schema follows.
 * There is no second term grammar: no `Opaque`, no `Raw`.
 */

/** A `SchemaRef` is tried first: it is the only member that carries a `symbolId`. */
const RefLikeSchema = Schema.Union([SchemaRef, SymbolRef]);

const ObjLayoutSchema = Schema.Literals(["inline", "compact", "block"]);

const nested = Schema.suspend((): Schema.Codec<Term> => TermSchema);

const MethodCallSchema: Schema.Codec<MethodCall> = Schema.Struct({
  name: Schema.String,
  args: Schema.Array(nested),
});

const ObjEntrySchema: Schema.Codec<ObjEntry> = Schema.Struct({
  key: Schema.String,
  value: nested,
});

/** Schema for the generator's neutral expression algebra, usable inside any Schema-defined model. */
export const TermSchema: Schema.Codec<Term> = Schema.Union([
  Schema.TaggedStruct("Lit", { json: Schema.Json }),
  Schema.TaggedStruct("Ref", { ref: RefLikeSchema }),
  Schema.TaggedStruct("Call", { callee: nested, args: Schema.Array(nested) }),
  Schema.TaggedStruct("Chain", { head: nested, calls: Schema.Array(MethodCallSchema) }),
  Schema.TaggedStruct("Member", { term: nested, member: Schema.String }),
  Schema.TaggedStruct("OptionalMember", { term: nested, member: Schema.String }),
  Schema.TaggedStruct("Nullish", { head: nested, tail: Schema.Array(nested) }),
  Schema.TaggedStruct("StrictEqual", { left: nested, right: nested }),
  Schema.TaggedStruct("Cond", { test: nested, consequent: nested, alternate: nested }),
  Schema.TaggedStruct("Paren", { term: nested }),
  Schema.TaggedStruct("Obj", { entries: Schema.Array(ObjEntrySchema), layout: ObjLayoutSchema }),
  Schema.TaggedStruct("Arr", { items: Schema.Array(nested) }),
]);
