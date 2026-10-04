import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, FileSystem, Path } from "effect";
import { copyUsersFixture, testDirectory } from "../../testing/projects.ts";

const original = new URL(
  "../../../packages/frontend-ts/test/fixtures/users/src/schemas.ts",
  import.meta.url,
).pathname;

describe("test project ownership", () => {
  it.effect("uses fresh independent copies and leaves authored inputs unchanged", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const expected = yield* fs.readFileString(original);
      const first = yield* copyUsersFixture();
      const second = yield* copyUsersFixture();

      assert.notStrictEqual(first, second);
      yield* fs.writeFileString(
        path.join(first, "src", "schemas.ts"),
        "export const changed = true;\n",
      );
      assert.strictEqual(
        yield* fs.readFileString(path.join(second, "src", "schemas.ts")),
        expected,
      );
      assert.strictEqual(yield* fs.readFileString(original), expected);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("removes a successful invocation's copy when its scope closes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* copyUsersFixture().pipe(Effect.scoped);

      assert.isFalse(yield* fs.exists(directory));
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("removes a failed invocation's copy without hiding its failure", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const acquired = yield* Deferred.make<string>();

      const failure = yield* Effect.gen(function* () {
        const directory = yield* testDirectory("failed-test-");
        yield* Deferred.succeed(acquired, directory);

        return yield* Effect.fail("expected test failure");
      }).pipe(Effect.scoped, Effect.flip);

      const directory = yield* Deferred.await(acquired);

      assert.strictEqual(failure, "expected test failure");
      assert.isFalse(yield* fs.exists(directory));
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("removes an interrupted invocation's copy before interruption completes", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const acquired = yield* Deferred.make<string>();

      const fiber = yield* Effect.gen(function* () {
        const directory = yield* testDirectory("interrupted-test-");
        yield* Deferred.succeed(acquired, directory);

        return yield* Effect.never;
      }).pipe(Effect.scoped, Effect.forkChild);

      const directory = yield* Deferred.await(acquired);

      yield* Fiber.interrupt(fiber);
      assert.isFalse(yield* fs.exists(directory));
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
