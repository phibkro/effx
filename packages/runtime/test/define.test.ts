import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Context, Schema } from "effect";
import { A, Annotation, Reflect, rest } from "@effx/runtime";

const RateLimit = Annotation.define({
  name: "app.RateLimit",
  target: "operation",
  args: { perMinute: A.int, burst: A.optional(A.int) },
  cardinality: "one",
});

const Path = Annotation.define({ name: "app.Path", target: "operation", args: [A.string] });

const Errs = Annotation.define({ name: "app.Errs", target: "operation", args: rest(A.schema()) });

class Users {
  @RateLimit({ perMinute: 60 })
  @Path("/x")
  static list() {}
}

const listMethod = Object.getOwnPropertyDescriptor(Users, "list")?.value;

describe("Annotation.define", () => {
  it("records exactly { name, args } on the decorated method, in source order", () => {
    assert.deepStrictEqual(Reflect.annotationsOf(listMethod), [
      { name: "app.RateLimit", args: [{ perMinute: 60 }] },
      { name: "app.Path", args: ["/x"] },
    ]);
  });

  it("derives the plan from args", () => {
    assert.deepStrictEqual(RateLimit.plan, {
      items: [
        {
          _tag: "Struct",
          fields: { perMinute: { _tag: "Int" }, burst: { _tag: "Int" } },
          optional: ["burst"],
        },
      ],
    });
    assert.deepStrictEqual(Path.plan, { items: [{ _tag: "String" }] });
    assert.deepStrictEqual(Errs.plan, { items: [], rest: { _tag: "Schema" } });
    assert.strictEqual(RateLimit.cardinality, "one");
  });

  it("types the declaration site from args", () => {
    expectTypeOf(RateLimit).parameters.toEqualTypeOf<
      [options: { readonly perMinute: number; readonly burst?: number }]
    >();
    expectTypeOf(Path).parameters.toEqualTypeOf<[path: string]>();
    expectTypeOf(Errs).parameters.toEqualTypeOf<Schema.Top[]>();
    expectTypeOf(RateLimit.name).toEqualTypeOf<"app.RateLimit">();
  });

  it("rejects wrong argument shapes and internal targets at compile time", () => {
    // @ts-expect-error perMinute is required
    RateLimit({ burst: 1 });
    // @ts-expect-error a path is a string
    Path(1);
    // @ts-expect-error class targets are internal in v1
    Annotation.define({ name: "app.Bad", target: "class", args: [] });
  });

  it("keeps the exact Context.Key of an effect clause and rejects every target but the endpoint", () => {
    class Policy extends Context.Service<Policy, { readonly perMinute: number }>()("app/Policy") {}

    const Limited = Annotation.define({
      name: "app.Limited",
      target: "operation",
      args: { perMinute: A.int },
      effect: { target: "endpoint", key: Policy },
    });

    assert.strictEqual(Limited.effect.key.key, "app/Policy");
    assert.strictEqual(Limited.effect.target, "endpoint");
    expectTypeOf(Limited.effect.key).toEqualTypeOf<typeof Policy>();
    expectTypeOf(Limited.effect.target).toEqualTypeOf<"endpoint">();
    expectTypeOf(RateLimit.effect).toEqualTypeOf<undefined>();
    assert.isUndefined(RateLimit.effect);

    Annotation.define({
      name: "app.Group",
      target: "operation",
      args: [],
      // @ts-expect-error v1 writes the endpoint only; the group slot is a later spec
      effect: { target: "group", key: Policy },
    });
    Annotation.define({
      name: "app.NotAKey",
      target: "operation",
      args: [],
      // @ts-expect-error a clause key is a Context.Key, not a bare id
      effect: { target: "endpoint", key: { key: "app/NotAKey" } },
    });
  });
});
