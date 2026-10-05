import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import { applyChanges, makeDocuments, offsetAt } from "../src/documents.ts";

const input = {
  uri: "file:///project/a.ts",
  file: "/project/a.ts",
  identity: "/physical/a.ts",
  version: 1,
  text: "original",
};

describe("owned editor document text", () => {
  it("applies sequential UTF-16 edits across CRLF without saving", () => {
    const result = applyChanges(
      "😀x\r\nabc",
      [
        { range: { start: { line: 0, character: 2 }, end: { line: 0, character: 3 } }, text: "A" },
        { range: { start: { line: 1, character: 1 }, end: { line: 1, character: 2 } }, text: "Z" },
      ],
      input.uri,
    );

    assert.isTrue(Result.isSuccess(result));

    if (Result.isSuccess(result)) assert.strictEqual(result.success, "😀A\r\naZc");

    const replacement = applyChanges(
      "ignored",
      [
        { text: "ab" },
        { range: { start: { line: 0, character: 1 }, end: { line: 0, character: 2 } }, text: "z" },
      ],
      input.uri,
    );

    assert.isTrue(Result.isSuccess(replacement));

    if (Result.isSuccess(replacement)) assert.strictEqual(replacement.success, "az");
  });

  it("rejects invalid lines, columns, reversed ranges and split surrogate pairs", () => {
    for (const position of [
      { line: 0, character: 1 },
      { line: 0, character: 5 },
      { line: 2, character: 0 },
      { line: -1, character: 0 },
    ]) {
      assert.isTrue(Result.isFailure(offsetAt("😀x\r\nabc", position, input.uri)));
    }

    assert.isTrue(
      Result.isFailure(
        applyChanges(
          "abc",
          [
            {
              range: { start: { line: 0, character: 2 }, end: { line: 0, character: 1 } },
              text: "x",
            },
          ],
          input.uri,
        ),
      ),
    );
    const eof = offsetAt("a\r\n", { line: 1, character: 0 }, input.uri);
    assert.isTrue(Result.isSuccess(eof));

    if (Result.isSuccess(eof)) assert.strictEqual(eof.success, 3);
  });

  it.effect("accepts version gaps and rejects stale changes without state mutation", () =>
    Effect.gen(function* () {
      const documents = yield* makeDocuments();
      const first = yield* documents.open(input);
      const captured = yield* documents.snapshot;
      const changed = yield* documents.change(input.uri, 9, [{ text: "latest" }]);
      assert.strictEqual(changed.version, 9);
      assert.strictEqual(changed.instance, first.instance);
      assert.strictEqual(captured.get(input.uri)?.text, "original");

      for (const version of [9, 2]) {
        const error = yield* Effect.flip(documents.change(input.uri, version, [{ text: "stale" }]));
        assert.strictEqual(error.reason, "Version");
      }

      assert.strictEqual(Option.getOrThrow(yield* documents.get(input.uri)).text, "latest");

      const invalid = yield* Effect.flip(
        documents.change(input.uri, 10, [
          {
            range: { start: { line: 99, character: 0 }, end: { line: 99, character: 0 } },
            text: "bad",
          },
        ]),
      );

      assert.strictEqual(invalid.reason, "Range");
      assert.strictEqual(Option.getOrThrow(yield* documents.get(input.uri)).version, 9);
    }),
  );

  it.effect("rejects duplicate physical aliases and gives reopened documents a new instance", () =>
    Effect.gen(function* () {
      const documents = yield* makeDocuments();
      const first = yield* documents.open(input);
      const duplicate = yield* Effect.flip(documents.open(input));
      assert.strictEqual(duplicate.reason, "AlreadyOpen");

      const alias = yield* Effect.flip(
        documents.open({ ...input, uri: "file:///alias/a.ts", file: "/alias/a.ts" }),
      );

      assert.strictEqual(alias.reason, "Alias");
      assert.isTrue(Option.isSome(yield* documents.close(input.uri)));
      assert.isTrue(Option.isNone(yield* documents.get(input.uri)));
      const reopened = yield* documents.open({ ...input, version: -3 });
      assert.notStrictEqual(reopened.instance, first.instance);
      assert.strictEqual(reopened.version, -3);

      const unopened = yield* Effect.flip(
        documents.change("file:///missing.ts", 1, [{ text: "x" }]),
      );

      assert.strictEqual(unopened.reason, "NotOpen");
    }),
  );

  it.effect("bounds current text and releases admission after close", () =>
    Effect.gen(function* () {
      const documents = yield* makeDocuments({ count: 1, textUnits: 4 });
      yield* documents.open({ ...input, text: "abcd" });
      const tooLarge = yield* Effect.flip(documents.change(input.uri, 2, [{ text: "abcde" }]));
      assert.strictEqual(tooLarge.reason, "Limit");
      assert.strictEqual(Option.getOrThrow(yield* documents.get(input.uri)).version, 1);

      const tooMany = yield* Effect.flip(
        documents.open({ ...input, uri: "file:///b.ts", identity: "/physical/b.ts", text: "b" }),
      );

      assert.strictEqual(tooMany.reason, "Limit");
      yield* documents.close(input.uri);
      yield* documents.open({
        ...input,
        uri: "file:///b.ts",
        identity: "/physical/b.ts",
        text: "b",
      });
      assert.strictEqual((yield* documents.snapshot).size, 1);
    }),
  );

  it.effect("clears text when its scope closes and refuses later mutation", () =>
    Effect.gen(function* () {
      const documents = yield* Effect.scoped(
        Effect.gen(function* () {
          const owned = yield* makeDocuments();
          yield* owned.open(input);

          return owned;
        }),
      );

      assert.strictEqual((yield* documents.snapshot).size, 0);
      const failure = yield* Effect.flip(documents.open(input));
      assert.strictEqual(failure.reason, "Closed");
    }),
  );
});
