import { assert, describe, it } from "@effect/vitest";
import { CompilerFault } from "@effx/compiler";
import { Cause, Effect, Exit, Layer, Path } from "effect";
import { expectTypeOf } from "vitest";
import { executableInventoryLayer } from "../../../scripts/executable-cache.ts";
import { ExecutableInventory, loadedExecutableFiles } from "../src/config-runtime.ts";

const inventoryLayer = (keys: Effect.Effect<ReadonlyArray<string>, CompilerFault>) =>
  Layer.succeed(ExecutableInventory, ExecutableInventory.of({ keys }));

const selected = (keys: ReadonlyArray<string>) =>
  Layer.mergeAll(Path.layer, inventoryLayer(Effect.succeed(keys)));

const native = Layer.mergeAll(Path.layer, executableInventoryLayer);

describe("evaluated executable physical inventory", () => {
  it("keeps the inventory and Path requirements and CompilerFault channel explicit", () => {
    expectTypeOf(loadedExecutableFiles()).toEqualTypeOf<
      Effect.Effect<Array<string>, CompilerFault, Path.Path | ExecutableInventory>
    >();
    expectTypeOf(executableInventoryLayer).toEqualTypeOf<
      Layer.Layer<ExecutableInventory, CompilerFault>
    >();
    expectTypeOf(loadedExecutableFiles().pipe(Effect.provide(native))).toEqualTypeOf<
      Effect.Effect<Array<string>, CompilerFault>
    >();
    expectTypeOf(loadedExecutableFiles()).not.toEqualTypeOf<
      Effect.Effect<Array<string>, CompilerFault, Path.Path>
    >();
  });

  it.effect("normalizes selected physical keys without realpath collapsing logical aliases", () =>
    Effect.gen(function* () {
      const files = yield* loadedExecutableFiles().pipe(
        Effect.provide(
          selected([
            "/project/helper.ts",
            "/project/sub/../helper.ts",
            "file:///project/helper.ts?epoch=1#loaded",
            "file:///project/space%20helper.ts",
            "/project/logical-alias/helper.ts",
            "relative/helper.ts",
            "node:module",
            "https://example.invalid/helper.ts",
          ]),
        ),
      );

      assert.deepStrictEqual(files, [
        "/project/helper.ts",
        "/project/space helper.ts",
        "/project/logical-alias/helper.ts",
      ]);
    }),
  );

  it.effect("observes selected keys lazily and freshly without ambient inventory", () =>
    Effect.gen(function* () {
      let observations = 0;
      const keys = Effect.sync(() => [`/project/helper-${++observations}.ts`]);
      const layer = Layer.mergeAll(Path.layer, inventoryLayer(keys));
      const discarded = loadedExecutableFiles();
      void discarded;
      assert.strictEqual(observations, 0);
      yield* Effect.gen(function* () {
        assert.deepStrictEqual(yield* loadedExecutableFiles(), ["/project/helper-1.ts"]);
        assert.deepStrictEqual(yield* loadedExecutableFiles(), ["/project/helper-2.ts"]);
      }).pipe(Effect.provide(layer));
      assert.strictEqual(observations, 2);
    }),
  );

  it.effect(
    "preserves inventory CompilerFault identity instead of fabricating an empty result",
    () =>
      Effect.gen(function* () {
        const fault = new CompilerFault({
          stage: "collect",
          message: "Cannot observe evaluated executable files",
        });

        const observed = yield* loadedExecutableFiles().pipe(
          Effect.flip,
          Effect.provide(Layer.mergeAll(Path.layer, inventoryLayer(Effect.fail(fault)))),
        );

        assert.strictEqual(observed, fault);
      }),
  );

  it.effect.each([
    { key: "file://[", message: "Invalid evaluated executable file URL" },
    {
      key: "file://remote/project/helper.ts",
      message: "Cannot resolve evaluated executable file URL",
    },
    {
      key: "file:///project/encoded%2Fhelper.ts",
      message: "Cannot resolve evaluated executable file URL",
    },
  ])("keeps malformed or unresolvable file keys as collect faults %#", ({ key, message }) =>
    Effect.gen(function* () {
      const fault = yield* loadedExecutableFiles().pipe(
        Effect.flip,
        Effect.provide(selected([key])),
      );

      assert.strictEqual(fault._tag, "CompilerFault");
      assert.strictEqual(fault.stage, "collect");
      assert.strictEqual(fault.message, message);
    }),
  );

  it.effect("does not recover inventory interruption into successful empty coverage", () =>
    Effect.gen(function* () {
      const exit = yield* loadedExecutableFiles().pipe(
        Effect.exit,
        Effect.provide(Layer.mergeAll(Path.layer, inventoryLayer(Effect.interrupt))),
      );

      assert.isTrue(Exit.isFailure(exit));

      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterrupts(exit.cause));
    }),
  );

  it.effect("keeps an inventory defect distinct from CompilerFault or empty success", () =>
    Effect.gen(function* () {
      const exit = yield* loadedExecutableFiles().pipe(
        Effect.exit,
        Effect.provide(Layer.mergeAll(Path.layer, inventoryLayer(Effect.die("inventory defect")))),
      );

      assert.isTrue(Exit.isFailure(exit));

      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasDies(exit.cause));
    }),
  );

  it.effect("the real root adapter exposes only detached string-key snapshots", () =>
    Effect.gen(function* () {
      const inventory = yield* ExecutableInventory;
      const first = yield* inventory.keys;
      const second = yield* inventory.keys;
      assert.notStrictEqual(first, second);
      assert.deepStrictEqual(first, second);
    }).pipe(Effect.provide(executableInventoryLayer)),
  );
});
