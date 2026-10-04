import { encodeJsonString, testDirectory } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { vi } from "vitest";
import { SurfaceJson } from "@effx/compiler";
import { ManifestJson } from "../src/manifest.ts";

// Each case spawns the real CLI (about 2-3 s per compile); several cases spawn it more than once.
vi.setConfig({ testTimeout: 120_000 });

/*
 * Spec 0021 falsifiers 1-4 over the real examples/users project and parsed (never executed or
 * typechecked) Alchemy Worker fixtures; no deploy, no Cloudflare call, no network.
 */

const usersRoot = new URL("../../../examples/users/", import.meta.url).pathname;

const fixtures = new URL("./fixtures/surface/", import.meta.url).pathname;

const repoRoot = new URL("../../../", import.meta.url).pathname;

const main = new URL("../src/main.ts", import.meta.url).pathname;

const withProject = <A, E, R>(use: (project: string, dir: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const dir = yield* testDirectory("surface-test-", path.join(usersRoot, ".effx"));

    yield* fs.copy(path.join(usersRoot, "src"), path.join(dir, "src"));
    yield* fs.copy(fixtures, dir);
    yield* fs.writeFileString(
      path.join(dir, "package.json"),
      '{ "devDependencies": { "typescript": "6.0.2" } }\n',
    );
    const project = path.join(dir, "tsconfig.json");
    yield* fs.writeFileString(
      project,
      `{ "extends": ${yield* encodeJsonString(path.join(usersRoot, "tsconfig.json"))}, "include": ["src/operations.ts"] }\n`,
    );

    return yield* use(project, dir);
  }).pipe(Effect.scoped);

const runCli = (project: string, ...args: ReadonlyArray<string>) =>
  Effect.sync(() => {
    const result = Bun.spawnSync(["bun", main, ...args, "--project", project], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
      code: result.exitCode,
    };
  });

const surfaceCheck = (
  project: string,
  dir: string,
  entry: string,
  ...extra: ReadonlyArray<string>
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;

    return yield* runCli(project, "surface", "check", "--against", path.join(dir, entry), ...extra);
  });

describe("effx surface manifest and check (spec 0021)", () => {
  it.effect("build writes a deterministic, schema-valid surface independent of emit mode", () =>
    withProject((project, dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const surfacePath = path.join(dir, ".effx", "surface.json");

        const contract = yield* runCli(project, "build", "--emit=contract");
        assert.strictEqual(contract.code, 0, contract.stderr || contract.stdout);
        const contractText = yield* fs.readFileString(surfacePath);

        const all = yield* runCli(project, "build");
        assert.strictEqual(all.code, 0, all.stderr || all.stdout);
        assert.strictEqual(yield* fs.readFileString(surfacePath), contractText);

        assert.isTrue(contractText.endsWith("\n"));
        const surface = yield* Schema.decodeEffect(SurfaceJson)(contractText);

        const manifest = yield* Schema.decodeEffect(ManifestJson)(
          yield* fs.readFileString(path.join(dir, ".effx", "manifest.json")),
        );

        assert.strictEqual(surface.semanticHash, manifest.semanticHash);

        assert.deepStrictEqual(
          surface.http.flatMap((group) =>
            group.endpoints.map((endpoint) => [endpoint.method, endpoint.path, endpoint.operation]),
          ),
          [
            ["GET", "/users/:id", "User.Get"],
            ["PATCH", "/users/:id/email", "User.ChangeEmail"],
          ],
        );

        assert.deepStrictEqual(
          surface.http.map((group) => [group.root, group.group, group.binding, group.wiring]),
          [["effx", "operations", "local", "AppRoutes"]],
        );

        assert.deepStrictEqual(
          surface.rpc.map((rpc) => rpc.name),
          ["User.ChangeEmail", "User.Get"],
        );

        assert.deepStrictEqual(
          surface.cli.map((cli) => cli.command.join(" ")),
          ["users change-email", "users get"],
        );
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("passes for a Worker that mounts AppRoutes through a barrel", () =>
    withProject((project, dir) =>
      Effect.gen(function* () {
        const result = yield* surfaceCheck(project, dir, "worker.ts");
        assert.strictEqual(result.code, 0, result.stderr || result.stdout);
        assert.include(result.stdout, "surface check:");
        assert.notMatch(result.stdout, /EFFX28\d\d (error|warning)/);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("follows a literal main path of an async Worker and namespace member access", () =>
    withProject((project, dir) =>
      Effect.gen(function* () {
        const async = yield* surfaceCheck(project, dir, "worker-async.ts");
        assert.strictEqual(async.code, 0, async.stderr || async.stdout);

        const member = yield* surfaceCheck(project, dir, "worker-namespace-member.ts");
        assert.strictEqual(member.code, 0, member.stderr || member.stdout);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "reports missing wiring (EFFX2802) for a Worker without AppRoutes or with a type-only use",
    () =>
      withProject((project, dir) =>
        Effect.gen(function* () {
          for (const entry of ["worker-missing.ts", "worker-type-only.ts"]) {
            const result = yield* surfaceCheck(project, dir, entry);
            assert.strictEqual(result.code, 1, `${entry}: ${result.stderr || result.stdout}`);
            assert.match(result.stdout, /EFFX2802 error[^\n]*AppRoutes/);
          }
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "reports extra wiring (EFFX2803) for a reference to a generated module the build no longer produces",
    () =>
      withProject((project, dir) =>
        Effect.gen(function* () {
          const result = yield* surfaceCheck(project, dir, "worker-stale.ts");
          assert.strictEqual(result.code, 1, result.stderr || result.stdout);
          assert.match(
            result.stdout,
            /EFFX2803 error[^\n]*RemovedApiHandlers[^\n]*worker-stale\.ts:\d+:\d+/,
          );
          assert.notMatch(result.stdout, /EFFX2802/);
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("rejects an entry that is not a recognized Worker program (EFFX2801)", () =>
    withProject((project, dir) =>
      Effect.gen(function* () {
        const result = yield* surfaceCheck(project, dir, "not-a-worker.ts");
        assert.strictEqual(result.code, 1, result.stderr || result.stdout);
        assert.match(result.stdout, /EFFX2801 error/);
        assert.notMatch(result.stdout, /EFFX2802/);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "warns where wiring is not statically decidable (EFFX2806) and still reports what it can",
    () =>
      withProject((project, dir) =>
        Effect.gen(function* () {
          const result = yield* surfaceCheck(project, dir, "worker-namespace.ts");
          assert.strictEqual(result.code, 1, result.stderr || result.stdout);
          assert.match(result.stdout, /EFFX2806 warning[^\n]*Generated/);
          assert.match(result.stdout, /EFFX2802 error/);
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("contract-only emit has no wiring exports (EFFX2807 info) and passes", () =>
    withProject((project, dir) =>
      Effect.gen(function* () {
        const result = yield* surfaceCheck(project, dir, "worker-missing.ts", "--emit=contract");
        assert.strictEqual(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /EFFX2807 info/);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "reports an unreadable --against file (EFFX2804) and a stale surface.json (EFFX2805)",
    () =>
      withProject((project, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          const unreadable = yield* surfaceCheck(project, dir, "does-not-exist.ts");
          assert.strictEqual(unreadable.code, 1, unreadable.stderr || unreadable.stdout);
          assert.match(unreadable.stdout, /EFFX2804 error/);

          const built = yield* runCli(project, "build");
          assert.strictEqual(built.code, 0, built.stderr || built.stdout);
          const fresh = yield* surfaceCheck(project, dir, "worker.ts");
          assert.strictEqual(fresh.code, 0, fresh.stderr || fresh.stdout);
          assert.notInclude(fresh.stdout, "EFFX2805");

          yield* fs.writeFileString(path.join(dir, ".effx", "surface.json"), "{}\n");
          const stale = yield* surfaceCheck(project, dir, "worker.ts");
          assert.strictEqual(stale.code, 0, stale.stderr || stale.stdout);
          assert.match(stale.stdout, /EFFX2805 warning/);
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("surface check is listed by the built-in help", () =>
    Effect.gen(function* () {
      const result = yield* runCli("tsconfig.json", "surface", "--help");
      assert.strictEqual(result.code, 0, result.stderr || result.stdout);
      assert.include(result.stdout, "check");
    }),
  );
});
