import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import { Builtins, Http, Operation, Reflect, type Plan } from "@effx/runtime";

const Token = Schema.Struct({ "x-token": Schema.String });

const Success = Schema.Struct({ ok: Schema.Boolean });

type SchemaPlan = Extract<Plan, { readonly _tag: "Schema" }>;

/** The plan of one field of an annotation whose only argument is an options struct. */
const fieldPlan = (
  definition: { readonly plan: { readonly items: ReadonlyArray<Plan> } },
  field: string,
): Plan | undefined => {
  const options = definition.plan.items[0];

  return options?._tag === "Struct" ? options.fields[field] : undefined;
};

describe("Http.headers (spec 0024 §2.2)", () => {
  it("is the identity function at runtime", () => {
    assert.strictEqual(Http.headers(Token), Token);
  });

  it("stamps the brand on the static type and keeps everything the Schema had", () => {
    const marked = Http.headers(Token);

    expectTypeOf(marked).toEqualTypeOf<typeof Token & { readonly "~effx/Http/Headers": true }>();
    expectTypeOf(marked).toExtend<typeof Token>();
    expectTypeOf(marked.fields).toEqualTypeOf<typeof Token.fields>();
    expectTypeOf(marked.Type).toEqualTypeOf<typeof Token.Type>();
    // @ts-expect-error a Schema nobody wrapped does not carry the brand
    expectTypeOf(Token).toExtend<{ readonly "~effx/Http/Headers": true }>();
  });

  it("only accepts a Schema", () => {
    // @ts-expect-error a plain object is no Schema
    Http.headers({ "x-token": "a" });
  });

  it("is no annotation: no definition, no Reflect export, no builder step, no recorded annotation", () => {
    assert.isFalse(Builtins.all.some((definition) => definition.name.endsWith("headers")));
    assert.deepStrictEqual(Object.keys(Reflect), ["annotationsOf"]);
    assert.isFalse("headers" in Operation.query({ input: Token, success: Success }));
    assert.isFalse("headers" in Operation.query({ input: Token, success: Success }).http);
    assert.deepStrictEqual(Reflect.annotationsOf(Http.headers(Token)), []);
  });
});

describe("the lowering plan of an operation input (spec 0024 §2)", () => {
  it("Query and Command record their input's field keys, and tolerate a Schema without them", () => {
    for (const definition of [Builtins.Query, Builtins.Command]) {
      assert.deepStrictEqual(fieldPlan(definition, "input"), {
        _tag: "Schema",
        fieldKeys: "all",
        fieldsOptional: true,
      } satisfies SchemaPlan);
      // `success` records nothing.
      assert.deepStrictEqual(fieldPlan(definition, "success"), { _tag: "Schema" });
    }
  });

  it("params and headers keep rejecting a Schema without static keys", () => {
    assert.deepStrictEqual(fieldPlan(Builtins.HttpContract, "params"), {
      _tag: "Schema",
      fieldKeys: "all",
    });
    assert.deepStrictEqual(fieldPlan(Builtins.HttpContract, "headers"), {
      _tag: "Schema",
      fieldKeys: "required",
    });
  });
});
