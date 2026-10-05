import { encodeJsonString, testDirectory } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { StableId } from "@effx/ir";
import { ManifestJson } from "../src/manifest.ts";

const fixtureRoot = new URL("../../frontend-ts/test/fixtures/users/", import.meta.url).pathname;

const repoRoot = new URL("../../../", import.meta.url).pathname;

const main = new URL("../src/main.ts", import.meta.url).pathname;

const contactProject = new URL(
  "../../frontend-ts/test/fixtures/rc116/tsconfig.contact.effx.json",
  import.meta.url,
).pathname;

const generated = [
  "generated/cli.ts",
  "generated/client.ts",
  "generated/http.ts",
  "generated/rpc.ts",
];

const decodeManifest = Schema.decodeEffect(ManifestJson);

/** Each invocation gets its own project root and output directory; the checked-in fixture is never built into. */
const withProject = <A, E, R>(
  entry: "operations.ts" | "broken.ts",
  use: (project: string, dir: string) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* testDirectory("cli-test-");
    yield* fs.copy(path.join(fixtureRoot, "src"), path.join(dir, "src"));
    yield* fs.writeFileString(
      path.join(dir, "package.json"),
      '{ "devDependencies": { "typescript": "6.0.2" } }\n',
    );
    const project = path.join(dir, "tsconfig.json");
    yield* fs.writeFileString(
      project,
      `{ "extends": ${yield* encodeJsonString(path.join(fixtureRoot, "tsconfig.json"))}, "include": ["src/${entry}"] }\n`,
    );

    return yield* use(project, dir);
  }).pipe(Effect.scoped);

/** Collect output even on exit 1: diagnostics are CLI data, not a failed spawn. */
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

describe("effx CLI child process (spec 0003)", () => {
  it.effect("cold all failure leaves owned output and manifest unchanged", () =>
    withProject("operations.ts", (project, dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        yield* fs.writeFileString(
          path.join(dir, "src", "operations.ts"),
          `
import { Schema } from "effect";
import { Http, Operation } from "@effx/runtime";
import { Root } from "./root.ts";
export const Input = Schema.Struct({});
export const Output = Schema.String;
export const Profile = Http.group({ root: Root, group: "profile" });
export const Read = Operation.query({ name: "Read", input: Input, success: Output })
  .in(Profile).http.get("/")
  .http.contract({ success: Output, metadata: { operationId: "profile.read" } }).declare();
`,
        );
        yield* fs.writeFileString(
          path.join(dir, "src", "root.ts"),
          `
import { Schema } from "effect";
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/http-api";
import { readBoard } from "../.effx/generated/onboarding-contract.ts";
export const Root = HttpApi.make("inventory")
  .add(HttpApiGroup.make("profile").add(HttpApiEndpoint.get("read", "/", { success: Schema.String })))
  .add(HttpApiGroup.make("onboarding").add(readBoard));
`,
        );
        const output = path.join(dir, ".effx");
        yield* fs.makeDirectory(path.join(output, "generated"), { recursive: true });
        yield* fs.writeFileString(path.join(output, "manifest.json"), "unchanged manifest\n");
        yield* fs.writeFileString(
          path.join(output, "generated", "sentinel.ts"),
          "unchanged output\n",
        );
        const result = yield* runCli(project, "build", "--emit=all");

        assert.strictEqual(result.code, 1, result.stdout + result.stderr);
        assert.strictEqual((result.stdout + result.stderr).match(/EFFX2415 error/g)?.length, 1);
        assert.include(result.stdout + result.stderr, "readBoard");
        assert.strictEqual(
          yield* fs.readFileString(path.join(output, "manifest.json")),
          "unchanged manifest\n",
        );
        assert.strictEqual(
          yield* fs.readFileString(path.join(output, "generated", "sentinel.ts")),
          "unchanged output\n",
        );
        assert.deepStrictEqual(yield* fs.readDirectory(path.join(output, "generated")), [
          "sentinel.ts",
        ]);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("renders built-in help for all four subcommands", () =>
    Effect.gen(function* () {
      const result = yield* runCli("tsconfig.json", "--help");
      assert.strictEqual(result.code, 0, result.stderr || result.stdout);

      for (const name of ["check", "build", "inspect", "graph"]) {
        assert.include(result.stdout, name);
      }
    }),
  );

  it.effect("rejects unknown subcommands with a usage error", () =>
    Effect.gen(function* () {
      const result = yield* runCli("tsconfig.json", "unknown-command");
      assert.notStrictEqual(result.code, 0);
      assert.match(result.stderr, /unknown.command/i);
    }),
  );

  it.effect("requires a name for inspect", () =>
    Effect.gen(function* () {
      const result = yield* runCli("tsconfig.json", "inspect");
      assert.notStrictEqual(result.code, 0);
      assert.match(result.stdout + result.stderr, /name|argument/i);
    }),
  );

  it.effect("check reports TypeScript skew and zero errors for the decorator fixture", () =>
    withProject("operations.ts", (project) =>
      Effect.gen(function* () {
        const result = yield* runCli(project, "check");
        assert.strictEqual(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /EFFX0001 info\s/);
        assert.include(result.stdout, "0 error(s)");
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("strict access makes a missing HTTP declaration an error", () =>
    withProject("operations.ts", (project) =>
      Effect.gen(function* () {
        const result = yield* runCli(project, "check", "--strict-access");

        assert.strictEqual(result.code, 1, result.stderr || result.stdout);
        assert.match(result.stdout, /EFFX2504 error/);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
  it.effect("check fails for an undeclared handler error, without writing output", () =>
    withProject("broken.ts", (project, dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const result = yield* runCli(project, "check");
        assert.strictEqual(result.code, 1, result.stderr || result.stdout);
        assert.match(result.stdout, /EFFX2201 error\s+[^\n]+\s+[^\s]*src\/broken\.ts:\d+:\d+/);
        assert.notInclude(result.stdout, fixtureRoot);
        assert.isFalse(yield* fs.exists(path.join(dir, ".effx")));
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "check accepts target and emit as equals or separate flags, without writing files",
    () =>
      withProject("operations.ts", (project, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          const contract = yield* runCli(
            project,
            "check",
            "--target=effect-4.0",
            "--emit=contract",
          );

          const handlers = yield* runCli(
            project,
            "check",
            "--target",
            "effect-4.0",
            "--emit",
            "handlers",
          );

          assert.strictEqual(contract.code, 0, contract.stderr || contract.stdout);
          assert.strictEqual(handlers.code, 0, handlers.stderr || handlers.stdout);
          assert.isFalse(yield* fs.exists(path.join(dir, ".effx")));
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("invalid target and emit values fail at the CLI boundary", () =>
    withProject("operations.ts", (project) =>
      Effect.gen(function* () {
        for (const args of [
          ["check", "--target=effect-5.0"],
          ["build", "--emit=unknown"],
          ["inspect", "User.Get", "--emit=unknown"],
          ["graph", "--target", "effect-5.0"],
        ]) {
          const result = yield* runCli(project, ...args);
          assert.notStrictEqual(result.code, 0, result.stdout);
          assert.match(result.stderr || result.stdout, /(--target|--emit)/);
        }
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "build writes a canonical, byte-stable IR and the four manifest-listed projections",
    () =>
      withProject("operations.ts", (project, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const first = yield* runCli(project, "build");
          assert.strictEqual(first.code, 0, first.stderr || first.stdout);
          const out = path.join(dir, ".effx");
          const irPath = path.join(out, "ir.json");
          const firstBytes = yield* fs.readFile(irPath);
          assert.strictEqual(new TextDecoder().decode(firstBytes).endsWith("\n"), true);

          const manifest = yield* decodeManifest(
            yield* fs.readFileString(path.join(out, "manifest.json")),
          );

          assert.strictEqual(manifest.format, "effx-manifest");
          assert.strictEqual(manifest.version, 1);
          assert.strictEqual(manifest.emit, "all");
          assert.deepStrictEqual(manifest.generated, generated);
          assert.match(manifest.semanticHash, /^[a-f0-9]{64}$/);
          assert.isTrue(manifest.locations[StableId.make("operation", "User.Get")] !== undefined);

          for (const file of generated) assert.isTrue(yield* fs.exists(path.join(out, file)), file);
          const second = yield* runCli(project, "build");
          assert.strictEqual(second.code, 0, second.stderr || second.stdout);
          assert.deepStrictEqual(yield* fs.readFile(irPath), firstBytes);
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("a mode switch removes only obsolete manifest-owned .effx outputs", () =>
    withProject("operations.ts", (project, dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const out = path.join(dir, ".effx");
        const manifestPath = path.join(out, "manifest.json");
        const irPath = path.join(out, "ir.json");
        const all = yield* runCli(project, "build");
        assert.strictEqual(all.code, 0, all.stderr || all.stdout);
        const firstManifest = yield* decodeManifest(yield* fs.readFileString(manifestPath));
        const ir = yield* fs.readFile(irPath);
        const userFile = path.join(out, "generated", "keep.ts");
        yield* fs.writeFileString(userFile, "// user-owned; never in a manifest\n");

        const contract = yield* runCli(project, "build", "--emit=contract");
        assert.strictEqual(contract.code, 0, contract.stderr || contract.stdout);
        const secondManifest = yield* decodeManifest(yield* fs.readFileString(manifestPath));
        assert.strictEqual(secondManifest.emit, "contract");
        assert.strictEqual(secondManifest.semanticHash, firstManifest.semanticHash);
        assert.deepStrictEqual(yield* fs.readFile(irPath), ir);
        assert.isTrue(yield* fs.exists(userFile));

        for (const name of firstManifest.generated) {
          if (!secondManifest.generated.includes(name)) {
            assert.isFalse(yield* fs.exists(path.join(out, name)), name);
          }
        }

        for (const name of secondManifest.generated) {
          assert.isTrue(yield* fs.exists(path.join(out, name)), name);
        }

        const handlers = yield* runCli(project, "build", "--emit", "handlers");
        assert.strictEqual(handlers.code, 0, handlers.stderr || handlers.stdout);
        const thirdManifest = yield* decodeManifest(yield* fs.readFileString(manifestPath));
        assert.strictEqual(thirdManifest.emit, "handlers");
        assert.strictEqual(thirdManifest.semanticHash, firstManifest.semanticHash);
        assert.isTrue(yield* fs.exists(userFile));

        for (const name of secondManifest.generated) {
          if (!thirdManifest.generated.includes(name)) {
            assert.isFalse(yield* fs.exists(path.join(out, name)), name);
          }
        }
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("inspect resolves User.Get and prints its operation and three exposures", () =>
    withProject("operations.ts", (project) =>
      Effect.gen(function* () {
        const result = yield* runCli(project, "inspect", "User.Get");
        assert.strictEqual(result.code, 0, result.stderr || result.stdout);
        assert.include(result.stdout, "Operation User.Get");
        assert.match(result.stdout, /Kind\s+Query/);
        assert.include(result.stdout, "GET /users/:id");
        assert.include(result.stdout, "RPC User.Get");
        assert.include(result.stdout, "CLI users get");
        assert.notInclude(result.stdout, "snapshotDecisionForCommand");
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("inspect shows the Contact snapshot decision claim in Authority", () =>
    Effect.gen(function* () {
      const result = yield* runCli(
        contactProject,
        "inspect",
        "contact.submitContactMessage",
        "--emit=contract",
      );

      assert.strictEqual(result.code, 0, result.stderr || result.stdout);
      assert.include(result.stdout, "Operation contact.submitContactMessage");
      assert.match(result.stdout, /Kind\s+Command/);
      assert.include(result.stdout, "Authority\n  snapshotDecisionForCommand: true\n\nExposed\n");
      assert.include(result.stdout, "POST /api/contact-messages");
    }),
  );

  it.effect("check accepts the Contact snapshot decision claim under strict access", () =>
    Effect.gen(function* () {
      const result = yield* runCli(contactProject, "check", "--strict-access", "--emit=contract");

      assert.strictEqual(result.code, 0, result.stderr || result.stdout);
      assert.include(result.stdout, "0 error(s)");
      assert.notMatch(result.stdout, /EFFX25\d\d (error|warning)/);
    }),
  );

  it.effect("graph prints the whole IR and limits scoped traversal to reachable nodes", () =>
    withProject("operations.ts", (project) =>
      Effect.gen(function* () {
        const all = yield* runCli(project, "graph");
        assert.strictEqual(all.code, 0, all.stderr || all.stdout);
        assert.isTrue(all.stdout.startsWith("flowchart LR"), all.stdout);
        assert.include(all.stdout, "operation:User.ChangeEmail");
        assert.match(all.stdout, /operation_User_Get -->\|ExposedAs http\| exposure_http_User_Get/);
        const scoped = yield* runCli(project, "graph", "User.Get");
        assert.strictEqual(scoped.code, 0, scoped.stderr || scoped.stdout);
        assert.isTrue(scoped.stdout.startsWith("flowchart LR"), scoped.stdout);
        assert.include(scoped.stdout, "operation:User.Get");
        assert.notInclude(scoped.stdout, "User.ChangeEmail");
        assert.match(
          scoped.stdout,
          /schema_src_schemas_GetUserInput -->\|InputOf\| operation_User_Get/,
        );
        assert.match(
          scoped.stdout,
          /schema_src_user_User_Public -->\|SuccessOf\| operation_User_Get/,
        );
        assert.match(
          scoped.stdout,
          /schema_src_errors_UserNotFound -->\|ErrorOf\| operation_User_Get/,
        );
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );
});
