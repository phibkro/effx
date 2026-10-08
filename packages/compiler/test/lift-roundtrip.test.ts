import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { IRArbitrary, canonical } from "@effx/ir";
import { hasErrors } from "@effx/compiler";
import { compiled, roundtrip } from "./lift-pipeline.ts";
import { GroupSpec } from "./lift-universe.ts";

/*
 * Spec 0019 §2.5 over REAL generator output: for every group of the universe, generate its contract source
 * with the one HTTP generator, lower the printed source with the test frontend, lift it, and compile the
 * suggestion again. L2: the canonical IR of the suggestion equals the IR the group started from. L3: lifting
 * what was lifted changes nothing, so a suggestion is a fixed point of lift after lowering.
 */

describe("lift recovers what the generator wrote (L2)", () => {
  it.effect("every generated group lifts back to the IR it started from", () =>
    Effect.gen(function* () {
      const failure = yield* IRArbitrary.falsification(
        IRArbitrary.arbitraryOf(GroupSpec),
        (spec) =>
          Effect.gen(function* () {
            const { original, lifted } = yield* roundtrip(spec);
            const again = yield* compiled(lifted.collected);
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

  it.effect("lowering the suggestion regenerates the original bytes (L3)", () =>
    Effect.gen(function* () {
      const failure = yield* IRArbitrary.falsification(
        IRArbitrary.arbitraryOf(GroupSpec),
        (spec) =>
          Effect.gen(function* () {
            const { original, lifted } = yield* roundtrip(spec);
            const again = yield* compiled(lifted.collected);

            const bytes = (files: typeof original.files.value) =>
              Option.getOrElse(
                Option.map(files, (generated) =>
                  generated.map((file) => [file.path, file.contents]),
                ),
                () => [],
              );

            return (
              bytes(original.files.value).length > 0 &&
              bytes(original.files.value).every(
                ([path, contents], index) =>
                  bytes(again.files.value)[index]?.[0] === path &&
                  bytes(again.files.value)[index]?.[1] === contents,
              ) &&
              bytes(original.files.value).length === bytes(again.files.value).length
            );
          }),
        { runs: 40, seed: 3 },
      );

      assert.isUndefined(failure, failure);
    }),
  );
});
