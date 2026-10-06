import { encodeJsonString, testDirectory } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { Extensions } from "@effx/compiler";
import { resolveProject } from "../src/commands.ts";
import { defineConfig } from "../src/config.ts";
import { expectTypeOf } from "vitest";

const fixtureRoot = new URL("../../frontend-ts/test/fixtures/users/", import.meta.url).pathname;

const repoRoot = new URL("../../../", import.meta.url).pathname;

const main = new URL("../src/main.ts", import.meta.url).pathname;

const configImport = `import { defineConfig } from "${new URL("../src/config.ts", import.meta.url).href}";`;

const stringJson = Schema.fromJsonString(Schema.String);

const fixture = <A, E, R>(use: (dir: string, project: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const dir = yield* testDirectory("config-test-");

    yield* fs.copy(path.join(fixtureRoot, "src"), path.join(dir, "src"));
    yield* fs.writeFileString(
      path.join(dir, "package.json"),
      '{ "devDependencies": { "typescript": "6.0.2" } }\n',
    );
    const project = path.join(dir, "tsconfig.json");
    yield* fs.writeFileString(
      project,
      `{ "extends": ${yield* encodeJsonString(path.join(fixtureRoot, "tsconfig.json"))}, "include": ["src/operations.ts"], "effx": { "projectRoot": ".", "outDir": "ts-out", "emit": "handlers", "target": "effect-4.0-rc", "strictAccess": true } }`,
    );

    return yield* use(dir, project);
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer));

const runAt = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.sync(() => {
    const result = Bun.spawnSync(["bun", main, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      code: result.exitCode,
      stdout: new TextDecoder().decode(result.stdout),
      stderr: new TextDecoder().decode(result.stderr),
    };
  });

const run = (project: string, ...args: ReadonlyArray<string>) =>
  runAt(repoRoot, ...args, "--project", project);

describe("spec 0024 naming config precedence", () => {
  it("defineConfig keeps the literal data pattern", () => {
    const config = defineConfig({ naming: { problemIdentifier: "{Group}{Key}Problem" } });
    expectTypeOf(config.naming.problemIdentifier).toEqualTypeOf<"{Group}{Key}Problem">();
  });

  it.effect("resolves CLI over config over tsconfig over the legacy default", () =>
    fixture((dir, project) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const settings = `{ "extends": ${yield* encodeJsonString(path.join(fixtureRoot, "tsconfig.json"))}, "include": ["src/operations.ts"], "effx": {} }`;
        yield* fs.writeFileString(project, settings);
        assert.strictEqual((yield* resolveProject(project)).config.naming, undefined);
        yield* fs.writeFileString(
          project,
          settings.replace(
            '"effx": {}',
            '"effx": { "naming": { "problemIdentifier": "Ts{Key}Problem" } }',
          ),
        );
        assert.deepStrictEqual((yield* resolveProject(project)).config.naming, {
          problemIdentifier: "Ts{Key}Problem",
        });
        yield* fs.writeFileString(
          path.join(dir, "effx.config.ts"),
          `${configImport} export default defineConfig({ naming: { problemIdentifier: "Config{Key}Problem" } });`,
        );
        assert.deepStrictEqual((yield* resolveProject(project)).config.naming, {
          problemIdentifier: "Config{Key}Problem",
        });

        const selected = yield* resolveProject(
          project,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          false,
          "Cli{Key}Problem",
        );

        assert.deepStrictEqual(selected.config.naming, { problemIdentifier: "Cli{Key}Problem" });
      }),
    ),
  );

  it.effect(
    "the actual CLI rejects malformed patterns and accepts a flag above a malformed fallback",
    () =>
      fixture((dir, project) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const settings = yield* fs.readFileString(project);
          yield* fs.writeFileString(
            project,
            settings.replace("src/operations.ts", "src/operations.access.builder.ts"),
          );
          yield* fs.writeFileString(
            path.join(dir, "effx.config.ts"),
            `${configImport} export default defineConfig({ naming: { problemIdentifier: "{Group}Problem" } });`,
          );
          const rejected = yield* run(project, "check");
          assert.strictEqual(rejected.code, 1);
          assert.include(rejected.stdout, "EFFX2412");

          const accepted = yield* run(
            project,
            "check",
            "--target",
            "effect-4.0",
            "--emit",
            "contract",
            "--naming-problem-identifier",
            "{Group}{Key}Problem",
          );

          assert.strictEqual(accepted.code, 0, accepted.stdout + accepted.stderr);
          assert.notInclude(accepted.stdout, "EFFX2412");

          const explaining = yield* runAt(
            dir,
            "--naming-problem-identifier",
            "{Key}Problem",
            "explain",
            "EFFX2412",
          );

          assert.strictEqual(explaining.code, 2);
          assert.include(explaining.stderr + explaining.stdout, "Unsupported option for explain");
        }),
      ),
  );
});

describe("spec 0015 config resolution", () => {
  it("defineConfig is a pure identity and preserves inferred fields", () => {
    const value = { generators: { http: false } } as const;
    assert.strictEqual(defineConfig(value), value);
  });

  it("preserves literal config fields and a callback's public Extension channel", () => {
    const config = defineConfig({
      strictAccess: false,
      emit: "contract",
      extensions: (builtin) => [...builtin],
    });

    expectTypeOf(config.strictAccess).toEqualTypeOf<false>();
    expectTypeOf(config.emit).toEqualTypeOf<"contract">();
    expectTypeOf(config.extensions(Extensions.builtin)).toEqualTypeOf<
      Array<(typeof Extensions.builtin)[number]>
    >();
  });

  it.effect(
    "uses tsconfig fallbacks, config-relative paths, explicit project and CLI overrides",
    () =>
      fixture((dir, project) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const second = path.join(dir, "selected.json");
          yield* fs.writeFileString(
            second,
            `{ "extends": ${yield* encodeJsonString(path.join(fixtureRoot, "tsconfig.json"))}, "include": ["src/operations.ts"], "effx": { "emit": "all", "strictAccess": false } }`,
          );
          const fallback = yield* resolveProject(project);
          assert.deepStrictEqual(fallback.config, {
            tsconfigPath: project,
            projectRoot: path.resolve(dir),
            outDir: path.join(dir, "ts-out"),
            emit: "handlers",
            target: "effect-4.0-rc",
            strictAccess: true,
          });
          const rooted = path.join(dir, "rooted.json");
          yield* fs.writeFileString(
            rooted,
            `{"extends":${yield* encodeJsonString(path.join(fixtureRoot, "tsconfig.json"))},"include":["src/operations.ts"],"effx":{"projectRoot":".."}}`,
          );
          assert.strictEqual(
            (yield* resolveProject(rooted)).config.projectRoot,
            path.resolve(dir, ".."),
          );
          const configPath = path.join(dir, "effx.config.ts");
          yield* fs.writeFileString(
            configPath,
            `${configImport} export default defineConfig({ project: "selected.json", outDir: "config-out", emit: "contract", target: "effect-4.0", strictAccess: true });`,
          );
          const configured = yield* resolveProject(project);
          assert.strictEqual(configured.tsconfigPath, second);
          assert.strictEqual(configured.config.outDir, path.join(dir, "config-out"));
          assert.strictEqual(configured.config.emit, "contract");
          assert.strictEqual(configured.config.target, "effect-4.0");
          assert.strictEqual(configured.config.strictAccess, true);

          const overridden = yield* resolveProject(
            project,
            false,
            "effect-4.0-rc",
            "all",
            undefined,
            "cli-out",
            true,
          );

          assert.strictEqual(overridden.tsconfigPath, project);
          assert.strictEqual(overridden.config.outDir, path.resolve("cli-out"));
          assert.strictEqual(overridden.config.emit, "all");
          assert.strictEqual(overridden.config.target, "effect-4.0-rc");
          assert.strictEqual(overridden.config.strictAccess, false);

          const explicit = yield* resolveProject(
            project,
            undefined,
            undefined,
            undefined,
            configPath,
          );

          assert.strictEqual(explicit.tsconfigPath, second);
          const nested = path.join(dir, "config");
          yield* fs.makeDirectory(nested);
          const nestedConfig = path.join(nested, "effx.config.ts");
          yield* fs.writeFileString(
            nestedConfig,
            `${configImport} export default defineConfig({ project: "../selected.json", outDir: "nested-output" });`,
          );

          const nestedProject = yield* resolveProject(
            project,
            undefined,
            undefined,
            undefined,
            nestedConfig,
          );

          assert.strictEqual(nestedProject.tsconfigPath, second);
          assert.strictEqual(nestedProject.config.outDir, path.join(nested, "nested-output"));
        }),
      ),
  );

  it.effect(
    "discovers only beside the initially selected tsconfig and uses config project without --project",
    () =>
      fixture((dir, project) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const nested = path.join(dir, "nested");
          yield* fs.makeDirectory(nested);
          yield* fs.writeFileString(
            path.join(nested, "selected.json"),
            `{"extends":${yield* encodeJsonString(path.join(fixtureRoot, "tsconfig.json"))},"include":["../src/operations.ts"],"effx":{"projectRoot":"..","emit":"contract"}}`,
          );
          yield* fs.writeFileString(
            path.join(nested, "effx.config.ts"),
            'throw new Error("must not discover a second config");',
          );
          yield* fs.writeFileString(
            path.join(dir, "effx.config.ts"),
            `${configImport} export default defineConfig({ project: "nested/selected.json" });`,
          );
          const configured = yield* runAt(dir, "build", "--no-strict-access");
          assert.strictEqual(configured.code, 0, configured.stderr || configured.stdout);
          const manifest = yield* fs.readFileString(path.join(nested, ".effx", "manifest.json"));
          assert.match(manifest, /"emit"\s*:\s*"contract"/);
          const selected = yield* run(project, "check", "--no-strict-access");
          assert.strictEqual(selected.code, 0, selected.stderr || selected.stdout);
        }),
      ),
  );
  it.effect("rejects absent explicit config and malformed extension lists before output", () =>
    fixture((dir, project) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const missing = yield* Effect.flip(
          resolveProject(project, undefined, undefined, undefined, path.join(dir, "absent.ts")),
        );

        assert.strictEqual(missing._tag, "CompilerFault");
        const bad = path.join(dir, "effx.config.ts");
        yield* fs.writeFileString(
          bad,
          `${configImport} export default defineConfig({ extensions: [null] });`,
        );
        const invalid = yield* Effect.flip(resolveProject(project));
        assert.strictEqual(invalid._tag, "CompilerFault");
        assert.match(invalid.message, /extensions/);
        const malformed = path.join(dir, "malformed.config.ts");
        yield* fs.writeFileString(malformed, 'export default { strictAccess: "not-a-boolean" };');

        const fields = yield* Effect.flip(
          resolveProject(project, undefined, undefined, undefined, malformed),
        );

        assert.strictEqual(fields._tag, "CompilerFault");
        assert.match(fields.message, /invalid fields/);
        assert.isFalse(yield* fs.exists(path.join(dir, ".effx")));
      }),
    ),
  );

  it.effect("appends arrays; callback replaces built-ins and validates the returned list", () =>
    fixture((dir, project) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = path.join(dir, "effx.config.ts");
        yield* fs.writeFileString(
          config,
          `${configImport} export default defineConfig({ extensions: [{ name: "custom", interpreters: {}, analyses: [], generators: [] }] });`,
        );
        const appended = yield* resolveProject(project);
        assert.strictEqual(appended.extensions.length, Extensions.builtin.length + 1);
        assert.strictEqual(appended.extensions.at(-1)?.name, "custom");
        yield* fs.writeFileString(
          path.join(dir, "replace.config.ts"),
          `${configImport} export default defineConfig({ extensions: () => [{ name: "replacement", interpreters: {}, analyses: [], generators: [] }] });`,
        );

        const replaced = yield* resolveProject(
          project,
          undefined,
          undefined,
          undefined,
          path.join(dir, "replace.config.ts"),
        );

        assert.deepStrictEqual(
          replaced.extensions.map((ext) => ext.name),
          ["replacement"],
        );
        const retainedPath = path.join(dir, "retained.config.ts");
        yield* fs.writeFileString(
          retainedPath,
          `${configImport} export default defineConfig({ extensions: (builtin) => [...builtin], generators: { http: false } });`,
        );

        const retained = yield* resolveProject(
          project,
          undefined,
          undefined,
          undefined,
          retainedPath,
        );

        assert.strictEqual(retained.extensions.length, Extensions.builtin.length);
        assert.strictEqual(
          retained.extensions.find((ext) => ext.name === "http")?.generators.length,
          0,
        );
        assert.strictEqual(
          retained.extensions.find((ext) => ext.name === "http-contract")?.analyses.length,
          Extensions.httpContractExtension.analyses.length,
        );
        yield* fs.writeFileString(
          path.join(dir, "invalid.config.ts"),
          `${configImport} export default defineConfig({ extensions: () => [undefined] });`,
        );

        const invalid = yield* Effect.flip(
          resolveProject(
            project,
            undefined,
            undefined,
            undefined,
            path.join(dir, "invalid.config.ts"),
          ),
        );

        assert.match(invalid.message, /extensions/);
      }),
    ),
  );

  it.effect("evaluates config once and never executes an application module", () =>
    fixture((dir, project) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const configMarker = path.join(dir, "config-runs.txt");
        const appMarker = path.join(dir, "app-runs.txt");
        const configMarkerJson = yield* Schema.encodeEffect(stringJson)(configMarker);
        const appMarkerJson = yield* Schema.encodeEffect(stringJson)(appMarker);
        yield* fs.writeFileString(
          path.join(dir, "effx.config.ts"),
          `${configImport} await Bun.write(${configMarkerJson}, (await Bun.file(${configMarkerJson}).exists() ? await Bun.file(${configMarkerJson}).text() : "") + "x"); export default defineConfig({ generators: { http: false, rpc: false, cli: false, client: false, foldkit: false } });`,
        );
        const operations = path.join(dir, "src", "operations.ts");
        yield* fs.writeFileString(
          operations,
          (yield* fs.readFileString(operations)) +
            `
Bun.write(${appMarkerJson}, "executed");
`,
        );
        const check = yield* run(project, "check", "--no-strict-access");
        assert.strictEqual(check.code, 0, check.stderr || check.stdout);
        assert.strictEqual(yield* fs.readFileString(configMarker), "x");
        assert.isFalse(yield* fs.exists(appMarker));
        const resolved = yield* resolveProject(project);

        for (const name of ["http", "rpc", "cli", "client", "foldkit"]) {
          assert.strictEqual(
            resolved.extensions.find((ext) => ext.name === name)?.generators.length,
            0,
          );
        }

        assert.isTrue(
          resolved.extensions.some(
            (ext) => ext.name === "http-contract" && ext.analyses.length > 0,
          ),
        );
      }),
    ),
  );

  it.effect(
    "generator switches change files but not IR, hash or contract validation",
    () =>
      fixture((dir, project) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          const buildFlags = [
            "--no-strict-access",
            "--emit=all",
            "--out-dir",
            path.join(dir, ".effx", "generated"),
          ];

          const normal = yield* run(project, "build", ...buildFlags);
          assert.strictEqual(normal.code, 0, normal.stderr || normal.stdout);
          const ir = yield* fs.readFileString(path.join(dir, ".effx", "ir.json"));
          const before = yield* fs.readFileString(path.join(dir, ".effx", "manifest.json"));
          yield* fs.writeFileString(
            path.join(dir, "effx.config.ts"),
            `${configImport} export default defineConfig({ generators: { http: false } });`,
          );
          const toggled = yield* run(project, "build", ...buildFlags);
          assert.strictEqual(toggled.code, 0, toggled.stderr || toggled.stdout);
          const after = yield* fs.readFileString(path.join(dir, ".effx", "manifest.json"));
          assert.strictEqual(yield* fs.readFileString(path.join(dir, ".effx", "ir.json")), ir);
          assert.notInclude(after, "generated/http.ts");
          assert.include(before, "generated/http.ts");
          assert.include(after, "generated/rpc.ts");
          // Even with HTTP files disabled, the HTTP contract analysis still rejects strict access.
          const strict = yield* run(project, "check", "--strict-access");
          assert.strictEqual(strict.code, 1);
          assert.match(strict.stdout, /EFFX2504 error/);
        }),
      ),
    120_000,
  );
  it.effect(
    "applies explicit --config and --out-dir on every command",
    () =>
      fixture((dir, project) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const config = path.join(dir, "other.config.ts");
          const output = path.join(dir, "chosen-output");
          yield* fs.writeFileString(
            config,
            `${configImport} export default defineConfig({ generators: { rpc: false } });`,
          );

          const flags = [
            "--config",
            config,
            "--no-strict-access",
            "--out-dir",
            output,
            "--emit=all",
          ];

          for (const args of [
            ["check"],
            ["inspect", "User.Get"],
            ["graph", "User.Get"],
            ["build"],
          ]) {
            const result = yield* run(project, ...args, ...flags);
            assert.strictEqual(result.code, 0, result.stderr || result.stdout);
          }

          assert.isTrue(yield* fs.exists(path.join(output, "http.ts")));
          assert.isFalse(yield* fs.exists(path.join(output, "rpc.ts")));
          const missing = yield* run(project, "graph", "--config", path.join(dir, "absent.ts"));
          assert.notStrictEqual(missing.code, 0);
          assert.match(missing.stderr + missing.stdout, /invalid effx config/);
        }),
      ),
    120_000,
  );
});
