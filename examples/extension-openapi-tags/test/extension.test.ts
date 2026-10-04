import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { expectTypeOf } from "vitest";
import { Extensions, compile, type CompilerFault, type GeneratedFile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { IRGraph, Node, StableId, canonical, decodeString, make, semanticHash } from "@effx/ir";
import { deprecatedExtension, deprecatedWarningCode } from "../deprecated-extension.ts";

const example = new URL("../", import.meta.url).pathname;

const examples = new URL("../../", import.meta.url).pathname;

const cli = new URL("../../../packages/cli/src/main.ts", import.meta.url).pathname;

const frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const services = Layer.mergeAll(frontend, BunServices.layer);

const extensions = [...Extensions.builtin, deprecatedExtension];

const operationId = StableId.make("operation", "Example.Lookup");

const extensionId = StableId.make("ext", "Example.Lookup/deprecated");

const errors = (diagnostics: ReadonlyArray<{ readonly severity: string }>) =>
  diagnostics.filter((diagnostic) => diagnostic.severity === "error");

/** The authored handler has a different SymbolRef for class method and builder value. */
const withoutHandlerIdentity = (ir: Parameters<typeof canonical>[0]) =>
  make(
    ir.nodes.map((node) =>
      node._tag === "Operation"
        ? {
            ...node,
            handler: {
              module: "./src/operations",
              export: "DeprecatedOperations",
              member: "lookup",
            },
          }
        : node,
    ),
    ir.edges,
  );

/** Real CLI process, with an isolated copy at the same depth as this workspace example. */
const withIsolatedExample = <A, E, R>(use: (directory: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const directory = yield* fs.makeTempDirectoryScoped({
      directory: examples,
      prefix: ".extension-test-",
    });

    for (const filename of [
      "package.json",
      "tsconfig.json",
      "effx.config.ts",
      "deprecated-extension.ts",
    ])
      yield* fs.copyFile(path.join(example, filename), path.join(directory, filename));
    yield* fs.copy(path.join(example, "src"), path.join(directory, "src"));
    yield* fs.makeDirectory(path.join(directory, "test"));
    yield* fs.copyFile(
      path.join(example, "test", "import-trap.ts"),
      path.join(directory, "test", "import-trap.ts"),
    );

    return yield* use(directory);
  }).pipe(Effect.scoped);

const runCli = (directory: string, command: "check" | "build") =>
  Effect.sync(() => {
    const result = Bun.spawnSync(["bun", cli, command, "--project", "tsconfig.json"], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      exitCode: result.exitCode,
      output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
    };
  });

describe("third-party extension authored outside effx packages", () => {
  it.effect(
    "CLI check reports the warning without evaluating the application; build writes real IR and JSDoc",
    () =>
      withIsolatedExample((directory) =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const check = yield* runCli(directory, "check");
          assert.strictEqual(check.exitCode, 0, check.output);
          assert.include(check.output, `${deprecatedWarningCode} warning`);
          assert.include(check.output, "Example.Lookup is deprecated: Use Example.Find instead");
          assert.include(check.output, "0 error(s)");
          assert.isFalse(yield* fs.exists(path.join(directory, ".effx", "ir.json")));

          const build = yield* runCli(directory, "build");
          assert.strictEqual(build.exitCode, 0, build.output);
          assert.include(build.output, `${deprecatedWarningCode} warning`);

          const ir = yield* decodeString(
            yield* fs.readFileString(path.join(directory, ".effx", "ir.json")),
          );

          const edge = { kind: "ExtensionOf", from: extensionId, to: operationId };
          assert.deepInclude(ir.edges, edge);
          assert.isTrue(
            ir.nodes.some((node) => node._tag === "Extension" && node.id === extensionId),
          );

          const generated = yield* fs.readFileString(
            path.join(directory, ".effx", "generated", "deprecated.ts"),
          );

          assert.strictEqual(
            generated,
            '/** @deprecated Use Example.Find instead */\nexport const deprecated_0 = "Example.Lookup" as const;\n',
          );
        }),
      ).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("unregistered custom annotations remain EFFX1101 errors", () =>
    Effect.gen(function* () {
      const project = new URL("../tsconfig.json", import.meta.url).pathname;
      const result = yield* compile({ tsconfigPath: project }, Extensions.builtin);
      assert.isTrue(result.diagnostics.some((diagnostic) => diagnostic.code === "EFFX1101"));
      assert.isTrue(Option.isNone(result.files.value));
    }).pipe(Effect.provide(services)),
  );

  it.effect(
    "decorator and builder collect the same custom semantic graph and handler-neutral hash",
    () =>
      Effect.gen(function* () {
        const project = new URL("../tsconfig.json", import.meta.url).pathname;
        const decorator = yield* compile({ tsconfigPath: project }, extensions);

        const builder = yield* compile(
          { tsconfigPath: project, entry: ["src/operations.builder.ts"] },
          extensions,
        );

        assert.deepStrictEqual(errors(decorator.diagnostics), []);
        assert.deepStrictEqual(errors(builder.diagnostics), []);
        const decoratorIr = Option.getOrThrow(decorator.ir.value);
        const builderIr = Option.getOrThrow(builder.ir.value);
        const customNode = decoratorIr.nodes.find((node) => node.id === extensionId);
        assert.isDefined(customNode);
        assert.isTrue(Schema.is(Node)(customNode));
        assert.deepStrictEqual(
          customNode,
          builderIr.nodes.find((node) => node.id === extensionId),
        );
        assert.deepStrictEqual(
          IRGraph.outgoing(Option.getOrThrow(decorator.index), extensionId, "ExtensionOf"),
          IRGraph.outgoing(Option.getOrThrow(builder.index), extensionId, "ExtensionOf"),
        );
        assert.deepStrictEqual(
          decorator.diagnostics.filter((d) => d.code === deprecatedWarningCode).length,
          1,
        );
        assert.deepStrictEqual(
          builder.diagnostics.filter((d) => d.code === deprecatedWarningCode).length,
          1,
        );

        const decoratorFile = Option.getOrThrow(decorator.files.value).find(
          (f) => f.path === "deprecated.ts",
        );

        const builderFile = Option.getOrThrow(builder.files.value).find(
          (f) => f.path === "deprecated.ts",
        );

        assert.deepStrictEqual(decoratorFile, builderFile);
        assert.strictEqual(
          canonical(withoutHandlerIdentity(decoratorIr)),
          canonical(withoutHandlerIdentity(builderIr)),
        );
        assert.strictEqual(
          yield* semanticHash(withoutHandlerIdentity(decoratorIr)),
          yield* semanticHash(withoutHandlerIdentity(builderIr)),
        );
      }).pipe(Effect.provide(services)),
  );
  it.effect("generator is lazy and changing only IR changes emitted JSDoc", () =>
    Effect.gen(function* () {
      const project = new URL("../tsconfig.json", import.meta.url).pathname;
      const result = yield* compile({ tsconfigPath: project }, extensions);
      assert.deepStrictEqual(errors(result.diagnostics), []);
      const ir = Option.getOrThrow(result.ir.value);

      const changed = make(
        ir.nodes.map((node) =>
          node._tag === "Extension" && node.id === extensionId
            ? { ...node, data: { reason: "Reason replaced in semantic IR" } }
            : node,
        ),
        ir.edges,
      );

      let reads = 0;

      const observed = {
        ...changed,
        get nodes() {
          reads++;

          return changed.nodes;
        },
      };

      const generator = deprecatedExtension.generators[0]!;
      const deferred = generator(observed, IRGraph.toGraph(changed));
      expectTypeOf(deferred).toEqualTypeOf<
        Effect.Effect<ReadonlyArray<GeneratedFile>, CompilerFault>
      >();
      assert.strictEqual(reads, 0);
      const files = yield* deferred;
      assert.strictEqual(reads, 1);
      assert.strictEqual(files.length, 1);
      assert.include(files[0]!.contents, "@deprecated Reason replaced in semantic IR");
      assert.notInclude(files[0]!.contents, "Use Example.Find instead");
    }).pipe(Effect.provide(services)),
  );
});
