import { copyRc116Fixture } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { ManifestJson, build, resolveProject } from "@effx/cli";
import { Extensions, compile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash } from "@effx/ir";
import effectPackage from "effect/package.json";
import cliPackage from "../../cli/package.json";
import { requireRc116FixtureDependencies } from "./rc116-fixture-dependencies.ts";

const fixtureRoot = new URL("./fixtures/rc116/", import.meta.url).pathname;

requireRc116FixtureDependencies(fixtureRoot);

const contractConfig = new URL(
  "./fixtures/rc116/project/contract/tsconfig.effx.json",
  import.meta.url,
).pathname;

const handlerConfig = new URL(
  "./fixtures/rc116/project/handlers/tsconfig.effx.json",
  import.meta.url,
).pathname;

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const fatal = (result: { readonly diagnostics: ReadonlyArray<{ readonly severity: string }> }) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const compileProfile = (tsconfigPath: string, emit: "contract" | "handlers") =>
  compile(
    {
      tsconfigPath,
      entry: ["../../src/profile.effx.ts"],
      emit,
      strictAccess: true,
    },
    Extensions.builtin,
  );

const directoryEntry = "../../src/directory-dense.effx.ts";

const verboseDirectoryEntry = "../../src/directory-verbose.effx.ts";

describe("isolated Effect rc.116 Directory group defaults", () => {
  it.effect(
    "preserves canonical IR, semantic hash, and generated contract/handler bytes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        for (const [config, mode] of [
          [contractConfig, "contract"],
          [handlerConfig, "handlers"],
        ] as const) {
          const dense = yield* compile(
            { tsconfigPath: config, entry: [directoryEntry], emit: mode, strictAccess: true },
            Extensions.builtin,
          );

          const verbose = yield* compile(
            {
              tsconfigPath: config,
              entry: [verboseDirectoryEntry],
              emit: mode,
              strictAccess: true,
            },
            Extensions.builtin,
          );

          assert.deepStrictEqual(fatal(dense), []);
          assert.deepStrictEqual(fatal(verbose), []);

          const denseIr = Option.getOrThrow(dense.ir.value);
          const verboseIr = Option.getOrThrow(verbose.ir.value);
          assert.strictEqual(canonical(denseIr), canonical(verboseIr));
          assert.strictEqual(yield* semanticHash(denseIr), yield* semanticHash(verboseIr));

          if (mode === "contract") {
            const group = denseIr.nodes.find((node) => node._tag === "HttpGroup");
            assert.isDefined(group);

            if (group?._tag !== "HttpGroup") return assert.fail("expected Directory group");
            assert.strictEqual(group.id, "group:external-native-api/directory");
            assert.deepStrictEqual(group.rootSymbol, {
              module: "../../src/directory-root",
              export: "ExternalDirectoryApi",
            });
            assert.deepStrictEqual(
              denseIr.nodes
                .filter((node) => node._tag === "Operation")
                .map((node) => node.name)
                .toSorted(),
              [
                "directory.amendSchool",
                "directory.executeSchoolCommand",
                "directory.listPeople",
                "directory.listSchools",
              ],
            );
          }

          const denseFiles = Option.getOrThrow(dense.files.value);
          const verboseFiles = Option.getOrThrow(verbose.files.value);
          assert.deepStrictEqual(denseFiles, verboseFiles);
          const filename = `directory-${mode}.ts`;
          assert.deepStrictEqual(
            denseFiles.map((file) => file.path),
            [filename],
          );
          const text = denseFiles[0]!.contents;

          if (mode === "contract") {
            for (const key of [
              "listPeople",
              "listSchools",
              "executeSchoolCommand",
              "amendSchool",
            ]) {
              assert.include(text, `identifier: "directory.${key}"`);
            }

            assert.include(text, "SchoolsDirectoryQuery");
            assert.include(text, "SchoolCommand");
            assert.include(text, "SchoolPatch");
            assert.include(text, "DirectoryProblemResponses");
          } else {
            assert.include(text, 'HttpApiBuilder.group(__effxRootApi, "directory"');
          }

          // This checked-in seed came from the pre-naming compiler; never hand-author it.
          const generated = path.join(path.dirname(config), ".effx", "generated");
          assert.strictEqual(yield* fs.readFileString(path.join(generated, filename)), text);
        }

        const decorated = yield* compile(
          { tsconfigPath: contractConfig, entry: ["../../src/directory-class.effx.ts"] },
          Extensions.builtin,
        );

        assert.deepStrictEqual(fatal(decorated), []);

        const classContract = Option.getOrThrow(decorated.ir.value).nodes.find(
          (node) => node._tag === "Extension" && node.tag === "HttpContract",
        );

        assert.isDefined(classContract);

        const expanded = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ root: Schema.String, group: Schema.String }),
        )(classContract?._tag === "Extension" ? classContract.data : undefined);

        assert.deepStrictEqual(expanded, { root: "external-native-api", group: "directory" });

        const builder = yield* compile(
          { tsconfigPath: contractConfig, entry: [directoryEntry] },
          Extensions.builtin,
        );

        const associated = Option.getOrThrow(decorated.collected.value).declarations.find(
          (declaration) => declaration.id === "DirectoryMethods.listSchools",
        );

        const builderSchool = Option.getOrThrow(builder.collected.value).declarations.find(
          (declaration) => declaration.id === "ListSchools",
        );

        assert.isDefined(associated);
        assert.isDefined(builderSchool);

        for (const annotation of ["Http.Contract", "Http.Problems", "Http.Access"]) {
          assert.deepStrictEqual(
            associated?.annotations.find((item) => item.name === annotation)?.args,
            builderSchool?.annotations.find((item) => item.name === annotation)?.args,
          );
        }
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "rejects double association, incompatible root/group, and query inference on POST",
    () =>
      Effect.gen(function* () {
        for (const [entry, code] of [
          ["directory-invalid-association.effx.ts", "EFFX2404"],
          ["directory-invalid-override.effx.ts", "EFFX2405"],
          ["directory-invalid-query.effx.ts", "EFFX2405"],
        ] as const) {
          const result = yield* compile(
            { tsconfigPath: contractConfig, entry: [`../../src/${entry}`], emit: "contract" },
            Extensions.builtin,
          );

          assert.include(
            result.diagnostics.map((diagnostic) => diagnostic.code),
            code,
          );

          if (entry === "directory-invalid-override.effx.ts") {
            assert.isAtLeast(
              result.diagnostics.filter((diagnostic) => diagnostic.code === code).length,
              2,
            );
          }

          assert.isTrue(Option.isNone(result.files.value), `${entry} emitted files`);
        }
      }).pipe(Effect.provide(Services)),
    120_000,
  );
});

describe("isolated Effect rc.116 Profile twin", () => {
  it.effect(
    "expands dense and verbose Profile to identical IR and generated bytes",
    () =>
      Effect.gen(function* () {
        for (const [config, mode] of [
          [contractConfig, "contract"],
          [handlerConfig, "handlers"],
        ] as const) {
          const dense = yield* compileProfile(config, mode);

          const verbose = yield* compile(
            {
              tsconfigPath: config,
              entry: ["../../src/profile-verbose.effx.ts"],
              emit: mode,
              strictAccess: true,
            },
            Extensions.builtin,
          );

          assert.deepStrictEqual(fatal(dense), []);
          assert.deepStrictEqual(fatal(verbose), []);
          const denseIr = Option.getOrThrow(dense.ir.value);
          const verboseIr = Option.getOrThrow(verbose.ir.value);
          assert.strictEqual(canonical(denseIr), canonical(verboseIr));
          assert.strictEqual(yield* semanticHash(denseIr), yield* semanticHash(verboseIr));
          assert.deepStrictEqual(
            Option.getOrThrow(dense.files.value),
            Option.getOrThrow(verbose.files.value),
          );
        }
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "emits the same declaration IR into separate contract/handler projects and typechecks both",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixtureRoot = yield* copyRc116Fixture();
        const contractConfig = path.join(fixtureRoot, "project", "contract", "tsconfig.effx.json");
        const handlerConfig = path.join(fixtureRoot, "project", "handlers", "tsconfig.effx.json");

        const seededContract = yield* fs.readFileString(
          path.join(
            fixtureRoot,
            "project",
            "contract",
            ".effx",
            "generated",
            "profile-contract.ts",
          ),
        );

        const contract = yield* compileProfile(contractConfig, "contract");
        const handlers = yield* compileProfile(handlerConfig, "handlers");

        assert.deepStrictEqual(fatal(contract), []);
        assert.deepStrictEqual(fatal(handlers), []);
        const collectedContract = Option.getOrThrow(contract.collected.value);
        const collectedHandlers = Option.getOrThrow(handlers.collected.value);
        assert.strictEqual(collectedContract.project?.target, "effect-4.0-rc");
        assert.strictEqual(collectedHandlers.project?.target, "effect-4.0-rc");
        assert.strictEqual(collectedContract.project?.allowImportingTsExtensions, false);
        assert.strictEqual(collectedHandlers.project?.allowImportingTsExtensions, false);
        assert.strictEqual(
          collectedContract.project?.canonicalImportBase,
          collectedHandlers.project?.canonicalImportBase,
        );
        assert.notStrictEqual(
          collectedContract.project?.outputDir,
          collectedHandlers.project?.outputDir,
        );
        assert.deepStrictEqual(
          collectedContract.declarations
            .filter((declaration) => declaration.binding === "external")
            .map((declaration) => declaration.id)
            .toSorted(),
          ["readOwnProfile", "updateOwnProfile"],
        );
        assert.isTrue(
          collectedContract.declarations
            .filter((declaration) => declaration.binding === "external")
            .every((declaration) => declaration.handlerSignature === undefined),
        );
        assert.deepStrictEqual(
          collectedContract.declarations.map((declaration) => declaration.annotations),
          collectedHandlers.declarations.map((declaration) => declaration.annotations),
        );

        const groupOptions = collectedContract.declarations
          .find((declaration) => declaration.id === "ProfileGroup")
          ?.annotations.find((annotation) => annotation.name === "Http.Group")?.args[0];

        const marker = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            defaults: Schema.Struct({
              middleware: Schema.Array(
                Schema.Struct({ security: Schema.optionalKey(Schema.Boolean) }),
              ),
            }),
          }),
        )(groupOptions);

        assert.strictEqual(marker.defaults.middleware[0]?.security, true);

        const contractIr = Option.getOrThrow(contract.ir.value);
        const handlerIr = Option.getOrThrow(handlers.ir.value);
        assert.strictEqual(canonical(contractIr), canonical(handlerIr));
        const expectedHash = yield* semanticHash(contractIr);
        assert.strictEqual(expectedHash, yield* semanticHash(handlerIr));
        const group = contractIr.nodes.find((node) => node._tag === "HttpGroup");
        assert.isDefined(group);

        if (group?._tag !== "HttpGroup") return assert.fail("expected the Profile group node");
        assert.strictEqual(group.id, "group:external-native-api/profile");
        assert.strictEqual(group.root, "external-native-api");
        assert.deepStrictEqual(group.rootSymbol, {
          module: "../../src/profile-root",
          export: "ExternalNativeApi",
        });
        assert.strictEqual(group.group, "profile");
        assert.strictEqual(group.title, "Profile");
        assert.strictEqual(group.description, "Authenticated self-service profile API.");
        assert.strictEqual(group.displayName, "Profile");
        const operations = contractIr.nodes.filter((node) => node._tag === "Operation");
        assert.deepStrictEqual(operations.map((operation) => operation.name).toSorted(), [
          "Profile.ReadOwnProfile",
          "Profile.UpdateOwnProfile",
        ]);
        assert.isTrue(operations.every((operation) => !Object.hasOwn(operation, "handler")));

        const contractFiles = Option.getOrThrow(contract.files.value);
        const handlerFiles = Option.getOrThrow(handlers.files.value);
        assert.deepStrictEqual(
          contractFiles.map((file) => file.path),
          ["profile-contract.ts"],
        );
        assert.deepStrictEqual(
          handlerFiles.map((file) => file.path),
          ["profile-handlers.ts"],
        );
        const contractText = contractFiles[0]!.contents;
        const handlerText = handlerFiles[0]!.contents;
        assert.strictEqual(seededContract, contractText);
        assert.include(contractText, 'HttpApiEndpoint.get("readOwnProfile", "/api/profile"');
        assert.include(contractText, 'HttpApiEndpoint.patch("updateOwnProfile", "/api/profile"');
        assert.include(contractText, 'identifier: "profile.readOwnProfile"');
        assert.include(contractText, 'identifier: "profile.updateOwnProfile"');
        assert.include(contractText, 'ProfileProblemResponses("ProfileReadOwnProfileProblem"');
        assert.include(contractText, 'ProfileProblemResponses("ProfileUpdateOwnProfileProblem"');
        assert.include(contractText, 'contentType: "application/merge-patch+json"');
        assert.include(contractText, "HttpApiSchema.status(200)");
        assert.include(contractText, "HttpApiSchema.status(304)");
        assert.include(contractText, "ProfileReadResponseHeaders");
        assert.include(contractText, "ProfileWriteResponseHeaders");
        assert.include(contractText, 'title: "Profile"');
        assert.include(contractText, 'description: "Authenticated self-service profile API."');
        assert.include(contractText, '"x-displayName": "Profile"');
        assert.include(contractText, "export const ProfileApi");
        assert.notInclude(contractText, "HttpApi.make(");
        assert.notInclude(contractText, "AppRoutes");
        assert.notInclude(contractText, "profile.effx");
        assert.notInclude(contractText, "@effx/runtime");
        assert.notInclude(contractText, "profile-root");
        assert.include(
          handlerText,
          'ExternalNativeApi as __effxRootApi } from "../../../../src/profile-root.js"',
        );
        assert.include(handlerText, 'HttpApiBuilder.group(__effxRootApi, "profile"');
        assert.include(handlerText, 'handleRaw("readOwnProfile"');
        assert.include(handlerText, 'handleRaw("updateOwnProfile"');
        assert.include(handlerText, 'guards["profile.readOwnProfile"]');
        assert.include(handlerText, 'guards["profile.updateOwnProfile"]');
        assert.include(handlerText, 'guards["profile.readOwnProfile"](input.request)');
        assert.include(handlerText, "R0 = unknown, R1 = unknown> = {");
        assert.include(handlerText, "  RawR0,\n  RawR1,\n>(");
        assert.include(
          handlerText,
          "ProfileGuardBindings<ProfileEndpoints, Authorization0, Authorization1>, RawR0, RawR1>",
        );
        assert.include(
          handlerText,
          'Effect.Services<ReturnType<Guards["profile.readOwnProfile"]>> | R0',
        );
        assert.include(
          handlerText,
          'Effect.Services<ReturnType<Guards["profile.updateOwnProfile"]>> | R1',
        );
        assert.notInclude(handlerText, "FixtureReadBackend");
        assert.notInclude(handlerText, "FixtureWriteBackend");
        assert.include(handlerText, "HttpApiBuilder.group(");
        assert.notInclude(handlerText, "handleAll(");
        assert.notInclude(handlerText, "AppRoutes");
        assert.notInclude(handlerText, "request.json");
        assert.notInclude(handlerText, "request.text");

        for (const file of [...contractFiles, ...handlerFiles]) {
          assert.notMatch(file.contents, /from "effect\/(?:http|http-api|rpc|cli|net|sql)"/);

          for (const [, moduleName] of file.contents.matchAll(/from "(\.[^"]+)"/g)) {
            assert.isTrue(
              moduleName?.endsWith(".js"),
              `relative import must target .js: ${moduleName}`,
            );
          }
        }

        assert.include(contractText, 'from "effect/unstable/httpapi"');
        assert.include(contractText, 'from "../../../../src/profile-support.js"');

        const versions = {
          effx: cliPackage.version,
          effect: effectPackage.version,
          typescript: TsSourceFrontend.typescriptVersion,
        };

        const contractProject = yield* resolveProject(contractConfig, true, undefined, "contract");
        const handlerProject = yield* resolveProject(handlerConfig, true, undefined, "handlers");
        yield* build(contractProject, versions);
        yield* build(handlerProject, versions);
        const contractEffx = path.join(path.dirname(contractConfig), ".effx");
        const handlerEffx = path.join(path.dirname(handlerConfig), ".effx");

        const readManifest = (directory: string) =>
          fs
            .readFileString(path.join(directory, "manifest.json"))
            .pipe(Effect.flatMap(Schema.decodeEffect(ManifestJson)));

        const contractManifest = yield* readManifest(contractEffx);
        const handlerManifest = yield* readManifest(handlerEffx);
        assert.strictEqual(contractManifest.emit, "contract");
        assert.strictEqual(handlerManifest.emit, "handlers");
        assert.deepStrictEqual(contractManifest.generated, ["generated/profile-contract.ts"]);
        assert.deepStrictEqual(handlerManifest.generated, ["generated/profile-handlers.ts"]);
        assert.strictEqual(contractManifest.semanticHash, handlerManifest.semanticHash);
        assert.strictEqual(contractManifest.semanticHash, expectedHash);
        assert.strictEqual(
          yield* fs.readFileString(path.join(contractEffx, "ir.json")),
          yield* fs.readFileString(path.join(handlerEffx, "ir.json")),
        );
        assert.deepStrictEqual(contractManifest.locations, handlerManifest.locations);
        assert.isTrue(
          Object.values(contractManifest.locations).every(
            (location) => location.file === "src/profile.effx.ts",
          ),
        );
        assert.strictEqual(
          yield* fs.readFileString(path.join(contractEffx, "generated", "profile-contract.ts")),
          contractText,
        );
        assert.strictEqual(
          yield* fs.readFileString(path.join(handlerEffx, "generated", "profile-handlers.ts")),
          handlerText,
        );

        const result = yield* Effect.sync(() => {
          const child = Bun.spawnSync(["bun", "run", "typecheck"], {
            cwd: fixtureRoot,
            stdout: "pipe",
            stderr: "pipe",
          });

          return {
            exitCode: child.exitCode,
            output: new TextDecoder().decode(child.stdout) + new TextDecoder().decode(child.stderr),
          };
        });

        assert.strictEqual(result.exitCode, 0, result.output);

        const openApiCheck = yield* Effect.sync(() => {
          const child = Bun.spawnSync(["bun", "test", "src/profile-openapi.spec.ts"], {
            cwd: fixtureRoot,
            stdout: "pipe",
            stderr: "pipe",
          });

          return {
            exitCode: child.exitCode,
            output: new TextDecoder().decode(child.stdout) + new TextDecoder().decode(child.stderr),
          };
        });

        assert.strictEqual(openApiCheck.exitCode, 0, openApiCheck.output);
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect("rejects invalid and duplicate endpoint keys before emitting files", () =>
    Effect.gen(function* () {
      const result = yield* compile(
        { tsconfigPath: contractConfig, entry: ["../../src/invalid-keys.effx.ts"] },
        Extensions.builtin,
      );

      assert.isAtLeast(
        result.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX2403").length,
        4,
      );
      assert.isTrue(Option.isNone(result.files.value));
    }).pipe(Effect.provide(Services)),
  );

  it.effect("defaults the problem schema ID from the key and rejects invalid overrides", () =>
    Effect.gen(function* () {
      const fallback = yield* compile(
        {
          tsconfigPath: contractConfig,
          entry: ["../../src/default-problem.effx.ts"],
          emit: "contract",
        },
        Extensions.builtin,
      );

      assert.deepStrictEqual(fatal(fallback), []);
      assert.include(
        Option.getOrThrow(fallback.files.value)[0]!.contents,
        'ProfileProblemResponses("readOwnProfileProblem"',
      );

      const invalid = yield* compile(
        { tsconfigPath: contractConfig, entry: ["../../src/invalid-problem-id.effx.ts"] },
        Extensions.builtin,
      );

      assert.isAtLeast(fatal(invalid).length, 2);
      assert.isTrue(Option.isNone(invalid.files.value));
    }).pipe(Effect.provide(Services)),
  );

  it.effect("rc security marker is required for a protected external declaration", () =>
    Effect.gen(function* () {
      const result = yield* compile(
        { tsconfigPath: contractConfig, entry: ["../../src/invalid-security.effx.ts"] },
        Extensions.builtin,
      );

      assert.include(
        result.diagnostics.map((diagnostic) => diagnostic.code),
        "EFFX2503",
      );
      assert.isTrue(Option.isNone(result.files.value));
    }).pipe(Effect.provide(Services)),
  );

  it.effect("rejects external RPC, mixed bindings, conflicting groups, and hidden symbols", () =>
    Effect.gen(function* () {
      for (const [entry, code] of [
        ["../../src/invalid-external-rpc.effx.ts", undefined],
        ["../../src/invalid-binding.effx.ts", undefined],
        ["../../src/invalid-group.effx.ts", undefined],
        ["../../src/invalid-symbol.effx.ts", "EFFX1102"],
      ] as const) {
        const result = yield* compile(
          { tsconfigPath: contractConfig, entry: [entry] },
          Extensions.builtin,
        );

        assert.isNotEmpty(fatal(result), `${entry} must not compile`);
        assert.isTrue(Option.isNone(result.files.value));

        if (code !== undefined)
          assert.include(
            result.diagnostics.map((diagnostic) => diagnostic.code),
            code,
          );
      }
    }).pipe(Effect.provide(Services)),
  );
});
