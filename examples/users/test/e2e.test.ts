import { copyUsersExample } from "../../../tools/testing/projects.ts";
import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { Client, UserChangeEmail, UserGet } from "../.effx/generated/client.ts";
import { OperationsClient } from "../.effx/generated/rpc.ts";
import { Email, UserId } from "../src/schemas.ts";
import { AppRoutes } from "../src/server.ts";
import { Users } from "../src/services.ts";

// The generated route layer, clients, and Bun test server share one Users store.
const TestServer = Layer.mergeAll(AppRoutes, Client.layer, OperationsClient.layerTest).pipe(
  Layer.provideMerge(BunHttpServer.layerTest),
  Layer.provideMerge(Users.layer),
);

it.live("builds and serves both generated projections on one Bun server", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const fs = yield* FileSystem.FileSystem;
    const originalProjectDir = yield* path.fromFileUrl(new URL("..", import.meta.url));
    const projectDir = yield* copyUsersExample();
    const main = new URL("../../../scripts/effx.ts", import.meta.url).pathname;

    const build = Bun.spawnSync(
      ["bun", main, "build", "--project", path.join(projectDir, "tsconfig.json")],
      {
        cwd: projectDir,
        stdout: "pipe",
        stderr: "pipe",
      },
    );

    const buildOutput =
      new TextDecoder().decode(build.stdout) + new TextDecoder().decode(build.stderr);

    assert.strictEqual(build.exitCode, 0, buildOutput);
    assert.isTrue(yield* fs.exists(path.join(projectDir, ".effx/generated/client.ts")));

    for (const file of ["client.ts", "http.ts", "rpc.ts", "cli.ts"]) {
      assert.strictEqual(
        yield* fs.readFileString(path.join(projectDir, ".effx", "generated", file)),
        yield* fs.readFileString(path.join(originalProjectDir, ".effx", "generated", file)),
        file + ": the freshly generated projection must match the module exercised below",
      );
    }

    yield* Effect.gen(function* () {
      const aliceId = UserId.make("1");
      const bobId = UserId.make("2");
      const newEmail = Email.make("alice+new@example.com");
      const alice = { id: aliceId, displayName: "Alice" };

      // GET must project the public view rather than leak the email field.
      assert.deepStrictEqual(yield* UserGet({ id: aliceId }), alice);
      assert.deepStrictEqual(yield* UserGet({ id: bobId }), { id: bobId, displayName: "Bob" });
      assert.deepStrictEqual(yield* UserChangeEmail({ id: aliceId, email: newEmail }), {
        ...alice,
        email: newEmail,
      });
      assert.deepStrictEqual(yield* UserGet({ id: aliceId }), alice);
      const users = yield* Users;
      assert.strictEqual((yield* users.find(aliceId)).email, newEmail);
      assert.deepStrictEqual(yield* UserChangeEmail({ id: aliceId, email: newEmail }), {
        ...alice,
        email: newEmail,
      });

      const rpc = yield* OperationsClient.make;
      assert.deepStrictEqual(yield* rpc["User.Get"]({ id: aliceId }), alice);

      const failure = yield* Effect.flip(
        rpc["User.ChangeEmail"]({ id: aliceId, email: Email.make("bob@example.com") }),
      );

      if (failure._tag !== "EmailTaken")
        return assert.fail(`expected EmailTaken, got ${failure._tag}`);
      assert.strictEqual(failure.email, "bob@example.com");
      assert.strictEqual((yield* users.find(aliceId)).email, newEmail);
    }).pipe(Effect.provide(TestServer));
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
);
