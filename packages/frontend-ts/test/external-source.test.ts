import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import {
  type Collected,
  type Declaration,
  Extensions,
  SourceFrontend,
  compileCollected,
  interpret,
} from "@effx/compiler";
import { StableId, canonical } from "@effx/ir";
import { TsSourceFrontend } from "@effx/frontend-ts";

const tsconfigPath = new URL("./fixtures/users/tsconfig.json", import.meta.url).pathname;

const fixtureRoot = new URL("./fixtures/users/", import.meta.url).pathname;

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const source = `
import { Http, Operation } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { User } from "./user.ts";
import { UserNotFound } from "./errors.ts";
import { Users } from "./services.ts";
import { UserProblemResponses } from "./contract-support.ts";
import "./_external-source-helper.ts";

@Http.Group({ root: "effx", group: "profile", title: "Profile", description: "Own profile", displayName: "Profile" })
export class DecoratedGroup {}

export const BuiltGroup = Http.group({
  root: "effx", group: "profile", title: "Profile", description: "Own profile", displayName: "Profile"
});

export const ReadProfile = Operation.query({
  name: "Profile.Read", input: GetUserInput, success: User.Public
})
  .http.get("/api/profile")
  .http.contract({
    root: "effx", group: "profile", success: User.Public,
    metadata: { operationId: "profile.readOwnProfile" }
  })
  .http.problems({
    registry: UserProblemResponses, codes: ["user.not-found"], identifier: "ProfileReadOwnProfileProblem",
    map: { UserNotFound: "user.not-found" }
  })
  .errors(UserNotFound)
  .requirements(Users)
  .declare();
`;

const helper = `
import { Http, Operation } from "@effx/runtime";
import { HttpApi } from "effect/http-api";
export const RootApi = HttpApi.make("effx");
export const WideApi = HttpApi.make("effx" as string);
export const UnselectedGroup = Http.group({ root: "effx", group: "unselected" });
export const InvalidUnusedGroup = Http.group({ root: UnknownRoot, group: "unused" });
@Http.Group({ root: UnknownRoot, group: "unused-class" })
export class InvalidUnusedClass {}
export const ImportedOperation = Operation.query({ name: "unused" }).declare();
`;

const onlyCoreAnnotations = (declaration: Declaration): Declaration => ({
  ...declaration,
  annotations: declaration.annotations.filter((annotation) =>
    ["Query", "Command", "Errors", "Requirements"].includes(annotation.name),
  ),
});

const selected = (declarations: ReadonlyArray<Declaration>): Collected => ({
  declarations,
  diagnostics: [],
});

const coreOnly = [Extensions.core];

const loadFixture = Effect.fnUntraced(function* (sourceText: string = source) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entry = path.join(fixtureRoot, "src", "_external-source.ts");
  const imported = path.join(fixtureRoot, "src", "_external-source-helper.ts");
  yield* fs.writeFileString(imported, helper);
  yield* Effect.addFinalizer(() => fs.remove(imported).pipe(Effect.ignore));
  yield* fs.writeFileString(entry, sourceText);
  yield* Effect.addFinalizer(() => fs.remove(entry).pipe(Effect.ignore));

  return yield* SourceFrontend.use((frontend) =>
    frontend.analyze({ tsconfigPath, entry: ["src/_external-source.ts"] }),
  );
});

describe("declaration-only source lowering", () => {
  it.effect(
    "collects only the entry, and both group syntaxes lower to identical standalone IR",
    () =>
      Effect.gen(function* () {
        const collected = yield* loadFixture();
        assert.deepStrictEqual(
          collected.diagnostics.filter((d) => d.severity === "error"),
          [],
        );
        assert.isUndefined(collected.declarations.find((d) => d.id === "UnselectedGroup"));
        assert.isUndefined(collected.declarations.find((d) => d.id === "InvalidUnusedGroup"));
        assert.isUndefined(collected.declarations.find((d) => d.id === "InvalidUnusedClass"));
        assert.isUndefined(collected.declarations.find((d) => d.id === "ImportedOperation"));
        assert.isTrue(collected.declarations.some((d) => d.id === "User" && d.kind === "model"));

        const decorated = collected.declarations.find((d) => d.id === "DecoratedGroup")!;
        const built = collected.declarations.find((d) => d.id === "BuiltGroup")!;
        const declared = collected.declarations.find((d) => d.id === "ReadProfile")!;

        assert.strictEqual(decorated.kind, "class");
        assert.strictEqual(built.kind, "builder");
        assert.deepStrictEqual(decorated.annotations, built.annotations);
        assert.deepStrictEqual(
          decorated.annotations.map((a) => a.name),
          ["Http.Group"],
        );
        assert.strictEqual(declared.binding, "external");
        assert.isUndefined(declared.member);
        assert.isUndefined(declared.handlerSignature);

        const decoratorIR = interpret(selected([decorated]), Extensions.builtin);
        const builderIR = interpret(selected([built]), Extensions.builtin);
        assert.deepStrictEqual(decoratorIR.diagnostics, []);
        assert.deepStrictEqual(builderIR.diagnostics, []);
        assert.strictEqual(
          canonical(Option.getOrThrow(decoratorIR.value)),
          canonical(Option.getOrThrow(builderIR.value)),
        );

        const group = Option.getOrThrow(builderIR.value).nodes.find(
          (node) => node._tag === "HttpGroup",
        );

        assert.deepStrictEqual(group, {
          _tag: "HttpGroup",
          id: StableId.make("group", "effx/profile"),
          root: "effx",
          group: "profile",
          title: "Profile",
          description: "Own profile",
          displayName: "Profile",
        });

        const external = interpret(selected([onlyCoreAnnotations(declared)]), coreOnly);
        assert.deepStrictEqual(external.diagnostics, []);

        const operation = Option.getOrThrow(external.value).nodes.find(
          (node) => node._tag === "Operation",
        );

        assert.strictEqual(operation?._tag, "Operation");

        if (operation?._tag === "Operation") {
          assert.strictEqual(operation.binding, "external");
          assert.isUndefined(operation.handler);
          assert.isFalse(operation.errors.inferred);
          assert.isFalse(operation.requirements.inferred);
          assert.deepStrictEqual(
            operation.errors.values.map((ref) => ref.export),
            ["UserNotFound"],
          );
          assert.deepStrictEqual(operation.requirements.values.map(String), ["service:Users"]);
        }

        const bare = onlyCoreAnnotations(declared);

        const withoutChannelClaims = interpret(
          selected([{ ...bare, annotations: bare.annotations.filter((a) => a.name === "Query") }]),
          coreOnly,
        );

        const unclaimed = Option.getOrThrow(withoutChannelClaims.value).nodes.find(
          (node) => node._tag === "Operation",
        );

        assert.strictEqual(unclaimed?._tag, "Operation");

        if (unclaimed?._tag === "Operation") {
          assert.isFalse(unclaimed.errors.inferred);
          assert.isFalse(unclaimed.requirements.inferred);
          assert.deepStrictEqual(unclaimed.errors.values, []);
          assert.deepStrictEqual(unclaimed.requirements.values, []);
        }
      }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("rejects malformed external/local binding pairs and executable projections", () =>
    Effect.gen(function* () {
      const collected = yield* loadFixture();

      const sourceDeclaration = onlyCoreAnnotations(
        collected.declarations.find((d) => d.id === "ReadProfile")!,
      );

      const withHandler = { ...sourceDeclaration, member: "handler" };

      const localWithoutHandler: Declaration = {
        id: sourceDeclaration.id,
        kind: "builder",
        module: sourceDeclaration.module,
        export: sourceDeclaration.export,
        annotations: sourceDeclaration.annotations,
      };

      for (const malformed of [withHandler, localWithoutHandler]) {
        const result = yield* compileCollected(selected([malformed]), coreOnly);
        assert.isTrue(result.diagnostics.some((d) => d.code === "EFFX1106"));
        assert.isTrue(Option.isNone(result.files.value));
      }

      for (const [extension, annotation] of [
        [Extensions.rpc, { name: "Rpc", args: ["Profile.Read"] }],
        [Extensions.cli, { name: "Cli", args: ["profile read"] }],
      ] as const) {
        const result = yield* compileCollected(
          selected([
            {
              ...sourceDeclaration,
              annotations: [...sourceDeclaration.annotations, annotation],
            },
          ]),
          [Extensions.core, extension],
        );

        assert.isTrue(result.diagnostics.some((d) => d.code === "EFFX1107"));
        assert.isTrue(Option.isNone(result.files.value));
      }

      const errorSchema = sourceDeclaration.annotations.find((a) => a.name === "Errors")?.args[0];
      assert.isDefined(errorSchema);

      if (errorSchema !== undefined) {
        const foldkit = yield* compileCollected(
          selected([
            {
              ...sourceDeclaration,
              annotations: [
                ...sourceDeclaration.annotations,
                { name: "Foldkit.Command", args: [{ success: errorSchema, failure: errorSchema }] },
              ],
            },
          ]),
          [Extensions.core, Extensions.foldkitExtension],
        );

        assert.isTrue(foldkit.diagnostics.some((d) => d.code === "EFFX1107"));
        assert.isTrue(Option.isNone(foldkit.files.value));
      }
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
  it.effect("resolves decorator and builder roots through the same exported HttpApi symbol", () =>
    Effect.gen(function* () {
      const concrete = source
        .replace(
          'import "./_external-source-helper.ts";',
          'import { RootApi as CanonicalRoot } from "./_external-source-helper.ts";',
        )
        .replace('@Http.Group({ root: "effx"', "@Http.Group({ root: CanonicalRoot")
        .replace(
          '  root: "effx", group: "profile", title: "Profile"',
          '  root: CanonicalRoot, group: "profile", title: "Profile"',
        );

      const collected = yield* loadFixture(concrete);
      assert.deepStrictEqual(
        collected.diagnostics.filter((d) => d.severity === "error"),
        [],
      );
      const decorated = collected.declarations.find((d) => d.id === "DecoratedGroup")!;
      const built = collected.declarations.find((d) => d.id === "BuiltGroup")!;
      assert.deepStrictEqual(decorated.annotations, built.annotations);
      const decoratorIR = interpret(selected([decorated]), Extensions.builtin);
      const builderIR = interpret(selected([built]), Extensions.builtin);
      assert.deepStrictEqual(decoratorIR.diagnostics, []);
      assert.deepStrictEqual(builderIR.diagnostics, []);
      const ir = Option.getOrThrow(builderIR.value);
      assert.strictEqual(canonical(ir), canonical(Option.getOrThrow(decoratorIR.value)));
      const group = ir.nodes.find((node) => node._tag === "HttpGroup");
      assert.strictEqual(group?.id, StableId.make("group", "effx/profile"));
      assert.strictEqual(group?._tag, "HttpGroup");

      if (group?._tag === "HttpGroup") {
        assert.strictEqual(group.root, "effx");
        assert.strictEqual(group.rootSymbol?.export, "RootApi");
      }

      assert.notInclude(canonical(ir), fixtureRoot);
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("diagnoses unexported, nonliteral and non-HttpApi group root values", () =>
    Effect.gen(function* () {
      const groupSource = `
import { Http } from "@effx/runtime";
import { HttpApi } from "effect/http-api";
import { WideApi } from "./_external-source-helper.ts";
const HiddenRoot = HttpApi.make("effx");
export const FakeRoot = { identifier: "effx" as const };
export const Group = Http.group({ root: ROOT, group: "profile" });
`;

      for (const root of [
        "HiddenRoot",
        "WideApi",
        "FakeRoot",
        'HttpApi.make("effx")',
        "MissingRoot",
      ]) {
        const collected = yield* loadFixture(groupSource.replace("ROOT", root));
        assert.isTrue(
          collected.diagnostics.some((d) => d.code === "EFFX1102"),
          root,
        );
        assert.isUndefined(collected.declarations.find((d) => d.id === "Group"));
      }

      const decorated = yield* loadFixture(
        groupSource.replace(
          'export const Group = Http.group({ root: ROOT, group: "profile" });',
          '@Http.Group({ root: WideApi, group: "profile" }) export class Group {}',
        ),
      );

      assert.isTrue(decorated.diagnostics.some((d) => d.code === "EFFX1102"));
      assert.isUndefined(decorated.declarations.find((d) => d.id === "Group"));
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("stops unexported group classes before generation", () =>
    Effect.gen(function* () {
      const collected = yield* loadFixture(`
import { Http } from "@effx/runtime";
@Http.Group({ root: "effx", group: "hidden" })
class HiddenGroup {}
`);

      assert.isUndefined(collected.declarations.find((d) => d.id === "HiddenGroup"));
      assert.isTrue(collected.diagnostics.some((d) => d.code === "EFFX1104"));
      const compiled = yield* compileCollected(collected, Extensions.builtin);
      assert.isTrue(Option.isNone(compiled.files.value));
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
