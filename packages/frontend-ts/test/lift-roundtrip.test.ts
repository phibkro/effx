import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import {
  Extensions,
  LiftFrontend,
  SourceFrontend,
  compileCollected,
  dense,
  lift,
  liftRegistryOf,
  printSuggestion,
} from "@effx/compiler";
import { LiftTsSourceFrontend, TsSourceFrontend } from "@effx/frontend-ts";
import { canonical } from "@effx/ir";
import { Effect, FileSystem, Layer, Option, Path, Result, Schema } from "effect";
import { testDirectory } from "../../../tools/testing/projects.ts";

const repo = new URL("../../../", import.meta.url).pathname;

const registry = liftRegistryOf(Extensions.builtin);

const Services = Layer.mergeAll(LiftTsSourceFrontend.layer, TsSourceFrontend.layer).pipe(
  Layer.provideMerge(BunServices.layer),
);

const EndpointCase = Schema.Struct({
  verb: Schema.Literals(["get", "post", "put", "patch", "delete"]),
  status: Schema.Literals(["omitted", 200, 201, 204]),
  headers: Schema.Boolean,
  bodyless: Schema.Boolean,
});

const Samples = Schema.Array(EndpointCase).check(Schema.isMinLength(25), Schema.isMaxLength(25));

describe("0019 real TypeScript Program recovery laws", () => {
  it.effect.prop(
    "L2/L3/L4/L5 recover 25 generated terms per program, including bare/headered explicit 200 and NoContent",
    [Samples],
    ([samples]) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* testDirectory("lift-laws-");
        yield* fs.makeDirectory(path.join(directory, "src"));
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
export const Output = Schema.Struct({ value: Schema.String }).annotate({ identifier: "Output" });
export const Headers = Schema.Struct({ etag: Schema.String });`,
        );
        const rootFile = path.join(directory, "src/root.ts");
        yield* fs.writeFileString(
          rootFile,
          'import { HttpApi } from "effect/http-api"; export class Root extends HttpApi.make("nf-root") {}',
        );

        // These witnesses keep explicit-200 and bodyless domains present regardless of the random sample.
        const cases = [
          ...samples,
          { verb: "get", status: 200, headers: false, bodyless: false },
          { verb: "post", status: 200, headers: true, bodyless: false },
          { verb: "post", status: 200, headers: true, bodyless: true },
        ];

        const declarations: Array<string> = [];

        for (let index = 0; index < cases.length; index++) {
          const sample = cases[index];

          if (sample === undefined) continue;
          const response = sample.bodyless ? "HttpApiSchema.NoContent" : "Output";
          const verb = sample.verb;
          const channel = verb === "get" || verb === "delete" ? "query" : "payload";
          const status = sample.status === "omitted" ? "" : `, status: ${sample.status}`;
          const headers = sample.headers ? ", responseHeaders: Headers" : "";
          declarations.push(`export const Op${index} = Operation.${verb === "get" ? "query" : "command"}({ name: "nf.op${index}", input: Input, success: ${response} })
.http.${verb}("/op${index}").http.contract({ root: "nf-root", group: "nf", ${channel}: Input, success: ${response}${status}${headers}, metadata: { operationId: "nf.op${index}" } }).declare();`);
        }

        const authored = `import { Http, Operation } from "@effx/runtime";
import { HttpApiSchema } from "effect/http-api";
import { Root } from "./root.ts";
import { Input, Output, Headers } from "./support.ts";
export const Group = Http.group({ root: Root, group: "nf" });
${declarations.join("\n")}`;

        const sourceFile = path.join(directory, "src/operations.effx.ts");
        yield* fs.writeFileString(sourceFile, authored);

        const config = {
          tsconfigPath: path.join(directory, "tsconfig.json"),
          entry: ["src/operations.effx.ts"],
          emit: "contract" as const,
        };

        const forward = yield* SourceFrontend;
        const originalCollected = yield* forward.analyze(config);
        const original = yield* compileCollected(originalCollected, Extensions.builtin);
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
        const generated = files.find((file) => file.path.endsWith("-contract.ts"));
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
        assert.strictEqual(generatedModel.endpoints.length, cases.length);
        // The generated group has no root. The composition uses the same real source Root export and id.
        yield* fs.writeFileString(
          rootFile,
          `import { HttpApi } from "effect/http-api";
import { ${group.symbol.export} } from "../.effx/generated/${generated.path}";
export class Root extends HttpApi.make("nf-root").add(${group.symbol.export}) { }`,
        );

        const model = Option.getOrThrow(
          (yield* frontend.analyze({ ...config, entry: ["src/root.ts"] })).value,
        );

        const input = {
          group: "nf",
          rules: [],
          names: {},
          output: { module: "../../src/operations.effx" },
        };

        const lifted = lift(model, input, registry);
        assert.deepStrictEqual(lifted.unsupported, []);
        assert.deepStrictEqual(
          lifted.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );

        const resolution = originalCollected.project;
        const resolveEffectModule = originalCollected.resolveEffectModule;

        assert.isDefined(resolution);
        assert.isDefined(resolveEffectModule);

        if (resolution === undefined || resolveEffectModule === undefined) return;

        const recovered = yield* compileCollected(
          { ...lifted.collected, project: resolution, resolveEffectModule },
          Extensions.builtin,
        );

        assert.deepStrictEqual(
          recovered.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        const denseChoice = dense(lifted.collected);

        assert.isTrue(
          Option.isSome(denseChoice),
          "the exact lifted normal-form group must have an identity-preserving dense form",
        );

        assert.strictEqual(canonical(Option.getOrThrow(recovered.ir.value)), canonical(expectedIR));

        for (const collected of [lifted.collected, Option.getOrThrow(denseChoice)]) {
          const text = printSuggestion(collected, { module: input.output.module });
          assert.isTrue(Result.isSuccess(text));

          if (Result.isFailure(text)) return;
          yield* fs.writeFileString(sourceFile, text.success);
          const recollected = yield* forward.analyze(config);
          const rebuilt = yield* compileCollected(recollected, Extensions.builtin);
          assert.deepStrictEqual(
            rebuilt.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
            [],
          );
          assert.strictEqual(canonical(Option.getOrThrow(rebuilt.ir.value)), canonical(expectedIR));
        }

        const recoveredFiles = Option.getOrThrow(recovered.files.value);

        for (const file of recoveredFiles)
          yield* fs.writeFileString(path.join(generatedDirectory, file.path), file.contents);

        const again = lift(
          Option.getOrThrow((yield* frontend.analyze({ ...config, entry: ["src/root.ts"] })).value),
          input,
          registry,
        );

        const second = yield* compileCollected(
          { ...again.collected, project: resolution, resolveEffectModule },
          Extensions.builtin,
        );

        assert.strictEqual(canonical(Option.getOrThrow(second.ir.value)), canonical(expectedIR));
      }).pipe(Effect.provide(Services)),
    { arbitrary: { runs: 3, seed: 1919, maxShrinks: 0 } },
  );
});
