import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { CompilerFault } from "@effx/compiler";
import { Cause, Effect, Exit, FileSystem, Path } from "effect";
import { expectTypeOf } from "vitest";
import { encodeJsonString, testDirectory } from "../../../tools/testing/projects.ts";
import { rereadProject, resolveProject, type ResolveOptions } from "../src/commands.ts";
import { defineConfig } from "../src/config.ts";
import type { WatchInput } from "../src/watch-files.ts";

const fixture = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* testDirectory("config-watch-");
  const project = path.join(dir, "tsconfig.json");
  const config = path.join(dir, "effx.config.ts");
  const sentinel = path.join(dir, "imports.txt");
  yield* fs.writeFileString(project, '{"include":["app.ts"],"effx":{"emit":"handlers"}}');
  yield* fs.writeFileString(
    path.join(dir, "app.ts"),
    'throw new Error("application must not execute");',
  );
  const probe = `import { appendFileSync } from "node:fs"; appendFileSync(${yield* encodeJsonString(sentinel)}, "import\\n");`;

  return { fs, path, dir, project, config, sentinel, probe };
});

const select = (project: string, options: ResolveOptions, config?: string) =>
  resolveProject(project, undefined, undefined, undefined, config, undefined, false, options);

const platform = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(BunServices.layer));

describe("spec 0018 executable config epoch", () => {
  it("defineConfig preserves coverage identity and literal inference", () => {
    const value = {
      executableCoverage: {
        files: ["alias"],
        directories: [{ path: "plugins", recursive: false }],
      },
    } as const;

    assert.strictEqual(defineConfig(value), value);
    expectTypeOf(
      defineConfig(value).executableCoverage.directories[0].recursive,
    ).toEqualTypeOf<false>();
  });

  it.effect(
    "denies discovered config before its sentinel runs, but explicit selection grants authority",
    () =>
      platform(
        Effect.gen(function* () {
          const f = yield* fixture();
          yield* f.fs.writeFileString(f.config, `${f.probe} export default {};`);

          const denied = yield* select(f.project, { trustDiscoveredConfig: false }).pipe(
            Effect.flip,
          );

          assert.strictEqual(denied._tag, "CompilerFault");
          assert.include(denied.message, f.config);
          assert.include(denied.message, "--trust-config");
          assert.isFalse(yield* f.fs.exists(f.sentinel));
          yield* select(f.project, { trustDiscoveredConfig: false }, f.config);
          assert.strictEqual(yield* f.fs.readFileString(f.sentinel), "import\n");
          assert.isFalse(yield* f.fs.exists(f.path.join(f.dir, ".effx")));
        }),
      ),
  );

  it.effect(
    "registers candidate and launch paths before import and unions config-relative logical aliases",
    () =>
      platform(
        Effect.gen(function* () {
          const f = yield* fixture();
          yield* f.fs.writeFileString(
            f.config,
            `${f.probe} export default { executableCoverage: { files: ["alias-a", "alias-b", "alias-a"], directories: [{path:"plugins",recursive:false}] } };`,
          );
          let seen: ReadonlyArray<WatchInput> = [];

          const resolved = yield* select(f.project, {
            executableFiles: ["launch-alias", "launch-alias"],
            executableDirectories: ["launch-plugins"],
            beforeImport: Effect.fnUntraced(function* (
              file: string,
              inputs: ReadonlyArray<WatchInput>,
            ) {
              assert.strictEqual(file, f.config);
              assert.isFalse(
                yield* f.fs
                  .exists(f.sentinel)
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new CompilerFault({ stage: "collect", message: "probe failed", cause }),
                    ),
                  ),
              );
              seen = inputs;
            }),
          });

          assert.deepStrictEqual(seen, [
            { path: f.config, kind: "executable" },
            { path: f.path.resolve("launch-alias"), kind: "executable" },
            {
              path: f.path.resolve("launch-plugins"),
              kind: "executable",
              directory: true,
              recursive: true,
            },
          ]);
          assert.deepStrictEqual(resolved.executableCoverage, [
            ...seen,
            { path: f.path.join(f.dir, "alias-a"), kind: "executable" },
            { path: f.path.join(f.dir, "alias-b"), kind: "executable" },
            {
              path: f.path.join(f.dir, "plugins"),
              kind: "executable",
              directory: true,
              recursive: false,
            },
          ]);
          assert.isFalse("executableCoverage" in resolved.config);
        }),
      ),
  );

  it.effect("registers an absent candidate even when discovered execution is untrusted", () =>
    platform(
      Effect.gen(function* () {
        const f = yield* fixture();
        let called = false;

        const resolved = yield* select(f.project, {
          trustDiscoveredConfig: false,
          beforeImport: (file, inputs) =>
            Effect.sync(() => {
              called = true;
              assert.strictEqual(file, f.config);
              assert.deepStrictEqual(inputs, [{ path: f.config, kind: "executable" }]);
            }),
        });

        assert.isTrue(called);
        assert.strictEqual(resolved.configPath, f.config);
        assert.deepStrictEqual(resolved.executableCoverage, [
          { path: f.config, kind: "executable" },
        ]);
      }),
    ),
  );

  it.effect(
    "retains original discovery and config-relative project selection on JSON refresh",
    () =>
      platform(
        Effect.gen(function* () {
          const f = yield* fixture();
          const selected = f.path.join(f.dir, "selected", "tsconfig.json");
          yield* f.fs.makeDirectory(f.path.dirname(selected));
          yield* f.fs.writeFileString(selected, '{"effx":{"emit":"contract"}}');
          yield* f.fs.writeFileString(
            f.path.join(f.path.dirname(selected), "effx.config.ts"),
            'throw new Error("second discovery forbidden");',
          );
          yield* f.fs.writeFileString(
            f.config,
            f.probe + 'export default {project:"selected/tsconfig.json",outDir:"config-out"};',
          );
          const initial = yield* select(f.project, {});
          assert.strictEqual(initial.tsconfigPath, selected);
          assert.strictEqual(initial.config.outDir, f.path.join(f.dir, "config-out"));
          yield* f.fs.writeFileString(selected, '{"effx":{"emit":"all"}}');
          const refreshed = yield* rereadProject(initial);
          assert.strictEqual(refreshed.tsconfigPath, selected);
          assert.strictEqual(refreshed.configPath, f.config);
          assert.strictEqual(refreshed.config.emit, "all");
          assert.strictEqual(yield* f.fs.readFileString(f.sentinel), "import\n");
          assert.strictEqual(
            (yield* resolveProject(
              f.project,
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              true,
            )).tsconfigPath,
            f.project,
          );
        }),
      ),
  );

  it.effect.each([
    "{files:[1]}",
    '{directories:[{path:"x"}]}',
    '{directories:[{path:"x",recursive:"yes"}]}',
    '{files:"x"}',
  ])("rejects malformed executable coverage %# through CompilerFault", (coverage) =>
    platform(
      Effect.gen(function* () {
        const f = yield* fixture();
        yield* f.fs.writeFileString(
          f.config,
          `export default { executableCoverage: ${coverage} };`,
        );
        const fault = yield* select(f.project, {}).pipe(Effect.flip);
        assert.strictEqual(fault._tag, "CompilerFault");
        assert.include(fault.message, "invalid fields");
      }),
    ),
  );

  it.effect(
    "rereads saved JSON while keeping the executable import, extension callback and precedence fixed",
    () =>
      platform(
        Effect.gen(function* () {
          const f = yield* fixture();
          yield* f.fs.writeFileString(
            f.config,
            `${f.probe} export default { strictAccess:true, extensions:(builtin)=>{appendFileSync(${yield* encodeJsonString(f.sentinel)},"extensions\\n");return builtin;} };`,
          );

          const initial = yield* resolveProject(
            f.project,
            false,
            undefined,
            undefined,
            undefined,
            "cli-output",
            true,
          );

          assert.strictEqual(initial.config.emit, "handlers");
          yield* f.fs.writeFileString(
            f.project,
            '{"effx":{"emit":"contract","strictAccess":true,"projectRoot":"nested","outDir":"json-out"}}',
          );
          const refreshed = yield* rereadProject(initial);
          assert.strictEqual(refreshed.config.emit, "contract");
          assert.strictEqual(refreshed.config.strictAccess, false);
          assert.strictEqual(refreshed.config.outDir, f.path.resolve("cli-output"));
          assert.strictEqual(refreshed.config.projectRoot, f.path.join(f.dir, "nested"));
          assert.strictEqual(refreshed.extensions, initial.extensions);
          assert.strictEqual(refreshed.resolution, initial.resolution);
          assert.strictEqual(yield* f.fs.readFileString(f.sentinel), "import\nextensions\n");
          yield* f.fs.writeFileString(f.project, '{"effx":');
          const broken = yield* rereadProject(initial).pipe(Effect.flip);
          assert.strictEqual(broken._tag, "CompilerFault");
          yield* f.fs.writeFileString(f.project, '{"effx":{"emit":"all"}}');
          assert.strictEqual((yield* rereadProject(initial)).config.emit, "all");
          assert.strictEqual(yield* f.fs.readFileString(f.sentinel), "import\nextensions\n");
          assert.isFalse(yield* f.fs.exists(f.path.join(f.dir, ".effx")));
        }),
      ),
  );

  it.effect(
    "pre-import typed rejection and interruption prevent executable work; construction is lazy",
    () =>
      platform(
        Effect.gen(function* () {
          const f = yield* fixture();
          yield* f.fs.writeFileString(f.config, `${f.probe} export default {};`);
          let called = false;
          const fault = new CompilerFault({ stage: "collect", message: "admission rejected" });

          const operation = select(f.project, {
            beforeImport: () =>
              Effect.sync(() => {
                called = true;
              }).pipe(Effect.flatMap(() => Effect.fail(fault))),
          });

          assert.isFalse(called);
          assert.strictEqual(yield* operation.pipe(Effect.flip), fault);
          assert.isFalse(yield* f.fs.exists(f.sentinel));

          const interrupted = yield* select(f.project, {
            beforeImport: () => Effect.interrupt,
          }).pipe(Effect.exit);

          assert.isTrue(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause));
          assert.isFalse(yield* f.fs.exists(f.sentinel));
        }),
      ),
  );
});
