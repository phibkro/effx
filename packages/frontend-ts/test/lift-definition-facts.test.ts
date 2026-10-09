import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { EffectModel, LiftFrontend } from "@effx/compiler";
import { LiftTsSourceFrontend } from "@effx/frontend-ts";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { testDirectory } from "../../../tools/testing/projects.ts";

const repo = new URL("../../../", import.meta.url).pathname;

const services = LiftTsSourceFrontend.layer.pipe(Layer.provideMerge(BunServices.layer));

const decodeModel = Schema.decodeUnknownEffect(EffectModel);

const fixture = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* testDirectory("lift-definition-facts-");

  const source = `import { Context, Schema } from "effect";
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/http-api";
import { A, Annotation } from "@effx/runtime";
export class ClassKey extends Context.Service<ClassKey, { readonly limit: number }>()("facts/Class") {}
export const FactoryKey = Context.Service<{ readonly limit: number }>("facts/Factory");
export const DefaultKey = Context.Reference<{ readonly limit: number }>("facts/Default", { defaultValue: () => { throw new Error("must not execute default"); } });
export const KeyAlias = FactoryKey;
export const ClassDefinition = Annotation.define({ name: "facts.Class", target: "operation", args: { limit: A.int }, effect: { target: "endpoint", key: ClassKey } });
export const FactoryDefinition = Annotation.define({ name: "facts.Factory", target: "operation", args: { limit: A.int }, effect: { target: "endpoint", key: KeyAlias } });
export const DefaultDefinition = Annotation.define({ name: "facts.Default", target: "operation", args: { limit: A.int }, effect: { target: "endpoint", key: DefaultKey } });
export const WithoutEffect = Annotation.define({ name: "facts.NoEffect", target: "operation", args: { limit: A.int } });
export const ComputedDefinition = Annotation.define({ name: "facts.Computed", target: "operation", args: { limit: A.int }, effect: { target: "endpoint", ["key"]: ClassKey } });
export const Fake = Object.assign((value: unknown) => value, { name: "facts.Fake" as const, effect: { target: "endpoint", key: ClassKey } });
export const Input = Schema.Struct({});
export const Read = HttpApiEndpoint.get("read", "/read", { query: Input, success: Schema.String })
  .annotate(FactoryDefinition.effect.key, { limit: 10 });
export class Group extends HttpApiGroup.make("facts").add(Read) {}
export class Root extends HttpApi.make("root").add(Group) {}
throw new Error("the analyzer must not execute this module");`;

  yield* fs.writeFileString(path.join(directory, "source.ts"), source);
  yield* fs.writeFileString(
    path.join(directory, "tsconfig.json"),
    `{"extends":"${repo}tsconfig.json","files":["source.ts"],"exclude":[],"effx":{"projectRoot":"."}}`,
  );

  return { tsconfigPath: path.join(directory, "tsconfig.json") };
});

describe("nominal annotation-definition source facts", () => {
  it.effect(
    "keeps canonical key exports and literal IDs without executing definitions or defaults",
    () =>
      Effect.gen(function* () {
        const model = Option.getOrThrow(
          (yield* (yield* LiftFrontend).analyze(yield* fixture())).value,
        );

        yield* decodeModel(model);

        const definition = (name: string) =>
          model.definitions.find((definition) => definition.name === name);

        assert.deepStrictEqual(definition("facts.Class")?.key, {
          ref: { module: "../../source", export: "ClassKey" },
          id: "facts/Class",
        });
        assert.deepStrictEqual(definition("facts.Factory")?.key, {
          ref: { module: "../../source", export: "FactoryKey" },
          id: "facts/Factory",
        });
        assert.deepStrictEqual(definition("facts.Default")?.key, {
          ref: { module: "../../source", export: "DefaultKey" },
          id: "facts/Default",
        });
        assert.isUndefined(definition("facts.NoEffect")?.key);
        assert.isDefined(definition("facts.Computed"));
        assert.isUndefined(definition("facts.Computed")?.key);
        assert.isFalse(model.definitions.some((definition) => definition.name === "facts.Fake"));

        const endpoint = model.endpoints.find((endpoint) => endpoint.symbol.export === "Read");

        const step = endpoint?.steps.find(
          (step) => step._tag === "Method" && step.name === "annotate",
        );

        assert.strictEqual(step?._tag, "Method");

        if (step?._tag === "Method") {
          const key = step.args[0];
          assert.strictEqual(key?._tag, "Lowered");

          if (key?._tag === "Lowered")
            assert.deepStrictEqual(key.term, {
              _tag: "Ref",
              ref: { module: "../../source", export: "FactoryKey" },
            });
        }
      }).pipe(Effect.provide(services)),
  );
});
