import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Predicate, Schema } from "effect";
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

class BoundBehaviorFailure extends Schema.TaggedError<BoundBehaviorFailure>()(
  "BoundBehaviorFailure",
  {
    cause: Schema.Defect(),
  },
) {}

const RuntimeModule = Schema.Struct({
  observeBoundBehaviors: Schema.declare(
    (value): value is (signal: AbortSignal) => Promise<BoundBehaviorObservations> =>
      Predicate.isFunction(value),
  ),
});

const Observations = Schema.Struct({
  packageVersion: Schema.String,
  moduleOrigin: Schema.String,
  runtimeIdentityMatches: Schema.Boolean,
  profile: Schema.Struct({ status: Schema.Int, body: Schema.String, releases: Schema.Int }),
  content: Schema.Array(
    Schema.Struct({
      action: Schema.Literals(["publish", "unpublish"]),
      status: Schema.Int,
      body: Schema.String,
    }),
  ),
  cancellation: Schema.Struct({ interrupted: Schema.Boolean, releases: Schema.Int }),
  guardFailure: Schema.Struct({ status: Schema.Int, reads: Schema.Int }),
  defect: Schema.Struct({ status: Schema.Int, releases: Schema.Int }),
});

type BoundBehaviorObservations = typeof Observations.Type;

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

  for (const group of ["profile", "content", "generic", "generic-defaulted"] as const) {
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

        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const modulePath = path.join(directory, "src", "bound-behaviors.ts");

        const loaded = yield* Effect.tryPromise({
          try: () => import(modulePath),
          catch: (cause) => new BoundBehaviorFailure({ cause }),
        });

        const fixture = yield* Schema.decodeUnknownEffect(RuntimeModule)(loaded);

        const raw = yield* Effect.tryPromise({
          try: (signal) => fixture.observeBoundBehaviors(signal),
          catch: (cause) => new BoundBehaviorFailure({ cause }),
        });

        const observed = yield* Schema.decodeEffect(Observations)(raw);

        const actualOrigin = observed.moduleOrigin.startsWith("file:")
          ? new URL(observed.moduleOrigin).pathname
          : observed.moduleOrigin;

        const effectRoot = yield* fs.realPath(path.join(directory, "node_modules", "effect"));
        assert.strictEqual(observed.packageVersion, "4.0.0-rc.116");
        assert.strictEqual(observed.runtimeIdentityMatches, true);
        assert.strictEqual(
          yield* fs.realPath(actualOrigin),
          path.join(effectRoot, "dist", "index.js"),
        );
        assert.strictEqual(observed.profile.status, 200);
        assert.strictEqual(
          observed.profile.body,
          '{"firstName":"bound:substitute","lastName":"bound"}',
        );
        assert.strictEqual(observed.profile.releases, 1);
        assert.deepStrictEqual(
          observed.content.map(({ action }) => action),
          ["publish", "unpublish"],
        );

        for (const response of observed.content) {
          assert.strictEqual(response.status, 200);
          assert.strictEqual(response.body, `article-1:${response.action}ed:8192`);
        }

        assert.strictEqual(observed.cancellation.interrupted, true);
        assert.strictEqual(observed.cancellation.releases, 1);
        assert.strictEqual(observed.guardFailure.status, 401);
        assert.strictEqual(observed.guardFailure.reads, 0);
        assert.strictEqual(observed.defect.status, 500);
        assert.strictEqual(observed.defect.releases, 1);
      }).pipe(Effect.scoped, Effect.provide(Services)),
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
      }).pipe(Effect.scoped, Effect.provide(Services)),
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
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "rejects a generic guards factory whose context tuple differs from the raw factory's",
    () =>
      Effect.gen(function* () {
        const directory = yield* generatedFixture();
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const backend = path.join(directory, "src", "content-bound-generic.ts");
        const source = yield* fs.readFileString(backend);
        yield* fs.writeFileString(
          backend,
          source.replace(
            "makeGenericGuards = <C extends GenericContentContext>(_context: C)",
            "makeGenericGuards = <C extends GenericContentContext>(_context: C, _extra: number)",
          ),
        );
        const diagnostics = yield* typeDiagnostics(directory);
        assert.isTrue(
          diagnostics.some((diagnostic) =>
            diagnostic.file?.endsWith("/bound-generic/.effx/generated/content-handlers.ts"),
          ),
          diagnostics.map((diagnostic) => `${diagnostic.file}: ${diagnostic.message}`).join("\n"),
        );
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );
});
