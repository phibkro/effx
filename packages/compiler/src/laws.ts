import { Effect, Equal, Result, Schema } from "effect";
import { OperationBuilder, Reflect as AnnotationReflect } from "@effx/runtime";
import type { Applied, DefinitionData, Plan } from "@effx/runtime";
import { IRArbitrary } from "@effx/ir";
import type { ArgsCodec } from "./annotation.ts";
import { decodeSchemaOf } from "./annotation.ts";

/** A law of a definition did not hold; `message` is the formatted falsification (shrunk input, replay token). */
export class LawViolation extends Schema.TaggedError<LawViolation>()("LawViolation", {
  definition: Schema.String,
  law: Schema.String,
  message: Schema.String,
}) {}

/** How many values a law checks, and the seed that replays a run. */
export type LawOptions = IRArbitrary.PropertyOptions;

/**
 * One derived law of a definition (spec 0020 §2.3). Nothing runs when a `Law` is built: `check` is a
 * suspended Effect that generates values, checks the property, and fails with `LawViolation` on a
 * falsification. It needs no services and starts no fibers; each generated value is checked inside an
 * Effect, so interrupting `check` stops it at the next value and leaves nothing to release.
 */
export interface Law {
  readonly name: string;
  readonly check: (options?: LawOptions) => Effect.Effect<void, LawViolation>;
}

/** A definition whose application is callable with its own `Live` arguments (an operation-target one). */
export type LawDefinition = DefinitionData & ((...live: never[]) => Applied<string, "operation">);

/** Leaves whose `Live` value is an application reference; a generator cannot produce one without a fixture universe. */
const hasReference = (plan: Plan): boolean => {
  switch (plan._tag) {
    case "Schema":
    case "Symbol":
    case "Capability":
    case "Injected":
      return true;
    case "Struct":
      return Object.values(plan.fields).some(hasReference);
    case "Array":
      return hasReference(plan.item);
    case "Record":
      return hasReference(plan.value);
    case "Union":
      return plan.members.some(hasReference);
    case "TaggedUnion":
      return Object.values(plan.cases).some((fields) => Object.values(fields).some(hasReference));
    case "Refine":
      return hasReference(plan.plan);
    default:
      return false;
  }
};

const decoratedAnnotations = (applied: Applied<string, "operation">) => {
  const owner = (): void => undefined;

  // SAFETY: the derived decorator records on `owner` and never reads its TC39 context (`appliedOf` in
  // `@effx/runtime`), so an empty object stands in for the context a class body would supply.
  applied(owner, {} as ClassMethodDecoratorContext<unknown, () => void>);

  return AnnotationReflect.annotationsOf(owner);
};

/**
 * The laws a definition satisfies, derived from its `args` plan (spec 0020 §2.3):
 *
 * 1. **round trip**, always: for `x` generated from the decode Schema, `decode(encode(x)) = x`.
 * 2. **syntax equivalence**, only for plans without `Schema`, `Symbol` or `Capability` leaves: for generated
 *    live arguments, the decorator spelling and `OperationBuilder.with(definition(...live))` record equal
 *    annotations (`Reflect.annotationsOf` against the builder's `annotations`). A reference-bearing plan
 *    needs a universe of fixture references (exported schemas, services) to generate live values from;
 *    v1 provides none, so that law is absent from the result rather than weakened.
 *
 * Values are generated through the `@effx/ir` Arbitrary adapter. A definition whose plan holds a rejected
 * `A.fromSchema` node (EFFX1301) has no derivable Schema: its `check` fails with `LawViolation`.
 * Pure: building the laws derives nothing.
 */
export const laws = (definition: LawDefinition): ReadonlyArray<Law> => {
  const lawOf = (
    name: string,
    property: (codec: ArgsCodec, live: ReadonlyArray<never>) => boolean,
  ): Law => ({
    name,
    check: Effect.fnUntraced(function* (
      options?: LawOptions,
    ): Effect.fn.Return<void, LawViolation> {
      const violation = (message: string) =>
        new LawViolation({ definition: definition.name, law: name, message });

      const schema = yield* Effect.try({
        try: () => decodeSchemaOf(definition),
        catch: (cause) => violation(`no decode Schema for the plan: ${String(cause)}`),
      });

      const arbitrary = yield* Effect.try({
        try: () => IRArbitrary.arbitraryOf(schema),
        catch: (cause) => violation(`no Arbitrary for the decode Schema: ${String(cause)}`),
      });

      const failure = yield* IRArbitrary.falsification(
        arbitrary,
        // SAFETY: the Type of the decode Schema of an argument list is the argument tuple.
        (value) => Effect.sync(() => property(schema, value as ReadonlyArray<never>)),
        options,
      );

      if (failure !== undefined) return yield* violation(failure);
    }),
  });

  const roundTrip = lawOf(`${definition.name}: decode(encode(x)) = x`, (schema, live) =>
    Result.match(
      Result.flatMap(Schema.encodeUnknownResult(schema)(live), Schema.decodeUnknownResult(schema)),
      { onFailure: () => false, onSuccess: (decoded) => Equal.equals(decoded, live) },
    ),
  );

  const syntax = lawOf(
    `${definition.name}: the decorator and the builder record equal annotations`,
    (_schema, live) =>
      Equal.equals(
        decoratedAnnotations(definition(...live)),
        new OperationBuilder([]).with(definition(...live)).annotations,
      ),
  );

  const { items, rest } = definition.plan;
  const references = items.some(hasReference) || (rest !== undefined && hasReference(rest));

  return references ? [roundTrip] : [roundTrip, syntax];
};
