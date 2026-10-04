import { Schema } from "effect";

export const Lookup = Schema.Struct({ id: Schema.String });

export const Found = Schema.Struct({ id: Schema.String });
