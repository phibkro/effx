import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { LiftDiagnostics, unsupportedSite, type Cause } from "@effx/compiler";
import { range } from "./lift-support.ts";

/*
 * Unsupported source retains every applicable cause (spec 0019 §0.6): causes order by source file, source
 * offset, then diagnostic code; the first is the primary diagnostic and the rest are related diagnostics.
 */

const subject = "profile.updateOwnProfile";

const closure = (start: number, end: number, file?: string): Cause => ({
  at: range(start, end, file),
  diagnostic: LiftDiagnostics.EFFX3005.emit({ subject, form: "closure" }),
});

const spread = (start: number, end: number, file?: string): Cause => ({
  at: range(start, end, file),
  diagnostic: LiftDiagnostics.EFFX3001.emit({ _tag: "Spread", subject, construct: "options" }),
});

const unknownHelper = (start: number, end: number, file?: string): Cause => ({
  at: range(start, end, file),
  diagnostic: LiftDiagnostics.EFFX3006.emit({
    subject,
    position: "success",
    callee: "customResponse",
  }),
});

const permutations = <A>(items: ReadonlyArray<A>): ReadonlyArray<ReadonlyArray<A>> =>
  items.length <= 1
    ? [items]
    : items.flatMap((item, index) =>
        permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
          item,
          ...rest,
        ]),
      );

const site = (causes: ReadonlyArray<Cause>) =>
  Option.getOrThrow(unsupportedSite(subject, range(0, 1), causes));

describe("unsupportedSite", () => {
  it.effect("orders by file, then offset, then code, and splits primary from related", () =>
    Effect.sync(() => {
      const result = site([
        closure(500, 520, "src/z.ts"),
        unknownHelper(40, 60),
        spread(40, 50),
        closure(40, 55),
        spread(10, 20, "src/a.ts"),
      ]);

      // src/a.ts sorts before src/profile.ts; at offset 40 the code breaks the tie (3001 < 3005 < 3006).
      assert.deepStrictEqual(
        [result.primary, ...(result.primary.related ?? [])].map((diagnostic) => [
          diagnostic.code,
          diagnostic.location?.file,
        ]),
        [
          ["EFFX3001", "src/a.ts"],
          ["EFFX3001", "src/profile.ts"],
          ["EFFX3005", "src/profile.ts"],
          ["EFFX3006", "src/profile.ts"],
          ["EFFX3005", "src/z.ts"],
        ],
      );
      assert.strictEqual(result.primary.related?.length, 4);
    }),
  );

  it.effect("orders offsets numerically, never as text or by line", () =>
    Effect.sync(() => {
      const result = site([closure(100, 101), closure(9, 10), closure(10, 11)]);

      assert.deepStrictEqual(
        [result.primary, ...(result.primary.related ?? [])].map(
          (diagnostic) => diagnostic.location?.col,
        ),
        [10, 11, 1],
      );
    }),
  );

  it.effect("is identical for every permutation of the same causes", () =>
    Effect.sync(() => {
      const causes = [
        closure(80, 90),
        spread(10, 20),
        unknownHelper(10, 20),
        closure(10, 30),
        spread(300, 310, "src/b.ts"),
      ];

      const expected = site(causes);

      for (const permutation of permutations(causes))
        assert.deepStrictEqual(site(permutation), expected);
    }),
  );

  it.effect("collapses identical causes and keeps distinct ranges apart", () =>
    Effect.sync(() => {
      const result = site([spread(10, 20), spread(10, 20), spread(10, 21)]);

      assert.strictEqual(result.primary.related?.length, 1);
    }),
  );

  it.effect("carries every cause with its own location and no nested relations", () =>
    Effect.sync(() => {
      const result = site([spread(10, 20), closure(300, 310)]);
      const related = result.primary.related ?? [];

      assert.deepStrictEqual(result.primary.location, { file: "src/profile.ts", line: 1, col: 11 });
      assert.deepStrictEqual(related[0]?.location, { file: "src/profile.ts", line: 4, col: 1 });
      assert.isUndefined(related[0]?.related);
    }),
  );

  it.effect("is absent for a declaration with no causes", () =>
    Effect.sync(() => assert.isTrue(Option.isNone(unsupportedSite(subject, range(0, 1), [])))),
  );
});

describe("lift diagnostics name what they report", () => {
  it.effect("EFFX3001 names the construct and the declaration", () =>
    Effect.sync(() => {
      const unknownStep = LiftDiagnostics.EFFX3001.emit({
        _tag: "UnknownStep",
        subject,
        step: "setHeaders",
      });

      assert.strictEqual(unknownStep.severity, "error");
      assert.include(unknownStep.message, "setHeaders");
      assert.include(unknownStep.message, subject);
    }),
  );

  it.effect("keeps a decision a warning and a passed check an info, never an error", () =>
    Effect.sync(() => {
      assert.strictEqual(
        LiftDiagnostics.EFFX3010.emit({ subject, decision: "kind", value: "Command" }).severity,
        "warning",
      );
      assert.strictEqual(
        LiftDiagnostics.EFFX3102.emit({ group: "profile", applied: ["ref-suffix"] }).severity,
        "info",
      );
    }),
  );

  it.effect("EFFX3201 states exactly which keys are missing and extra", () =>
    Effect.sync(() => {
      const message = LiftDiagnostics.EFFX3201.emit({
        group: "profile",
        missing: ["updateOwnProfile"],
        extra: [],
      }).message;

      assert.include(message, "missing: updateOwnProfile");
      assert.include(message, "extra: none");
    }),
  );
});
