import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema } from "effect";
import { IRArbitrary } from "@effx/ir";
import { relativeModule, unifiedDiff } from "@effx/compiler";
import { applyHunks } from "./lift-apply.ts";

/*
 * The two pure helpers under the printer and the patch renderer. `relativeModule` must name the same file
 * the module key names; `unifiedDiff` must be exactly invertible: applying its hunks to the old text gives
 * the new text (the law `git apply` relies on), whatever the texts are.
 */

const specifier = (from: string, to: string): string =>
  Result.getOrElse(relativeModule(from, to), (message) => `ERROR ${message}`);

describe("relativeModule names the module the key names", () => {
  it.each([
    { name: "a sibling", from: "./src/profile.effx", to: "./src/common", expected: "./common" },
    {
      name: "a file in the same directory root",
      from: "./profile.effx",
      to: "./src/x",
      expected: "./src/x",
    },
    { name: "a parent's child", from: "./src/a/b.effx", to: "./src/c/d", expected: "../c/d" },
    { name: "an ancestor", from: "./src/a/b/c.effx", to: "./src/x", expected: "../../x" },
    {
      name: "keys above the base",
      from: "../../src/profile.effx",
      to: "../../src/profile-support",
      expected: "./profile-support",
    },
    {
      name: "a key above the importing file's base",
      from: "./src/p.effx",
      to: "../x",
      expected: "../../x",
    },
    { name: "a bare package", from: "./src/p.effx", to: "@app/support", expected: "@app/support" },
    {
      name: "an Effect module",
      from: "./src/p.effx",
      to: "effect/http-api",
      expected: "effect/http-api",
    },
  ])("resolves $name", ({ from, to, expected }) => {
    assert.strictEqual(specifier(from, to), expected);
  });

  it("refuses a path that would have to name a directory no key records", () => {
    const result = relativeModule("../../src/p.effx", "../x");

    assert.isTrue(Result.isFailure(result));
  });
});

const NAMES = ["a", "b", "c"] as const;

const Text = Schema.Struct({
  lines: Schema.Array(Schema.Literals(NAMES)).check(Schema.isMaxLength(14)),
  trailingNewline: Schema.Boolean,
});

const textOf = (text: typeof Text.Type): string =>
  text.lines.join("\n") + (text.lines.length > 0 && text.trailingNewline ? "\n" : "");

describe("unifiedDiff", () => {
  it("is empty for equal texts", () => {
    assert.strictEqual(unifiedDiff("f.ts", "a\nb\n", "a\nb\n"), "");
  });

  it("prints a git-readable header and one hunk with context", () => {
    const before = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].join("\n") + "\n";
    const after = ["1", "2", "3", "4", "five", "6", "7", "8", "9"].join("\n") + "\n";

    assert.strictEqual(
      unifiedDiff("src/f.ts", before, after),
      [
        "--- a/src/f.ts",
        "+++ b/src/f.ts",
        "@@ -2,7 +2,7 @@",
        " 2",
        " 3",
        " 4",
        "-5",
        "+five",
        " 6",
        " 7",
        " 8",
      ].join("\n"),
    );
  });

  it("splits distant changes into hunks and joins close ones", () => {
    const base = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);

    const edit = (indexes: ReadonlyArray<number>) =>
      base.map((line, index) => (indexes.includes(index) ? `${line}!` : line)).join("\n") + "\n";

    const hunkCount = (diff: string) =>
      diff.split("\n").filter((line) => line.startsWith("@@")).length;

    assert.strictEqual(hunkCount(unifiedDiff("f", base.join("\n") + "\n", edit([2, 25]))), 2);
    assert.strictEqual(hunkCount(unifiedDiff("f", base.join("\n") + "\n", edit([2, 8]))), 1);
  });

  it("marks a text without a final newline", () => {
    const diff = unifiedDiff("f", "a\nb", "a\nb\n");

    assert.include(diff, "\\ No newline at end of file");
    assert.strictEqual(applyHunks("a\nb", diff), "a\nb\n");
  });

  it.each([
    ["a\r\nb\r\n", "a\r\nc\r\n"],
    ["a\r\nb", "a\r\nb\r\n"],
    ["a\nb\n", "a\nb"],
    ["", "a"],
    ["a", ""],
  ])("preserves exact newline bytes for %#", (before, after) => {
    assert.strictEqual(applyHunks(before, unifiedDiff("f", before, after)), after);
  });

  it.effect("applying its hunks to the old text gives the new text, for any two texts", () =>
    Effect.gen(function* () {
      const failure = yield* IRArbitrary.falsification(
        IRArbitrary.arbitraryOf(Schema.Struct({ before: Text, after: Text })),
        ({ before, after }) => {
          const from = textOf(before);
          const to = textOf(after);
          const diff = unifiedDiff("f.ts", from, to);

          return applyHunks(from, diff) === to;
        },
        { runs: 250, seed: 19 },
      );

      assert.isUndefined(failure, failure);
    }),
  );
});
