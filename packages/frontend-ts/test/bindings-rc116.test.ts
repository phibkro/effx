import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { compile, Extensions } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash } from "@effx/ir";
import { ts, tryTs } from "../src/ts.ts";
import { copyRc116Fixture } from "../../../tools/testing/projects.ts";
import { requireRc116FixtureDependencies } from "./rc116-fixture-dependencies.ts";

requireRc116FixtureDependencies(new URL("./fixtures/rc116/", import.meta.url).pathname);

const Services = Layer.mergeAll(
  BunServices.layer,
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
);

const typeDiagnostics = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configPath = path.join(directory, "tsconfig.bound.target.json");
  const text = yield* fs.readFileString(configPath);

  return yield* tryTs("bound-rc116-typecheck", () => {
    const json = ts.parseConfigFileTextToJson(configPath, text);
    const parsed = ts.parseJsonConfigFileContent(json.config, ts.sys, directory);
    const program = ts.createProgram(parsed.fileNames, parsed.options);

    return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => ({
      file: diagnostic.file?.fileName,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
  });
});

const generatedFixture = Effect.fnUntraced(function* () {
  const directory = yield* copyRc116Fixture();
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const group of ["profile", "content"] as const) {
    const config = path.join(directory, "project", `bound-${group}`, "tsconfig.effx.json");
    const contract = yield* compile({ tsconfigPath: config, emit: "contract" }, Extensions.builtin);
    const bound = yield* compile({ tsconfigPath: config, emit: "handlers" }, Extensions.builtin);

    for (const result of [contract, bound])
      assert.deepStrictEqual(
        result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        [],
      );
    assert.strictEqual(
      canonical(Option.getOrThrow(contract.ir.value)),
      canonical(Option.getOrThrow(bound.ir.value)),
    );
    assert.strictEqual(
      yield* semanticHash(Option.getOrThrow(contract.ir.value)),
      yield* semanticHash(Option.getOrThrow(bound.ir.value)),
    );
    assert.strictEqual(Option.getOrThrow(contract.collected.value).bindings, undefined);
    assert.lengthOf(Option.getOrThrow(bound.collected.value).bindings!, 1);

    for (const file of Option.getOrThrow(contract.files.value)) {
      assert.notInclude(file.contents, "-bound-http");
      assert.notInclude(file.contents, ".bind");
    }

    const output = path.join(directory, "project", `bound-${group}`, ".effx", "generated");
    yield* fs.makeDirectory(output, { recursive: true });

    for (const file of Option.getOrThrow(bound.files.value))
      yield* fs.writeFileString(path.join(output, file.path), file.contents);
  }

  return directory;
});

describe("bound Profile and Content against installed rc.116", () => {
  it.effect(
    "typechecks real generated factories, type-only cycles, negative witnesses and both With injection styles",
    () =>
      Effect.gen(function* () {
        const directory = yield* generatedFixture();
        assert.deepStrictEqual(yield* typeDiagnostics(directory), []);

        const result = yield* Effect.sync(() => {
          const child = Bun.spawnSync(["bun", "test", "src/bound-runtime.spec.ts"], {
            cwd: directory,
            stdout: "pipe",
            stderr: "pipe",
          });

          return {
            exitCode: child.exitCode,
            output: new TextDecoder().decode(child.stdout) + new TextDecoder().decode(child.stderr),
          };
        });

        assert.strictEqual(result.exitCode, 0, result.output);
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "rejects mismatched factory context tuples in the generated file",
    () =>
      Effect.gen(function* () {
        const directory = yield* generatedFixture();
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const backend = path.join(directory, "src", "profile-bound-http.ts");
        const source = yield* fs.readFileString(backend);
        yield* fs.writeFileString(
          backend,
          source.replace(
            "makeProfileGuards = (context: ProfileContext)",
            "makeProfileGuards = (context: ProfileContext, _extra: number)",
          ),
        );
        const diagnostics = yield* typeDiagnostics(directory);
        assert.isTrue(
          diagnostics.some((diagnostic) =>
            diagnostic.file?.endsWith("/bound-profile/.effx/generated/profile-handlers.ts"),
          ),
          diagnostics.map((diagnostic) => `${diagnostic.file}: ${diagnostic.message}`).join("\n"),
        );
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "rejects an undeclared guardFor failure in generated endpoint constraints",
    () =>
      Effect.gen(function* () {
        const directory = yield* generatedFixture();
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const backend = path.join(directory, "src", "content-bound-http.ts");
        const source = yield* fs.readFileString(backend);
        yield* fs.writeFileString(
          backend,
          source
            .replace("import { Effect }", "import { Effect, Schema }")
            .replace(
              "  return { endpoint: endpoint.identifier };",
              "  return yield* new Undeclared({ endpoint: endpoint.identifier });",
            ) +
            '\nclass Undeclared extends Schema.TaggedError<Undeclared>()("Undeclared", { endpoint: Schema.String }) {}\n',
        );
        const diagnostics = yield* typeDiagnostics(directory);
        assert.isTrue(
          diagnostics.some((diagnostic) =>
            diagnostic.file?.endsWith("/bound-content/.effx/generated/content-handlers.ts"),
          ),
          diagnostics.map((diagnostic) => `${diagnostic.file}: ${diagnostic.message}`).join("\n"),
        );
      }).pipe(Effect.provide(Services)),
    120_000,
  );
});
