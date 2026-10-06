import { copyRc116Fixture, copyUsersFixture } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { ManifestJson, build, resolveProject } from "@effx/cli";
import { Extensions, HttpDiagnostics, compile, type CompileResult } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash } from "@effx/ir";
import { requireRc116FixtureDependencies } from "./rc116-fixture-dependencies.ts";

requireRc116FixtureDependencies(new URL("./fixtures/rc116/", import.meta.url).pathname);

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

const errors = (result: CompileResult) => result.diagnostics.filter((d) => d.severity === "error");

const same = Effect.fnUntraced(function* (explicit: CompileResult, dense: CompileResult) {
  assert.deepStrictEqual(errors(explicit), []);
  assert.deepStrictEqual(errors(dense), []);
  const original = Option.getOrThrow(explicit.ir.value);
  const derived = Option.getOrThrow(dense.ir.value);
  assert.strictEqual(canonical(derived), canonical(original));
  assert.strictEqual(yield* semanticHash(derived), yield* semanticHash(original));
  assert.deepStrictEqual(
    Option.getOrThrow(dense.files.value),
    Option.getOrThrow(explicit.files.value),
  );
});

// This suite is the repository rc116 fixture oracle, not the actual mono-web four-group corpus.
describe("problem naming on real source fixtures", () => {
  it.effect(
    "rc116 Profile and Directory preserve exact IR, hash and files in both passes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const copied = yield* copyRc116Fixture();
        const tsconfigPath = path.join(copied, "project/contract/tsconfig.effx.json");

        for (const [entry, prefix] of [
          ["profile.effx.ts", "Profile"],
          ["directory-dense.effx.ts", "Directory"],
        ] as const) {
          const file = path.join(copied, "src", entry);
          const source = yield* fs.readFileString(file);

          const dense = source.replace(
            new RegExp(`identifier: "${prefix}[A-Za-z]+Problem",?\\n?`, "gu"),
            "",
          );

          assert.notStrictEqual(dense, source);

          if (prefix === "Directory") {
            assert.include(dense, 'identifier: "SchoolCommandProblem"');
            assert.include(dense, 'identifier: "SchoolPatchProblem"');
          }

          const project = { tsconfigPath, entry: [`../../src/${entry}`], strictAccess: true };
          let contractHash: string | undefined;

          for (const emit of ["contract", "handlers"] as const) {
            yield* fs.writeFileString(file, source);
            const explicit = yield* compile({ ...project, emit }, Extensions.builtin);
            yield* fs.writeFileString(file, dense);

            const derived = yield* compile(
              { ...project, emit, naming: { problemIdentifier: "{Group}{Key}Problem" } },
              Extensions.builtin,
            );

            yield* same(explicit, derived);
            const hash = yield* semanticHash(Option.getOrThrow(derived.ir.value));

            if (emit === "contract") contractHash = hash;
            else assert.strictEqual(hash, contractHash);
          }
        }
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "builder and decorator prepasses agree with an explicit naming override",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const copied = yield* copyUsersFixture();

        for (const entry of ["operations.contract.builder.ts", "operations.contract.ts"]) {
          const file = path.join(copied, "src", entry);
          const source = yield* fs.readFileString(file);

          const explicit = source.replace(
            "registry: UserProblemResponses,",
            'registry: UserProblemResponses, identifier: "UsersContractGetProblem",',
          );

          assert.notStrictEqual(explicit, source);

          const config = {
            tsconfigPath: path.join(copied, "tsconfig.json"),
            entry: [`src/${entry}`],
          };

          yield* fs.writeFileString(file, explicit);
          const before = yield* compile(config, Extensions.builtin);
          yield* fs.writeFileString(file, source);

          const after = yield* compile(
            { ...config, naming: { problemIdentifier: "{Group}{Key}Problem" } },
            Extensions.builtin,
          );

          yield* same(before, after);
        }
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "records the resolved semantic policy in a fresh manifest and changes hash on policy mismatch",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const copied = yield* copyUsersFixture();

        const project = yield* resolveProject(
          path.join(copied, "tsconfig.json"),
          undefined,
          undefined,
          "all",
          undefined,
          undefined,
          false,
          "{Group}{Key}Problem",
        );

        const selected = {
          ...project,
          config: { ...project.config, entry: ["src/operations.contract.builder.ts"] },
        };

        yield* build(selected, {
          effx: "test",
          effect: "4.0.0",
          typescript: TsSourceFrontend.typescriptVersion,
        });

        const manifest = yield* Schema.decodeEffect(ManifestJson)(
          yield* fs.readFileString(path.join(project.effxDir, "manifest.json")),
        );

        assert.deepStrictEqual(manifest.naming, { problemIdentifier: "{Group}{Key}Problem" });

        const alternate = yield* compile(
          { ...selected.config, naming: { problemIdentifier: "Other{Key}Problem" } },
          Extensions.builtin,
        );

        assert.deepStrictEqual(errors(alternate), []);
        assert.notStrictEqual(
          yield* semanticHash(Option.getOrThrow(alternate.ir.value)),
          manifest.semanticHash,
        );
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "reports malformed tsconfig patterns as registered diagnostics and emits no files",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const copied = yield* copyUsersFixture();
        const configPath = path.join(copied, "tsconfig.json");
        const original = yield* fs.readFileString(configPath);
        yield* fs.writeFileString(
          configPath,
          original.replace(
            "{",
            '{ "effx": { "naming": { "problemIdentifier": "{Unknown}{Key}" } },',
          ),
        );

        const result = yield* compile(
          { tsconfigPath: configPath, entry: ["src/operations.contract.builder.ts"] },
          Extensions.builtin,
        );

        assert.deepStrictEqual(
          errors(result).map((d) => d.code),
          [HttpDiagnostics.EFFX2412.entry.code],
        );
        assert.isTrue(Option.isNone(result.files.value));
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );
});

describe("derived collision through the compiler", () => {
  it.effect(
    "rejects differing derived unions, accepts equal unions, and preserves an explicit shared override",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const copied = yield* copyUsersFixture();
        const file = path.join(copied, "src/operations.contract.builder.ts");
        const source = yield* fs.readFileString(file);

        const second = source
          .slice(source.indexOf("export const contractGet"))
          .replace("export const contractGet", "export const contractOther")
          .replace("User.ContractGet", "User.ContractOther")
          .replaceAll('group: "users"', 'group: "others"')
          .replace("users.contractGet", "others.contractGet")
          .replace('"/users/:id"', '"/others/:id"');

        const config = {
          tsconfigPath: path.join(copied, "tsconfig.json"),
          entry: ["src/operations.contract.builder.ts"],
          naming: { problemIdentifier: "{Key}Problem" },
        };

        yield* fs.writeFileString(file, source + second);
        const equal = yield* compile(config, Extensions.builtin);
        assert.deepStrictEqual(errors(equal), []);

        const different = second.replace(
          'codes: ["user.not-found"]',
          'codes: ["user.not-found", "user.unavailable"]',
        );

        yield* fs.writeFileString(file, source + different);
        const collision = yield* compile(config, Extensions.builtin);
        assert.deepStrictEqual(
          errors(collision).map((d) => d.code),
          [HttpDiagnostics.EFFX2413.entry.code],
        );
        assert.isTrue(Option.isNone(collision.files.value));
        yield* fs.writeFileString(
          file,
          source +
            different.replace(
              "registry: UserProblemResponses,",
              'registry: UserProblemResponses, identifier: "SharedProblem",',
            ),
        );
        const explicit = yield* compile(config, Extensions.builtin);
        assert.deepStrictEqual(errors(explicit), []);
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );
});
