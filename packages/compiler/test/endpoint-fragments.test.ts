import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Context, Effect, Option } from "effect";
import { A, Annotation } from "@effx/runtime";
import {
  type Annotation as CollectedAnnotation,
  type Collected,
  type EndpointFragment,
  type Extension,
  Extensions,
  compileCollected,
  extension,
  implement,
} from "@effx/compiler";
import { decoratorStyle, getUser } from "./fixtures/users.ts";
import { UserPublic } from "../../ir/test/fixtures/users.ts";

class RateLimitPolicy extends Context.Service<
  RateLimitPolicy,
  { readonly perMinute: number; readonly burst?: number }
>()("app/RateLimit") {}

class TagPolicy extends Context.Service<TagPolicy, unknown>()("app/Tag") {}

class BarePolicy extends Context.Service<BarePolicy, unknown>()("app/Bare") {}

class OwnedPolicy extends Context.Service<OwnedPolicy, unknown>()("app/Owned") {}

class CalledPolicy extends Context.Service<CalledPolicy, unknown>()("app/Called") {}

class HookedPolicy extends Context.Service<HookedPolicy, unknown>()("app/Hooked") {}

class MetaPolicy extends Context.Service<MetaPolicy, unknown>()("app/Meta") {}

const RateLimit = Annotation.define({
  name: "app.RateLimit",
  target: "operation",
  args: { perMinute: A.int, burst: A.optional(A.int) },
  cardinality: "one",
  effect: { target: "endpoint", key: RateLimitPolicy },
});

const Plain = Annotation.define({
  name: "app.Plain",
  target: "operation",
  args: { perMinute: A.int },
});

const Tag = Annotation.define({
  name: "app.Tag",
  target: "operation",
  args: [A.string, A.int],
  effect: { target: "endpoint", key: TagPolicy },
});

const Bare = Annotation.define({
  name: "app.Bare",
  target: "operation",
  args: [A.string],
  effect: { target: "endpoint", key: BarePolicy },
});

const Owned = Annotation.define({
  name: "app.Owned",
  target: "operation",
  args: [A.schema()],
  effect: { target: "endpoint", key: OwnedPolicy },
});

const Called = Annotation.define({
  name: "app.Called",
  target: "operation",
  args: [A.symbol<unknown>({ check: "exported-value" })],
  effect: { target: "endpoint", key: CalledPolicy },
});

const Meta = Annotation.define({
  name: "app.Meta",
  target: "operation",
  args: [A.json],
  effect: { target: "endpoint", key: MetaPolicy },
});

const Hooked = Annotation.define({
  name: "app.Hooked",
  target: "operation",
  args: [A.json],
  effect: { target: "endpoint", key: HookedPolicy },
});

const rateLimitRef = { module: "defs/rate-limit", export: "RateLimit" };

const annotated = (...annotations: ReadonlyArray<CollectedAnnotation>): Collected => ({
  ...decoratorStyle,
  declarations: decoratorStyle.declarations.map((declaration) =>
    declaration.id === getUser.id
      ? { ...declaration, annotations: [...declaration.annotations, ...annotations] }
      : declaration,
  ),
});

const withApp = (...extensions: ReadonlyArray<Extension>): ReadonlyArray<Extension> => [
  ...Extensions.builtin,
  ...extensions,
];

const app = extension("app", [implement(RateLimit), implement(Plain)]);

const httpOf = Effect.fnUntraced(function* (
  collected: Collected,
  extensions: ReadonlyArray<Extension>,
) {
  const result = yield* compileCollected(collected, extensions);
  const files = Option.getOrThrow(result.files.value);

  return files.find((file) => file.path === "http.ts")?.contents ?? "";
});

const rateLimited = annotated({
  name: "app.RateLimit",
  args: [{ perMinute: 60, burst: 5 }],
  definition: rateLimitRef,
});

describe("the default writer of an effect clause", () => {
  it.effect("appends .annotate(<Definition>.effect.key, <value>) to the endpoint", () =>
    Effect.gen(function* () {
      const http = yield* httpOf(rateLimited, withApp(app));

      assert.include(http, ".annotate(RateLimit.effect.key, { perMinute: 60, burst: 5 })");
      assert.include(http, 'import { RateLimit } from "defs/rate-limit";');
      // only the annotated operation carries it
      assert.strictEqual(http.split(".annotate(RateLimit.effect.key").length, 2);
    }),
  );

  it.effect("omits an absent optional field and never emits undefined", () =>
    Effect.gen(function* () {
      const http = yield* httpOf(
        annotated({ name: "app.RateLimit", args: [{ perMinute: 7 }], definition: rateLimitRef }),
        withApp(app),
      );

      assert.include(http, ".annotate(RateLimit.effect.key, { perMinute: 7 })");
      assert.notInclude(http, "undefined");
    }),
  );

  it.effect(
    "emits nothing without an effect clause, and the file equals the one without the annotation",
    () =>
      Effect.gen(function* () {
        const plain = yield* httpOf(
          annotated({ name: "app.Plain", args: [{ perMinute: 1 }], definition: rateLimitRef }),
          withApp(app),
        );

        const without = yield* httpOf(decoratorStyle, withApp(app));

        assert.notInclude(plain, ".annotate(");
        assert.strictEqual(plain, without);
      }),
  );

  it.effect(
    "emits nothing for an annotation without a recorded definition (hand-built Collected)",
    () =>
      Effect.gen(function* () {
        const result = yield* compileCollected(
          annotated({ name: "app.RateLimit", args: [{ perMinute: 60 }] }),
          withApp(app),
        );

        const files = Option.getOrThrow(result.files.value);

        assert.deepStrictEqual(
          result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        assert.notInclude(
          files.find((file) => file.path === "http.ts")?.contents ?? "",
          ".annotate(",
        );
      }),
  );

  it.effect(
    "prints one argument as the value, several as an array, and keeps declaration order",
    () =>
      Effect.gen(function* () {
        const tagRef = { module: "defs/tag", export: "Tag" };
        const bareRef = { module: "defs/bare", export: "Bare" };

        const collected = annotated(
          { name: "app.Bare", args: ["x"], definition: bareRef },
          { name: "app.Tag", args: ["a", 3], definition: tagRef },
        );

        // extension-list order, not the order the annotations were written in
        const http = yield* httpOf(
          collected,
          withApp(extension("first", [implement(Tag)]), extension("second", [implement(Bare)])),
        );

        const tag = http.indexOf('.annotate(Tag.effect.key, ["a", 3])');
        const bare = http.indexOf('.annotate(Bare.effect.key, "x")');

        assert.isTrue(tag >= 0 && bare > tag);
      }),
  );

  it.effect("prints JSON by structure: quoted keys, nested arrays, empty containers", () =>
    Effect.gen(function* () {
      const http = yield* httpOf(
        annotated({
          name: "app.Meta",
          args: [{ "x-key": [1, true, 's"q'], empty: {}, none: [] }],
          definition: { module: "defs/meta", export: "Meta" },
        }),
        withApp(extension("app", [implement(Meta)])),
      );

      assert.include(
        http,
        '.annotate(Meta.effect.key, { "x-key": [1, true, "s\\"q"], empty: {}, none: [] })',
      );
    }),
  );

  it.effect("imports a lowered Schema or Symbol argument and honours a member", () =>
    Effect.gen(function* () {
      const http = yield* httpOf(
        annotated(
          {
            name: "app.Owned",
            args: [{ _tag: "Schema", ref: UserPublic }],
            definition: { module: "defs/owned", export: "Owned" },
          },
          {
            name: "app.Called",
            args: [
              {
                _tag: "Symbol",
                ref: { module: "defs/access", export: "Access", member: "annotator" },
              },
            ],
            definition: { module: "defs/called", export: "Called" },
          },
        ),
        withApp(extension("app", [implement(Owned), implement(Called)])),
      );

      assert.include(http, ".annotate(Owned.effect.key, User)");
      assert.include(http, ".annotate(Called.effect.key, Access.annotator)");
      assert.include(http, 'import { Access } from "defs/access";');
    }),
  );

  it.effect("an argument the writer cannot print is EFFX1102, never dropped", () =>
    Effect.gen(function* () {
      const result = yield* compileCollected(
        annotated({
          name: "app.Hooked",
          args: [{ ok: 1, hook: { _tag: "Lambda" } }],
          definition: { module: "defs/hooked", export: "Hooked" },
        }),
        withApp(extension("app", [implement(Hooked)])),
      );

      assert.isTrue(Option.isNone(result.files.value));

      const problem = result.diagnostics.find((diagnostic) => diagnostic.code === "EFFX1102");

      assert.isDefined(problem);
    }),
  );

  it("an extension derives one fragment per definition with an effect clause", () => {
    const fragments = extension("app", [
      implement(RateLimit),
      implement(Plain),
      implement(Tag),
    ]).fragments;

    assert.strictEqual(fragments?.length, 2);
    assert.isUndefined(extension("plain", [implement(Plain)]).fragments);
    expectTypeOf(fragments).toEqualTypeOf<ReadonlyArray<EndpointFragment> | undefined>();
  });
});
