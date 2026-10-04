import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema, SchemaTransformation } from "effect";
import { A, Annotation } from "@effx/runtime";
import type { Arg } from "@effx/runtime";

/** `A.fromSchema` plans, equal to the equivalent `A.*` combinators for every accepted shape. */
const planOf = (schema: Schema.Top) => A.fromSchema(schema).plan;

describe("A.fromSchema accepted shapes", () => {
  it("scalars equal their combinators", () => {
    assert.deepStrictEqual(planOf(Schema.String), A.string.plan);
    assert.deepStrictEqual(planOf(Schema.NonEmptyString), A.nonEmptyString.plan);
    assert.deepStrictEqual(
      planOf(Schema.String.check(Schema.isMinLength(1))),
      A.nonEmptyString.plan,
    );
    assert.deepStrictEqual(planOf(Schema.Finite), A.number.plan);
    assert.deepStrictEqual(planOf(Schema.Int), A.int.plan);
    assert.deepStrictEqual(planOf(Schema.Boolean), A.boolean.plan);
  });

  it("literals and unions of literals equal A.literal", () => {
    assert.deepStrictEqual(planOf(Schema.Literal("a")), A.literal("a").plan);
    assert.deepStrictEqual(planOf(Schema.Literal(3)), A.literal(3).plan);
    assert.deepStrictEqual(planOf(Schema.Literals(["a", "b"])), A.literal("a", "b").plan);
    assert.deepStrictEqual(
      planOf(Schema.Literals(["a", 1, true])),
      A.literal<"a" | 1 | true>("a", 1, true).plan,
    );
  });

  it("structs with optionalKey equal A.struct with A.optional", () => {
    assert.deepStrictEqual(
      planOf(
        Schema.Struct({
          perMinute: Schema.Int,
          burst: Schema.optionalKey(Schema.Int),
          tag: Schema.String,
        }),
      ),
      A.struct({ perMinute: A.int, burst: A.optional(A.int), tag: A.string }).plan,
    );
  });

  it("records and arrays equal their combinators, including the named checks", () => {
    assert.deepStrictEqual(
      planOf(Schema.Record(Schema.String, Schema.Finite)),
      A.record(A.number).plan,
    );
    assert.deepStrictEqual(planOf(Schema.Array(Schema.String)), A.array(A.string).plan);
    assert.deepStrictEqual(
      planOf(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
      A.array(A.string, { nonEmpty: true }).plan,
    );
    assert.deepStrictEqual(
      planOf(Schema.Array(Schema.String).check(Schema.isNonEmpty())),
      A.array(A.string, { nonEmpty: true }).plan,
    );
    assert.deepStrictEqual(
      planOf(Schema.UniqueArray(Schema.String)),
      A.array(A.string, { unique: true }).plan,
    );
    assert.deepStrictEqual(
      planOf(Schema.UniqueArray(Schema.String).check(Schema.isMinLength(1))),
      A.array(A.string, { unique: true, nonEmpty: true }).plan,
    );
    assert.deepStrictEqual(planOf(Schema.NonEmptyArray(Schema.Int)), A.nonEmptyArray(A.int).plan);
  });

  it("unions and tagged unions equal A.union and A.taggedUnion", () => {
    assert.deepStrictEqual(
      planOf(Schema.Union([Schema.String, Schema.Struct({ id: Schema.Int })])),
      A.union(A.string, A.struct({ id: A.int })).plan,
    );
    assert.deepStrictEqual(
      planOf(
        Schema.TaggedUnion({
          One: { capability: Schema.String },
          None: {},
          Many: { n: Schema.Int },
        }),
      ),
      A.taggedUnion({ One: { capability: A.string }, None: {}, Many: { n: A.int } }).plan,
    );
  });

  it("a tagged case with an optional field stays a plain union of structs", () => {
    const plan = planOf(
      Schema.TaggedUnion({ One: { capability: Schema.optionalKey(Schema.String) }, None: {} }),
    );

    assert.strictEqual(plan._tag, "Union");
  });

  it("Json and JsonObject equal A.json and A.jsonObject", () => {
    assert.deepStrictEqual(planOf(Schema.Json), A.json.plan);
    assert.deepStrictEqual(planOf(Schema.JsonObject), A.jsonObject.plan);
    assert.deepStrictEqual(planOf(Schema.Record(Schema.String, Schema.Json)), A.jsonObject.plan);
  });

  it("Opaque leaves no AST trace, so it is its underlying struct", () => {
    class Opaque extends Schema.Opaque<Opaque>()(Schema.Struct({ a: Schema.String })) {}

    assert.deepStrictEqual(planOf(Opaque), A.struct({ a: A.string }).plan);
  });

  it("a refinement the algebra cannot name is kept as a Refine around the structural plan", () => {
    const max = planOf(Schema.String.check(Schema.isMaxLength(3)));

    assert.strictEqual(max._tag, "Refine");
    assert.deepStrictEqual(max._tag === "Refine" ? max.plan : undefined, A.string.plan);

    const natural = planOf(Schema.Natural);

    assert.strictEqual(natural._tag, "Refine");
    assert.deepStrictEqual(natural._tag === "Refine" ? natural.plan : undefined, A.int.plan);
  });

  it("is lazy about nothing: building a plan runs no check and builds no diagnostics", () => {
    const definition = Annotation.define({
      name: "app.Ok",
      target: "operation",
      args: {
        limit: A.fromSchema(
          Schema.Struct({ n: Schema.Int, tags: Schema.UniqueArray(Schema.String) }),
        ),
      },
    });

    assert.deepStrictEqual(definition.diagnostics, []);
  });
});

class Klass extends Schema.Class<Klass>("Klass")({ a: Schema.String }) {}

type Rejection = readonly [name: string, schema: Schema.Top, path: string, kind: string];

const rejected: ReadonlyArray<Rejection> = [
  ["Class", Klass, "$[0]", "Class"],
  ["Date", Schema.Date, "$[0]", "Date"],
  ["Option (another Declaration)", Schema.Option(Schema.String), "$[0]", "Declaration"],
  ["BigInt", Schema.BigInt, "$[0]", "BigInt"],
  ["bigint Literal", Schema.Literal(1n), "$[0]", "BigInt"],
  ["Symbol", Schema.Symbol, "$[0]", "Symbol"],
  ["Unknown", Schema.Unknown, "$[0]", "Unknown"],
  ["Any", Schema.Any, "$[0]", "Any"],
  ["ObjectKeyword", Schema.ObjectKeyword, "$[0]", "ObjectKeyword"],
  ["suspend", Schema.suspend(() => Schema.String), "$[0]", "Suspend"],
  ["Null inside a union", Schema.NullOr(Schema.String), "$[0]|1", "Null"],
  [
    "Undefined (Schema.optional)",
    Schema.Struct({ a: Schema.optional(Schema.String) }),
    "$[0].a|1",
    "Undefined",
  ],
  ["Tuple", Schema.Tuple([Schema.String]), "$[0]", "Tuple"],
  ["FiniteFromString", Schema.FiniteFromString, "$[0]", "Transformation"],
  [
    "transform",
    Schema.String.pipe(
      Schema.decodeTo(
        Schema.Finite,
        SchemaTransformation.transform({
          decode: (s: string) => s.length,
          encode: (n: number) => "x".repeat(n),
        }),
      ),
    ),
    "$[0]",
    "Transformation",
  ],
  [
    "transformEffect (the v4 transformOrFail)",
    Schema.String.pipe(
      Schema.decodeTo(
        Schema.Finite,
        SchemaTransformation.transformEffect({
          decode: (s: string) => Effect.succeed(s.length),
          encode: (n: number) => Effect.succeed("x".repeat(n)),
        }),
      ),
    ),
    "$[0]",
    "Transformation",
  ],
  [
    "shape-preserving transformation",
    Schema.String.pipe(Schema.decodeTo(Schema.String, SchemaTransformation.trim())),
    "$[0]",
    "Transformation",
  ],
  [
    "nested in struct, array and record",
    Schema.Struct({ items: Schema.Array(Schema.Record(Schema.String, Schema.Date)) }),
    "$[0].items[][*]",
    "Date",
  ],
  [
    "nested in a tagged case",
    Schema.TaggedUnion({ A: { when: Schema.Date }, B: {} }),
    "$[0]<A>.when",
    "Date",
  ],
];

describe("A.fromSchema rejected kinds", () => {
  for (const [name, schema, path, kind] of rejected) {
    it(`${name}: EFFX1301 with its path and node kind; define stays total`, () => {
      const definition = Annotation.define({
        name: "app.Bad",
        target: "operation",
        args: [A.fromSchema(schema)],
      });

      assert.deepStrictEqual(definition.diagnostics, [
        {
          code: "EFFX1301",
          message: `annotation app.Bad: args ${path}: Schema node ${kind} cannot be lowered from source (A.fromSchema)`,
        },
      ]);
    });
  }

  it("reports every invalid leaf, in argument order, including a rest position", () => {
    const definition = Annotation.define({
      name: "app.Many",
      target: "operation",
      args: { a: A.fromSchema(Schema.Date), b: A.fromSchema(Schema.Symbol), ok: A.string },
    });

    assert.deepStrictEqual(
      definition.diagnostics.map((d) => d.message),
      [
        "annotation app.Many: args $[0].a: Schema node Date cannot be lowered from source (A.fromSchema)",
        "annotation app.Many: args $[0].b: Schema node Symbol cannot be lowered from source (A.fromSchema)",
      ],
    );
  });

  it("a built-in-only algebra definition never has diagnostics", () => {
    const definition = Annotation.define({
      name: "app.Fine",
      target: "operation",
      args: { a: A.string, b: A.optional(A.array(A.int)) },
    });

    assert.deepStrictEqual(definition.diagnostics, []);
  });
});

describe("A.fromSchema typing", () => {
  it("Live is the Schema's Encoded and Read is its Type; Live feeds the declaration site", () => {
    const Options = Schema.Struct({
      perMinute: Schema.Int,
      burst: Schema.optionalKey(Schema.Int),
      kind: Schema.Literals(["a", "b"]),
    });

    const arg = A.fromSchema(Options);

    expectTypeOf(arg).toEqualTypeOf<Arg<typeof Options.Encoded, typeof Options.Type>>();

    const Def = Annotation.define({ name: "app.Typed", target: "operation", args: [arg] });

    expectTypeOf(Def).parameters.toEqualTypeOf<
      [
        options: {
          readonly perMinute: number;
          readonly burst?: number;
          readonly kind: "a" | "b";
        },
      ]
    >();
  });

  it("rejects a value the Schema does not describe at compile time", () => {
    const Def = Annotation.define({
      name: "app.Typed2",
      target: "operation",
      args: [A.fromSchema(Schema.Struct({ n: Schema.Int }))],
    });

    // @ts-expect-error n is a number
    Def({ n: "1" });
  });
});
