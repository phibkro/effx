import { copyUsersFixture } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { type ProjectConfig, Extensions, SourceFrontend, compile } from "@effx/compiler";
import { canonical, semanticHash } from "@effx/ir";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { loadProject, readTsconfigEffx, targetProfileFromVersion } from "../src/project.ts";

const tsconfigPath = new URL("./fixtures/users/tsconfig.json", import.meta.url).pathname;

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const encodePackagePin = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      devDependencies: Schema.Struct({ typescript: Schema.String }),
    }),
  ),
);

describe("frontend target project", () => {
  it("recognizes only supported installed Effect profiles", () => {
    assert.strictEqual(targetProfileFromVersion("4.0.0"), "effect-4.0");
    assert.strictEqual(targetProfileFromVersion("4.0.0-rc.116"), "effect-4.0-rc");
    assert.isUndefined(targetProfileFromVersion("3.19.0"));
    assert.isUndefined(targetProfileFromVersion("4.0.1"));
    assert.isUndefined(targetProfileFromVersion("4.0.0-beta.1"));
  });
  it.effect.each([
    ["6.9.0", "info"],
    ["7.0.2", "warning"],
  ] as const)("preserves TypeScript skew message and severity for pin %s", ([pin, severity]) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* copyUsersFixture();
      yield* fs.writeFileString(
        path.join(fixtureRoot, "package.json"),
        yield* encodePackagePin({ devDependencies: { typescript: pin } }),
      );

      const project = yield* loadProject({
        tsconfigPath: path.join(fixtureRoot, "tsconfig.json"),
        entry: ["src/operations.ts"],
      });

      assert.deepStrictEqual(
        project.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX0001"),
        [
          {
            code: "EFFX0001",
            severity,
            message: `effx analyses with TypeScript ${TsSourceFrontend.typescriptVersion} but the project pins typescript ${pin}; tsc/tsgo remains the authoritative type gate`,
          },
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect(
    "resolves its installed Effect, inherited extension policy, and explicit override",
    () =>
      Effect.gen(function* () {
        const inferred = yield* loadProject({ tsconfigPath, entry: ["src/operations.ts"] });
        assert.strictEqual(inferred.resolution?.target, "effect-4.0");
        assert.strictEqual(inferred.resolution?.emit, "all");
        assert.strictEqual(inferred.resolution?.allowImportingTsExtensions, true);
        assert.deepStrictEqual(
          inferred.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX2701"),
          [],
        );
        assert.isTrue(inferred.resolveEffectModule?.("effect/Schema"));
        assert.isTrue(inferred.resolveEffectModule?.("effect/sql/SqlError"));
        assert.isFalse(inferred.resolveEffectModule?.("effect/sql/NotReal"));
        assert.isFalse(inferred.resolveEffectModule?.("effect/not-a-module"));

        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixtureRoot = yield* copyUsersFixture();
        const directory = yield* fs.makeTempDirectoryScoped({ directory: fixtureRoot });
        const inheritedOnly = path.join(directory, "tsconfig.inherited.json");
        yield* fs.writeFileString(
          inheritedOnly,
          '{"extends":"../tsconfig.json","effx":{"projectRoot":".."}}',
        );

        const inherited = yield* loadProject({
          tsconfigPath: inheritedOnly,
          entry: ["../src/operations.ts"],
        });

        assert.strictEqual(inherited.resolution?.allowImportingTsExtensions, true);
        assert.strictEqual(inherited.rootDir, path.resolve(fixtureRoot));
        const inheritedConfig = path.join(directory, "tsconfig.effx.json");
        yield* fs.writeFileString(
          inheritedConfig,
          '{"extends":"../tsconfig.json","compilerOptions":{"allowImportingTsExtensions":false},"effx":{"projectRoot":"../wrong-root"}}',
        );

        const explicit = yield* loadProject({
          tsconfigPath: inheritedConfig,
          projectRoot: "..",
          entry: ["../src/operations.ts"],
          target: "effect-4.0-rc",
          emit: "handlers",
        });

        assert.strictEqual(explicit.resolution?.target, "effect-4.0-rc");
        assert.strictEqual(explicit.resolution?.allowImportingTsExtensions, false);
        assert.strictEqual(explicit.resolution?.emit, "handlers");
        assert.strictEqual(explicit.rootDir, path.resolve(fixtureRoot));
        assert.strictEqual(
          explicit.resolution?.canonicalImportBase,
          path.join(path.resolve(fixtureRoot), ".effx", "generated"),
        );
        assert.strictEqual(
          explicit.resolution?.outputDir,
          path.join(directory, ".effx", "generated"),
        );
        assert.deepStrictEqual(explicit.rootNames, [
          path.join(fixtureRoot, "src", "operations.ts"),
        ]);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect("keeps canonical IR and hash independent of output directory and mode", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* copyUsersFixture();
      const workspace = yield* fs.makeTempDirectoryScoped({ directory: fixtureRoot });
      const contractDir = path.join(workspace, "contract");
      const handlerDir = path.join(workspace, "handlers");
      yield* fs.makeDirectory(contractDir);
      yield* fs.makeDirectory(handlerDir);

      const configText = '{"extends":"../../tsconfig.json","effx":{"projectRoot":"../.."}}';

      yield* fs.writeFileString(path.join(contractDir, "tsconfig.effx.json"), configText);
      yield* fs.writeFileString(path.join(handlerDir, "tsconfig.effx.json"), configText);
      const common: Pick<ProjectConfig, "entry"> = { entry: ["../../src/operations.ts"] };

      const contract = yield* compile(
        { ...common, tsconfigPath: path.join(contractDir, "tsconfig.effx.json"), emit: "contract" },
        Extensions.builtin,
      );

      const handlers = yield* compile(
        { ...common, tsconfigPath: path.join(handlerDir, "tsconfig.effx.json"), emit: "handlers" },
        Extensions.builtin,
      );

      assert.isTrue(
        Option.getOrThrow(contract.collected.value).resolveEffectModule?.("effect/Schema"),
      );

      assert.strictEqual(
        canonical(Option.getOrThrow(contract.ir.value)),
        canonical(Option.getOrThrow(handlers.ir.value)),
      );
      assert.strictEqual(
        yield* semanticHash(Option.getOrThrow(contract.ir.value)),
        yield* semanticHash(Option.getOrThrow(handlers.ir.value)),
      );
      assert.notStrictEqual(
        Option.getOrThrow(contract.collected.value).project?.outputDir,
        Option.getOrThrow(handlers.collected.value).project?.outputDir,
      );
      assert.deepStrictEqual(
        Option.getOrThrow(contract.collected.value).declarations,
        Option.getOrThrow(handlers.collected.value).declarations,
      );
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("chooses the tsconfig project's Effect rather than the first source project's", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const workspace = yield* fs.makeTempDirectoryScoped();
      const source = path.join(workspace, "source");
      const target = path.join(workspace, "target");
      const absent = path.join(workspace, "absent");
      const sourcePackage = path.join(source, "node_modules", "effect");
      const targetPackage = path.join(target, "node_modules", "effect");
      yield* fs.makeDirectory(path.join(source, "src"), { recursive: true });
      yield* fs.makeDirectory(sourcePackage, { recursive: true });
      yield* fs.makeDirectory(path.join(sourcePackage, "dist"));
      yield* fs.writeFileString(
        path.join(sourcePackage, "dist", "Schema.d.ts"),
        "export declare const marker: unique symbol;\n",
      );
      yield* fs.makeDirectory(targetPackage, { recursive: true });
      yield* fs.makeDirectory(absent);
      yield* fs.writeFileString(path.join(source, "src", "entry.ts"), "export const entry = 1;\n");
      yield* fs.writeFileString(
        path.join(sourcePackage, "package.json"),
        '{"name":"effect","version":"4.0.0-rc.116","exports":{"./package.json":"./package.json","./*":"./dist/*.js"}}',
      );
      yield* fs.writeFileString(
        path.join(targetPackage, "package.json"),
        '{"name":"effect","version":"4.0.0","exports":{"./package.json":"./package.json"}}',
      );

      const config =
        '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler","noEmit":true},"files":["../source/src/entry.ts"]}';

      const targetConfig = path.join(target, "tsconfig.json");
      const absentConfig = path.join(absent, "tsconfig.json");
      yield* fs.writeFileString(targetConfig, config);
      yield* fs.writeFileString(absentConfig, config);
      const sourceConfig = path.join(source, "tsconfig.json");
      yield* fs.writeFileString(
        sourceConfig,
        '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler","noEmit":true},"files":["src/entry.ts"]}',
      );
      const sibling = yield* loadProject({ tsconfigPath: sourceConfig });
      assert.strictEqual(sibling.resolution?.target, "effect-4.0-rc");
      assert.isTrue(sibling.resolveEffectModule?.("effect/Schema"));

      const installed = yield* loadProject({ tsconfigPath: targetConfig });
      assert.deepStrictEqual(installed.rootNames, [path.join(source, "src", "entry.ts")]);
      assert.strictEqual(installed.resolution?.target, "effect-4.0");
      assert.isFalse(installed.diagnostics.some((diagnostic) => diagnostic.code === "EFFX2701"));
      assert.isFalse(installed.resolveEffectModule?.("effect/Schema"));

      const missing = yield* loadProject({ tsconfigPath: absentConfig });
      assert.isUndefined(missing.resolution);
      assert.isTrue(
        missing.diagnostics.some(
          (diagnostic) =>
            diagnostic.code === "EFFX2701" &&
            diagnostic.message.includes(absent) &&
            !diagnostic.message.includes(source),
        ),
      );
      assert.deepStrictEqual(
        missing.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX1106"),
        [
          {
            code: "EFFX1106",
            severity: "warning",
            message: `@effx/runtime is not resolvable from ${path.join(source, "src", "entry.ts")}; no effx declarations can be recognised`,
          },
        ],
      );
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect("reports EFFX2701 with tsconfig location for a missing or unsupported package", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const missingDir = yield* fs.makeTempDirectoryScoped();
      const sourceDir = path.join(missingDir, "src");
      yield* fs.makeDirectory(sourceDir);
      yield* fs.writeFileString(path.join(sourceDir, "entry.ts"), "export const sentinel = 1;\n");
      const configFile = path.join(missingDir, "tsconfig.json");
      yield* fs.writeFileString(
        configFile,
        '{"compilerOptions":{"module":"ESNext","moduleResolution":"bundler","noEmit":true},"include":["src/*.ts"]}',
      );

      const missing = yield* SourceFrontend.use((frontend) =>
        frontend.analyze({ tsconfigPath: configFile }),
      );

      const absence = missing.diagnostics.find((diagnostic) => diagnostic.code === "EFFX2701");
      assert.deepStrictEqual(absence?.location, { file: configFile, line: 1, col: 1 });
      assert.isUndefined(missing.project);

      const explicitMissing = yield* compile(
        { tsconfigPath: configFile, target: "effect-4.0-rc" },
        Extensions.builtin,
      );

      const explicitAbsence = explicitMissing.diagnostics.find(
        (diagnostic) => diagnostic.code === "EFFX2701",
      );

      assert.deepStrictEqual(explicitAbsence?.location, { file: configFile, line: 1, col: 1 });
      assert.isTrue(explicitAbsence?.message.includes("effect/package.json is not resolvable"));
      assert.isUndefined(Option.getOrThrow(explicitMissing.collected.value).project);
      assert.isTrue(Option.isNone(explicitMissing.files.value));

      const packageDir = path.join(missingDir, "node_modules", "effect");
      yield* fs.makeDirectory(packageDir, { recursive: true });
      yield* fs.writeFileString(
        path.join(packageDir, "package.json"),
        '{"name":"effect","version":"3.0.0","exports":{"./package.json":"./package.json"}}',
      );
      const unsupported = yield* loadProject({ tsconfigPath: configFile });
      assert.isTrue(
        unsupported.diagnostics.some(
          (diagnostic) => diagnostic.code === "EFFX2701" && diagnostic.message.includes("3.0.0"),
        ),
      );
      assert.isUndefined(unsupported.resolution);

      const override = yield* loadProject({ tsconfigPath: configFile, target: "effect-4.0-rc" });
      assert.strictEqual(override.resolution?.target, "effect-4.0-rc");
      assert.isFalse(override.diagnostics.some((diagnostic) => diagnostic.code === "EFFX2701"));
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
  it.effect("validates tsconfig effx fields and preserves direct compile overrides", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* copyUsersFixture();
      const dir = yield* fs.makeTempDirectoryScoped({ directory: fixtureRoot });
      const file = path.join(dir, "tsconfig.effx.json");
      yield* fs.writeFileString(
        file,
        '{"extends":"../tsconfig.json","include":["../src/operations.ts"],"effx":{"projectRoot":"..","outDir":"generated-other","emit":"contract","target":"effect-4.0-rc","strictAccess":true}}',
      );
      const settings = yield* readTsconfigEffx(file);
      assert.strictEqual(settings?.emit, "contract");
      assert.strictEqual(settings?.strictAccess, true);
      const direct = yield* loadProject({ tsconfigPath: file });
      assert.strictEqual(direct.rootDir, fixtureRoot.replace(/\/$/, ""));
      assert.strictEqual(direct.resolution?.outputDir, path.join(dir, "generated-other"));
      assert.strictEqual(direct.resolution?.emit, "contract");
      assert.strictEqual(direct.resolution?.target, "effect-4.0-rc");
      assert.strictEqual(direct.resolution?.strictAccess, true);
      const strict = yield* compile({ tsconfigPath: file }, Extensions.builtin);
      assert.isTrue(
        strict.diagnostics.some((d) => d.code === "EFFX2504" && d.severity === "error"),
      );

      const overridden = yield* compile(
        { tsconfigPath: file, strictAccess: false },
        Extensions.builtin,
      );

      assert.isTrue(
        overridden.diagnostics.some((d) => d.code === "EFFX2504" && d.severity === "warning"),
      );
      assert.isFalse(
        overridden.diagnostics.some((d) => d.code === "EFFX2504" && d.severity === "error"),
      );
      yield* fs.writeFileString(
        file,
        '{"extends":"../tsconfig.json","effx":{"strictAccess":"yes"}}',
      );
      const invalid = yield* Effect.flip(readTsconfigEffx(file));
      assert.strictEqual(invalid._tag, "CompilerFault");
      const fallback = yield* loadProject({ tsconfigPath: file });
      assert.isTrue(fallback.diagnostics.some((d) => d.code === "EFFX2701"));
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
