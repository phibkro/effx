import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { compile } from "@effx/compiler";
import type { CompilerFault, SourceFrontend } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { ApplicationIR } from "@effx/ir";
import {
  Cause,
  Console,
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Queue,
  Schema,
} from "effect";
import type { Crypto, Path, PlatformError } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import { expectTypeOf } from "vitest";
import {
  copyStableV4Fixture,
  copyUsersFixture,
  encodeJsonString,
  testDirectory,
} from "../../../tools/testing/projects.ts";
import { acquireBuildOutput, build, CheckFailed, resolveProject } from "../src/commands.ts";
import { dev } from "../src/watch.ts";
import type { WatchClosed, WatchLimit } from "../src/watch-files.ts";
import { acquireOutputOwner } from "../src/output-owner.ts";
import type { SessionClosed } from "../src/project-session.ts";
import type { ExecutableInventory } from "../src/config-runtime.ts";
import { executableInventoryLayer } from "../../../scripts/executable-cache.ts";

type DevExit = Exit.Exit<
  Effect.Success<ReturnType<typeof dev>>,
  Effect.Error<ReturnType<typeof dev>>
>;

class ReportReceipts extends Context.Service<
  ReportReceipts,
  {
    readonly console: Console.Console;
    readonly awaitWake: Effect.Effect<void>;
    readonly exit: Effect.Effect<Option.Option<DevExit>>;
    readonly noteExit: (exit: DevExit) => Effect.Effect<void>;
  }
>()("@effx/cli/test/watch/ReportReceipts") {
  static readonly layer = Layer.effect(
    ReportReceipts,
    Effect.gen(function* () {
      const actual = yield* Console.Console;
      const wake = yield* Queue.dropping<void>(1);
      let exit: Option.Option<DevExit> = Option.none();
      yield* Effect.addFinalizer(() => Queue.shutdown(wake).pipe(Effect.asVoid));

      return ReportReceipts.of({
        // Forward every real Console method. Only native log completion wakes the
        // consumer; one coalesced wake retains no report history or waiting producer.
        console: Object.assign(Object.create(actual), {
          log: (...args: ReadonlyArray<unknown>) => {
            actual.log(...args);
            Queue.offerUnsafe(wake, undefined);
          },
        }),
        awaitWake: Queue.take(wake),
        exit: Effect.sync(() => exit),
        noteExit: (completed) =>
          Effect.sync(() => {
            exit = Option.some(completed);
            Queue.offerUnsafe(wake, undefined);
          }),
      });
    }),
  );
}

const consoleReceipts = Layer.effect(
  Console.Console,
  ReportReceipts.pipe(Effect.map((receipts) => receipts.console)),
).pipe(Layer.provideMerge(ReportReceipts.layer));

const platform = TsSourceFrontend.layer.pipe(
  Layer.provideMerge(BunServices.layer),
  Layer.provideMerge(consoleReceipts),
  Layer.provideMerge(executableInventoryLayer),
);

const observeDev = Effect.fnUntraced(function* (...args: Parameters<typeof dev>) {
  const receipts = yield* ReportReceipts;

  return yield* dev(...args).pipe(Effect.onExit(receipts.noteExit));
});

const versions = { effx: "test", effect: "4.0.0", typescript: "6.0.3" };

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

const decodeIr = Schema.decodeEffect(Schema.fromJsonString(ApplicationIR));

// One controlled clock step admits a native observer pass after an edit. Receipt
// waiting then suspends for real IO/reporting; elapsed time never signals success.
const awaitOutput = Effect.fnUntraced(function* (
  after: number,
  accepts: (text: string) => boolean,
) {
  const receipts = yield* ReportReceipts;
  yield* TestClock.adjust("250 millis");

  while (true) {
    const lines = yield* TestConsole.logLines;
    const text = lines.slice(after).map(String).join("\n");

    if (accepts(text)) return { text, offset: lines.length };

    const exit = yield* receipts.exit;

    if (Option.isSome(exit)) {
      if (Exit.isFailure(exit.value)) return yield* Effect.failCause(exit.value.cause);

      assert.fail("Dev exited without publishing the expected report");
    }

    yield* receipts.awaitWake;
  }
});

const fixture = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* copyUsersFixture();
  const config = dir + "/tsconfig.json";
  const original = yield* fs.readFileString(config);
  // Narrow only the disposable copy, keeping real imports and declarations.
  const selected = original.replace('"src/**/*.ts"', '"src/operations.ts"');
  yield* fs.writeFileString(config, selected);
  const app = dir + "/src/operations.ts";
  yield* fs.writeFileString(
    app,
    (yield* fs.readFileString(app)) + '\nthrow new Error("application must never execute");\n',
  );

  return { fs, dir, config, selected };
});

const finished = (text: string) => /\d+ error\(s\), \d+ warning\(s\), \d+ info/.test(text);

describe("actual scoped effx dev journey", () => {
  it("constructs without resolving or executing the project and preserves requirements", () => {
    const value = dev({ project: "/never-read/tsconfig.json" }, versions);
    assert.isTrue(Effect.isEffect(value));
    expectTypeOf<Effect.Success<typeof value>>().toEqualTypeOf<undefined>();
    expectTypeOf<Effect.Success<typeof value>>().not.toEqualTypeOf<void>();
    expectTypeOf<Effect.Success<typeof value>>().not.toEqualTypeOf<never>();
    expectTypeOf<Effect.Error<typeof value>>().toEqualTypeOf<
      | CheckFailed
      | CompilerFault
      | WatchLimit
      | WatchClosed
      | SessionClosed
      | PlatformError.PlatformError
      | PlatformError.BadArgument
    >();
    expectTypeOf<Effect.Services<typeof value>>().toEqualTypeOf<
      FileSystem.FileSystem | Path.Path | Crypto.Crypto | SourceFrontend | ExecutableInventory
    >();
    expectTypeOf<Effect.Error<typeof value>>().not.toEqualTypeOf<never>();
    expectTypeOf<Effect.Services<typeof value>>().not.toEqualTypeOf<never>();
  });

  it.effect.each(["contract", "handlers", "all"] as const)(
    "keeps configured generator toggles and explicit %s emission check-only",
    (emit) =>
      Effect.gen(function* () {
        const { fs, dir, config } = yield* fixture();
        const executable = dir + "/effx.config.ts";
        yield* fs.writeFileString(
          executable,
          'export default { outDir: "custom", target: "effect-4.0", generators: { http: false, rpc: false, cli: false, client: false, foldkit: false } };',
        );

        const worker = yield* Effect.forkScoped(
          observeDev({ project: config, config: executable, emit }, versions),
        );

        const output = yield* awaitOutput(0, finished);
        const project = yield* resolveProject(config, undefined, undefined, emit, executable);
        const result = yield* compile(project.config, project.extensions);
        assert.isTrue(
          output.text.includes(
            `${result.diagnostics.filter((entry) => entry.severity === "error").length} error(s)`,
          ),
        );
        assert.isFalse(yield* fs.exists(dir + "/custom"));
        assert.isFalse(yield* fs.exists(dir + "/.effx"));
        yield* Fiber.interrupt(worker);
      }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect("reports edit/error/repair with full check diagnostics, writes nothing and stops", () =>
    Effect.gen(function* () {
      const { fs, dir, config } = yield* fixture();
      const app = dir + "/src/operations.ts";
      const original = yield* fs.readFileString(app);
      const worker = yield* Effect.forkScoped(observeDev({ project: config }, versions));
      let output = yield* awaitOutput(0, finished);
      const project = yield* resolveProject(config);
      const oneShot = yield* compile(project.config, project.extensions);
      assert.isTrue(
        output.text.includes(
          `${oneShot.diagnostics.filter((entry) => entry.severity === "error").length} error(s)`,
        ),
      );

      const broken = original.replace(
        '@Http.Get("/users/:id")',
        '@Http.Get("/users/:id")\n  @Http.Contract({ group: "users", payload: GetUserInput })',
      );

      yield* fs.writeFileString(app, broken);
      output = yield* awaitOutput(output.offset, finished);
      assert.isFalse(output.text.includes("0 error(s)"));
      const check = yield* compile(project.config, project.extensions);

      for (const diagnostic of check.diagnostics)
        assert.isTrue(output.text.includes(diagnostic.code));
      yield* fs.writeFileString(app, original);
      output = yield* awaitOutput(output.offset, finished);
      assert.isTrue(output.text.includes("0 error(s)"));
      assert.isTrue(output.text.includes("cycle 3"));
      assert.isFalse(yield* fs.exists(dir + "/.effx"));
      yield* Fiber.interrupt(worker);
      const exit = yield* Fiber.await(worker);
      assert.isTrue(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause));
      const stopped = yield* TestConsole.logLines;
      yield* fs.writeFileString(app, broken);
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual(yield* TestConsole.logLines, stopped);
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect("clears a malformed saved JSON cycle and repairs without reevaluating config", () =>
    Effect.gen(function* () {
      const { fs, dir, config, selected } = yield* fixture();
      const sentinel = dir + "/config-imports.txt";
      const executable = dir + "/effx.config.ts";
      yield* fs.writeFileString(
        executable,
        `import { appendFileSync } from "node:fs"; appendFileSync(${yield* encodeJsonString(sentinel)}, "import\\n"); export default {};`,
      );

      const worker = yield* Effect.forkScoped(
        observeDev({ project: config, config: executable }, versions),
      );

      let output = yield* awaitOutput(0, finished);
      yield* fs.writeFileString(config, "{ invalid");
      output = yield* awaitOutput(output.offset, (text) => text.includes("Diagnostics cleared"));
      assert.isTrue(output.text.includes("CompilerFault"));
      yield* fs.writeFileString(config, selected);
      output = yield* awaitOutput(output.offset, finished);
      assert.isTrue(output.text.includes("0 error(s)"));
      assert.strictEqual(yield* fs.readFileString(sentinel), "import\n");
      yield* Fiber.interrupt(worker);
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect.each(["rename", "delete", "include", "new-import"] as const)(
    "reconciles saved source membership %s",
    (change) =>
      Effect.gen(function* () {
        const { fs, dir, config, selected } = yield* fixture();
        const app = dir + "/src/operations.ts";
        const original = yield* fs.readFileString(app);
        const worker = yield* Effect.forkScoped(observeDev({ project: config }, versions));
        const initial = yield* awaitOutput(0, finished);

        if (change === "rename") {
          yield* fs.rename(app, dir + "/src/renamed.ts");
          yield* fs.writeFileString(
            config,
            selected.replace("src/operations.ts", "src/renamed.ts"),
          );
        } else if (change === "delete") {
          yield* fs.remove(app);
        } else if (change === "include") {
          yield* fs.writeFileString(
            config,
            selected.replace("src/operations.ts", "src/operations.contract-invalid.ts"),
          );
        } else {
          yield* fs.writeFileString(app, 'import "./new.ts";\n' + original);
          yield* fs.writeFileString(
            dir + "/src/new.ts",
            'import "./operations.contract-invalid.ts";',
          );
        }

        const changed = yield* awaitOutput(
          initial.offset,
          (text) => finished(text) || text.includes("Diagnostics cleared"),
        );

        assert.isTrue(changed.text.includes("cycle 2"));
        yield* Fiber.interrupt(worker);
      }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect(
    "writes the accepted result in custom output, preserves errors/sentinels and retains one writer",
    () =>
      Effect.gen(function* () {
        const { fs, dir, config } = yield* fixture();
        const outDir = dir + "/custom-output";
        yield* fs.makeDirectory(outDir);
        yield* fs.writeFileString(outDir + "/sentinel.ts", "untouched");
        const app = dir + "/src/operations.ts";
        const original = yield* fs.readFileString(app);

        const worker = yield* Effect.forkScoped(
          observeDev({ project: config, outDir, build: true, emit: "all" }, versions),
        );

        const initial = yield* awaitOutput(0, (text) => text.includes("manifest"));
        const manifest = yield* fs.readFileString(dir + "/.effx/manifest.json");
        yield* decodeJson(manifest);
        assert.isTrue((yield* fs.readDirectory(outDir)).length > 1);

        const project = yield* resolveProject(
          config,
          undefined,
          undefined,
          "all",
          undefined,
          outDir,
        );

        const accepted = yield* compile(project.config, project.extensions);
        const refused = yield* acquireBuildOutput(project, accepted).pipe(Effect.flip);
        assert.strictEqual(refused._tag, "OutputBusy");
        yield* fs.writeFileString(
          app,
          original.replace(
            '@Http.Get("/users/:id")',
            '@Http.Get("/users/:id")\n  @Http.Contract({ payload: GetUserInput })',
          ),
        );
        const failed = yield* awaitOutput(initial.offset, finished);
        assert.isFalse(failed.text.includes("0 error(s)"));
        assert.strictEqual(yield* fs.readFileString(dir + "/.effx/manifest.json"), manifest);
        assert.strictEqual(yield* fs.readFileString(outDir + "/sentinel.ts"), "untouched");
        yield* fs.writeFileString(app, original);
        yield* awaitOutput(failed.offset, (text) => text.includes("manifest"));
        yield* Fiber.interrupt(worker);
        assert.isFalse(yield* fs.exists(outDir + "/.effx-output-owner.lock"));
        assert.isFalse(yield* fs.exists(dir + "/.effx/.effx-output-owner.lock"));
        yield* acquireBuildOutput(project, accepted);
      }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect.each(["logical-alias", "static-package-alias", "computed-external", "config"] as const)(
    "requires exactly one restart for covered executable %s",
    (change) =>
      Effect.gen(function* () {
        const { fs, dir, config } = yield* fixture();
        const outside = yield* testDirectory("dev-executable-");
        const first = outside + "/first.ts";
        const second = outside + "/second.ts";
        const alias = dir + "/selected.ts";
        yield* fs.writeFileString(first, "export const selected = {};\n");
        yield* fs.writeFileString(second, "export const selected = {};\n");
        yield* fs.symlink(first, alias);
        const executable = dir + "/effx.config.ts";
        const declaration = change === "computed-external" ? first : alias;
        // This fixture exercises runtime-selected module loading, including the
        // static bare package route whose physical cache key cannot prove its alias.

        if (change === "static-package-alias") {
          const packageDirectory = outside + "/package";
          yield* fs.makeDirectory(packageDirectory);
          yield* fs.writeFileString(
            packageDirectory + "/package.json",
            '{"name":"dev-selected","type":"module","exports":"./selected.ts"}',
          );
          yield* fs.symlink(first, packageDirectory + "/selected.ts");
          yield* fs.makeDirectory(dir + "/node_modules");
          yield* fs.symlink(packageDirectory, dir + "/node_modules/dev-selected");
          yield* fs.writeFileString(
            executable,
            'import { selected } from "dev-selected"; export default selected;',
          );
        } else
          yield* fs.writeFileString(
            executable,
            `const location = ${yield* encodeJsonString(declaration)}; const loaded = await import(location); export default loaded.selected;`,
          );

        const worker = yield* Effect.forkScoped(
          observeDev(
            {
              project: config,
              config: executable,
              executableFiles: [
                alias,
                first,
                ...(change === "static-package-alias"
                  ? [
                      dir + "/node_modules/dev-selected/selected.ts",
                      dir + "/node_modules/dev-selected/package.json",
                    ]
                  : []),
              ],
            },
            versions,
          ),
        );

        const initial = yield* awaitOutput(0, finished);

        if (change === "static-package-alias") {
          yield* fs.remove(outside + "/package/selected.ts");
          yield* fs.symlink(second, outside + "/package/selected.ts");
        } else if (change === "logical-alias") {
          yield* fs.remove(alias);
          yield* fs.symlink(second, alias);
        } else if (change === "computed-external")
          yield* fs.writeFileString(first, "export const selected = { strictAccess: true };\n");
        else yield* fs.writeFileString(executable, "export default { strictAccess: true };\n");

        const restarted = yield* awaitOutput(initial.offset, (text) =>
          text.includes("RestartRequired"),
        );

        const app = dir + "/src/operations.ts";
        yield* fs.writeFileString(
          app,
          (yield* fs.readFileString(app)) + "\nexport const changed = true;\n",
        );
        yield* TestClock.adjust("1 second");

        const subsequent = (yield* TestConsole.logLines)
          .slice(initial.offset)
          .map(String)
          .join("\n");

        assert.strictEqual(subsequent.split("RestartRequired:").length - 1, 1);
        assert.isFalse(subsequent.includes("cycle 2"));
        assert.isTrue(restarted.text.includes("restart effx dev"));
        yield* Fiber.interrupt(worker);
      }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect("detects a real config import-window write before analysis admission", () =>
    Effect.gen(function* () {
      const { fs, dir, config } = yield* fixture();
      const executable = dir + "/effx.config.ts";
      yield* fs.writeFileString(
        executable,
        `import { writeFileSync } from "node:fs"; writeFileSync(${yield* encodeJsonString(executable)}, "export default {};"); export default {};`,
      );

      const worker = yield* Effect.forkScoped(
        observeDev({ project: config, config: executable }, versions),
      );

      const output = yield* awaitOutput(0, (text) => text.includes("RestartRequired"));
      assert.isFalse(output.text.includes("cycle 1"));
      yield* Fiber.interrupt(worker);
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect("saved emit changes remove only manifest-owned obsolete generated files", () =>
    Effect.gen(function* () {
      const { fs, dir, config, selected } = yield* fixture();

      const worker = yield* Effect.forkScoped(
        observeDev({ project: config, build: true }, versions),
      );

      const initial = yield* awaitOutput(0, (text) => text.includes("manifest"));
      const output = dir + "/.effx/generated";
      const before = yield* fs.readDirectory(output);
      yield* fs.writeFileString(output + "/sentinel.ts", "not owned");
      yield* fs.writeFileString(
        config,
        selected.replace('"include":', '"effx":{"emit":"handlers"},"include":'),
      );
      yield* awaitOutput(initial.offset, (text) => text.includes("manifest"));
      const after = yield* fs.readDirectory(output);
      assert.isTrue(before.some((file) => !after.includes(file)));
      assert.strictEqual(yield* fs.readFileString(output + "/sentinel.ts"), "not owned");
      yield* Fiber.interrupt(worker);
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect("a competing dev build terminates without changing the first owner artifacts", () =>
    Effect.gen(function* () {
      const { fs, dir, config } = yield* fixture();

      const first = yield* Effect.forkScoped(
        observeDev({ project: config, build: true }, versions),
      );

      yield* awaitOutput(0, (text) => text.includes("manifest"));
      const manifest = yield* fs.readFileString(dir + "/.effx/manifest.json");

      const second = yield* Effect.forkScoped(
        observeDev({ project: config, build: true }, versions),
      );

      const exit = yield* Fiber.await(second);
      assert.isTrue(Exit.isFailure(exit));

      if (Exit.isFailure(exit)) assert.isFalse(Cause.hasInterrupts(exit.cause));
      assert.strictEqual(yield* fs.readFileString(dir + "/.effx/manifest.json"), manifest);
      yield* Fiber.interrupt(first);
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect("rejects over-limit launch coverage before importing executable code", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* testDirectory("dev-limit-");
      const sentinel = dir + "/executed.txt";
      yield* fs.writeFileString(dir + "/tsconfig.json", '{"include":[]}');
      yield* fs.writeFileString(
        dir + "/effx.config.ts",
        `import { writeFileSync } from "node:fs"; writeFileSync(${yield* encodeJsonString(sentinel)}, "BAD"); export default {};`,
      );

      const rejected = yield* dev(
        {
          project: dir + "/tsconfig.json",
          executableFiles: Array.from({ length: 8193 }, (_, index) => dir + `/input-${index}.ts`),
        },
        versions,
      ).pipe(Effect.exit);

      assert.isTrue(Exit.isFailure(rejected));
      assert.isFalse(yield* fs.exists(sentinel));
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect(
    "a watcher file-limit failure terminates rather than pretending the session is healthy",
    () =>
      Effect.gen(function* () {
        const { fs, dir, config } = yield* fixture();
        const covered = dir + "/covered.ts";
        yield* fs.writeFileString(covered, "export const selected = true;");

        const worker = yield* Effect.forkScoped(
          observeDev({ project: config, executableFiles: [covered] }, versions),
        );

        yield* awaitOutput(0, finished);
        yield* fs.writeFileString(covered, "x".repeat(16 * 1024 * 1024 + 1));
        yield* TestClock.adjust("250 millis");

        const exit = yield* Fiber.await(worker);
        assert.isTrue(Exit.isFailure(exit));

        if (Exit.isFailure(exit)) assert.isFalse(Cause.hasInterrupts(exit.cause));

        assert.isFalse(yield* fs.exists(dir + "/.effx"));
      }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect.each(["after-first-artifact", "before-output-acquisition"] as const)(
    "supersession at %s preserves causal write admission and whole batches",
    (hold) =>
      Effect.gen(function* () {
        const { fs, dir, config } = yield* fixture();
        const project = yield* resolveProject(config);
        const accepted = yield* compile(project.config, project.extensions);
        const collected = Option.getOrThrow(accepted.collected.value);
        const files = Option.getOrThrow(accepted.files.value);
        assert.isAbove(files.length, 0);
        const firstArtifact = collected.project!.outputDir + "/" + files[0]!.path;
        const reached = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const writes: Array<{ file: string; text: string }> = [];
        let held = false;

        // This is an event tap on the real platform service, not a fake filesystem.
        // Every write reaches the native filesystem with its original arguments.
        const observedFs: FileSystem.FileSystem = {
          ...fs,
          writeFileString: Effect.fnUntraced(function* (
            ...args: Parameters<typeof fs.writeFileString>
          ) {
            const file = args[0];
            const admission = file.endsWith("/.effx-output-owner.lock");
            const artifact = file === firstArtifact;

            if (!held && hold === "before-output-acquisition" && admission) {
              held = true;
              yield* Deferred.succeed(reached, undefined);
              yield* Deferred.await(release);
            }

            yield* fs.writeFileString(...args);
            writes.push({ file, text: args[1] });

            if (!held && hold === "after-first-artifact" && artifact) {
              held = true;
              yield* Deferred.succeed(reached, undefined);
              yield* Deferred.await(release);
            }
          }),
        };

        yield* Effect.gen(function* () {
          const worker = yield* Effect.forkScoped(
            observeDev({ project: config, build: true }, versions).pipe(
              Effect.provideService(FileSystem.FileSystem, observedFs),
            ),
          );

          yield* Deferred.await(reached);
          const app = dir + "/src/operations.ts";
          yield* fs.writeFileString(
            app,
            (yield* fs.readFileString(app)).replace("User.Get", "User.AfterEdit"),
          );
          yield* TestClock.adjust("1 second");
          assert.isFalse(writes.some((entry) => entry.file.endsWith("/manifest.json")));

          yield* Deferred.succeed(release, undefined);
          yield* awaitOutput(
            0,
            (text) =>
              text.includes("cycle 2") &&
              text.split("/{ir.json, manifest.json, surface.json}").length - 1 ===
                (hold === "after-first-artifact" ? 2 : 1),
          );

          const manifests = writes.filter((entry) => entry.file.endsWith("/manifest.json"));
          const irWrites = writes.filter((entry) => entry.file.endsWith("/ir.json"));

          const snapshots = yield* Effect.forEach(irWrites, (entry) => decodeIr(entry.text));

          if (hold === "after-first-artifact") {
            assert.strictEqual(manifests.length, 2);
            assert.deepStrictEqual(snapshots[0], Option.getOrThrow(accepted.ir.value));
            assert.isTrue(writes.indexOf(manifests[0]!) < writes.indexOf(irWrites[1]!));
          } else {
            assert.strictEqual(manifests.length, 1);
            assert.strictEqual(irWrites.length, 1);
          }

          const latest = snapshots[snapshots.length - 1]!;

          const operation = latest.nodes.find(
            (node) => node._tag === "Operation" && node.name === "User.AfterEdit",
          );

          assert.isDefined(operation);
          assert.isTrue(
            latest.nodes.some(
              (node) =>
                node._tag === "Exposure" &&
                node.operation === operation!.id &&
                node.transport._tag === "rpc" &&
                node.transport.name === "User.Get",
            ),
          );
          const changedCheck = yield* compile(project.config, project.extensions);
          assert.deepStrictEqual(latest, Option.getOrThrow(changedCheck.ir.value));
          const changedFiles = Option.getOrThrow(changedCheck.files.value);
          const batches = hold === "after-first-artifact" ? [files, changedFiles] : [changedFiles];
          let previousManifest = -1;

          for (const [index, batch] of batches.entries()) {
            const manifest = writes.indexOf(manifests[index]!);

            const artifacts = writes
              .slice(previousManifest + 1, manifest)
              .filter(
                (entry) =>
                  entry.file.startsWith(collected.project!.outputDir + "/") &&
                  !entry.file.endsWith("/.effx-output-owner.lock"),
              );

            assert.deepStrictEqual(
              artifacts,
              batch.map((file) => ({
                file: collected.project!.outputDir + "/" + file.path,
                text: file.contents,
              })),
            );
            previousManifest = manifest;
          }

          yield* Fiber.interrupt(worker);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
      }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect.each(["direct", "physical-alias"] as const)(
    "rejects explicit selected source/output overlap through %s",
    (alias) =>
      Effect.gen(function* () {
        const { fs, dir, config, selected } = yield* fixture();
        const output = alias === "direct" ? dir + "/src" : dir + "/output-alias";

        if (alias === "physical-alias") yield* fs.symlink(dir + "/src", output);

        yield* fs.writeFileString(config, selected.replace('"include":', '"files":'));

        const worker = yield* Effect.forkScoped(
          observeDev({ project: config, outDir: output }, versions),
        );

        const exit = yield* Fiber.await(worker);
        assert.isTrue(Exit.isFailure(exit));

        if (Exit.isFailure(exit)) {
          const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
          assert.strictEqual(error._tag, "CompilerFault");

          if (error._tag === "CompilerFault")
            assert.isTrue(error.message.includes("Invalid selection"));
        }

        assert.isFalse((yield* TestConsole.logLines).map(String).some(finished));
      }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect(
    "saved outDir migration releases obsolete custody and resumes old-directory authored observation",
    () =>
      Effect.gen(function* () {
        const { fs, dir, config, selected } = yield* fixture();
        const oldOutput = dir + "/old-output";
        const newOutput = dir + "/new-output";

        const oldPolicy = selected.replace(
          '"include":',
          '"effx":{"outDir":"old-output"},"include":',
        );

        const newPolicy = selected.replace(
          '"include":',
          '"effx":{"outDir":"new-output"},"include":',
        );

        yield* fs.writeFileString(config, oldPolicy);

        const worker = yield* Effect.forkScoped(
          observeDev({ project: config, build: true }, versions),
        );

        const initial = yield* awaitOutput(0, (text) => text.includes("manifest"));
        yield* fs.writeFileString(config, newPolicy);

        const migrated = yield* awaitOutput(initial.offset, (text) =>
          text.includes("build cycle 2 complete"),
        );

        const settled = yield* TestConsole.logLines;
        yield* TestClock.adjust("1 second");
        assert.deepStrictEqual(yield* TestConsole.logLines, settled);

        assert.isTrue((yield* fs.readDirectory(newOutput)).length > 0);
        assert.isFalse(yield* fs.exists(oldOutput + "/.effx-output-owner.lock"));
        yield* Effect.scoped(
          acquireOutputOwner({ generatedDir: oldOutput, effxDir: dir + "/independent-metadata" }),
        );

        const project = yield* resolveProject(config);
        const result = yield* compile(project.config, project.extensions);
        const refused = yield* acquireBuildOutput(project, result).pipe(Effect.flip);
        assert.strictEqual(refused._tag, "OutputBusy");

        const authored = oldOutput + "/authored.ts";

        const schema =
          'import { Schema } from "effect"; export const GetUserInput = Schema.Struct({ id: Schema.String });';

        yield* fs.writeFileString(authored, schema);
        const app = dir + "/src/operations.ts";
        yield* fs.writeFileString(
          app,
          (yield* fs.readFileString(app))
            .replace(
              'import { ChangeEmailInput, GetUserInput } from "./schemas.ts";',
              'import { ChangeEmailInput } from "./schemas.ts"; import { GetUserInput } from "../old-output/authored.ts";',
            )
            .replace(
              '@Http.Get("/users/:id")',
              '@Http.Get("/users/:id")\n  @Http.Contract({ group: "users", params: GetUserInput, success: User.Public })',
            ),
        );
        // The existing selected operation consumes this helper. It is not a new
        // declaration root; imported invalid operations would not diagnose it.
        const includedCheck = yield* compile(project.config, project.extensions);
        assert.deepStrictEqual(
          includedCheck.diagnostics.filter((entry) => entry.severity === "error"),
          [],
        );
        const included = yield* awaitOutput(migrated.offset, (text) => text.includes("manifest"));
        const acceptedManifest = yield* fs.readFileString(dir + "/.effx/manifest.json");
        yield* fs.writeFileString(authored, schema.replace("{ id:", "{ other:"));
        const edited = yield* awaitOutput(included.offset, finished);
        const changedCheck = yield* compile(project.config, project.extensions);
        assert.isTrue(
          changedCheck.diagnostics.some(
            (entry) => entry.code === "EFFX2402" && entry.severity === "error",
          ),
        );

        for (const diagnostic of changedCheck.diagnostics)
          assert.isTrue(edited.text.includes(diagnostic.message));
        assert.strictEqual(
          yield* fs.readFileString(dir + "/.effx/manifest.json"),
          acceptedManifest,
        );
        yield* fs.writeFileString(authored, schema);
        const repaired = yield* awaitOutput(edited.offset, (text) => text.includes("manifest"));
        assert.isTrue(repaired.text.includes("0 error(s)"));
        yield* Fiber.interrupt(worker);
      }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect("handler dev observes another project's generated HTTP contract as input", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const copied = yield* copyStableV4Fixture();
      const contractConfig = copied + "/project/contract/tsconfig.effx.json";
      const handlerConfig = copied + "/project/handlers/tsconfig.effx.json";
      const handlerSource = copied + "/src/profile.effx.ts";
      const contractSource = copied + "/src/profile-contract.effx.ts";
      const generatedContract = copied + "/project/contract/.effx/generated/profile-contract.ts";
      const handlerManifest = copied + "/project/handlers/.effx/manifest.json";
      const handlerProjection = copied + "/project/handlers/.effx/generated/profile-handlers.ts";
      const sentinel = copied + "/application-executed.txt";
      const original = yield* fs.readFileString(handlerSource);

      // Keep handler declarations unchanged when the contract producer changes.
      // The copied native root imports project/contract/.effx/generated/ProfileApi.
      yield* fs.writeFileString(contractSource, original);
      yield* fs.writeFileString(
        contractConfig,
        (yield* fs.readFileString(contractConfig)).replace(
          "../../src/profile.effx.ts",
          "../../src/profile-contract.effx.ts",
        ),
      );
      const root = copied + "/src/profile-root.ts";

      const tripwire =
        '\nimport { writeFileSync } from "node:fs"; writeFileSync(' +
        (yield* encodeJsonString(sentinel)) +
        ', "application executed");\n';

      yield* fs.writeFileString(root, (yield* fs.readFileString(root)) + tripwire);
      const contract = yield* resolveProject(contractConfig, true, "effect-4.0", "contract");
      yield* build(contract, versions);
      const bootstrap = yield* fs.readFileString(generatedContract);
      const beforeWatch = (yield* TestConsole.logLines).length;

      const worker = yield* Effect.forkScoped(
        observeDev(
          {
            project: handlerConfig,
            target: "effect-4.0",
            emit: "handlers",
            strictAccess: true,
            build: true,
          },
          versions,
        ),
      );

      const initial = yield* awaitOutput(beforeWatch, (text) =>
        text.includes("build cycle 1 complete"),
      );

      assert.isTrue(initial.text.includes("0 error(s)"));
      // Imported own-output aliases are not declaration roots. They must remain
      // readable like direct own-output imports, without watching our write bytes.
      yield* fs.symlink(handlerProjection, copied + "/src/owned-handler-alias.ts");
      yield* fs.symlink(
        copied + "/project/handlers/.effx/generated",
        copied + "/src/owned-output-directory",
      );

      const handlerWithAliases =
        original +
        '\nimport "./owned-handler-alias.js";\nimport "./owned-output-directory/profile-handlers.js";\n';

      yield* fs.writeFileString(handlerSource, handlerWithAliases);

      const aliases = yield* awaitOutput(initial.offset, (text) => {
        const latest = text.slice(text.lastIndexOf("effx dev cycle "));

        return latest.includes("0 error(s)") && /effx dev build cycle \d+ complete/.test(latest);
      });

      assert.isFalse(aliases.text.includes("RestartRequired"));

      // Leaving owned output must remain observable through the logical route.
      yield* fs.remove(copied + "/src/owned-handler-alias.ts");
      yield* fs.symlink(generatedContract, copied + "/src/owned-handler-alias.ts");

      const retargeted = yield* awaitOutput(aliases.offset, (text) => {
        const latest = text.slice(text.lastIndexOf("effx dev cycle "));

        return latest.includes("0 error(s)") && /effx dev build cycle \d+ complete/.test(latest);
      });

      assert.isFalse(retargeted.text.includes("RestartRequired"));

      const acceptedManifest = yield* fs.readFileString(handlerManifest);
      const acceptedProjection = yield* fs.readFileString(handlerProjection);
      const quiet = yield* TestConsole.logLines;
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual(yield* TestConsole.logLines, quiet);

      // Produce a genuinely different group through the normal contract compiler,
      // not an edited output fixture or a replacement inventory implementation.
      yield* fs.writeFileString(
        contractSource,
        original.replace(
          'operationId: "profile.readOwnProfile"',
          'operationId: "profile.readChanged"',
        ),
      );
      const beforeChange = (yield* TestConsole.logLines).length;
      yield* build(contract, versions);
      assert.notStrictEqual(yield* fs.readFileString(generatedContract), bootstrap);
      const handler = yield* resolveProject(handlerConfig, true, "effect-4.0", "handlers");
      const changedCheck = yield* compile(handler.config, handler.extensions);
      assert.isTrue(
        changedCheck.diagnostics.some(
          (entry) => entry.code === "EFFX2415" && entry.severity === "error",
        ),
      );

      const changed = yield* awaitOutput(beforeChange, (text) => {
        const latest = text.slice(text.lastIndexOf("effx dev cycle "));

        return latest.includes("EFFX2415") && finished(latest);
      });

      for (const entry of changedCheck.diagnostics)
        assert.isTrue(changed.text.includes(entry.message));
      assert.isFalse(changed.text.includes("RestartRequired"));
      assert.strictEqual(yield* fs.readFileString(handlerSource), handlerWithAliases);
      assert.strictEqual(yield* fs.readFileString(handlerManifest), acceptedManifest);
      assert.strictEqual(yield* fs.readFileString(handlerProjection), acceptedProjection);

      yield* fs.writeFileString(contractSource, original);
      const beforeRepair = (yield* TestConsole.logLines).length;
      yield* build(contract, versions);

      const repaired = yield* awaitOutput(beforeRepair, (text) => {
        const latest = text.slice(text.lastIndexOf("effx dev cycle "));

        return latest.includes("0 error(s)") && /effx dev build cycle \d+ complete/.test(latest);
      });

      assert.isFalse(
        repaired.text.slice(repaired.text.lastIndexOf("effx dev cycle ")).includes("EFFX2415"),
      );
      assert.strictEqual(yield* fs.readFileString(handlerProjection), acceptedProjection);
      assert.isFalse(yield* fs.exists(sentinel));
      const repairedQuiet = yield* TestConsole.logLines;
      yield* TestClock.adjust("1 second");
      assert.deepStrictEqual(yield* TestConsole.logLines, repairedQuiet);
      yield* Fiber.interrupt(worker);
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect("saved referenced JSON faults clear the native dev cycle and repair normally", () =>
    Effect.gen(function* () {
      const { fs, dir, config, selected } = yield* fixture();
      const reference = dir + "/reference/tsconfig.json";
      const valid = '{"compilerOptions":{"composite":true},"files":["ref.ts"]}';
      yield* fs.makeDirectory(dir + "/reference");
      yield* fs.writeFileString(dir + "/reference/ref.ts", "export const reference = true;");
      yield* fs.writeFileString(reference, valid);
      yield* fs.writeFileString(
        config,
        selected.replace('"include":', '"references":[{"path":"./reference"}],"include":'),
      );

      const worker = yield* Effect.forkScoped(observeDev({ project: config }, versions));
      const initial = yield* awaitOutput(0, finished);
      assert.isTrue(initial.text.includes("0 error(s)"));
      yield* fs.writeFileString(reference, "{ invalid");

      const corrupt = yield* awaitOutput(initial.offset, (text) =>
        text.includes("Diagnostics cleared"),
      );

      assert.isTrue(corrupt.text.includes("CompilerFault"));
      const project = yield* resolveProject(config);
      const corruptCheck = yield* compile(project.config, project.extensions).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(corruptCheck));

      yield* fs.remove(reference);

      const missing = yield* awaitOutput(corrupt.offset, (text) =>
        text.includes("Diagnostics cleared"),
      );

      assert.isTrue(missing.text.includes("CompilerFault"));
      const missingCheck = yield* compile(project.config, project.extensions).pipe(Effect.exit);
      assert.isTrue(Exit.isFailure(missingCheck));

      yield* fs.writeFileString(reference, valid);

      const repaired = yield* awaitOutput(missing.offset, (text) => {
        const latest = text.slice(text.lastIndexOf("effx dev cycle "));

        return latest.includes("0 error(s)") && finished(latest);
      });

      assert.isFalse(repaired.text.includes("RestartRequired"));
      assert.isFalse(yield* fs.exists(dir + "/.effx"));
      yield* Fiber.interrupt(worker);
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect(
    "dev retains include-directory membership through identity probes without listing effect/dist",
    () =>
      Effect.gen(function* () {
        const { fs, dir, config, selected } = yield* fixture();
        const target = dir + "/src/members";
        const included = dir + "/watched-members";
        yield* fs.makeDirectory(target);
        yield* fs.symlink(target, included);
        yield* fs.writeFileString(
          config,
          selected.replace('"src/operations.ts"', '"src/operations.ts", "watched-members/**/*.ts"'),
        );
        const listed: Array<string> = [];

        const observedFs: FileSystem.FileSystem = {
          ...fs,
          readDirectory: Effect.fnUntraced(function* (
            ...args: Parameters<typeof fs.readDirectory>
          ) {
            listed.push(args[0]);

            return yield* fs.readDirectory(...args);
          }),
        };

        const worker = yield* Effect.forkScoped(
          observeDev({ project: config }, versions).pipe(
            Effect.provideService(FileSystem.FileSystem, observedFs),
          ),
        );

        const initial = yield* awaitOutput(0, finished);
        assert.isTrue(initial.text.includes("0 error(s)"));
        assert.isFalse(listed.some((directory) => directory.endsWith("/effect/dist")));

        // Native includes enumerate this symlinked directory. Subsequent realpath
        // and existence observations must not downgrade that enumeration authority.
        yield* fs.writeFileString(target + "/first.ts", "export const first = true;");
        const first = yield* awaitOutput(initial.offset, finished);
        assert.isTrue(first.text.includes("0 error(s)"));
        assert.isTrue(first.text.includes("cycle 2"));
        yield* fs.writeFileString(target + "/second.ts", "export const second = true;");
        const second = yield* awaitOutput(first.offset, finished);
        assert.isTrue(second.text.includes("0 error(s)"));
        assert.isTrue(second.text.includes("cycle 3"));
        assert.isFalse(listed.some((directory) => directory.endsWith("/effect/dist")));
        assert.isFalse(yield* fs.exists(dir + "/.effx"));
        yield* Fiber.interrupt(worker);
      }).pipe(Effect.scoped, Effect.provide(platform)),
  );
});
