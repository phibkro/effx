import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { Contribution, Extensions, compile, dataOf } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { resolveProject } from "../src/commands.ts";
// The definition module is a leaf: the test imports it exactly as the config does.
import { RateLimit } from "../../frontend-ts/test/fixtures/users/src/rate-limit.def.ts";

/*
 * Spec 0015 (a config-supplied extension) and spec 0020 (a typed `implement` definition) in one
 * project: the generic `Annotate` / `.annotate` and the typed `@RateLimit` / `.with(RateLimit(...))`
 * reach the same definition by its name and lower to the same `{ name, args }` record.
 */

const fixtureRoot = new URL("../../frontend-ts/test/fixtures/users/", import.meta.url).pathname;

const main = new URL("../src/main.ts", import.meta.url).pathname;

const configUrl = new URL("../src/config.ts", import.meta.url).href;

const compilerUrl = new URL("../../compiler/src/index.ts", import.meta.url).href;

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

/** The four spellings of `src/operations.rate-limit.annotate.ts`: declaration id, operation name, typed or generic. */
const spellings = [
  {
    declaration: "Spellings.genericDecorator",
    operation: "Spellings.GenericDecorator",
    typed: false,
  },
  { declaration: "Spellings.typedDecorator", operation: "Spellings.TypedDecorator", typed: true },
  { declaration: "genericBuilder", operation: "Spellings.GenericBuilder", typed: false },
  { declaration: "typedBuilder", operation: "Spellings.TypedBuilder", typed: true },
] as const;

const written = ".annotate(RateLimit.effect.key, { perMinute: 60, burst: 5 })";

const occurrences = (text: string, part: string): number => text.split(part).length - 1;

/** A throwaway project beside the users fixture whose config registers `extension("app", [implement(RateLimit)])`. */
const withProject = <A, E, R>(
  entry: string,
  use: (dir: string, tsconfig: string) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const dir = yield* fs.makeTempDirectoryScoped({
      directory: fixtureRoot,
      prefix: ".definitions-test-",
    });

    yield* fs.copy(path.join(fixtureRoot, "src"), path.join(dir, "src"));
    const tsconfig = path.join(dir, "tsconfig.json");

    yield* fs.writeFileString(
      tsconfig,
      `{ "extends": "../tsconfig.json", "include": ["src/${entry}"] }\n`,
    );

    yield* fs.writeFileString(
      path.join(dir, "effx.config.ts"),
      [
        `import { defineConfig } from "${configUrl}";`,
        `import { extension, implement } from "${compilerUrl}";`,
        `import { RateLimit } from "./src/rate-limit.def.ts";`,
        `export default defineConfig({ extensions: [extension("app", [implement(RateLimit)])] });`,
        "",
      ].join("\n"),
    );

    return yield* use(dir, tsconfig);
  }).pipe(Effect.scoped, Effect.provide(BunServices.layer));

const runCli = (cwd: string, ...args: ReadonlyArray<string>) =>
  Effect.sync(() => {
    const result = Bun.spawnSync(["bun", main, ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    return {
      code: result.exitCode,
      output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
    };
  });

describe("a config-supplied extension built from a typed definition", () => {
  it.effect(
    "lowers Annotate, .annotate, the typed decorator and .with(...) to one { name, args } record",
    () =>
      withProject("operations.rate-limit.annotate.ts", (_dir, tsconfig) =>
        Effect.gen(function* () {
          // The config is the only module the CLI evaluates; its extension list appends to the built-ins.
          const resolved = yield* resolveProject(tsconfig);

          assert.deepStrictEqual(
            resolved.extensions.map((extension) => extension.name),
            [...Extensions.builtin.map((extension) => extension.name), "app"],
          );

          const result = yield* compile(resolved.config, resolved.extensions);

          assert.deepStrictEqual(
            result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
            [],
          );

          const collected = Option.getOrThrow(result.collected.value);

          for (const spelling of spellings) {
            const declaration = collected.declarations.find(
              (candidate) => candidate.id === spelling.declaration,
            );

            const limits = declaration?.annotations.filter(
              (annotation) => annotation.name === "app.RateLimit",
            );

            assert.strictEqual(limits?.length, 1, `${spelling.declaration} carries one RateLimit`);
            const limit = limits?.[0];

            // The record every spelling shares: the name and the arguments lowered by the definition's plan.
            assert.deepStrictEqual(
              { name: limit?.name, args: limit?.args },
              { name: "app.RateLimit", args: [{ perMinute: 60, burst: 5 }] },
              spelling.declaration,
            );

            // Only the applied definition records its own export (a writer imports it); the generic floor has none.
            assert.deepStrictEqual(
              limit?.definition,
              spelling.typed
                ? { module: "../../src/rate-limit.def", export: "RateLimit" }
                : undefined,
              spelling.declaration,
            );
          }

          // One IR node per operation with the same typed data, read back through the definition.
          const ir = Option.getOrThrow(result.ir.value);
          const operations = ir.nodes.filter((node) => node._tag === "Operation");

          assert.deepStrictEqual(
            operations.map((operation) => operation.name).toSorted(),
            spellings.map((spelling) => spelling.operation).toSorted(),
          );

          for (const operation of operations) {
            assert.deepStrictEqual(
              Option.getOrThrow(dataOf(RateLimit, ir, operation.id)),
              [{ perMinute: 60, burst: 5 }],
              operation.name,
            );
          }

          // The effect clause writes `.annotate(<Definition>.effect.key, ...)` for the applied definition only.
          const http = Option.getOrThrow(result.files.value).find(
            (file) => file.path === "http.ts",
          )?.contents;

          assert.strictEqual(
            occurrences(http ?? "", written),
            spellings.filter((spelling) => spelling.typed).length,
          );
        }),
      ).pipe(Effect.provide(Services)),
  );

  it.effect("an unregistered name stays EFFX1101 in every spelling", () =>
    withProject("operations.rate-limit.annotate.ts", (_dir, tsconfig) =>
      Effect.gen(function* () {
        const resolved = yield* resolveProject(tsconfig);
        const result = yield* compile(resolved.config, Extensions.builtin);

        assert.deepStrictEqual(
          result.diagnostics
            .filter((diagnostic) => diagnostic.code === "EFFX1101")
            .map((diagnostic) => diagnostic.message)
            .toSorted(),
          spellings
            .map(
              (spelling) =>
                `@app.RateLimit on ${spelling.declaration}: no extension interprets this annotation`,
            )
            .toSorted(),
        );
      }),
    ).pipe(Effect.provide(Services)),
  );

  it.effect("the generic spelling is decoded against its definition (EFFX1102)", () =>
    withProject("operations.rate-limit.annotate-invalid.ts", (_dir, tsconfig) =>
      Effect.gen(function* () {
        const resolved = yield* resolveProject(tsconfig);
        const result = yield* compile(resolved.config, resolved.extensions);
        const problems = result.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX1102");

        assert.strictEqual(problems.length, 1);
        assert.include(problems[0]?.message, "Wrong.get");
        assert.isTrue(Option.isNone(result.files.value), "an error skips generation");

        // A hand-written interpreter owning the same name (the untyped floor) accepts the call: only the
        // definition's decode rejects a string where `A.int` is declared.
        const floor = yield* compile(resolved.config, [
          ...Extensions.builtin,
          {
            name: "floor",
            interpreters: { "app.RateLimit": () => Contribution.empty },
            analyses: [],
            generators: [],
          },
        ]);

        assert.deepStrictEqual(
          floor.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
      }),
    ).pipe(Effect.provide(Services)),
  );

  it.effect("the CLI builds the same IR and generated annotation from the config", () =>
    withProject("operations.rate-limit.annotate.ts", (dir, tsconfig) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const built = yield* runCli(dir, "build", "--project", tsconfig);

        assert.strictEqual(built.code, 0, built.output);

        const ir = yield* fs.readFileString(path.join(dir, ".effx", "ir.json"));

        for (const spelling of spellings) {
          assert.include(
            ir,
            `"ext:app.RateLimit/${spelling.operation}"`,
            "an Extension node per spelling",
          );
        }

        const http = yield* fs.readFileString(path.join(dir, ".effx", "generated", "http.ts"));

        assert.strictEqual(
          occurrences(http, written),
          spellings.filter((spelling) => spelling.typed).length,
        );
      }),
    ).pipe(Effect.provide(Services)),
  );

  it.effect("rejects a malformed definition, expand or fragment list before compiling", () =>
    withProject("operations.rate-limit.annotate.ts", (dir, tsconfig) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = path.join(dir, "malformed.config.ts");

        for (const field of [
          "annotations: [null]",
          "annotations: [{ name: 'app.X' }]",
          "expand: 1",
          "fragments: [1]",
        ]) {
          yield* fs.writeFileString(
            config,
            [
              `import { defineConfig } from "${configUrl}";`,
              `export default defineConfig({ extensions: [{ name: "bad", interpreters: {}, analyses: [], generators: [], ${field} }] });`,
              "",
            ].join("\n"),
          );

          const fault = yield* Effect.flip(
            resolveProject(tsconfig, undefined, undefined, undefined, config),
          );

          assert.strictEqual(fault._tag, "CompilerFault", field);
          assert.match(fault.message, /extensions must contain valid Extension entries/, field);
        }

        assert.isFalse(yield* fs.exists(path.join(dir, ".effx")));
      }),
    ).pipe(Effect.provide(Services)),
  );
});
