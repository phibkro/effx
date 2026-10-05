import { copyUsersFixture } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { A, Annotation } from "@effx/runtime";
import {
  type Extension,
  type GeneratedFile,
  Extensions,
  compile,
  extension,
  implement,
} from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
// The definition modules are leaves; the test imports them exactly as an extension author would.
import { Mismatch } from "./fixtures/users/src/rate-limit-mismatch.def.ts";
import { RateLimit } from "./fixtures/users/src/rate-limit.def.ts";

const fixtureRoot = new URL("./fixtures/users/", import.meta.url).pathname;

const tsconfigPath = `${fixtureRoot}tsconfig.json`;

const repoRoot = new URL("../../../", import.meta.url).pathname;

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

/** The same definition without its `effect` clause: the writer has nothing to emit for it. */
const RateLimitWithoutEffect = Annotation.define({
  name: "app.RateLimit",
  target: "operation",
  args: { perMinute: A.int, burst: A.optional(A.int) },
  cardinality: "one",
});

const withApp = (...definitions: ReadonlyArray<Parameters<typeof implement>[0]>) => [
  ...Extensions.builtin,
  extension(
    "app",
    definitions.map((definition) => implement(definition)),
  ),
];

const compileEntry = (entry: string, extensions: ReadonlyArray<Extension>) =>
  compile({ tsconfigPath, entry: [`src/${entry}`] }, extensions);

const httpOf = (files: ReadonlyArray<GeneratedFile>): string =>
  files.find((file) => file.path === "http.ts")?.contents ?? "";

const GeneratedTsconfig = Schema.fromJsonString(
  Schema.Struct({
    extends: Schema.String,
    include: Schema.Array(Schema.String),
    compilerOptions: Schema.Struct({
      paths: Schema.Record(Schema.String, Schema.Array(Schema.String)),
    }),
  }),
);

/**
 * Writes the generated files to `<fixture>/.effx/<name>/` (two levels below the fixture root, where the
 * generated relative imports expect to be) and runs `tsc --noEmit` over the fixture project plus them.
 */
const typecheckGenerated = Effect.fnUntraced(function* (
  name: string,
  files: ReadonlyArray<GeneratedFile>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const fixtureRoot = yield* copyUsersFixture();
  const outDir = path.join(fixtureRoot, ".effx", name);

  yield* fs.makeDirectory(outDir, { recursive: true });

  for (const file of files) {
    yield* fs.writeFileString(path.join(outDir, file.path), file.contents);
  }

  const config = path.join(fixtureRoot, ".effx", `tsconfig.${name}.json`);

  yield* fs.writeFileString(
    config,
    yield* Schema.encodeEffect(GeneratedTsconfig)({
      extends: "../tsconfig.json",
      include: [`./${name}/*.ts`],
      compilerOptions: {
        paths: {
          "@effx/runtime": ["../../../../../runtime/src/index.ts"],
          "@effx/diagnostics": ["../../../../../diagnostics/src/index.ts"],
          "@effx/runtime/diagnostics": ["../../../../../runtime/src/diagnostics.ts"],
        },
      },
    }),
  );

  return yield* Effect.sync(() => {
    const result = Bun.spawnSync(
      ["bun", "--bun", "node_modules/.bin/tsc", "--noEmit", "-p", config],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );

    return {
      code: result.exitCode,
      text: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
    };
  });
});

const annotate = ".annotate(RateLimit.effect.key, { perMinute: 60, burst: 5 })";

describe("the default writer of an effect clause, end to end", () => {
  it.effect(
    "writes .annotate(<Definition>.effect.key, <value>) for the decorator and the builder operation",
    () =>
      Effect.gen(function* () {
        const result = yield* compileEntry("operations.rate-limit.ts", withApp(RateLimit));

        assert.deepStrictEqual(
          result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );

        const http = httpOf(Option.getOrThrow(result.files.value));

        assert.include(http, 'import { RateLimit } from "../../src/rate-limit.def.ts";');

        const endpoints = http.split("HttpApiEndpoint.get(").slice(1);

        assert.strictEqual(endpoints.length, 2);

        for (const endpoint of endpoints) {
          assert.strictEqual(endpoint.split(annotate).length, 2);
        }
      }).pipe(Effect.provide(Services)),
  );

  it.effect("writes nothing when the definition has no effect clause", () =>
    Effect.gen(function* () {
      const result = yield* compileEntry(
        "operations.rate-limit.ts",
        withApp(RateLimitWithoutEffect),
      );

      assert.deepStrictEqual(
        result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        [],
      );
      assert.notInclude(httpOf(Option.getOrThrow(result.files.value)), ".annotate(");
    }).pipe(Effect.provide(Services)),
  );

  it.effect(
    "the generated code typechecks against the key's shape (tsc)",
    () =>
      Effect.gen(function* () {
        const result = yield* compileEntry("operations.rate-limit.ts", withApp(RateLimit));

        const output = yield* typecheckGenerated(
          "writer-ok",
          Option.getOrThrow(result.files.value),
        );

        assert.strictEqual(output.code, 0, `tsc output:\n${output.text}`);
      }).pipe(Effect.provide(Services)),
    120_000,
  );

  it.effect(
    "a key whose shape disagrees with the arguments makes the generated code fail tsc",
    () =>
      Effect.gen(function* () {
        const result = yield* compileEntry("operations.rate-limit.mismatch.ts", withApp(Mismatch));
        const files = Option.getOrThrow(result.files.value);

        assert.include(httpOf(files), ".annotate(Mismatch.effect.key, { perMinute: 60 })");

        const output = yield* typecheckGenerated("writer-mismatch", files);

        assert.notStrictEqual(output.code, 0, "tsc accepted a value that disagrees with the key");
        assert.match(output.text, /writer-mismatch\/http\.ts\(\d+,\d+\): error TS2322/);
        assert.include(output.text, "Type 'number' is not assignable to type 'string'");
      }).pipe(Effect.provide(Services)),
    120_000,
  );
});
