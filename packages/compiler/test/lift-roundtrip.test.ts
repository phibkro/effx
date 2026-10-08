import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { IRArbitrary, canonical } from "@effx/ir";
import { Extensions, compileCollected, hasErrors, lift, type Collected } from "@effx/compiler";
import { modelOf } from "./lift-source.ts";
import { GroupSpec, collectedOf, liftInput, universe } from "./lift-universe.ts";

/*
 * Spec 0019 §2.5 L2 over REAL generator output: for every group of the universe, generate its contract source
 * with the one HTTP generator, lower the printed source with the test frontend, lift it, and compile the
 * suggestion again. The canonical IR of the suggestion must equal the IR the group started from.
 */

const compiled = (collected: Collected) => compileCollected(collected, Extensions.builtin);

const outcome = Effect.fnUntraced(function* (spec: GroupSpec) {
  const original = yield* compiled(collectedOf(spec));

  if (hasErrors(original.diagnostics))
    return yield* Effect.die(
      new Error(
        `the universe produced errors: ${original.diagnostics.map((entry) => entry.message).join("; ")}`,
      ),
    );

  const files = Option.getOrThrow(original.files.value);
  const lifted = lift(modelOf(files, universe), liftInput);
  const again = yield* compiled(lifted.collected);

  return { original, lifted, again, files };
});

describe("lift recovers what the generator wrote (L2)", () => {
  it.effect("every generated group lifts back to the IR it started from", () =>
    Effect.gen(function* () {
      const failure = yield* IRArbitrary.falsification(
        IRArbitrary.arbitraryOf(GroupSpec),
        (spec) =>
          Effect.map(outcome(spec), ({ original, lifted, again }) => {
            const before = original.ir.value;
            const after = again.ir.value;

            return (
              lifted.unsupported.length === 0 &&
              lifted.refactors.length === 0 &&
              !hasErrors(again.diagnostics) &&
              Option.isSome(before) &&
              Option.isSome(after) &&
              canonical(before.value) === canonical(after.value)
            );
          }),
        { runs: 60, seed: 19 },
      );

      assert.isUndefined(failure, failure);
    }),
  );
});
