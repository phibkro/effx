import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { type EmitMode, Extensions, SourceFrontend, compileCollected } from "@effx/compiler";
import { canonical } from "@effx/ir";
import { TsSourceFrontend } from "@effx/frontend-ts";

const testDirectory = new URL("./", import.meta.url).pathname;

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

const native = `
import { Schema } from "effect";
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/http-api";
const Native = HttpApi.make("inventory").add(HttpApiGroup.make("profile").add(
  HttpApiEndpoint.get("read", "/", { success: Schema.String }),
  HttpApiEndpoint.get("handWritten", "/manual", { success: Schema.String }),
));
`;

const operations = (key: string, validOperationId: boolean) => `
import { Schema } from "effect";
import { Http, Operation } from "@effx/runtime";
import { ApiAlias } from "./barrel.ts";
export const Input = Schema.Struct({});
export const Output = Schema.String;
export const Profile = Http.group({ root: ApiAlias, group: "profile" });
export const Read = Operation.query({ name: "Read", input: Input, success: Output })
  .in(Profile).http.get("/")
  .http.contract({ success: Output, metadata: { operationId: "${validOperationId ? "profile" : "invalid"}.${key}" } })
  .declare();
`;

const collectSource = Effect.fnUntraced(function* (
  root = "export const Root = Native;",
  key = "read",
  emit: EmitMode = "handlers",
  validOperationId = true,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fs.makeTempDirectoryScoped({ directory: testDirectory });
  const tsconfigPath = path.join(directory, "tsconfig.json");
  yield* fs.writeFileString(
    tsconfigPath,
    `{"extends":"../../../../tsconfig.json","include":["operations.ts"],"exclude":[],"effx":{"projectRoot":".","emit":"${emit}"}}`,
  );
  yield* fs.writeFileString(path.join(directory, "root.ts"), native + root);
  yield* fs.writeFileString(
    path.join(directory, "barrel.ts"),
    'export { Root as ApiAlias } from "./root.ts";',
  );
  yield* fs.writeFileString(
    path.join(directory, "operations.ts"),
    operations(key, validOperationId),
  );

  return yield* SourceFrontend.use((frontend) =>
    frontend.analyze({
      tsconfigPath,
      entry: ["operations.ts"],
      emit,
    }),
  );
});

const unsafeRoots = [
  ["any groups", "Omit<typeof Native, 'groups'> & { groups: any }"],
  ["unknown groups", "Omit<typeof Native, 'groups'> & { groups: unknown }"],
  [
    "union group",
    "Omit<typeof Native, 'groups'> & { groups: { profile: typeof Native.groups.profile | (Omit<typeof Native.groups.profile, 'identifier'> & { identifier: 'other' }) } }",
  ],
  [
    "indexed groups",
    "Omit<typeof Native, 'groups'> & { groups: Record<string, typeof Native.groups.profile> }",
  ],
  [
    "optional group",
    "Omit<typeof Native, 'groups'> & { groups: { profile?: typeof Native.groups.profile } }",
  ],
  [
    "wide group identifier",
    "Omit<typeof Native, 'groups'> & { groups: { profile: Omit<typeof Native.groups.profile, 'identifier'> & { identifier: string } } }",
  ],
  [
    "any endpoints",
    "Omit<typeof Native, 'groups'> & { groups: { profile: Omit<typeof Native.groups.profile, 'endpoints'> & { endpoints: any } } }",
  ],
  [
    "unknown endpoints",
    "Omit<typeof Native, 'groups'> & { groups: { profile: Omit<typeof Native.groups.profile, 'endpoints'> & { endpoints: unknown } } }",
  ],
  [
    "indexed endpoints",
    "Omit<typeof Native, 'groups'> & { groups: { profile: Omit<typeof Native.groups.profile, 'endpoints'> & { endpoints: Record<string, typeof Native.groups.profile.endpoints.read> } } }",
  ],
  [
    "optional endpoint",
    "Omit<typeof Native, 'groups'> & { groups: { profile: Omit<typeof Native.groups.profile, 'endpoints'> & { endpoints: { read?: typeof Native.groups.profile.endpoints.read } } } }",
  ],
  [
    "wide endpoint identifier",
    "Omit<typeof Native, 'groups'> & { groups: { profile: Omit<typeof Native.groups.profile, 'endpoints'> & { endpoints: { read: Omit<typeof Native.groups.profile.endpoints.read, 'identifier'> & { identifier: string } } } } }",
  ],
] as const;

describe("concrete HttpApi endpoint inventory", () => {
  it.effect(
    "keeps canonical root identity through a barrel and inventory outside semantic IR",
    () =>
      Effect.gen(function* () {
        const collected = yield* collectSource();
        assert.deepStrictEqual(
          collected.diagnostics.filter((d) => d.severity === "error"),
          [],
        );
        assert.deepStrictEqual(collected.httpApiGroups, [
          {
            root: { module: "../../root", export: "Root" },
            group: "profile",
            endpoints: ["handWritten", "read"],
          },
        ]);
        const result = yield* compileCollected(collected, Extensions.builtin);
        assert.deepStrictEqual(
          result.diagnostics.filter((d) => d.severity === "error"),
          [],
        );
        assert.isTrue(Option.isSome(result.files.value));
        const ir = Option.getOrThrow(result.ir.value);
        const group = ir.nodes.find((node) => node._tag === "HttpGroup");
        assert.deepStrictEqual(
          group?._tag === "HttpGroup" ? group.rootSymbol : undefined,
          collected.httpApiGroups?.[0]?.root,
        );
        const without = { ...collected, httpApiGroups: [] };
        const rejected = yield* compileCollected(without, Extensions.builtin);
        assert.strictEqual(canonical(ir), canonical(Option.getOrThrow(rejected.ir.value)));
        assert.isTrue(rejected.diagnostics.some((d) => d.code === "EFFX2415"));
        assert.isTrue(Option.isNone(rejected.files.value));
      }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("rejects a declared group absent from the concrete root", () =>
    Effect.gen(function* () {
      const collected = yield* collectSource(
        'export const Root = HttpApi.make("inventory").add(HttpApiGroup.make("other"));',
      );

      const result = yield* compileCollected(collected, Extensions.builtin);
      assert.isTrue(
        result.diagnostics.some((d) => d.code === "EFFX2415" && d.message.includes("profile")),
      );
      assert.isTrue(Option.isNone(result.files.value));
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect.each(["contract", "handlers", "all"] as const)(
    "rejects a declared endpoint absent from the concrete root in %s mode",
    (emit) =>
      Effect.gen(function* () {
        const collected = yield* collectSource(undefined, "missing", emit);
        const result = yield* compileCollected(collected, Extensions.builtin);
        assert.isTrue(
          result.diagnostics.some((d) => d.code === "EFFX2415" && d.message.includes("missing")),
        );
        assert.isTrue(Option.isNone(result.files.value));
      }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("reveals the inventory defect after the earlier fatal contract defect is fixed", () =>
    Effect.gen(function* () {
      const both = yield* collectSource(undefined, "missing", "handlers", false);
      const blocked = yield* compileCollected(both, Extensions.builtin);
      assert.deepStrictEqual(
        blocked.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.code),
        ["EFFX2403"],
      );
      assert.isTrue(Option.isNone(blocked.files.value));

      const repaired = yield* collectSource(undefined, "missing", "handlers");
      const revealed = yield* compileCollected(repaired, Extensions.builtin);
      assert.deepStrictEqual(
        revealed.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.code),
        ["EFFX2415"],
      );
      assert.isTrue(Option.isNone(revealed.files.value));
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect.each(unsafeRoots)("rejects unprovable %s before generation", ([, type]) =>
    Effect.gen(function* () {
      const collected = yield* collectSource(`export declare const Root: ${type};`);
      assert.isTrue(
        collected.diagnostics.some((d) => d.code === "EFFX2415" && d.location !== undefined),
      );
      assert.isUndefined(collected.httpApiGroups);
      const result = yield* compileCollected(collected, Extensions.builtin);
      assert.isTrue(Option.isNone(result.files.value));
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
