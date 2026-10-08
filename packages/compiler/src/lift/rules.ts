import { Schema } from "effect";
import { SchemaRef, SymbolRef } from "@effx/ir";
import { ProjectResolution } from "../Collected.ts";

/*
 * Lift rules are DATA (spec 0019 §5.2, §0.2): Schema-decoded JSON that maps an application helper to the
 * effx annotation data it stands for. No application callback runs in the compiler, and there is no
 * `Extension.lifters` field: the definition-owned `implement({ lift })` hook (S1) will contribute rules of
 * these same schemas. The pure core consumes them directly, so a fixture can drive it before S1 lands.
 */

/** One entry of an object literal built by a template. */
export interface TemplateField {
  readonly key: string;
  readonly value: TemplateExpr;
}

/**
 * A closed, total expression language over the literal arguments of one builder call (spec 0019 §5.2:
 * `$arg`, `$const`, `$ifPresent`, plus the few forms the four mono-web access builders need). It evaluates to
 * JSON only; it has no loops, no application symbols and no evaluation of source.
 */
export type TemplateExpr =
  | { readonly _tag: "Const"; readonly value: Schema.Json }
  | { readonly _tag: "Arg"; readonly name: string }
  | {
      readonly _tag: "IfPresent";
      readonly arg: string;
      readonly present: TemplateExpr;
      readonly absent: TemplateExpr;
    }
  | {
      readonly _tag: "IfTrue";
      readonly arg: string;
      readonly whenTrue: TemplateExpr;
      readonly whenFalse: TemplateExpr;
    }
  | { readonly _tag: "Object"; readonly fields: ReadonlyArray<TemplateField> }
  | { readonly _tag: "Array"; readonly items: ReadonlyArray<TemplateExpr> }
  | { readonly _tag: "Concat"; readonly parts: ReadonlyArray<TemplateExpr> }
  | { readonly _tag: "Map"; readonly arg: string; readonly body: TemplateExpr }
  | { readonly _tag: "Item" };

const nested = Schema.suspend((): Schema.Codec<TemplateExpr> => TemplateExpr);

const TemplateFieldSchema: Schema.Codec<TemplateField> = Schema.Struct({
  key: Schema.String,
  value: nested,
});

export const TemplateExpr: Schema.Codec<TemplateExpr> = Schema.Union([
  Schema.TaggedStruct("Const", { value: Schema.Json }),
  Schema.TaggedStruct("Arg", { name: Schema.String }),
  Schema.TaggedStruct("IfPresent", { arg: Schema.String, present: nested, absent: nested }),
  Schema.TaggedStruct("IfTrue", { arg: Schema.String, whenTrue: nested, whenFalse: nested }),
  Schema.TaggedStruct("Object", { fields: Schema.Array(TemplateFieldSchema) }),
  Schema.TaggedStruct("Array", { items: Schema.Array(nested) }),
  Schema.TaggedStruct("Concat", { parts: Schema.Array(nested) }),
  Schema.TaggedStruct("Map", { arg: Schema.String, body: nested }),
  Schema.TaggedStruct("Item", {}),
]);

/** One argument of a registered builder call: its name, the literal kind it accepts, and its default. */
export const ArgSpec = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["string", "strings", "boolean"]),
  required: Schema.Boolean,
  default: Schema.optionalKey(Schema.Json),
});

export type ArgSpec = typeof ArgSpec.Type;

/** A builder takes one object literal (`{ capability, decisionTime }`) or positional literal arguments. */
export const ArgPattern = Schema.TaggedUnion({
  Object: { fields: Schema.Array(ArgSpec) },
  Positional: { params: Schema.Array(ArgSpec) },
});

export type ArgPattern = typeof ArgPattern.Type;

/**
 * What an access builder stands for: every `Http.Access` field except the annotator, which the rule names,
 * and the resolver, which `resolver` evaluates to an id that `LiftInput.names` maps to a real export.
 */
export const AccessEmit = Schema.Struct({
  exposure: TemplateExpr,
  acceptedCredentials: TemplateExpr,
  principalKinds: TemplateExpr,
  capabilities: TemplateExpr,
  requirements: TemplateExpr,
  concealment: TemplateExpr,
  decisionTime: TemplateExpr,
});

export type AccessEmit = typeof AccessEmit.Type;

/**
 * The lift rules. Schema-valued slots are `SchemaRef`s and function-valued slots `SymbolRef`s, exactly the
 * references the IR records, so a rule can never name a symbol the IR cannot hold.
 *
 * - `SuccessWrapper`: `callee(S)` stands for success `S` plus the response headers, status and conditional
 *   flag of the helper. With `schema` set the helper takes no schema argument and stands for that schema
 *   (spec 0019 §0.5: the body-less `HttpApiSchema.NoContent` family).
 * - `ProblemRegistry`: `response(union)` where `union` is `union(identifier, [codes])` stands for
 *   `Http.Problems { registry, codes, identifier }`. The generated spelling `registry(identifier, [codes])`
 *   is recognized through the same rule.
 * - `Metadata`: `callee(summary, description)` and the generated `annotator({ … })` stand for the endpoint
 *   metadata with that annotator.
 * - `Access`: `apply(endpoint, callee(args))` (or `callee(args)` alone when `apply` is absent) stands for
 *   `Http.Access`; the generated `annotator({ … })` spelling is recognized through the same rule.
 */
export const LiftRule = Schema.TaggedUnion({
  SuccessWrapper: {
    callee: SymbolRef,
    schema: Schema.optionalKey(SchemaRef),
    responseHeaders: Schema.optionalKey(SchemaRef),
    conditional: Schema.optionalKey(Schema.Literal(true)),
    status: Schema.optionalKey(Schema.Int),
  },
  ProblemRegistry: { response: SymbolRef, union: SymbolRef, registry: SymbolRef },
  Metadata: {
    callee: SymbolRef,
    annotator: SymbolRef,
    positional: Schema.Array(Schema.Literals(["summary", "description"])),
  },
  Access: {
    callee: SymbolRef,
    apply: Schema.optionalKey(SymbolRef),
    annotator: SymbolRef,
    arguments: ArgPattern,
    resolver: TemplateExpr,
    emit: AccessEmit,
  },
});

export type LiftRule = typeof LiftRule.Type;

/**
 * Everything the pure core needs besides the model. `names` pins the real exports that enter the IR hash:
 * a resolver id (the value an access builder passes as its resolver) maps to the exported resolver symbol,
 * and a planned-export key `<group>.<endpointKey>#<role>` maps to the symbol the human lift chose. A name
 * that is not pinned is derived deterministically; one that cannot be resolved is a diagnostic, never a
 * placeholder.
 */
export const LiftInput = Schema.Struct({
  group: Schema.String,
  rules: Schema.Array(LiftRule),
  names: Schema.Record(Schema.String, SymbolRef),
  emptyInput: Schema.optionalKey(SchemaRef),
  output: Schema.Struct({ module: Schema.String }),
  project: Schema.optionalKey(ProjectResolution),
});

export type LiftInput = typeof LiftInput.Type;
