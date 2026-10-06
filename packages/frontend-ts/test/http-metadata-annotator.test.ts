import { copyUsersFixture } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { AnnotationArg, Extensions, SourceFrontend, compile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const source = `
import { Context, Effect, Schema } from "effect";
import { Http, Operation, Query } from "@effx/runtime";
export const ReadInput = Schema.Struct({});
export const ReadOutput = Schema.String;
export const annotateOperation = (_metadata: unknown) => Context.empty();
export const notCallable = 42;
const hiddenAnnotator = (_metadata: unknown) => Context.empty();

export class ProfileOperations {
  @Query({ name: "Profile.Read" })
  @Http.Get("/profile")
  @Http.Contract({ group: "profile", success: ReadOutput, metadata: {
    annotator: annotateOperation, operationId: "profile.read", summary: "Read",
    description: "Current profile", tags: ["Profile"]
  } })
  static read() { return Effect.succeed("ok"); }
}
export const readProfile = Operation.query({ name: "Profile.Read", input: ReadInput, success: ReadOutput })
  .http.get("/profile")
  .http.contract({ group: "profile", success: ReadOutput, metadata: {
    annotator: annotateOperation, operationId: "profile.read", summary: "Read",
    description: "Current profile", tags: ["Profile"]
  } })
  .handler(() => Effect.succeed("ok"));
export const hidden = Operation.query({ name: "Profile.Hidden", input: ReadInput, success: ReadOutput })
  .http.get("/hidden")
  .http.contract({ group: "profile", success: ReadOutput, metadata: { annotator: hiddenAnnotator } })
  .declare();
export const invalid = Operation.query({ name: "Profile.Invalid", input: ReadInput, success: ReadOutput })
  .http.get("/invalid")
  .http.contract({ group: "profile", success: ReadOutput, metadata: { annotator: notCallable } })
  .declare();
export const inline = Operation.query({ name: "Profile.Inline", input: ReadInput, success: ReadOutput })
  .http.get("/inline")
  .http.contract({ group: "profile", success: ReadOutput, metadata: { annotator: () => Context.empty() } })
  .declare();
`;

describe("Http.Contract metadata annotator lowering", () => {
  it.effect(
    "retains the same exported callable ref in builder and decorator syntax, rejects invalid callables",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixtureRoot = yield* copyUsersFixture();
        const tsconfigPath = path.join(fixtureRoot, "tsconfig.json");
        const fixture = path.join(fixtureRoot, "src", "_metadata-annotator.ts");
        yield* fs.writeFileString(fixture, source);
        yield* Effect.addFinalizer(() => fs.remove(fixture).pipe(Effect.ignore));

        const collected = yield* SourceFrontend.use((frontend) =>
          frontend.analyze({ tsconfigPath, entry: ["src/_metadata-annotator.ts"] }),
        );

        const decorated = collected.declarations.find(
          (item) => item.id === "ProfileOperations.read",
        );

        const built = collected.declarations.find((item) => item.id === "readProfile");
        assert.isDefined(decorated);
        assert.isDefined(built);

        const decoratedContract = decorated?.annotations.find(
          (annotation) => annotation.name === "Http.Contract",
        );

        const builtContract = built?.annotations.find(
          (annotation) => annotation.name === "Http.Contract",
        );

        const parsed = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            metadata: Schema.Struct({
              annotator: AnnotationArg,
              operationId: Schema.String,
              summary: Schema.String,
              description: Schema.String,
              tags: Schema.Array(Schema.String),
            }),
          }),
        )(decoratedContract?.args[0]);

        assert.deepStrictEqual(parsed.metadata, {
          annotator: {
            _tag: "Symbol",
            ref: { module: "../../src/_metadata-annotator", export: "annotateOperation" },
          },
          operationId: "profile.read",
          summary: "Read",
          description: "Current profile",
          tags: ["Profile"],
        });
        assert.deepStrictEqual(builtContract, decoratedContract);

        const invalid = collected.diagnostics.filter(
          (diagnostic) => diagnostic.code === "EFFX1102",
        );

        assert.strictEqual(invalid.length, 3);

        for (const id of ["hidden", "invalid", "inline"]) {
          const declaration = collected.declarations.find((item) => item.id === id);
          assert.isDefined(declaration);
          assert.isFalse(
            declaration?.annotations.some((annotation) => annotation.name === "Http.Contract"),
            `${id} must not retain an invalid HTTP contract`,
          );
        }

        const compiled = yield* compile(
          { tsconfigPath, entry: ["src/_metadata-annotator.ts"] },
          Extensions.builtin,
        );

        assert.include(
          compiled.diagnostics.map((diagnostic) => diagnostic.code),
          "EFFX1102",
        );
        assert.isTrue(Option.isNone(compiled.files.value));
      }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
