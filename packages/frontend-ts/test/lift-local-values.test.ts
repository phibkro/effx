import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { EffectModel, Extensions, LiftFrontend, lift, liftRegistryOf } from "@effx/compiler";
import { LiftTsSourceFrontend } from "@effx/frontend-ts";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { testDirectory } from "../../../tools/testing/projects.ts";

const repo = new URL("../../../", import.meta.url).pathname;

const Services = LiftTsSourceFrontend.layer.pipe(Layer.provideMerge(BunServices.layer));

const decodeModel = Schema.decodeUnknownEffect(EffectModel);

const registry = liftRegistryOf(Extensions.builtin);

const fixture = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* testDirectory("lift-local-values-");

  const source = `import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
export const Input = Schema.Struct({});
export const Output = Schema.String;
export const union = (identifier: string, codes: readonly string[]) => Schema.String;
export const response = (schema: typeof Output) => schema;
export const registry = (identifier: string, codes: readonly string[]) => Schema.Never;
const PrivateProblem = union("PrivateProblem", ["one", "two"]);
let MutableProblem = union("MutableProblem", ["mutable"]);
export const Accepted = HttpApiEndpoint.get("accepted", "/accepted", {query: Input, success: Output, error: response((PrivateProblem) as typeof Output)});
export const Mutable = HttpApiEndpoint.get("mutable", "/mutable", {query: Input, success: Output, error: response(MutableProblem)});
export const Extra = HttpApiEndpoint.get("extra", "/extra", {query: Input, success: Output, error: response(PrivateProblem, {})});
export const Nested = HttpApiEndpoint.get("nested", "/nested", {query: Input, success: Output, error: response(response(PrivateProblem))});
export class Group extends HttpApiGroup.make("locals").add(Accepted, Mutable, Extra, Nested) {}
export class Root extends HttpApi.make("root").add(Group) {}`;

  yield* fs.writeFileString(path.join(directory, "source.ts"), source);
  yield* fs.writeFileString(
    path.join(directory, "tsconfig.json"),
    `{"extends":"${repo}tsconfig.json","files":["source.ts"],"exclude":[],"effx":{"projectRoot":"."}}`,
  );

  return { tsconfigPath: path.join(directory, "tsconfig.json"), source, directory };
});

describe("immutable private problem-union source facts", () => {
  it.effect(
    "records only const identities and complete unary local uses, never fake exports or partial terms",
    () =>
      Effect.gen(function* () {
        const copied = yield* fixture();
        const model = Option.getOrThrow((yield* (yield* LiftFrontend).analyze(copied)).value);
        yield* decodeModel(model);
        const value = model.localValues.find((value) => value.id.name === "PrivateProblem");
        assert.isDefined(value);
        assert.isFalse(model.localValues.some((value) => value.id.name === "MutableProblem"));
        assert.isFalse(model.values.some((value) => value.symbol.export === "PrivateProblem"));
        assert.isFalse(model.files.some((file) => file.exports.includes("PrivateProblem")));

        if (value === undefined) return;
        assert.strictEqual(value.kind, "const");
        assert.strictEqual(value.id.offset, copied.source.indexOf("PrivateProblem ="));
        assert.strictEqual(
          model.localCalls.filter((call) => call.argument.name === "PrivateProblem").length,
          2,
        );
        const accepted = model.endpoints.find((endpoint) => endpoint.symbol.export === "Accepted");
        assert.strictEqual(accepted?.options._tag, "Entries");

        if (accepted?.options._tag === "Entries") {
          const error = accepted.options.entries.find(
            (entry) => entry._tag === "Property" && entry.name === "error",
          );

          assert.strictEqual(error?._tag, "Property");

          if (error?._tag === "Property") {
            assert.strictEqual(error.value._tag, "Unlowered");
            assert.isFalse("term" in error.value);
            assert.isTrue(
              model.localCalls.some(
                (call) =>
                  call.range.start.offset === error.value.range.start.offset &&
                  call.range.end.offset === error.value.range.end.offset,
              ),
            );
          }
        }

        const result = lift(
          model,
          {
            group: "locals",
            rules: [
              {
                _tag: "ProblemRegistry",
                response: { module: "../../source", export: "response" },
                union: { module: "../../source", export: "union" },
                registry: { module: "../../source", export: "registry" },
              },
            ],
            names: {},
            output: { module: "../../suggestion" },
          },
          registry,
        );

        assert.deepStrictEqual(
          result.unsupported.map((site) => site.subject),
          ["locals.mutable", "locals.extra", "locals.nested"],
        );
        assert.deepStrictEqual(
          result.codeReferences.map((reference) => reference.codes),
          [["one", "two"]],
        );
        assert.isTrue(
          result.codeReferences.every((reference) => reference.ref.export !== "PrivateProblem"),
        );
        assert.strictEqual(
          result.refactors.filter((refactor) => refactor.code === "EFFX3004").length,
          1,
        );
      }).pipe(Effect.provide(Services)),
  );
});
