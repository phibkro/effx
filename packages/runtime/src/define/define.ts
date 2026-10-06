import type { Context } from "effect";
import type { Annotation } from "../Annotation.js";
import { record } from "../Annotation.js";
import { annotationSchemaLowering } from "../diagnostics.js";
import type { Arg, Field, LiveStruct, ReadStruct } from "./arg.js";
import { invalidLeaves } from "./from-schema.js";
import type { ArgsPlan, Plan } from "./plan.js";

/** Where an annotation may be attached. User definitions: `"operation"` only in v1 (spec 0020 §0.4). */
export type PublicTarget = "operation";

/** Internal source targets include backend bindings; public annotation definitions remain operation-only. */
export type InternalTarget = "class" | "group" | "model" | "binding";

export type Target = PublicTarget | InternalTarget;

/** The brand the frontend detects by shape (never by name): `~effx/Annotation/Applied`. */
export const AppliedTypeId = "~effx/Annotation/Applied" as const;

export type AppliedTypeId = typeof AppliedTypeId;

/** What the frontend reads off an applied annotation's static type. */
export interface AppliedBrand<Name extends string, T extends Target> {
  readonly name: Name;
  readonly target: T;
}

type MethodDecoratorFor = <This, Args extends ReadonlyArray<never>, Return>(
  value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => undefined;

type ClassDecoratorFor = <Class extends abstract new (...args: never) => object>(
  value: Class,
  context: ClassDecoratorContext<Class>,
) => undefined;

/**
 * The result of calling a definition: simultaneously a TC39 decorator (target `"operation"`: a static
 * method) and a builder argument (`.with(applied)`). At runtime it records exactly `{ name, args }`.
 */
export type Applied<Name extends string, T extends Target> = (T extends "operation"
  ? MethodDecoratorFor
  : ClassDecoratorFor) & {
  readonly [AppliedTypeId]: AppliedBrand<Name, T>;
  readonly annotation: Annotation;
};

/**
 * The optional `effect` clause of a definition (spec 0020 §4): the annotation is also an Effect `Context`
 * key, and the default writer emits `.annotate(<definition>.effect.key, <value>)` on the generated Effect
 * object. v1 supports the HTTP endpoint only. `key` is any `Context.Key`; its literal `key` string id is
 * what a static lift matches.
 */
export interface EffectClause {
  /** Which generated Effect object carries the annotation (v1: the HTTP endpoint). */
  readonly target: "endpoint";
  readonly key: Context.Key<unknown, unknown>;
}

export type ArgsInput =
  | ReadonlyArray<Arg<never, unknown> | Arg<unknown, unknown>>
  | RestArgs<unknown, unknown>
  | Readonly<Record<string, Field>>;

export interface RestArgs<out Live, out Read> {
  readonly _rest: Arg<Live, Read>;
}

/** `args: A.rest(A.schema())` — a variadic annotation like `@Errors(a, b, c)`. */
export const rest = <L, R>(item: Arg<L, R>): RestArgs<L, R> => ({ _rest: item });

type LiveTuple<T extends ReadonlyArray<unknown>> = {
  readonly [I in keyof T]: T[I] extends Arg<infer L, infer _R> ? L : never;
};

/** The positional parameters of the derived decorator/builder function. */
export type LiveParameters<Input> =
  Input extends ReadonlyArray<unknown>
    ? LiveTuple<Input>
    : Input extends RestArgs<infer L, infer _R>
      ? Array<L>
      : Input extends Readonly<Record<string, Field>>
        ? readonly [LiveStruct<Input>]
        : never;

type ReadTuple<T extends ReadonlyArray<unknown>> = {
  readonly [I in keyof T]: T[I] extends Arg<infer _L, infer R> ? R : never;
};

/** The positional `Read` types (markers unresolved) `read` receives; see `Resolved` in `@effx/compiler`. */
export type ReadParameters<Input> =
  Input extends ReadonlyArray<unknown>
    ? ReadTuple<Input>
    : Input extends RestArgs<infer _L, infer R>
      ? ReadonlyArray<R>
      : Input extends Readonly<Record<string, Field>>
        ? readonly [ReadStruct<Input>]
        : never;

const fieldPlan = (field: Field): Plan => ("_optional" in field ? field.arg.plan : field.plan);

const isArgList = (input: ArgsInput): input is ReadonlyArray<Arg<unknown, unknown>> =>
  Array.isArray(input);

const isRestArgs = (input: ArgsInput): input is RestArgs<unknown, unknown> => "_rest" in input;

/** Normalizes the three accepted `args` spellings into one positional plan. */
export const argsPlanOf = (input: ArgsInput): ArgsPlan => {
  if (isArgList(input)) return { items: input.map((item) => item.plan) };

  if (isRestArgs(input)) return { items: [], rest: input._rest.plan };

  const plans: Record<string, Plan> = {};
  const optional: Array<string> = [];

  for (const [key, field] of Object.entries(input)) {
    if ("_optional" in field && field._optional === "injected") {
      plans[key] = { _tag: "Injected", plan: field.arg.plan };
      continue;
    }

    plans[key] = fieldPlan(field);

    if ("_optional" in field && field._optional === "optional") optional.push(key);
  }

  return { items: [{ _tag: "Struct", fields: plans, optional }] };
};

export interface DefineOptions<
  Name extends string,
  T extends Target,
  Input extends ArgsInput,
  E extends EffectClause | undefined = undefined,
> {
  /** Literal, namespaced (`app.RateLimit`); a collision with another definition is EFFX1302. */
  readonly name: Name;
  readonly target: T;
  readonly args: Input;
  /** Default `"many"`: the framework does not reject repeats. `"one"`: a second one is a diagnostic. */
  readonly cardinality?: "one" | "many";
  readonly effect?: E;
  /** Internal: record `{ ...options, [selfAs]: <the decorated class> }` (`PersistentModel.schema`). */
  readonly selfAs?: string;
  /** Internal: the builder-chain step that applies it (`"http.get"`), the frontend's name table. */
  readonly builder?: string;
}

/**
 * A problem `define` found in a definition without throwing (`define` is total). The compiler reports
 * each as an error (`definitionDiagnostics`); today only `A.fromSchema` produces one, `EFFX1301`.
 */
export type DefinitionDiagnostic = Pick<
  ReturnType<typeof annotationSchemaLowering.emit>,
  "code" | "message"
>;

/**
 * The data half of a definition: everything the compiler and frontend read; no call signature. `effect`
 * is the loose `EffectClause | undefined`; `Definition` narrows it to the exact clause it was built with.
 */
export interface DefinitionData<
  Name extends string = string,
  T extends Target = Target,
  Input extends ArgsInput = ArgsInput,
> {
  readonly name: Name;
  readonly target: T;
  readonly plan: ArgsPlan;
  readonly cardinality: "one" | "many";
  /** `EFFX1301` for every `A.fromSchema` node the frontend cannot lower; empty for a valid definition. */
  readonly diagnostics: ReadonlyArray<DefinitionDiagnostic>;
  readonly effect: EffectClause | undefined;
  readonly selfAs: string | undefined;
  readonly builder: string | undefined;
  /** Type-level only: the argument input this definition was built from. */
  readonly Args?: Input;
}

/**
 * A declared annotation. Calling it applies it. `plan`, `target`, `cardinality` and `effect` are the
 * data the compiler and frontend derive everything else from; the runtime never reads them. `E` keeps
 * the exact clause given to `define`, so `Definition.effect.key` keeps its own `Context.Key<I, S>` type.
 */
export interface Definition<
  Name extends string = string,
  T extends Target = Target,
  Input extends ArgsInput = ArgsInput,
  E extends EffectClause | undefined = EffectClause | undefined,
> extends DefinitionData<Name, T, Input> {
  readonly effect: E;
  (...args: LiveParameters<Input>): Applied<Name, T>;
}

/** A class (decorator target `"class"`) or a static method (target `"operation"`): what `record` keys on. */
type DecoratedOwner = (abstract new (...args: never) => object) | ((...args: never) => void);

/** The decorator-shaped half of an applied annotation, before the brand and `annotation` are attached. */
interface AppliedParts<Name extends string, T extends Target> {
  readonly decorator: (value: DecoratedOwner) => undefined;
  readonly brand: AppliedBrand<Name, T>;
  readonly annotation: Annotation;
}

const appliedOf = <Name extends string, T extends Target>(
  parts: AppliedParts<Name, T>,
): Applied<Name, T> =>
  // SAFETY: `Applied` is a decorator function carrying the brand and the recorded annotation; the
  // conditional `MethodDecoratorFor | ClassDecoratorFor` part only types how `tsc` checks the decorator
  // position, and at runtime the function records the annotation on whatever owner it receives.
  Object.assign(parts.decorator, {
    [AppliedTypeId]: parts.brand,
    annotation: parts.annotation,
  }) as Applied<Name, T>;

/** The `EFFX1301` diagnostics of a plan: one per `Invalid` leaf, naming its path from the argument list. */
const planDiagnostics = (name: string, plan: ArgsPlan): ReadonlyArray<DefinitionDiagnostic> =>
  [
    ...plan.items.flatMap((item, i) => invalidLeaves(item, `$[${i}]`)),
    ...(plan.rest === undefined ? [] : invalidLeaves(plan.rest, "$[]")),
  ].map((leaf) => {
    const { code, message } = annotationSchemaLowering.emit({
      annotation: name,
      path: leaf.path,
      nodeKind: leaf.kind,
    });

    return { code, message };
  });

const build = <
  Name extends string,
  T extends Target,
  Input extends ArgsInput,
  E extends EffectClause | undefined,
>(
  options: DefineOptions<Name, T, Input, E>,
): Definition<Name, T, Input, E> => {
  const plan = argsPlanOf(options.args);

  const apply = (...live: LiveParameters<Input>): Applied<Name, T> => {
    // SAFETY: `live` are the Live-typed arguments of the derived function, i.e. annotation values.
    const annotation: Annotation = { name: options.name, args: live as Annotation["args"] };

    const decorator = (value: DecoratedOwner): undefined => {
      // SAFETY: a `selfAs` definition (`PersistentModel.schema`) has a struct as its first argument.
      const struct = annotation.args[0] as object;

      const args =
        options.selfAs === undefined ? annotation.args : [{ ...struct, [options.selfAs]: value }];

      record(value, { name: options.name, args });

      return undefined;
    };

    return appliedOf({
      decorator,
      brand: { name: options.name, target: options.target },
      annotation,
    });
  };

  // `name` is a non-writable own property of every function, so it is defined, not assigned.
  // SAFETY: `apply` already has the call signature of `Definition`; the properties defined here are
  // exactly its `DefinitionData` members.
  return Object.defineProperties(apply, {
    name: { value: options.name },
    target: { value: options.target },
    plan: { value: plan },
    diagnostics: { value: planDiagnostics(options.name, plan) },
    cardinality: { value: options.cardinality ?? "many" },
    effect: { value: options.effect },
    selfAs: { value: options.selfAs },
    builder: { value: options.builder },
  }) as Definition<Name, T, Input, E>;
};

/**
 * Declares a user annotation (spec 0020). `name` and `args` are all `tsc` needs to type the derived
 * decorator and builder argument; `args` is a closed combinator algebra, so it is statically lowerable
 * by construction. The compiler half is `Annotation.implement` in `@effx/compiler`.
 */
export const define = <
  const Name extends string,
  const Input extends ArgsInput,
  const E extends EffectClause | undefined = undefined,
>(
  options: DefineOptions<Name, PublicTarget, Input, E>,
): Definition<Name, PublicTarget, Input, E> => build(options);

/** Built-ins only: reaches the internal class/group/model targets. Not exported from the package root. */
export const defineBuiltin = <
  const Name extends string,
  const T extends Target,
  const Input extends ArgsInput,
>(
  options: DefineOptions<Name, T, Input>,
): Definition<Name, T, Input, undefined> => build(options);
