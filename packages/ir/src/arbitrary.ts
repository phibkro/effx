/** @effect-diagnostics unstableApiUsage:off */
import { Arbitrary, type Effect } from "effect";
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
