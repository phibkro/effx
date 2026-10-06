import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Schema } from "effect";
import { Binding, Builtins, Reflect } from "@effx/runtime";

class Backend extends Context.Service<Backend, { readonly value: string }>()(
  "binding-test/Backend",
) {}

class Denied extends Schema.TaggedError<Denied>()("Denied", {}) {}

const work: Effect.Effect<string, Denied, Backend> = Effect.gen(function* () {
  const backend = yield* Backend;

  return backend.value;
});

describe("Binding.group identity laws", () => {
  it("constructs and discards without invoking throwing setup or recording annotations", () => {
    let calls = 0;

    const setup = () => {
      calls++;
      throw new Error("must not execute while collecting source syntax");
    };

    const options = { handlers: setup, guards: setup };
    const binding = Binding.group({}, options);
    assert.strictEqual(binding, options);
    assert.strictEqual(calls, 0);
    assert.deepStrictEqual(Reflect.annotationsOf(binding), []);
    assert.isFalse(Builtins.all.some((definition) => definition.name.startsWith("Binding.")));
    assert.deepStrictEqual(Object.keys(Binding), ["group"]);
  });

  it.effect("preserves the operation channels and allows capability substitution", () =>
    Effect.gen(function* () {
      const binding = Binding.group({}, { handlers: () => work, guards: () => ({}) });
      expectTypeOf(binding.handlers()).toEqualTypeOf<Effect.Effect<string, Denied, Backend>>();
      assert.strictEqual(binding.handlers(), work);
      assert.strictEqual(
        yield* binding.handlers().pipe(Effect.provideService(Backend, { value: "substitute" })),
        "substitute",
      );
    }),
  );
});
