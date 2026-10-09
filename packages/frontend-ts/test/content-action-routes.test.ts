import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Extensions, compile } from "@effx/compiler";
import { canonical, semanticHash } from "@effx/ir";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { Effect, FileSystem, Layer, Option, Path } from "effect";

const fixtureRoot = new URL("./fixtures/stable-v4/", import.meta.url).pathname;

const contractConfig = new URL("./fixtures/stable-v4/tsconfig.content.effx.json", import.meta.url)
  .pathname;

const handlersConfig = new URL(
  "./fixtures/stable-v4/project/content-handlers/tsconfig.effx.json",
  import.meta.url,
).pathname;

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const compileActions = (tsconfigPath: string, emit: "contract" | "handlers") =>
  compile({ tsconfigPath, emit, strictAccess: true }, Extensions.builtin);

const errors = (diagnostics: ReadonlyArray<{ readonly severity: string }>) =>
  diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("stable Effect 4 colon-action HTTP routes", () => {
  it.effect(
    "preserves articleId in both generated Content actions and typechecks the raw bindings",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const contract = yield* compileActions(contractConfig, "contract");
        const handlers = yield* compileActions(handlersConfig, "handlers");

        assert.deepStrictEqual(errors(contract.diagnostics), []);
        assert.deepStrictEqual(errors(handlers.diagnostics), []);
        const contractIr = Option.getOrThrow(contract.ir.value);
        const handlerIr = Option.getOrThrow(handlers.ir.value);
        assert.strictEqual(canonical(contractIr), canonical(handlerIr));
        assert.strictEqual(yield* semanticHash(contractIr), yield* semanticHash(handlerIr));

        const paths = contractIr.nodes
          .flatMap((node) =>
            node._tag === "Exposure" && node.transport._tag === "http"
              ? [`${node.transport.method} ${node.transport.path}`]
              : [],
          )
          .toSorted();

        assert.deepStrictEqual(paths, [
          "POST /api/content/articles/:articleId:publish",
          "POST /api/content/articles/:articleId:unpublish",
        ]);

        const contractFiles = Option.getOrThrow(contract.files.value);
        const handlerFiles = Option.getOrThrow(handlers.files.value);
        assert.deepStrictEqual(
          contractFiles.map((file) => file.path),
          ["content-contract.ts"],
        );
        assert.deepStrictEqual(
          handlerFiles.map((file) => file.path),
          ["content-handlers.ts"],
        );
        const contractText = contractFiles[0]!.contents;
        const handlersText = handlerFiles[0]!.contents;
        assert.strictEqual(Array.from(contractText.matchAll(/params: ArticleParams/g)).length, 2);
        assert.include(
          contractText,
          'HttpApiEndpoint.post("publishArticle", "/api/content/articles/:articleId:publish"',
        );
        assert.include(
          contractText,
          'HttpApiEndpoint.post("unpublishArticle", "/api/content/articles/:articleId:unpublish"',
        );
        assert.include(handlersText, 'HttpApiBuilder.group(__effxRootApi, "content"');
        assert.strictEqual(
          contractText,
          yield* fs.readFileString(
            path.join(fixtureRoot, ".effx", "generated", "content-contract.ts"),
          ),
        );
        assert.strictEqual(
          handlersText,
          yield* fs.readFileString(
            path.join(
              fixtureRoot,
              "project",
              "content-handlers",
              ".effx",
              "generated",
              "content-handlers.ts",
            ),
          ),
        );

        const target = yield* Effect.sync(() => {
          const child = Bun.spawnSync(
            [
              "bun",
              "--bun",
              "node_modules/.bin/tsc",
              "--noEmit",
              "-p",
              "tsconfig.content.target.json",
            ],
            {
              cwd: fixtureRoot,
              stdout: "pipe",
              stderr: "pipe",
            },
          );

          return {
            exitCode: child.exitCode,
            output: new TextDecoder().decode(child.stdout) + new TextDecoder().decode(child.stderr),
          };
        });

        assert.strictEqual(target.exitCode, 0, target.output);
      }).pipe(Effect.provide(Services)),
    120_000,
  );
});
