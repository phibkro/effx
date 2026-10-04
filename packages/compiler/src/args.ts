import { Result, Schema } from "effect";
import { SchemaRef, SymbolRef } from "@effx/ir";
import type { Annotation, Declaration } from "./Collected.ts";
import { type Diagnostic, error } from "./Diagnostic.ts";

/** @internal */
export const SchemaArg = Schema.TaggedStruct("Schema", {
  ref: SchemaRef,
  fields: Schema.optionalKey(Schema.Array(Schema.String)),
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
