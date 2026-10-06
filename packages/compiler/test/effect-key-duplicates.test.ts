import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Option } from "effect";
import { A, Annotation } from "@effx/runtime";
import {
  type CompileResult,
  Extensions,
  compileCollected,
  extension,
  implement,
} from "@effx/compiler";
import { decoratorStyle } from "./fixtures/users.ts";

class RateLimitPolicy extends Context.Service<RateLimitPolicy, { readonly perMinute: number }>()(
  "app/RateLimit",
) {}

class QuotaPolicy extends Context.Service<QuotaPolicy, { readonly perMinute: number }>()(
  "app/Quota",
) {}

const RateLimit = Annotation.define({
  name: "app.RateLimit",
  target: "operation",
  args: { perMinute: A.int },
  effect: { target: "endpoint", key: RateLimitPolicy },
});

const Quota = Annotation.define({
  name: "app.Quota",
  target: "operation",
  args: { perMinute: A.int },
  effect: { target: "endpoint", key: QuotaPolicy },
});

// Another name, the RateLimit key id: the second annotation would overwrite the first on one endpoint.
const Twin = Annotation.define({
  name: "app.Twin",
  target: "operation",
  args: { perMinute: A.int },
  effect: { target: "endpoint", key: RateLimitPolicy },
});

const Plain = Annotation.define({
  name: "app.Plain",
  target: "operation",
  args: { perMinute: A.int },
});

const compileWith = (...definitions: ReadonlyArray<Parameters<typeof implement>[0]>) =>
  compileCollected(decoratorStyle, [
    ...Extensions.builtin,
    extension(
      "app",
      definitions.map((definition) => implement(definition)),
    ),
  ]);

const duplicates = (result: CompileResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX1304");

describe("EFFX1304 (duplicate effect key id)", () => {
  it.effect("two definitions with the same effect key id are rejected", () =>
    Effect.gen(function* () {
      const result = yield* compileWith(RateLimit, Twin);
      const [duplicate] = duplicates(result);

      assert.strictEqual(duplicates(result).length, 1);
      assert.strictEqual(duplicate?.severity, "error");
      assert.isTrue(Option.isNone(result.files.value));
    }),
  );

  it.effect("distinct key ids, and definitions without an effect clause, are fine", () =>
    Effect.gen(function* () {
      const result = yield* compileWith(RateLimit, Quota, Plain);

      assert.deepStrictEqual(duplicates(result), []);
    }),
  );

  it.effect("two definitions without an effect clause never collide on a key", () =>
    Effect.gen(function* () {
      const other = Annotation.define({
        name: "app.Other",
        target: "operation",
        args: { perMinute: A.int },
      });

      assert.deepStrictEqual(duplicates(yield* compileWith(Plain, other)), []);
    }),
  );
});
