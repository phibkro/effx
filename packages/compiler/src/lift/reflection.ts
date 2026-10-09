import { Schema } from "effect";

/*
 * The Reflection of one mounted group (spec 0019 §2.1) and the records the check child program emits
 * (§2.4 step 5). Defined as Schema so the CLI can decode the child document with the strict parse option
 * (`onExcessProperty: "error"` at decode time): an unexpected field is check inability (EFFX3103 data),
 * never silence.
 *
 * The comparison owns exactly one variant of delta evidence: a `Pass` carries the applied Δ classes and a
 * `Mismatch` carries the differences; the reflections themselves only carry the two sides
 * (`original`/`generated`). The optional `identifierAnnotation` witness exists solely to prove the Δ2
 * premise with actual merged Context values (dated clarification 2026-10-09); it is not a suggestion fact.
 */

/** The exact key of Effect's own OpenAPI identifier annotation. */
export const OPEN_API_IDENTIFIER_KEY = "effect/http-api/OpenApi/Identifier";

/** The Δ2 witness: the actual `Context` value behind one endpoint's `OpenApi/Identifier` key. */
export const IdentifierWitness = Schema.Struct({
  key: Schema.Literal(OPEN_API_IDENTIFIER_KEY),
  endpoint: Schema.String,
  value: Schema.String,
});

export type IdentifierWitness = typeof IdentifierWitness.Type;

/** The wire reflection of one endpoint of one group. All list fields are plain arrays: an empty group is valid and its emptiness is the actual evidence. */
export const EndpointReflection = Schema.Struct({
  group: Schema.String,
  identifier: Schema.String,
  method: Schema.String,
  path: Schema.String,
  middleware: Schema.Array(Schema.String),
  successStatuses: Schema.Array(Schema.Int),
  errorStatuses: Schema.Array(Schema.Int),
  annotationKeys: Schema.Array(Schema.String),
  identifierAnnotation: Schema.optionalKey(IdentifierWitness),
  /** Registered opaque projections (`ProjectConfig.lift` refs), keyed by their config key. */
  projections: Schema.Record(Schema.String, Schema.Json),
});

export type EndpointReflection = typeof EndpointReflection.Type;

/** One mounted group's complete wire reflection, recorded by the `--check` child program. */
export const Reflection = Schema.Struct({
  openapi: Schema.Json,
  endpoints: Schema.Array(EndpointReflection),
});

export type Reflection = typeof Reflection.Type;

/** Strict child-document decoder: excess keys are EFFX3103 data (spec 0019 §6). */
export const decodeReflection = Schema.decodeUnknownEffect(Reflection, {
  onExcessProperty: "error",
});

/** The two sides one comparison compares. Applied deltas never live here. */
export const ReflectionPair = Schema.Struct({ original: Reflection, generated: Reflection });

export type ReflectionPair = typeof ReflectionPair.Type;

/** The closed set of tolerated differences (spec 0019 §2.2). A new Δ is a spec edit, never a flag. */
export const Delta = Schema.Literals([
  "ref-suffix",
  "explicit-default-identifier",
  "endpoint-order",
]);

export type Delta = typeof Delta.Type;
