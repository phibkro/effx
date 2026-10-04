/** @effect-diagnostics unstableApiUsage:off */
import { Arbitrary, Effect, type Schema } from "effect";
import { ApplicationIR } from "./ApplicationIR.ts";
import { Edge } from "./Edge.ts";
import { Node } from "./Node.ts";

/**
 * Testing adapter around `effect/Arbitrary` (unstable). The only module that imports it.
 * Derivation is lazy because it can throw for schemas the unstable implementation
 * cannot compile; callers see that at the call site, not at import time.
 */
export const arbitraryIR = (): Arbitrary.Arbitrary<ApplicationIR> =>
  Arbitrary.schema(ApplicationIR);

export const arbitraryNode = (): Arbitrary.Arbitrary<Node> => Arbitrary.schema(Node);

export const arbitraryEdge = (): Arbitrary.Arbitrary<Edge> => Arbitrary.schema(Edge);

export const sampleIR = (
  count: number,
): Effect.Effect<ReadonlyArray<ApplicationIR>, Arbitrary.SampleError> =>
  Arbitrary.sampleEffect(arbitraryIR(), { count });

/**
 * An `Arbitrary` for the decoded `Type` of any Schema. Derivation is immediate and throws when the
 * unstable implementation cannot compile the schema; callers that must not throw wrap the call.
 */
export const arbitraryOf = <S extends Schema.Constraint>(
  schema: S,
): Arbitrary.Arbitrary<S["Type"]> => Arbitrary.schema(schema);

/** How many values a property check generates and, to replay a run, the seed it draws them from. */
export interface PropertyOptions {
  readonly runs?: number | undefined;
  readonly seed?: string | number | undefined;
}

/**
 * Checks `property` over values of `arbitrary`. Succeeds with `undefined` when it held for every generated
 * value, otherwise with the formatted falsification (shrunk input, failure, replay token). A defect or an
 * interruption in `property` is not a falsification and keeps propagating.
 */
export const falsification = <A, E = never, R = never>(
  arbitrary: Arbitrary.Arbitrary<A>,
  property: (value: A) => boolean | Effect.Effect<boolean, E, R>,
  options?: PropertyOptions,
): Effect.Effect<string | undefined, never, R> =>
  Arbitrary.checkEffect(arbitrary, property, options).pipe(
    Effect.map(Arbitrary.formatCheckFailure),
  );
