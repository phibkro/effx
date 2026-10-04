import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { SourceFrontend } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";

const tsconfigPath = new URL("./fixtures/users/tsconfig.json", import.meta.url).pathname;

const fixtureRoot = new URL("./fixtures/users/", import.meta.url).pathname;

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const groups = `
import { Context, Schema } from "effect";
import { HttpApi, HttpApiMiddleware, HttpApiSecurity } from "effect/http-api";
import { Http } from "@effx/runtime";
export const Root = HttpApi.make("api");
export const Success = Schema.String;
export const Input = Schema.Struct({ search: Schema.String });
export class Auth extends HttpApiMiddleware.Service<Auth>()("test/Auth", {
  security: { bearer: HttpApiSecurity.bearer }
}) {}
export const annotate = (_meta: unknown) => Context.empty();
export const authorize = (_spec: unknown) => Context.empty();
export const registry = (_id: string, _codes: readonly [string, ...string[]]) => [Schema.String];
export const Group = Http.group({ root: Root, group: "profile", defaults: {
  middleware: [Auth], metadata: { annotator: annotate }, problems: { registry },
  access: { annotator: authorize, exposure: "External", acceptedCredentials: ["Cookie"],
    principalKinds: ["Person"], concealment: { _tag: "Reveal" } }
} });
export const NotGroup = { name: "no" };
@Http.Group({ root: Root, group: "profile", defaults: {
  middleware: [Auth], metadata: { annotator: annotate }, problems: { registry },
  access: { annotator: authorize, exposure: "External", acceptedCredentials: ["Cookie"],
    principalKinds: ["Person"], concealment: { _tag: "Reveal" } }
} })
export class ClassGroup {}
export const InvalidGroup = Http.group({ root: UnknownRoot, group: "invalid" });
export const UnusedBrokenGroup = Http.group({ root: UnknownRoot, group: "unused" });
@Http.Group({ root: UnknownRoot, group: "unused-class" })
export class UnusedBrokenClass {}
`;

const operations = `
import { Effect } from "effect";
import { Http, Operation, Query } from "@effx/runtime";
import { Group as Alias, ClassGroup, Input, Success, NotGroup, InvalidGroup } from "./_group-source.ts";
export const read = Operation.query({ name: "profile.read", input: Input, success: Success })
  .in(Alias).http.get("/profile").http.contract({ query: true })
  .http.problems({ codes: ["not-found"] }).declare();
export const classReference = Operation.query({ name: "profile.class", input: Input, success: Success })
  .in(ClassGroup).http.get("/class").http.contract({}).declare();
@Http.Group({ root: "api", group: "local" })
export class LocalGroup {
  @Query({ name: "local.read", input: Input, success: Success })
  @Http.Get("/local")
  @Http.Contract({})
  static read() { return Effect.succeed("ok"); }
}
export const localRead = Operation.query({ name: "local.read", input: Input, success: Success })
  .in(LocalGroup).http.get("/local").http.contract({}).declare();
export const repeated = Operation.query({ input: Input, success: Success })
  .in(Alias).in(Alias).http.get("/repeated").http.contract({}).declare();
export const nongroup = Operation.query({ input: Input, success: Success })
  .in(NotGroup).http.get("/nongroup").http.contract({}).declare();
const hiddenGroup = Http.group({ root: "api", group: "private" });
export const hidden = Operation.query({ input: Input, success: Success })
  .in(hiddenGroup).http.get("/hidden").http.contract({}).declare();
export const missing = Operation.query({ input: Input, success: Success })
  .in(UnknownGroup).http.get("/missing").http.contract({}).declare();
export const invalidReference = Operation.query({ input: Input, success: Success })
  .in(InvalidGroup).http.get("/invalid").http.contract({}).declare();
`;

describe("group association lowering", () => {
  it.effect("lowers exported group defaults and references", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const groupPath = path.join(fixtureRoot, "src", "_group-source.ts");
      const operationPath = path.join(fixtureRoot, "src", "_group-operations.ts");
      yield* fs.writeFileString(groupPath, groups);
      yield* Effect.addFinalizer(() => fs.remove(groupPath).pipe(Effect.ignore));
      yield* fs.writeFileString(operationPath, operations);
      yield* Effect.addFinalizer(() => fs.remove(operationPath).pipe(Effect.ignore));

      const collected = yield* SourceFrontend.use((frontend) =>
        frontend.analyze({ tsconfigPath, entry: ["src/_group-operations.ts"] }),
      );

      const declaration = (id: string) => collected.declarations.find((item) => item.id === id);
      const group = declaration("Group");
      assert.isDefined(
        group,
        "imported group declarations must be collected: " +
          collected.diagnostics.map((d) => d.code + ": " + d.message).join("; "),
      );
      assert.isUndefined(declaration("InvalidGroup"));
      assert.isUndefined(declaration("UnusedBrokenGroup"));
      assert.isUndefined(declaration("UnusedBrokenClass"));
      assert.isTrue(
        collected.diagnostics.some(
          (item) => item.code === "EFFX1102" && item.message.includes("InvalidGroup"),
        ),
      );
      assert.isFalse(collected.diagnostics.some((item) => item.message.includes("UnusedBroken")));
      assert.deepStrictEqual(group?.annotations[0]?.args[0], {
        root: {
          _tag: "Symbol",
          ref: { module: "../../src/_group-source", export: "Root" },
          identifier: "api",
        },
        group: "profile",
        defaults: {
          middleware: [
            {
              _tag: "Symbol",
              ref: { module: "../../src/_group-source", export: "Auth" },
              security: true,
            },
          ],
          metadata: {
            annotator: {
              _tag: "Symbol",
              ref: { module: "../../src/_group-source", export: "annotate" },
            },
          },
          problems: {
            registry: {
              _tag: "Symbol",
              ref: { module: "../../src/_group-source", export: "registry" },
            },
          },
          access: {
            annotator: {
              _tag: "Symbol",
              ref: { module: "../../src/_group-source", export: "authorize" },
            },
            exposure: "External",
            acceptedCredentials: ["Cookie"],
            principalKinds: ["Person"],
            concealment: { _tag: "Reveal" },
          },
        },
      });
      assert.deepStrictEqual(declaration("ClassGroup")?.annotations, group?.annotations);
      assert.deepStrictEqual(
        declaration("read")?.annotations.find((item) => item.name === "Http.In")?.args,
        [{ _tag: "Symbol", ref: { module: "../../src/_group-source", export: "Group" } }],
      );
      assert.deepStrictEqual(
        declaration("classReference")?.annotations.find((item) => item.name === "Http.In")?.args,
        [{ _tag: "Symbol", ref: { module: "../../src/_group-source", export: "ClassGroup" } }],
      );
      const decorated = declaration("LocalGroup.read")?.annotations;
      const built = declaration("localRead")?.annotations;
      assert.isDefined(decorated);
      assert.deepStrictEqual(
        built?.filter((item) => item.name !== "Http.In"),
        decorated,
      );
      assert.deepStrictEqual(built?.find((item) => item.name === "Http.In")?.args, [
        { _tag: "Symbol", ref: { module: "../../src/_group-operations", export: "LocalGroup" } },
      ]);

      for (const id of ["repeated", "nongroup", "missing", "hidden"])
        assert.include(collected.diagnostics.map((item) => item.message).join("\n"), id);
      assert.isAtLeast(collected.diagnostics.filter((item) => item.code === "EFFX2404").length, 4);
      assert.isUndefined(declaration("repeated"));
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
