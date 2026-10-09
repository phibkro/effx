import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import {
  Extensions,
  LiftFrontend,
  SourceFrontend,
  compileCollected,
  extension,
  implement,
  lift,
  liftRegistryOf,
  printSuggestion,
} from "@effx/compiler";
import { LiftTsSourceFrontend, TsSourceFrontend } from "@effx/frontend-ts";
import { canonical } from "@effx/ir";
import { A, Annotation } from "@effx/runtime";
import { Context, Effect, FileSystem, Layer, Option, Path, Result } from "effect";
import { testDirectory } from "../../../tools/testing/projects.ts";

class RateLimitPolicy extends Context.Service<
  RateLimitPolicy,
  { readonly perMinute: number; readonly burst?: number }
>()("app/RateLimit") {}

const RateLimit = Annotation.define({
  name: "app.RateLimit",
  target: "operation",
  args: { perMinute: A.int, burst: A.optional(A.int) },
  cardinality: "one",
  effect: { target: "endpoint", key: RateLimitPolicy },
});

const repo = new URL("../../../", import.meta.url).pathname;

const services = Layer.mergeAll(TsSourceFrontend.layer, LiftTsSourceFrontend.layer).pipe(
  Layer.provideMerge(BunServices.layer),
);

const selected = [...Extensions.builtin, extension("app", [implement(RateLimit)])];

const registry = liftRegistryOf(selected);

const definitions = new Map(
  selected.flatMap((selectedExtension) =>
    (selectedExtension.annotations ?? []).map(
      (definition) =>
        [definition.name, { plan: definition.plan, target: definition.target }] as const,
    ),
  ),
);

const contractFile = (files: ReadonlyArray<{ readonly path: string; readonly contents: string }>) =>
  files.find((file) => file.path.endsWith("-contract.ts"));

const authored = `import { Http, Operation } from "@effx/runtime";
import { Root } from "./root.ts";
import { Input, Output } from "./support.ts";
import { RateLimit } from "./definition.ts";
export const Group = Http.group({ root: Root, group: "limited" });
export const Limited = Operation.query({ name: "limited.read", input: Input, success: Output })
.http.get("/limited").http.contract({ root: "limited-root", group: "limited", query: Input, success: Output, metadata: { operationId: "limited.read" } })
.with(RateLimit({ perMinute: 60, burst: 5 })).declare();`;

describe("the real RateLimit definition-owned lift journey", () => {
  it.effect(
    "recovers the source definition and its key, decodes args, and preserves canonical IR and contract bytes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* testDirectory("lift-rate-limit-");
        yield* fs.makeDirectory(path.join(directory, "src"));

        // The definition module is the real documentation source, copied byte for byte.
        yield* fs.copyFile(
          path.join(repo, "ai-docs/src/06_custom-extensions/03_define-annotation.ts"),
          path.join(directory, "src/definition.ts"),
        );

        yield* fs.writeFileString(
          path.join(directory, "tsconfig.json"),
          `{
        "extends": "${repo}tsconfig.json", "include": ["src/operations.effx.ts"], "exclude": [],
        "effx": { "projectRoot": "." }
      }`,
        );

        yield* fs.writeFileString(
          path.join(directory, "src/support.ts"),
          `import { Schema } from "effect";
export const Input = Schema.Struct({ value: Schema.String });
export const Output = Schema.Struct({ value: Schema.String }).annotate({ identifier: "Output" });`,
        );

        const rootFile = path.join(directory, "src/root.ts");

        yield* fs.writeFileString(
          rootFile,
          'import { HttpApi } from "effect/http-api"; export class Root extends HttpApi.make("limited-root") {}',
        );

        const sourceFile = path.join(directory, "src/operations.effx.ts");
        yield* fs.writeFileString(sourceFile, authored);

        const config = {
          tsconfigPath: path.join(directory, "tsconfig.json"),
          entry: ["src/operations.effx.ts"],
          emit: "contract" as const,
        };

        const forward = yield* SourceFrontend;
        const originalCollected = yield* forward.analyze(config, { definitions });
        const original = yield* compileCollected(originalCollected, selected);

        assert.deepStrictEqual(
          original.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        const expectedIR = Option.getOrThrow(original.ir.value);
        const generatedDirectory = path.join(directory, ".effx/generated");
        yield* fs.makeDirectory(generatedDirectory, { recursive: true });
        const files = Option.getOrThrow(original.files.value);

        for (const file of files)
          yield* fs.writeFileString(path.join(generatedDirectory, file.path), file.contents);
        const generated = contractFile(files);
        assert.isDefined(generated);

        if (generated === undefined) return;
        const frontend = yield* LiftFrontend;

        const generatedModel = Option.getOrThrow(
          (yield* frontend.analyze({ ...config, entry: [`.effx/generated/${generated.path}`] }))
            .value,
        );

        const group = generatedModel.groups[0];
        assert.isDefined(group);

        if (group === undefined) return;
        // The generated group has no root. The composition uses the same real source Root export and id.
        yield* fs.writeFileString(
          rootFile,
          `import { HttpApi } from "effect/http-api";
import { ${group.symbol.export} } from "../.effx/generated/${generated.path}";
export class Root extends HttpApi.make("limited-root").add(${group.symbol.export}) { }`,
        );

        const model = Option.getOrThrow(
          (yield* frontend.analyze({ ...config, entry: ["src/root.ts"] })).value,
        );

        const definition = model.definitions.find((entry) => entry.name === RateLimit.name);
        assert.isDefined(definition);
        const keyRef = definition?.key?.ref;
        assert.strictEqual(definition?.key?.id, "app/RateLimit");
        assert.strictEqual(keyRef?.export, "RateLimitPolicy");

        if (keyRef === undefined) return;

        assert.strictEqual(model.endpoints.length, 1);
        const endpoint = model.endpoints[0];
        assert.isDefined(endpoint);

        const annotate = endpoint?.steps.find(
          (step) => step._tag === "Method" && step.name === "annotate",
        );

        assert.strictEqual(annotate?._tag, "Method");

        if (annotate?._tag === "Method") {
          const key = annotate.args[0];
          assert.strictEqual(key?._tag, "Lowered");

          if (key?._tag === "Lowered")
            assert.deepStrictEqual(key.term, { _tag: "Ref", ref: keyRef });
        }

        const input = {
          group: "limited",
          rules: [],
          names: {},
          output: { module: "../../src/operations.effx" },
        };

        const lifted = lift(model, input, registry);

        assert.deepStrictEqual(
          lifted.unsupported,
          [],
          lifted.diagnostics
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
            .join("\n"),
        );

        const annotation = lifted.collected.declarations
          .flatMap((declaration) => declaration.annotations)
          .find((entry) => entry.name === RateLimit.name);

        assert.deepStrictEqual(annotation?.definition, definition?.ref);
        assert.deepStrictEqual(annotation?.args, [{ perMinute: 60, burst: 5 }]);

        const resolution = originalCollected.project;
        const resolveEffectModule = originalCollected.resolveEffectModule;

        assert.isDefined(resolution);
        assert.isDefined(resolveEffectModule);

        if (resolution === undefined || resolveEffectModule === undefined) return;

        const relifted = yield* compileCollected(
          { ...lifted.collected, project: resolution, resolveEffectModule },
          selected,
        );

        assert.deepStrictEqual(
          relifted.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        assert.strictEqual(canonical(Option.getOrThrow(relifted.ir.value)), canonical(expectedIR));
        const reliftedContract = contractFile(Option.getOrThrow(relifted.files.value));
        assert.strictEqual(reliftedContract?.contents, generated.contents);

        const printed = printSuggestion(lifted.collected, { module: input.output.module });
        assert.isTrue(Result.isSuccess(printed));

        if (Result.isFailure(printed)) return;
        yield* fs.writeFileString(sourceFile, printed.success);

        const recollected = yield* forward.analyze(config, { definitions });
        const rebuilt = yield* compileCollected(recollected, selected);

        assert.deepStrictEqual(
          rebuilt.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        assert.strictEqual(canonical(Option.getOrThrow(rebuilt.ir.value)), canonical(expectedIR));
        const rebuiltContract = contractFile(Option.getOrThrow(rebuilt.files.value));
        assert.strictEqual(rebuiltContract?.contents, generated.contents);
      }).pipe(Effect.provide(services)),
  );
});
