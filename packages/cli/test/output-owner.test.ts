import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import {
  Crypto,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Path,
  Scope,
} from "effect";
import type { PlatformError } from "effect/PlatformError";
import { expectTypeOf } from "vitest";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { canonical } from "@effx/ir";
import { compile, CompilerFault, SourceFrontend } from "@effx/compiler";
import {
  copyUsersFixture,
  encodeJsonString,
  testDirectory,
} from "../../../tools/testing/projects.ts";
import { subprocess } from "../../persistence/test/process.ts";
import {
  acquireBuildOutput,
  migrateBuildOutput,
  rereadProject,
  build,
  check,
  failOnErrors,
  resolveProject,
  writeCompileResult,
} from "../src/commands.ts";
import {
  acquireOutputOwner,
  assertOutputOwner,
  migrateOutputOwner,
  OutputBusy,
  type OutputOwner,
  type OutputResources,
} from "../src/output-owner.ts";

const root = new URL("../../../", import.meta.url).pathname;

const ownerModule = new URL("../src/output-owner.ts", import.meta.url).pathname;

const lockName = ".effx-output-owner.lock";

const frontend = TsSourceFrontend.layer.pipe(Layer.provideMerge(BunServices.layer));

const versions = { effx: "test", effect: "4.0.0", typescript: "6" };

const resourcesAt = (directory: string): OutputResources => ({
  generatedDir: directory + "/.effx/generated",
  effxDir: directory + "/.effx",
});

// Native child-process adapter already owns termination and output backpressure.
// The test process holds the first lease; a distinct Bun process attempts the same
// resource. Completion is witnessed by child exit, never a timed sleep.
const competingProcess = Effect.fnUntraced(function* (resources: OutputResources) {
  const code = `
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { acquireOutputOwner } from ${yield* encodeJsonString(ownerModule)};
BunRuntime.runMain(Effect.scoped(acquireOutputOwner({
  generatedDir: ${yield* encodeJsonString(resources.generatedDir)},
  effxDir: ${yield* encodeJsonString(resources.effxDir)}
})).pipe(Effect.andThen(Console.log("ADMITTED")),
Effect.catchTag("OutputBusy", () => Console.log("REFUSED")), Effect.provide(BunServices.layer)));
`;

  return yield* subprocess(["bun", "-e", code], root);
});

const artifactBytes = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const output = directory + "/.effx";
  const generated = (yield* fs.readDirectory(output + "/generated")).sort();

  const files = [
    "ir.json",
    "manifest.json",
    "surface.json",
    ...generated.map((file) => "generated/" + file),
  ];

  const contents: Record<string, string> = {};

  for (const file of files) contents[file] = yield* fs.readFileString(output + "/" + file);

  return contents;
});

describe("normal build result writer and cross-process custody", () => {
  it.effect("construction is lazy and keeps all custody channels", () =>
    Effect.sync(() => {
      const discarded = acquireOutputOwner(resourcesAt("/not-created-by-construction"));
      assert.isTrue(Effect.isEffect(discarded));
      expectTypeOf(discarded).toEqualTypeOf<
        Effect.Effect<
          OutputOwner,
          OutputBusy | PlatformError,
          FileSystem.FileSystem | Path.Path | Crypto.Crypto | Scope.Scope
        >
      >();
    }),
  );

  it.effect("exact shared output, metadata, and symlink aliases refuse before use", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* testDirectory("owner-alias-");
      const resources = resourcesAt(directory);
      const owner = yield* acquireOutputOwner(resources);
      yield* fs.symlink(directory + "/.effx", directory + "/alias");

      const aliases = {
        generatedDir: directory + "/alias/generated",
        effxDir: directory + "/alias",
      };

      yield* assertOutputOwner(owner, aliases);

      for (const competitor of [
        aliases,
        { generatedDir: resources.generatedDir, effxDir: directory + "/other" },
        { generatedDir: directory + "/different", effxDir: resources.effxDir },
      ]) {
        const error = yield* Effect.flip(Effect.scoped(acquireOutputOwner(competitor)));
        assert.strictEqual(error._tag, "OutputBusy");
      }

      yield* assertOutputOwner(owner, resources);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect("new output suffixes resolve through physical symlink parents", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* testDirectory("owner-new-");
      yield* fs.makeDirectory(directory + "/physical");
      yield* fs.symlink(directory + "/physical", directory + "/logical");

      const resources = {
        generatedDir: directory + "/logical/new/generated",
        effxDir: directory + "/logical/new",
      };

      const owner = yield* acquireOutputOwner(resources);
      assert.include(owner.resources, directory + "/physical/new/generated");
      yield* assertOutputOwner(owner, {
        generatedDir: directory + "/physical/new/generated",
        effxDir: directory + "/physical/new",
      });
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect("scope success, failure, and interruption release custody", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* testDirectory("owner-release-");
      const resources = resourcesAt(directory);
      yield* Effect.scoped(acquireOutputOwner(resources));
      assert.isFalse(yield* fs.exists(resources.effxDir + "/" + lockName));

      const failure = yield* Effect.exit(
        Effect.scoped(
          acquireOutputOwner(resources).pipe(
            Effect.andThen(
              Effect.fail(new OutputBusy({ resource: directory, message: "test failure" })),
            ),
          ),
        ),
      );

      assert.isTrue(Exit.isFailure(failure));
      assert.isFalse(yield* fs.exists(resources.generatedDir + "/" + lockName));
      const admitted = yield* Deferred.make<void>();

      const fiber = yield* Effect.forkChild(
        Effect.scoped(
          Effect.gen(function* () {
            yield* acquireOutputOwner(resources);
            yield* Deferred.succeed(admitted, undefined);

            return yield* Effect.never;
          }),
        ),
      );

      yield* Deferred.await(admitted);
      yield* Fiber.interrupt(fiber);
      assert.isTrue(Exit.isFailure(yield* Fiber.await(fiber)));
      yield* Effect.scoped(acquireOutputOwner(resources));
      assert.isFalse(yield* fs.exists(resources.effxDir + "/" + lockName));
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect("failed set acquisition rolls back earlier locks and never removes another token", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* testDirectory("owner-token-");
      const resources = { generatedDir: directory + "/a", effxDir: directory + "/z" };
      yield* fs.makeDirectory(resources.effxDir);
      yield* fs.writeFileString(resources.effxDir + "/" + lockName, "other-owner");
      const error = yield* Effect.flip(acquireOutputOwner(resources));
      assert.strictEqual(error._tag, "OutputBusy");
      assert.isFalse(yield* fs.exists(resources.generatedDir + "/" + lockName));
      assert.strictEqual(
        yield* fs.readFileString(resources.effxDir + "/" + lockName),
        "other-owner",
      );
      const other = resourcesAt(directory + "/owned");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const owner = yield* acquireOutputOwner(other);
          yield* fs.writeFileString(other.effxDir + "/" + lockName, "replacement-owner");
          assert.strictEqual(
            (yield* Effect.flip(assertOutputOwner(owner, other)))._tag,
            "OutputBusy",
          );
        }),
      );
      assert.strictEqual(
        yield* fs.readFileString(other.effxDir + "/" + lockName),
        "replacement-owner",
      );
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.live("actual second process refuses canonical aliases, then acquires after release", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* testDirectory("owner-process-");
      const resources = resourcesAt(directory);
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* acquireOutputOwner(resources);
          yield* fs.symlink(directory + "/.effx", directory + "/alias");

          const competitor = yield* competingProcess({
            generatedDir: directory + "/alias/generated",
            effxDir: directory + "/alias",
          });

          assert.strictEqual(competitor.code, 0, competitor.text);
          assert.include(competitor.text, "REFUSED");
          assert.notInclude(competitor.text, "ADMITTED");
        }),
      );
      const admitted = yield* competingProcess(resources);
      assert.strictEqual(admitted.code, 0, admitted.text);
      assert.include(admitted.text, "ADMITTED");
      assert.isFalse(yield* fs.exists(resources.effxDir + "/" + lockName));
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect("manifest file aliases share custody even before their target exists", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* testDirectory("owner-manifest-");
      yield* fs.makeDirectory(directory + "/one");
      yield* fs.makeDirectory(directory + "/two");
      yield* fs.makeDirectory(directory + "/metadata");
      yield* fs.symlink(directory + "/metadata/manifest.json", directory + "/one/manifest.json");
      yield* fs.symlink(directory + "/metadata/manifest.json", directory + "/two/manifest.json");
      const first = { generatedDir: directory + "/output-one", effxDir: directory + "/one" };
      yield* acquireOutputOwner(first);

      const error = yield* Effect.flip(
        Effect.scoped(
          acquireOutputOwner({
            generatedDir: directory + "/output-two",
            effxDir: directory + "/two",
          }),
        ),
      );

      assert.strictEqual(error._tag, "OutputBusy");
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.live("copied fixture writer preserves normal bytes without recompiling accepted result", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* copyUsersFixture();
      // Select the known-good input, not the fixture's deliberate broken declaration.
      yield* fs.writeFileString(
        directory + "/tsconfig.writer.json",
        '{ "extends": "./tsconfig.json", "include": ["src/operations.ts"] }',
      );
      const project = yield* resolveProject(directory + "/tsconfig.writer.json");
      yield* check(project);
      assert.isFalse(yield* fs.exists(project.effxDir));
      const accepted = yield* failOnErrors(yield* compile(project.config, project.extensions));
      yield* build(project, versions);
      const normal = yield* artifactBytes(directory);
      const owner = yield* acquireBuildOutput(project, accepted);

      const competitor = yield* subprocess(
        ["bun", root + "packages/cli/src/main.ts", "build", "--project", project.tsconfigPath],
        root,
      );

      assert.notStrictEqual(competitor.code, 0, competitor.text);
      assert.include(competitor.text, "already owned");
      assert.deepStrictEqual(yield* artifactBytes(directory), normal);
      // A disk change after admission would change a second compilation. The writer
      // must keep the already-accepted in-memory result and its exact generated bytes.
      yield* fs.writeFileString(directory + "/src/operations.ts", "export const changed = true;\n");
      yield* writeCompileResult(project, versions, accepted, owner);
      assert.deepStrictEqual(yield* artifactBytes(directory), normal);
      assert.strictEqual(normal["ir.json"], canonical(Option.getOrThrow(accepted.ir.value)) + "\n");

      for (const file of Option.getOrThrow(accepted.files.value))
        assert.strictEqual(normal["generated/" + file.path], file.contents);
      const bytes = yield* artifactBytes(directory);

      const invalid = {
        ...accepted,
        diagnostics: [
          ...accepted.diagnostics,
          { code: "EFFX0001", severity: "error" as const, message: "rejected cycle" },
        ],
      };

      assert.strictEqual(
        (yield* Effect.flip(writeCompileResult(project, versions, invalid, owner)))._tag,
        "CheckFailed",
      );
      assert.deepStrictEqual(yield* artifactBytes(directory), bytes);
      const files = Option.getOrThrow(accepted.files.value);
      assert.isAbove(files.length, 0);
      yield* fs.writeFileString(project.effxDir + "/generated/unrelated.ts", "user-owned\n");

      const fewerFiles = {
        ...accepted,
        files: { ...accepted.files, value: Option.some(files.slice(1)) },
      };

      yield* writeCompileResult(project, versions, fewerFiles, owner);
      assert.isFalse(yield* fs.exists(project.effxDir + "/generated/" + files[0]!.path));
      assert.strictEqual(
        yield* fs.readFileString(project.effxDir + "/generated/unrelated.ts"),
        "user-owned\n",
      );
    }).pipe(Effect.scoped, Effect.provide(frontend)),
  );

  it.live(
    "migration holds old, new aliases and metadata through callback then retires only old",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* testDirectory("owner-migrate-process-");
        const old = resourcesAt(directory);
        const target = { ...old, generatedDir: directory + "/.effx/next" };
        const owner = yield* acquireOutputOwner(old);
        let finished = false;

        const migrated = yield* migrateOutputOwner(owner, target, (union) =>
          Effect.gen(function* () {
            yield* fs.symlink(target.generatedDir, directory + "/new-alias");
            yield* assertOutputOwner(union, old);
            yield* assertOutputOwner(union, target);

            for (const competing of [
              { generatedDir: old.generatedDir, effxDir: directory + "/competitor-old" },
              { generatedDir: directory + "/new-alias", effxDir: directory + "/competitor-new" },
              { generatedDir: directory + "/competitor-output", effxDir: old.effxDir },
            ]) {
              const result = yield* competingProcess(competing);
              assert.strictEqual(result.code, 0, result.text);
              assert.include(result.text, "REFUSED");
            }

            finished = true;

            return 42;
          }),
        );

        assert.isTrue(finished);
        assert.strictEqual(migrated.value, 42);
        assert.strictEqual(migrated.owner.resources.length, 2);
        assert.deepStrictEqual(migrated.owner.generatedDirs, [target.generatedDir]);
        yield* assertOutputOwner(migrated.owner, target);

        const released = yield* competingProcess({
          generatedDir: old.generatedDir,
          effxDir: directory + "/independent",
        });

        assert.include(released.text, "ADMITTED");
        assert.isFalse(yield* fs.exists(old.generatedDir + "/" + lockName));
        assert.isTrue(yield* fs.exists(target.generatedDir + "/" + lockName));
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect(
    "failed, defective and interrupted migrations retain old custody and roll back new",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* testDirectory("owner-migrate-failure-");
        const old = resourcesAt(directory);
        const target = { ...old, generatedDir: directory + "/.effx/new" };
        const owner = yield* acquireOutputOwner(old);

        const discardedMigration = migrateOutputOwner(owner, target, () =>
          Effect.service(SourceFrontend).pipe(
            Effect.andThen(
              Effect.fail(new CompilerFault({ stage: "generate", message: "typed callback" })),
            ),
          ),
        );

        expectTypeOf(discardedMigration).toEqualTypeOf<
          Effect.Effect<
            { readonly owner: OutputOwner; readonly value: never },
            CompilerFault | OutputBusy | PlatformError,
            SourceFrontend | FileSystem.FileSystem | Path.Path | Crypto.Crypto | Scope.Scope
          >
        >();
        assert.isFalse(yield* fs.exists(target.generatedDir));
        yield* Effect.scoped(
          Effect.gen(function* () {
            yield* acquireOutputOwner({ ...target, effxDir: directory + "/competitor" });
            let invoked = false;

            const refused = yield* Effect.flip(
              migrateOutputOwner(owner, target, () =>
                Effect.sync(() => {
                  invoked = true;
                }),
              ),
            );

            assert.strictEqual(refused._tag, "OutputBusy");
            assert.isFalse(invoked);
            yield* assertOutputOwner(owner, old);
          }),
        );

        const failure = yield* Effect.flip(
          migrateOutputOwner(owner, target, () =>
            Effect.fail(new OutputBusy({ resource: target.generatedDir, message: "batch failed" })),
          ),
        );

        assert.strictEqual(failure.message, "batch failed");
        yield* assertOutputOwner(owner, old);
        assert.isFalse(yield* fs.exists(target.generatedDir + "/" + lockName));

        const defect = yield* Effect.exit(
          migrateOutputOwner(owner, target, () => Effect.die("batch defect")),
        );

        assert.isTrue(Exit.isFailure(defect));
        yield* assertOutputOwner(owner, old);
        assert.isFalse(yield* fs.exists(target.generatedDir + "/" + lockName));
        const admitted = yield* Deferred.make<void>();

        const fiber = yield* Effect.forkChild(
          migrateOutputOwner(owner, target, () =>
            Effect.gen(function* () {
              yield* Deferred.succeed(admitted, undefined);

              return yield* Effect.never;
            }),
          ),
        );

        yield* Deferred.await(admitted);
        yield* Fiber.interrupt(fiber);
        assert.isTrue(Exit.isFailure(yield* Fiber.await(fiber)));
        yield* assertOutputOwner(owner, old);
        assert.isFalse(yield* fs.exists(target.generatedDir + "/" + lockName));
        const sessionScope = yield* Scope.Scope;
        const before = sessionScope.state;

        assert.strictEqual(before._tag, "Open");
        const initialFinalizers = before._tag === "Open" ? (before.finalizers?.size ?? 1) : 0;
        let current = owner;

        for (let index = 0; index < 8; index++) {
          const next = { ...old, generatedDir: directory + "/.effx/epoch-" + index };
          const migrated = yield* migrateOutputOwner(current, next, () => Effect.void);
          current = migrated.owner;
          assert.strictEqual(current.resources.length, 2);
          assert.strictEqual(current.generatedDirs.length, 1);
          yield* assertOutputOwner(current, next);
        }

        const after = sessionScope.state;
        assert.strictEqual(after._tag, "Open");
        assert.strictEqual(
          after._tag === "Open" ? (after.finalizers?.size ?? 1) : 0,
          initialFinalizers,
        );
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect("copied fixture migration prunes only held old manifest files after admission", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const directory = yield* copyUsersFixture();
      const config = directory + "/tsconfig.writer.json";
      yield* fs.writeFileString(
        config,
        '{ "extends": "./tsconfig.json", "include": ["src/operations.ts"] }',
      );
      const oldProject = yield* resolveProject(config);

      const accepted = yield* failOnErrors(
        yield* compile(oldProject.config, oldProject.extensions),
      );

      const owner = yield* acquireBuildOutput(oldProject, accepted);
      yield* writeCompileResult(oldProject, versions, accepted, owner);
      const oldFiles = Option.getOrThrow(accepted.files.value);
      yield* fs.writeFileString(oldProject.effxDir + "/generated/unrelated.ts", "user-owned\n");
      yield* fs.writeFileString(
        config,
        '{ "extends": "./tsconfig.json", "include": ["src/operations.ts"], "effx": { "outDir": ".effx/next" } }',
      );
      const project = yield* rereadProject(oldProject);
      const next = yield* failOnErrors(yield* compile(project.config, project.extensions));

      const migrated = yield* migrateBuildOutput(project, next, owner, (union) =>
        Effect.gen(function* () {
          yield* assertOutputOwner(union, resourcesAt(directory));
          assert.isTrue(yield* fs.exists(oldProject.effxDir + "/generated/" + oldFiles[0]!.path));
          yield* writeCompileResult(project, versions, next, union);
          assert.isTrue(yield* fs.exists(oldProject.effxDir + "/generated/" + lockName));
        }),
      );

      assert.isFalse(yield* fs.exists(oldProject.effxDir + "/generated/" + lockName));
      assert.strictEqual(
        yield* fs.readFileString(oldProject.effxDir + "/generated/unrelated.ts"),
        "user-owned\n",
      );

      for (const file of oldFiles)
        assert.isFalse(yield* fs.exists(oldProject.effxDir + "/generated/" + file.path));

      for (const file of Option.getOrThrow(next.files.value))
        assert.strictEqual(
          yield* fs.readFileString(oldProject.effxDir + "/next/" + file.path),
          file.contents,
        );
      yield* assertOutputOwner(migrated.owner, {
        generatedDir: oldProject.effxDir + "/next",
        effxDir: oldProject.effxDir,
      });
      yield* fs.symlink(oldProject.effxDir + "/next", oldProject.effxDir + "/alias");
      yield* fs.writeFileString(
        config,
        '{ "extends": "./tsconfig.json", "include": ["src/operations.ts"], "effx": { "outDir": ".effx/alias" } }',
      );
      const aliasProject = yield* rereadProject(project);

      const aliasResult = yield* failOnErrors(
        yield* compile(aliasProject.config, aliasProject.extensions),
      );

      const samePhysical = yield* migrateBuildOutput(
        aliasProject,
        aliasResult,
        migrated.owner,
        (union) => writeCompileResult(aliasProject, versions, aliasResult, union),
      );

      assert.strictEqual(samePhysical.owner.resources.length, 2);

      for (const file of Option.getOrThrow(aliasResult.files.value)) {
        assert.strictEqual(
          yield* fs.readFileString(oldProject.effxDir + "/next/" + file.path),
          file.contents,
        );
      }
    }).pipe(Effect.scoped, Effect.provide(frontend)),
  );

  it.effect.each(["new-output", ".effx/new-output"])(
    "retiring custom output stays intact while migration to %s writes normally",
    (destination) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* copyUsersFixture();
        const config = directory + "/tsconfig.writer.json";
        yield* fs.writeFileString(
          config,
          '{ "extends": "./tsconfig.json", "include": ["src/operations.ts"], "effx": { "outDir": "old-output" } }',
        );
        const oldProject = yield* resolveProject(config);

        const accepted = yield* failOnErrors(
          yield* compile(oldProject.config, oldProject.extensions),
        );

        const owner = yield* acquireBuildOutput(oldProject, accepted);
        yield* writeCompileResult(oldProject, versions, accepted, owner);
        const oldFiles = Option.getOrThrow(accepted.files.value);
        const oldManifest = yield* fs.readFileString(oldProject.effxDir + "/manifest.json");
        yield* fs.writeFileString(directory + "/old-output/unrelated.ts", "user-owned\n");

        const fewer = {
          ...accepted,
          files: { ...accepted.files, value: Option.some(oldFiles.slice(1)) },
        };

        const refused = yield* Effect.flip(writeCompileResult(oldProject, versions, fewer, owner));
        assert.strictEqual(refused._tag, "CompilerFault");
        assert.strictEqual(
          yield* fs.readFileString(oldProject.effxDir + "/manifest.json"),
          oldManifest,
        );
        yield* fs.writeFileString(
          config,
          '{ "extends": "./tsconfig.json", "include": ["src/operations.ts"], "effx": { "outDir": "' +
            destination +
            '" } }',
        );
        const project = yield* rereadProject(oldProject);

        const next = yield* failOnErrors(yield* compile(project.config, project.extensions));

        const migrated = yield* migrateBuildOutput(project, next, owner, (union) =>
          Effect.gen(function* () {
            yield* writeCompileResult(project, versions, next, union);
            assert.isTrue(yield* fs.exists(directory + "/old-output/" + lockName));
          }),
        );

        for (const file of oldFiles)
          assert.strictEqual(
            yield* fs.readFileString(directory + "/old-output/" + file.path),
            file.contents,
          );
        assert.strictEqual(
          yield* fs.readFileString(directory + "/old-output/unrelated.ts"),
          "user-owned\n",
        );
        assert.isFalse(yield* fs.exists(directory + "/old-output/" + lockName));

        for (const file of Option.getOrThrow(next.files.value))
          assert.strictEqual(
            yield* fs.readFileString(directory + "/" + destination + "/" + file.path),
            file.contents,
          );
        assert.notStrictEqual(
          yield* fs.readFileString(project.effxDir + "/manifest.json"),
          oldManifest,
        );
        yield* assertOutputOwner(migrated.owner, {
          generatedDir: directory + "/" + destination,
          effxDir: project.effxDir,
        });
      }).pipe(Effect.scoped, Effect.provide(frontend)),
  );
});
