import { Result, Schema } from "effect";
import { SchemaRef, SymbolRef } from "@effx/ir";
import type { Annotation, Declaration } from "./Collected.ts";
import { type Diagnostic, error } from "./Diagnostic.ts";

/**
 * A lowered Schema reference. `fields` are its static field keys where the position records them;
 * `marker: "headers"` says its static type was wrapped by `Http.headers` (spec 0024 §2.2). Neither enters
 * the IR's `SchemaRef`.
 *
 * @internal
 */
export const SchemaArg = Schema.TaggedStruct("Schema", {
  ref: SchemaRef,
  fields: Schema.optionalKey(Schema.Array(Schema.String)),
  marker: Schema.optionalKey(Schema.Literal("headers")),
});

/** @internal */
export const SymbolArg = Schema.TaggedStruct("Symbol", {
  ref: SymbolRef,
  security: Schema.optionalKey(Schema.Boolean),
});

/** Decodes `annotation.args` against `schema`, or an `EFFX1102` diagnostic. */
export const decodeArgs = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  annotation: Annotation,
  declaration: Declaration,
): Result.Result<S["Type"], Diagnostic> =>
  Result.mapError(Schema.decodeResult(schema)(annotation.args), (schemaError) =>
    error(
      "EFFX1102",
      `@${annotation.name} on ${declaration.id}: malformed arguments — ${schemaError.message}`,
    ),
  );

/** @internal */
export const findAnnotation = (declaration: Declaration, name: string): Annotation | undefined =>
  declaration.annotations.find((annotation) => annotation.name === name);
