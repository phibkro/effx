import { encodeJsonString, testDirectory } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { vi } from "vitest";
import cliPackage from "../package.json";
import rootPackage from "../../../package.json";
import { CEDAR_WASM_VERSION } from "../src/cedar-validate.ts";
import { ManifestJson } from "../src/manifest.ts";

// Each case spawns the real CLI (about 2-3 s per compile); several cases spawn it more than once.
vi.setConfig({ testTimeout: 180_000 });

/*
 * Spec 0017 falsifiers F1-F6 over the real CLI, the real examples/users project, the real
 * `ai-docs` access sources (the Profile-like SnapshotRead/Transaction pair, Any/None/All and
 * requirement parameters), and the real Cedar validator.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname;

const usersRoot = `${repoRoot}examples/users/`;

const accessSources = `${repoRoot}ai-docs/src/04_problems-and-access/`;

const main = new URL("../src/main.ts", import.meta.url).pathname;

const goldens = new URL("../../compiler/test/fixtures/cedar/", import.meta.url).pathname;

/** Printed by the stand-in module whenever something loads the validator. */
const PROBE_LOADED = "CEDAR_PROBE_LOADED";

const fixturesDir = new URL("./fixtures/cedar/", import.meta.url).pathname;

const probe = `${fixturesDir}block-cedar-wasm.ts`;

const RootCompilerOptions = Schema.fromJsonString(
  Schema.Struct({
    compilerOptions: Schema.Struct({
      paths: Schema.Record(Schema.String, Schema.Array(Schema.String)),
    }),
  }),
);

/**
 * A scratch tsconfig that keeps the repository's path aliases and redirects the validator's import
 * to the failing stand-in. Bun applies `--tsconfig-override` `paths` to runtime imports, which its
 * runtime `plugin` onResolve does not do for a bare package in Bun 1.3.13.
 */
const withBlockedValidator = <A, E, R>(use: (override: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const root = yield* Schema.decodeEffect(RootCompilerOptions)(
      yield* read(`${repoRoot}tsconfig.json`),
    );

    const file = yield* fs.makeTempFileScoped({
      directory: yield* testDirectory("cedar-probe-"),
      prefix: ".cedar-probe-",
      suffix: ".json",
    });

    const text = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
      extends: `${repoRoot}tsconfig.json`,
      compilerOptions: {
        paths: {
          ...Object.fromEntries(
            Object.entries(root.compilerOptions.paths).map(([alias, targets]) => [
              alias,
              targets.map((target) => `${repoRoot}${target.replace(/^\.\//, "")}`),
            ]),
          ),
          "@cedar-policy/cedar-wasm/nodejs": [probe],
        },
      },
    });

    yield* fs.writeFileString(file, `${text}\n`);

    return yield* use(file);
  }).pipe(Effect.scoped);

const sha256 = (text: string): string => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** A scratch copy of examples/users, as the surface tests make one. */
const withUsersProject = <A, E, R>(use: (project: string, dir: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const dir = yield* testDirectory("cedar-users-test-");

    yield* fs.copy(path.join(usersRoot, "src"), path.join(dir, "src"));
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

/** A scratch project over one `ai-docs` access example. */
const withAccessProject = <A, E, R>(
  source: string,
  use: (project: string, dir: string) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const dir = yield* testDirectory("cedar-access-test-");

    const project = path.join(dir, "tsconfig.json");

    yield* fs.copy(accessSources, path.join(dir, "src"));

    // A source that is not one of the docs examples is a test-owned `.fixture` copied in by name.
    if (source === "access-variants.ts") {
      yield* fs.copy(`${fixturesDir}access-variants.ts.fixture`, path.join(dir, "src", source));
    }

    // This project opts its copied input into the otherwise ignored .effx tree.
    yield* fs.writeFileString(
      project,
      `{ "extends": ${yield* encodeJsonString(path.join(repoRoot, "tsconfig.json"))}, "include": ["src/${source}"], "exclude": [] }\n`,
    );

    return yield* use(project, dir);
  }).pipe(Effect.scoped);

const runCli = (
  args: ReadonlyArray<string>,
  options: { readonly tsconfigOverride?: string } = {},
) =>
  Effect.sync(() => {
    const override =
      options.tsconfigOverride === undefined
        ? []
        : ["--tsconfig-override", options.tsconfigOverride];

    const result = Bun.spawnSync(["bun", ...override, main, ...args], {
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

const cedar = (project: string, ...args: ReadonlyArray<string>) =>
  runCli(["cedar", ...args, "--project", project]);

const read = (file: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.readFileString(file);
  });

const readGolden = (name: string, hash: string) =>
  Effect.gen(function* () {
    return {
      schema: (yield* read(`${goldens}${name}.cedarschema`)).replaceAll("{{HASH}}", hash),
      policies: (yield* read(`${goldens}${name}.cedar`)).replaceAll("{{HASH}}", hash),
    };
  });

const manifestHash = (dir: string) =>
  Effect.gen(function* () {
    const manifest = yield* Schema.decodeEffect(ManifestJson)(
      yield* read(`${dir}/.effx/manifest.json`),
    );

    return manifest.semanticHash;
  });

/** sha-256 of every file under `.effx/` except `cedar/`, keyed by relative path. */
const effxTree = (dir: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = `${dir}/.effx`;
    const entries = yield* fs.readDirectory(root, { recursive: true });
    const tree: Record<string, string> = {};

    for (const entry of entries.toSorted((a, b) => (a < b ? -1 : 1))) {
      if (entry === "cedar" || entry.startsWith("cedar/")) continue;

      if ((yield* fs.stat(`${root}/${entry}`)).type === "File") {
        tree[entry] = sha256(yield* read(`${root}/${entry}`));
      }
    }

    return tree;
  });

describe("effx cedar (spec 0017)", () => {
  it.effect(
    "F1/F4: examples/users projects to the golden pair, with the IR hash in the header",
    () =>
      withUsersProject((project, dir) =>
        Effect.gen(function* () {
          const built = yield* runCli(["build", "--project", project]);

          assert.strictEqual(built.code, 0, built.stderr || built.stdout);

          const emitted = yield* cedar(project);

          assert.strictEqual(emitted.code, 0, emitted.stderr || emitted.stdout);
          assert.include(emitted.stdout, `validated by cedar-wasm ${CEDAR_WASM_VERSION}`);
          assert.include(emitted.stdout, "EFFX4105 info");

          const hash = yield* manifestHash(dir);
          const golden = yield* readGolden("users", hash);

          assert.strictEqual(yield* read(`${dir}/.effx/cedar/schema.cedarschema`), golden.schema);
          assert.strictEqual(yield* read(`${dir}/.effx/cedar/policies.cedar`), golden.policies);
          assert.include(golden.schema, `semanticHash ${hash}`);
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("F4: output bytes are identical across runs, emit modes and output directories", () =>
    withUsersProject((project, dir) =>
      Effect.gen(function* () {
        const outputs = [
          { args: ["--emit=contract"], out: `${dir}/.effx/cedar` },
          { args: ["--emit=all"], out: `${dir}/.effx/cedar` },
          {
            args: ["--emit=handlers", "--out-dir", `${dir}/elsewhere/cedar`],
            out: `${dir}/elsewhere/cedar`,
          },
        ];

        const seen: Array<string> = [];

        for (const { args, out } of outputs) {
          const result = yield* cedar(project, ...args);

          assert.strictEqual(result.code, 0, result.stderr || result.stdout);
          seen.push(
            (yield* read(`${out}/schema.cedarschema`)) + (yield* read(`${out}/policies.cedar`)),
          );
        }

        assert.strictEqual(seen[1], seen[0]);
        assert.strictEqual(seen[2], seen[0]);
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("F1: a Profile-like SnapshotRead query and Transaction command from real source", () =>
    withAccessProject("02_access.ts", (project, dir) =>
      Effect.gen(function* () {
        const result = yield* cedar(project);

        assert.strictEqual(result.code, 0, result.stderr || result.stdout);

        const schema = yield* read(`${dir}/.effx/cedar/schema.cedarschema`);
        const policies = yield* read(`${dir}/.effx/cedar/policies.cedar`);

        assert.include(
          schema,
          'action "operation/settings.read" in ["capability/settings.read"]\n    appliesTo { principal: [Person], resource: [CurrentAccount], context: { "settings.owner": Bool } };',
        );
        assert.include(schema, '@kind("Query")');
        assert.include(schema, '@decisionTime("SnapshotRead")');
        assert.include(
          schema,
          'action "operation/settings.update" in ["capability/settings.update"]',
        );
        assert.include(schema, '@kind("Command")');
        assert.include(schema, '@decisionTime("Transaction")');
        assert.include(policies, '@id("effx:grant:settings.read")');
        assert.include(policies, '@id("effx:require:settings.update:settings.owner")');
        assert.include(policies, 'unless { context["settings.owner"] };');
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "F6: Any, None, All and a parameterized requirement from real source (EFFX4103/4104)",
    () =>
      withAccessProject("access-variants.ts", (project, dir) =>
        Effect.gen(function* () {
          const result = yield* cedar(project);

          assert.strictEqual(result.code, 0, result.stderr || result.stdout);
          assert.match(
            result.stdout,
            /EFFX4103 warning\s+settings\.readShared: requirement "workspace\.member"/,
          );
          assert.match(result.stdout, /EFFX4104 warning\s+settings\.reset: capabilities All/);

          const schema = yield* read(`${dir}/.effx/cedar/schema.cedarschema`);

          assert.include(
            schema,
            'action "operation/settings.readShared" in ["capability/settings.admin", "capability/settings.read"]',
          );
          assert.match(schema, /action "operation\/settings\.reset"\n/);
          assert.match(schema, /action "operation\/settings\.health"\n/);

          const denied = yield* cedar(project, "--deny-warnings");

          assert.strictEqual(denied.code, 1, denied.stderr || denied.stdout);
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("F6: EFFX4107 writes nothing when no operation has a capability or a contract", () =>
    withAccessProject("01_problems.ts", (project, dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const result = yield* cedar(project);

        assert.strictEqual(result.code, 0, result.stderr || result.stdout);
        assert.match(result.stdout, /EFFX4107 info/);
        assert.include(result.stdout, "cedar: nothing written");
        assert.isFalse(yield* fs.exists(`${dir}/.effx/cedar`));
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "F6: EFFX4101 for an invalid --namespace writes nothing; a valid one is used throughout",
    () =>
      withUsersProject((project, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const invalid = yield* cedar(project, "--namespace", "1bad");

          assert.strictEqual(invalid.code, 1, invalid.stderr || invalid.stdout);
          assert.match(invalid.stdout, /EFFX4101 error[^\n]*--namespace "1bad"/);
          assert.isFalse(yield* fs.exists(`${dir}/.effx/cedar`));

          const valid = yield* cedar(project, "--namespace", "App::Authz");

          assert.strictEqual(valid.code, 0, valid.stderr || valid.stdout);
          assert.include(
            yield* read(`${dir}/.effx/cedar/schema.cedarschema`),
            "namespace App::Authz {",
          );
          assert.include(
            yield* read(`${dir}/.effx/cedar/policies.cedar`),
            'action in App::Authz::Action::"capability/User.Read"',
          );
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("F2c/F6: --policies is validated against the emitted schema (EFFX4102, EFFX4106)", () =>
    withUsersProject((project, dir) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const good = `${dir}/good.cedar`;
        const bad = `${dir}/bad.cedar`;
        const impossible = `${dir}/impossible.cedar`;

        yield* fs.writeFileString(
          good,
          'permit (principal, action == Effx::Action::"operation/User.Get", resource);\n',
        );
        yield* fs.writeFileString(
          bad,
          '@id("app:typo")\npermit (principal, action == Effx::Action::"operation/User.Gett", resource);\n',
        );
        yield* fs.writeFileString(
          impossible,
          'permit (principal, action == Effx::Action::"capability/User.Read", resource);\n',
        );

        const ok = yield* cedar(project, "--policies", good);

        assert.strictEqual(ok.code, 0, ok.stderr || ok.stdout);
        assert.notMatch(ok.stdout, /EFFX410[26]/);

        const rejected = yield* cedar(project, "--policies", bad);

        assert.strictEqual(rejected.code, 1, rejected.stderr || rejected.stdout);
        assert.match(
          rejected.stdout,
          /EFFX4102 error\s+[^\n]*bad\.cedar: policy app:typo: for policy `app:typo`, unrecognized action `Effx::Action::"operation\/User\.Gett"` \(did you mean `Effx::Action::"operation\/User\.Get"`\?\)/,
        );
        // The emitted pair is valid, so it is still written; only the application policy is wrong.
        assert.isTrue(yield* fs.exists(`${dir}/.effx/cedar/schema.cedarschema`));

        const warned = yield* cedar(project, "--policies", impossible);

        assert.strictEqual(warned.code, 0, warned.stderr || warned.stdout);
        assert.match(warned.stdout, /EFFX4106 warning[^\n]*impossible\.cedar/);

        const denied = yield* cedar(project, "--policies", impossible, "--deny-warnings");

        assert.strictEqual(denied.code, 1, denied.stderr || denied.stdout);

        const missing = yield* cedar(project, "--policies", `${dir}/absent.cedar`);

        assert.strictEqual(missing.code, 1);
        assert.include(missing.stdout + missing.stderr, "cannot read the --policies file");
      }),
    ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "F3b/c: effx cedar changes nothing else under .effx; build and check create no cedar dir",
    () =>
      withUsersProject((project, dir) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;

          const checked = yield* runCli(["check", "--project", project]);

          assert.strictEqual(checked.code, 0, checked.stderr || checked.stdout);
          assert.isFalse(yield* fs.exists(`${dir}/.effx`));

          const built = yield* runCli(["build", "--project", project]);

          assert.strictEqual(built.code, 0, built.stderr || built.stdout);
          assert.isFalse(yield* fs.exists(`${dir}/.effx/cedar`));

          const before = yield* effxTree(dir);

          assert.isAbove(Object.keys(before).length, 3);

          const emitted = yield* cedar(project);

          assert.strictEqual(emitted.code, 0, emitted.stderr || emitted.stdout);
          assert.isTrue(yield* fs.exists(`${dir}/.effx/cedar/schema.cedarschema`));
          assert.deepStrictEqual(yield* effxTree(dir), before);

          // Building again leaves the Cedar output alone and still produces the same tree.
          const rebuilt = yield* runCli(["build", "--project", project]);

          assert.strictEqual(rebuilt.code, 0, rebuilt.stderr || rebuilt.stdout);
          assert.deepStrictEqual(yield* effxTree(dir), before);
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "F3d: check and build never resolve the validator; effx cedar names the install when it is missing",
    () =>
      withUsersProject((project, dir) =>
        withBlockedValidator((override) =>
          Effect.gen(function* () {
            const fs = yield* FileSystem.FileSystem;

            const blocked = (args: ReadonlyArray<string>) =>
              runCli([...args, "--project", project], { tsconfigOverride: override });

            const checked = yield* blocked(["check"]);

            assert.strictEqual(checked.code, 0, checked.stderr || checked.stdout);
            assert.notInclude(checked.stdout + checked.stderr, PROBE_LOADED);

            const built = yield* blocked(["build"]);

            assert.strictEqual(built.code, 0, built.stderr || built.stdout);
            assert.notInclude(built.stdout + built.stderr, PROBE_LOADED);

            const missing = yield* blocked(["cedar"]);

            assert.strictEqual(missing.code, 1);
            assert.include(missing.stdout + missing.stderr, PROBE_LOADED);
            assert.include(
              missing.stdout + missing.stderr,
              `run: bun add @cedar-policy/cedar-wasm@${CEDAR_WASM_VERSION}`,
            );
            assert.isFalse(yield* fs.exists(`${dir}/.effx/cedar`));
          }),
        ),
      ).pipe(Effect.provide(BunServices.layer)),
  );
});

describe("Cedar scope and pin (spec 0017 F3d, F5)", () => {
  const sourceFiles = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files: Array<string> = [];

    for (const entry of yield* fs.readDirectory(`${repoRoot}packages`, { recursive: true })) {
      if (/(^|\/)(node_modules|dist)\//.test(entry)) continue;

      if (!/(^|\/)src\/.*\.ts$/.test(entry)) continue;

      files.push(path.join(repoRoot, "packages", entry));
    }

    return files;
  }).pipe(Effect.provide(BunServices.layer));

  it.effect("no module statically imports the validator; only one adapter file names it", () =>
    Effect.gen(function* () {
      const naming: Array<string> = [];

      for (const file of yield* sourceFiles) {
        const text = yield* read(file);

        if (!text.includes("cedar-wasm")) continue;

        if (file.endsWith("/packages/cli/src/cedar-validate.ts")) {
          // A type import erases; the value import is the one dynamic `import()`.
          assert.notMatch(text, /^import (?!type\b)[^\n]*cedar-wasm/m);
          assert.match(text, /import\("@cedar-policy\/cedar-wasm\/nodejs"\)/);
        } else if (!file.endsWith("/packages/cli/src/cedar.ts")) {
          naming.push(file);
        }
      }

      // cedar.ts only prints the version; every other mention is a violation.
      assert.deepStrictEqual(naming, []);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "the validator adapter has no request-evaluation entry point and nothing issues a lease",
    () =>
      Effect.gen(function* () {
        for (const file of yield* sourceFiles) {
          const text = yield* read(file);

          assert.notMatch(
            text,
            /\b(isAuthorized|statefulIsAuthorized|Authorizer|partiallyAuthorize)\b/,
            file,
          );
          assert.notMatch(text, /\bLease\b/, file);
        }

        const adapter = yield* read(`${repoRoot}packages/cli/src/cedar-validate.ts`);

        const used = [...adapter.matchAll(/cedar\.(\w+)\(/g)]
          .map((match) => match[1])
          .toSorted((a, b) => ((a ?? "") < (b ?? "") ? -1 : 1));

        assert.deepStrictEqual(used, ["policySetTextToParts", "validate"]);
      }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "one pin: adapter constant, cli peer, root dev dependency, lockfile and installed package",
    () =>
      Effect.gen(function* () {
        const installed = yield* Schema.decodeEffect(
          Schema.fromJsonString(Schema.Struct({ version: Schema.String })),
        )(yield* read(`${repoRoot}node_modules/@cedar-policy/cedar-wasm/package.json`));

        const lock = yield* read(`${repoRoot}bun.lock`);

        assert.strictEqual(
          cliPackage.peerDependencies["@cedar-policy/cedar-wasm"],
          CEDAR_WASM_VERSION,
        );
        assert.deepStrictEqual(cliPackage.peerDependenciesMeta["@cedar-policy/cedar-wasm"], {
          optional: true,
        });
        assert.strictEqual(
          rootPackage.devDependencies["@cedar-policy/cedar-wasm"],
          CEDAR_WASM_VERSION,
        );
        assert.strictEqual(installed.version, CEDAR_WASM_VERSION);
        assert.include(lock, `"@cedar-policy/cedar-wasm@${CEDAR_WASM_VERSION}"`);
        assert.notProperty(cliPackage.dependencies, "@cedar-policy/cedar-wasm");
      }).pipe(Effect.provide(BunServices.layer)),
  );
});
