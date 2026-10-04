import { Schema } from "effect";
import { StableId } from "./StableId.ts";

/** A runtime Effect Schema value, preserved by reference (ADR 0004). */
export const SchemaRef = Schema.Struct({
  module: Schema.String,
  export: Schema.String,
  symbolId: StableId,
});

export type SchemaRef = typeof SchemaRef.Type;

/** A value symbol (handler method, service class). */
export const SymbolRef = Schema.Struct({
  module: Schema.String,
  export: Schema.String,
  member: Schema.optionalKey(Schema.String),
});

export type SymbolRef = typeof SymbolRef.Type;
