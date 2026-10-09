import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import {
  EffectModel,
  LocalConstCall,
  LocalConstRecord,
  SourceRange,
  TermSchema,
  TermSlot,
  Terms,
  type Term,
} from "@effx/compiler";
import { profileModel, range, schemaOf } from "./lift-support.ts";

/*
 * The lift model is the frontend → core boundary (spec 0019 §3.1, §8 S7). These tests pin what that boundary
 * refuses to represent and what survives a trip through its document form; they use only the public API.
 */

const httpApiSchema = { module: "effect/unstable/httpapi", export: "HttpApiSchema" };

const samples: ReadonlyArray<{ readonly name: string; readonly term: Term }> = [
  { name: "Lit", term: Terms.lit({ a: [1, "b", null, true] }) },
  {
    name: "Ref (SymbolRef with a static member)",
    term: Terms.ref({ module: "./m", export: "Errors", member: "NotFound" }),
  },
  { name: "Ref (SchemaRef)", term: Terms.ref(schemaOf("./m", "Schema")) },
  {
    name: "Call",
    term: Terms.call(Terms.member(Terms.ref(httpApiSchema), "status"), [Terms.lit(201)]),
  },
  {
    name: "Chain",
    term: Terms.chain(Terms.ref(httpApiSchema), [
      Terms.methodCall("middleware", [Terms.ref({ module: "./m", export: "Security" })]),
    ]),
  },
  { name: "Member", term: Terms.member(Terms.ref(httpApiSchema), "NoContent") },
  { name: "OptionalMember", term: Terms.optionalMember(Terms.ref(httpApiSchema), "httpApiStatus") },
  {
    name: "Nullish",
    term: Terms.nullish(Terms.ref(httpApiSchema), [Terms.lit(200), Terms.lit(201)]),
  },
  { name: "StrictEqual", term: Terms.strictEqual(Terms.ref(httpApiSchema), Terms.lit(200)) },
  { name: "Cond", term: Terms.cond(Terms.lit(true), Terms.lit(1), Terms.lit(2)) },
  { name: "Paren", term: Terms.paren(Terms.lit(1)) },
  {
    name: "Obj in every layout",
    term: Terms.obj(
      [
        { key: "a", value: Terms.obj([{ key: "b", value: Terms.lit(1) }], "inline") },
        { key: "c", value: Terms.obj([], "block") },
      ],
      "compact",
    ),
  },
  { name: "Arr", term: Terms.arr([Terms.lit("x"), Terms.arr([])]) },
];

/** The S5 status-200 expression the generator prints: the deepest term the algebra builds today. */
const statusExpression: Term = Terms.paren(
  Terms.cond(
    Terms.strictEqual(
      Terms.paren(
        Terms.nullish(
          Terms.optionalMember(
            Terms.call(
              Terms.member(Terms.ref({ module: "effect", export: "SchemaAST" }), "resolve"),
              [Terms.member(Terms.ref(schemaOf("./m", "S")), "ast")],
            ),
            "httpApiStatus",
          ),
          [Terms.lit(200)],
        ),
      ),
      Terms.lit(200),
    ),
    Terms.ref(schemaOf("./m", "S")),
    Terms.call(Terms.call(Terms.member(Terms.ref(httpApiSchema), "status"), [Terms.lit(200)]), [
      Terms.ref(schemaOf("./m", "S")),
    ]),
  ),
);

const roundTrip = Effect.fn("roundTrip")(function* (term: Term) {
  const encoded = yield* Schema.encodeEffect(TermSchema)(term);

  return yield* Schema.decodeEffect(TermSchema)(encoded);
});

describe("TermSchema", () => {
  it.effect.each(samples)("round-trips $name unchanged", ({ term }) =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* roundTrip(term), term);
    }),
  );

  it.effect("round-trips the generator's status-200 expression", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* roundTrip(statusExpression), statusExpression);
    }),
  );

  it.effect("keeps a SchemaRef's symbolId and never gives a SymbolRef one", () =>
    Effect.gen(function* () {
      const schema = yield* roundTrip(Terms.ref(schemaOf("./m", "S")));
      const symbol = yield* roundTrip(Terms.ref({ module: "./m", export: "S" }));

      assert.deepStrictEqual(schema._tag === "Ref" ? schema.ref : undefined, schemaOf("./m", "S"));
      assert.isFalse(symbol._tag === "Ref" && "symbolId" in symbol.ref);
    }),
  );

  it.effect.each([
    { name: "a Raw escape", input: { _tag: "Raw", text: "anything()" } },
    { name: "an Opaque source display", input: { _tag: "Opaque", display: "anything()" } },
    { name: "a non-JSON literal", input: { _tag: "Lit", json: undefined } },
    { name: "a call without a callee", input: { _tag: "Call", args: [] } },
    {
      name: "a nested construct outside the algebra",
      input: { _tag: "Paren", term: { _tag: "Raw", text: "x" } },
    },
  ])("rejects $name", ({ input }) =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(Schema.decodeUnknownEffect(TermSchema)(input));

      assert.strictEqual(failure._tag, "SchemaError");
    }),
  );
});

describe("source coordinates", () => {
  const valid = range(10, 20);

  it.effect("accepts an empty and a non-empty range", () =>
    Effect.gen(function* () {
      assert.deepStrictEqual(yield* Schema.decodeEffect(SourceRange)(valid), valid);
      assert.deepStrictEqual(yield* Schema.decodeEffect(SourceRange)(range(10, 10)), range(10, 10));
    }),
  );

  it.effect.each([
    { name: "an end before its start", input: { ...valid, end: range(5, 5).end } },
    { name: "a negative offset", input: { ...valid, start: { ...valid.start, offset: -1 } } },
    { name: "a zero line", input: { ...valid, start: { ...valid.start, line: 0 } } },
    { name: "a fractional column", input: { ...valid, end: { ...valid.end, col: 1.5 } } },
  ])("rejects $name", ({ input }) =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(Schema.decodeEffect(SourceRange)(input));

      assert.strictEqual(failure._tag, "SchemaError");
    }),
  );
});

describe("TermSlot availability", () => {
  it.effect("makes a partial term unrepresentable", () =>
    Effect.gen(function* () {
      // An Unlowered slot has no `term` at all: nothing can read a half-lowered expression.
      expectTypeOf<Extract<TermSlot, { readonly _tag: "Unlowered" }>>().not.toHaveProperty("term");
      expectTypeOf<Extract<TermSlot, { readonly _tag: "Lowered" }>>().toHaveProperty("term");

      const decode = Schema.decodeUnknownEffect(TermSlot);

      const noFindings = yield* Effect.flip(
        decode({ _tag: "Unlowered", range: range(0, 1), findings: [] }),
      );

      const noTerm = yield* Effect.flip(decode({ _tag: "Lowered", range: range(0, 1), spans: [] }));

      assert.strictEqual(noFindings._tag, "SchemaError");
      assert.strictEqual(noTerm._tag, "SchemaError");
    }),
  );
});

describe("EffectModel", () => {
  it.effect("is a JSON document: the Profile model survives a trip through text", () =>
    Effect.gen(function* () {
      const document = Schema.fromJsonString(EffectModel);
      const text = yield* Schema.encodeEffect(document)(profileModel);

      assert.deepStrictEqual(yield* Schema.decodeEffect(document)(text), profileModel);
    }),
  );

  it.effect(
    "keeps the unsupported endpoint's other slots available beside its Unlowered options",
    () =>
      Effect.sync(() => {
        const broken = profileModel.endpoints.find(
          (endpoint) => endpoint.options._tag === "Unlowered",
        );

        assert.isDefined(broken);
        // The spread voids only the options slot: key and path stay readable for identity and other causes.
        assert.strictEqual(broken?.key._tag, "Lowered");
        assert.strictEqual(broken?.path._tag, "Lowered");
      }),
  );

  it.effect("rejects a model whose target is not a known profile", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        Schema.decodeUnknownEffect(EffectModel)({ ...profileModel, target: "effect-5.0" }),
      );

      assert.strictEqual(failure._tag, "SchemaError");
    }),
  );

  it.effect(
    "keeps private const identity source-only and refuses let/var or mismatched provenance",
    () =>
      Effect.gen(function* () {
        const value = {
          kind: "const" as const,
          id: { file: "src/profile.ts", offset: 2, name: "PrivateProblem" },
          range: range(0, 10),
          init: {
            _tag: "Lowered" as const,
            term: Terms.lit("source"),
            range: range(4, 9),
            spans: [],
          },
        };

        const decode = Schema.decodeUnknownEffect(LocalConstRecord);

        expectTypeOf<LocalConstRecord>().not.toHaveProperty("symbol");
        assert.deepStrictEqual(yield* decode(value), value);

        for (const invalid of [
          { ...value, kind: "let" },
          { ...value, kind: "var" },
          { ...value, id: { ...value.id, file: "elsewhere.ts" } },
          { ...value, id: { ...value.id, offset: 10 } },
          { ...value, init: { ...value.init, range: range(4, 11) } },
        ])
          assert.strictEqual((yield* Effect.flip(decode(invalid)))._tag, "SchemaError");

        const call = {
          range: range(11, 20),
          callee: { module: "./problems", export: "responses" },
          argument: value.id,
        };

        assert.deepStrictEqual(yield* Schema.decodeEffect(LocalConstCall)(call), call);
        assert.strictEqual(
          (yield* Effect.flip(
            Schema.decodeEffect(LocalConstCall)({
              ...call,
              argument: { ...call.argument, file: "elsewhere.ts" },
            }),
          ))._tag,
          "SchemaError",
        );
      }),
  );
});
