import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option, Schema } from "effect";
import { A, Annotation, type Applied, type DefinitionData } from "@effx/runtime";
import {
  type Annotation as CollectedAnnotation,
  type Collected,
  type Law,
  Extensions,
  LawViolation,
  dataOf,
  extension,
  implement,
  interpret,
  laws,
} from "@effx/compiler";
import { type ApplicationIR, StableId } from "@effx/ir";
import { decoratorStyle, getUser } from "./fixtures/users.ts";

const RateLimit = Annotation.define({
  name: "app.RateLimit",
  target: "operation",
  args: { perMinute: A.int, burst: A.optional(A.int) },
  cardinality: "one",
});

const Quota = Annotation.define({
  name: "app.Quota",
  target: "operation",
  args: [
    A.fromSchema(
      Schema.Struct({
        tags: Schema.UniqueArray(Schema.NonEmptyString),
        mode: Schema.Literals(["soft", "hard"]),
        extra: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
      }),
    ),
  ],
});

const UsesSchema = Annotation.define({ name: "app.Uses", target: "operation", args: [A.schema()] });

const getId = StableId.make("operation", "User.Get");

const changeId = StableId.make("operation", "User.ChangeEmail");

const annotated = (annotation: CollectedAnnotation): Collected => ({
  ...decoratorStyle,
  declarations: decoratorStyle.declarations.map((declaration) =>
    declaration.id === getUser.id
      ? { ...declaration, annotations: [...declaration.annotations, annotation] }
      : declaration,
  ),
});

const extensions = [
  ...Extensions.builtin,
  extension("app", [implement(RateLimit), implement(Quota), implement(UsesSchema)]),
];

const irOf = (collected: Collected): ApplicationIR =>
  Option.getOrThrow(interpret(collected, extensions).value);

describe("dataOf", () => {
  const ir = irOf(annotated({ name: "app.RateLimit", args: [{ perMinute: 60, burst: 5 }] }));

  it("reads back what the default read recorded, decoded against the definition's Schema", () => {
    const data = dataOf(RateLimit, ir, getId);

    assert.deepStrictEqual(Option.getOrThrow(data), [{ perMinute: 60, burst: 5 }]);
    expectTypeOf(data).toEqualTypeOf<
      Option.Option<readonly [{ readonly perMinute: number; readonly burst?: number }]>
    >();
  });

  it("is None for an operation without the annotation and for another definition", () => {
    assert.isTrue(Option.isNone(dataOf(RateLimit, ir, changeId)));
    assert.isTrue(Option.isNone(dataOf(Quota, ir, getId)));
  });

  it("is None when the recorded data no longer decodes against the definition", () => {
    const stale: ApplicationIR = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node._tag === "Extension" && node.tag === "app.RateLimit"
          ? { ...node, data: { args: [{ perMinute: "sixty" }] } }
          : node,
      ),
    };

    assert.isTrue(Option.isNone(dataOf(RateLimit, stale, getId)));
  });

  it("records the definition's export in the node and still reads back the args alone", () => {
    const definition = { module: "../../src/rate-limit.def", export: "RateLimit" };

    const withDefinition = irOf(
      annotated({ name: "app.RateLimit", args: [{ perMinute: 60 }], definition }),
    );

    const node = withDefinition.nodes.find(
      (candidate) => candidate._tag === "Extension" && candidate.tag === "app.RateLimit",
    );

    assert.deepStrictEqual(node?._tag === "Extension" ? node.data : undefined, {
      definition,
      args: [{ perMinute: 60 }],
    });
    assert.deepStrictEqual(Option.getOrThrow(dataOf(RateLimit, withDefinition, getId)), [
      { perMinute: 60 },
    ]);

    const bare = ir.nodes.find(
      (candidate) => candidate._tag === "Extension" && candidate.tag === "app.RateLimit",
    );

    assert.deepStrictEqual(bare?._tag === "Extension" ? bare.data : undefined, {
      args: [{ perMinute: 60, burst: 5 }],
    });
  });

  it("decodes an A.fromSchema definition to the Schema's Type", () => {
    const quota = irOf(
      annotated({
        name: "app.Quota",
        args: [{ tags: ["a", "b"], mode: "soft", extra: { k: [1, "x"] } }],
      }),
    );

    const data = dataOf(Quota, quota, getId);

    assert.deepStrictEqual(Option.getOrThrow(data), [
      { tags: ["a", "b"], mode: "soft", extra: { k: [1, "x"] } },
    ]);
  });
});

const run = (law: Law) => law.check({ runs: 60, seed: 7 });

describe("laws", () => {
  it("a plain definition has the round-trip law and the syntax-equivalence law", () => {
    assert.deepStrictEqual(
      laws(RateLimit).map((law) => law.name),
      [
        "app.RateLimit: decode(encode(x)) = x",
        "app.RateLimit: the decorator and the builder record equal annotations",
      ],
    );
  });

  it.effect.each(laws(RateLimit).map((law) => [law.name, law] as const))("%s", ([, law]) =>
    run(law),
  );

  it.effect.each(laws(Quota).map((law) => [law.name, law] as const))("%s", ([, law]) => run(law));

  it("a reference-bearing plan has the round-trip law only: no fixture universe in v1", () => {
    assert.deepStrictEqual(
      laws(UsesSchema).map((law) => law.name),
      ["app.Uses: decode(encode(x)) = x"],
    );
  });

  it.effect("the round-trip law holds for a plan with Schema references", () =>
    run(laws(UsesSchema)[0]!),
  );

  it("building the laws derives and generates nothing", () => {
    const invalid = Annotation.define({
      name: "app.Invalid",
      target: "operation",
      args: [A.fromSchema(Schema.Date)],
    });

    assert.doesNotThrow(() => laws(invalid));
  });

  it.effect("a running check is interrupted promptly and leaves nothing running", () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        laws(RateLimit)[0]!.check({ runs: 5_000_000, seed: 1 }),
      );

      yield* Effect.yieldNow;
      yield* Fiber.interrupt(fiber);

      const exit = yield* Fiber.await(fiber);

      assert.isTrue(Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause));
    }),
  );

  it.effect(
    "a definition with a rejected A.fromSchema node has no Schema: a typed LawViolation",
    () =>
      Effect.gen(function* () {
        const invalid = Annotation.define({
          name: "app.Invalid",
          target: "operation",
          args: [A.fromSchema(Schema.Date)],
        });

        const violation = yield* Effect.flip(run(laws(invalid)[0]!));

        assert.instanceOf(violation, LawViolation);
        assert.strictEqual(violation.definition, "app.Invalid");
      }),
  );

  it.effect(
    "a definition whose builder spelling drifts from its decorator spelling violates the syntax law",
    () =>
      Effect.gen(function* () {
        const Skew = Annotation.define({ name: "app.Skew", target: "operation", args: [A.string] });

        // The builder reads `annotation`; the decorator records its own `{ name, args }`.
        const call = (value: never): Applied<"app.Skew", "operation"> =>
          Object.assign(Skew(value), { annotation: { name: "app.Skew", args: [] } });

        // SAFETY: the properties defined here are exactly the `DefinitionData` members of `Skew`.
        const skewed = Object.defineProperties(call, {
          name: { value: Skew.name },
          target: { value: Skew.target },
          plan: { value: Skew.plan },
          diagnostics: { value: Skew.diagnostics },
          cardinality: { value: Skew.cardinality },
          effect: { value: Skew.effect },
          selfAs: { value: Skew.selfAs },
          builder: { value: Skew.builder },
        }) as typeof call & DefinitionData;

        const [, syntax] = laws(skewed);
        const violation = yield* Effect.flip(run(syntax!));

        assert.instanceOf(violation, LawViolation);
        assert.strictEqual(
          violation.law,
          "app.Skew: the decorator and the builder record equal annotations",
        );
      }),
  );
});
