import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { compile } from "@effx/compiler";
import type { CompilerFault, SourceFrontend } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { Cause, Effect, Exit, Fiber, FileSystem, Layer, Schema } from "effect";
import type { Crypto, Path, PlatformError } from "effect";
import { TestClock, TestConsole } from "effect/testing";
import { expectTypeOf } from "vitest";
import {
  copyUsersFixture,
  encodeJsonString,
  testDirectory,
} from "../../../tools/testing/projects.ts";
import { acquireBuildOutput, resolveProject } from "../src/commands.ts";
import { dev } from "../src/watch.ts";
import type { WatchClosed, WatchLimit } from "../src/watch-files.ts";

const platform = TsSourceFrontend.layer.pipe(Layer.provideMerge(BunServices.layer));

const versions = { effx: "test", effect: "4.0.0", typescript: "6.0.3" };

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown));

// Completion is the program's report, not elapsed time. The clock only drives
// native observation; a finite attempt bound fails if the report never arrives.
const awaitOutput = Effect.fnUntraced(function* (
  after: number,
  accepts: (text: string) => boolean,
) {
  for (let attempt = 0; attempt < 80; attempt++) {
    const lines = yield* TestConsole.logLines;
    const text = lines.slice(after).map(String).join("\n");

    if (accepts(text)) return { text, offset: lines.length };
    yield* TestClock.adjust("250 millis");
    yield* Effect.yieldNow;
  }

  assert.fail("Dev did not publish the expected report");
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
    expectTypeOf(value).not.toEqualTypeOf<Effect.Effect<void>>();
    expectTypeOf(value).toEqualTypeOf<
      Effect.Effect<
        void,
        CompilerFault | WatchLimit | WatchClosed | PlatformError.PlatformError,
        FileSystem.FileSystem | Path.Path | Crypto.Crypto | SourceFrontend
      >
    >();
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
          dev({ project: config, config: executable, emit }, versions),
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
      const worker = yield* Effect.forkScoped(dev({ project: config }, versions));
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
        dev({ project: config, config: executable }, versions),
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
        const worker = yield* Effect.forkScoped(dev({ project: config }, versions));
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
          dev({ project: config, outDir, build: true, emit: "all" }, versions),
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
          dev(
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
        dev({ project: config, config: executable }, versions),
      );

      const output = yield* awaitOutput(0, (text) => text.includes("RestartRequired"));
      assert.isFalse(output.text.includes("cycle 1"));
      yield* Fiber.interrupt(worker);
    }).pipe(Effect.scoped, Effect.provide(platform)),
  );

  it.effect("saved emit changes remove only manifest-owned obsolete generated files", () =>
    Effect.gen(function* () {
      const { fs, dir, config, selected } = yield* fixture();
      const worker = yield* Effect.forkScoped(dev({ project: config, build: true }, versions));
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
      const first = yield* Effect.forkScoped(dev({ project: config, build: true }, versions));
      yield* awaitOutput(0, (text) => text.includes("manifest"));
      const manifest = yield* fs.readFileString(dir + "/.effx/manifest.json");
      const second = yield* Effect.forkScoped(dev({ project: config, build: true }, versions));
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
          dev({ project: config, executableFiles: [covered] }, versions),
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
});
