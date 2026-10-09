import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Predicate, Schema } from "effect";
import { compile, Extensions } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { ts, tryTs } from "../src/ts.ts";
import { copyStableV4Fixture } from "../../../tools/testing/projects.ts";
import { requireStableV4FixtureDependencies } from "./stable-v4-fixture-dependencies.ts";

requireStableV4FixtureDependencies(new URL("./fixtures/stable-v4/", import.meta.url).pathname);

const Services = Layer.mergeAll(
  BunServices.layer,
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
);

const Behaviors = Schema.Struct({
  observeErrorsStaticBehaviors: Schema.declare(
    (value): value is (signal: AbortSignal) => Promise<{ status: number; body: string }> =>
      Predicate.isFunction(value),
  ),
});

const Observations = Schema.Struct({
  status: Schema.Int,
  body: Schema.fromJsonString(Schema.TaggedStruct("UserNotFound", { id: Schema.String })),
});

const typeDiagnostics = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const configPath = path.join(directory, "tsconfig.errors-static.target.json");
  const text = yield* fs.readFileString(configPath);

  return yield* tryTs("errors-static-typecheck", () => {
    const json = ts.parseConfigFileTextToJson(configPath, text);
    const parsed = ts.parseJsonConfigFileContent(json.config, ts.sys, directory);
    const program = ts.createProgram(parsed.fileNames, parsed.options);

    return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((diagnostic) => ({
      file: diagnostic.file?.fileName,
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    }));
  });
});

describe("a class-static error Schema in a generated endpoint", () => {
  it.effect("keeps the member schema in `error:` so the real failure decodes back to it", () =>
    Effect.gen(function* () {
      const directory = yield* copyStableV4Fixture();
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const project = path.join(directory, "project", "errors-static");

      const result = yield* compile(
        { tsconfigPath: path.join(project, "tsconfig.effx.json"), emit: "contract" },
        Extensions.builtin,
      );

      assert.deepStrictEqual(
        result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        [],
      );

      const output = path.join(project, ".effx", "generated");

      yield* fs.makeDirectory(output, { recursive: true });

      for (const file of Option.getOrThrow(result.files.value))
        yield* fs.writeFileString(path.join(output, file.path), file.contents);

      // The generated endpoint is typechecked exactly as the consumer reads it, and the failure is then
      // produced through that endpoint's declared error schema over a real request.
      assert.deepStrictEqual(yield* typeDiagnostics(directory), []);

      const loaded = yield* Effect.tryPromise(
        () => import(path.join(directory, "src", "errors-static-behaviors.ts")),
      );

      const behaviors = yield* Schema.decodeUnknownEffect(Behaviors)(loaded);

      const observed = yield* Effect.promise(() =>
        behaviors.observeErrorsStaticBehaviors(new AbortController().signal),
      );

      assert.deepStrictEqual(yield* Schema.decodeEffect(Observations)(observed), {
        status: 500,
        body: { _tag: "UserNotFound", id: "u1" },
      });
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
