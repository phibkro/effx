import type { Schema } from "effect";
import { planOfSchemaAst } from "./from-schema.js";
import type { ArgsPlan, FieldKeys, Plan, SymbolCheck } from "./plan.js";

/**
 * One argument position of an annotation. `Live` is what the author writes (checked by `tsc`);
 * `Read` is what the compiler's `read` receives after lowering and decoding. `plan` is the only
 * runtime content: data the frontend lowers by and the compiler derives its decode Schema from.
 * `Live`/`Read` are phantom (never set).
 */
export interface Arg<out Live, out Read = Live> {
  readonly plan: Plan;
  readonly Live?: Live;
  readonly Read?: Read;
}

/** A struct field that may be absent in source and in the lowered value. */
export interface OptionalArg<out Live, out Read = Live> {
  readonly _optional: "optional";
  readonly arg: Arg<Live, Read>;
}

/** A struct field that may be absent in source but is required in `Read` (the 0013 pre-pass fills it). */
export interface SourceOptionalArg<out Live, out Read = Live> {
  readonly _optional: "source";
  readonly arg: Arg<Live, Read>;
}

/** A struct field supplied by the collector, never written in source. */
export interface InjectedArg<out Read> {
  readonly _optional: "injected";
  readonly arg: Arg<never, Read>;
}

export type Field =
  | Arg<unknown, unknown>
  | OptionalArg<unknown, unknown>
  | SourceOptionalArg<unknown, unknown>
  | InjectedArg<unknown>;

type LiveOf<F> =
  F extends Arg<infer L, infer _R>
    ? L
    : F extends OptionalArg<infer L, infer _R>
      ? L
      : F extends SourceOptionalArg<infer L, infer _R>
        ? L
        : never;

type ReadOf<F> =
  F extends Arg<infer _L, infer R>
    ? R
    : F extends OptionalArg<infer _L, infer R>
      ? R
      : F extends SourceOptionalArg<infer _L, infer R>
        ? R
        : F extends InjectedArg<infer R>
          ? R
          : never;

type Fields = Readonly<Record<string, Field>>;

type Flatten<T> = { [K in keyof T]: T[K] } & {};

type LiveRequired<F extends Fields> = {
  [K in keyof F as F[K] extends Arg<unknown, unknown> ? K : never]: LiveOf<F[K]>;
};

type LiveOptional<F extends Fields> = {
  [
    K in keyof F as F[K] extends OptionalArg<unknown, unknown> | SourceOptionalArg<unknown, unknown>
      ? K
      : never
  ]?: LiveOf<F[K]>;
};

type ReadRequired<F extends Fields> = {
  [K in keyof F as F[K] extends OptionalArg<unknown, unknown> ? never : K]: ReadOf<F[K]>;
};

type ReadOptional<F extends Fields> = {
  [K in keyof F as F[K] extends OptionalArg<unknown, unknown> ? K : never]?: ReadOf<F[K]>;
};

export type LiveStruct<F extends Fields> = Readonly<Flatten<LiveRequired<F> & LiveOptional<F>>>;

export type ReadStruct<F extends Fields> = Readonly<Flatten<ReadRequired<F> & ReadOptional<F>>>;

const make = <Live, Read = Live>(plan: Plan): Arg<Live, Read> => ({ plan });

type PlanOf<Tag extends Plan["_tag"]> = Extract<Plan, { readonly _tag: Tag }>;

/** A plan under construction: optional keys are assigned only when present, so absent means absent. */
type Draft<T> = { -readonly [K in keyof T]: T[K] };

const planOf = (field: Field): Plan => ("_optional" in field ? field.arg.plan : field.plan);

/** The lowered form of a `taggedUnion` case: `{ _tag, ...fields }`. */
type TaggedLive<Cases extends Readonly<Record<string, Fields>>> = {
  [K in keyof Cases & string]: Readonly<Flatten<{ readonly _tag: K } & LiveStruct<Cases[K]>>>;
}[keyof Cases & string];

type TaggedRead<Cases extends Readonly<Record<string, Fields>>> = {
  [K in keyof Cases & string]: Readonly<Flatten<{ readonly _tag: K } & ReadStruct<Cases[K]>>>;
}[keyof Cases & string];

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

/**
 * `Read` markers. The runtime stays free of `@effx/ir`; the compiler resolves each marker to the real
 * decoded type (`SchemaArg`, `SymbolArg`, …) with a type-level map (`Resolved` in `@effx/compiler`).
 */
export interface SchemaMarker {
  readonly "~effx/Read": "Schema";
}

export interface SymbolMarker {
  readonly "~effx/Read": "Symbol";
}

export interface RootSymbolMarker {
  readonly "~effx/Read": "RootSymbol";
}

/** The lowered form of `Capability.make(name, { resource, focus? })`: `resource` is the model's export name. */
export interface CapabilityMarker {
  readonly "~effx/Read": "Capability";
}

export interface SymbolOptions {
  readonly check: SymbolCheck;
  readonly message?: string;
}

export interface SchemaOptions {
  readonly fieldKeys?: FieldKeys;
  /** With `fieldKeys`: a Schema without static `fields` lowers without them instead of being rejected. */
  readonly fieldsOptional?: true;
  readonly taggedMessage?: true;
}

/**
 * The closed combinator algebra for annotation arguments (spec 0020 §2.2). Every member has a fixed
 * lowering, an encoded form and a decode Schema derived by the compiler, so an `args` built from it is
 * statically lowerable by construction.
 */
export const A = {
  string: make<string>({ _tag: "String" }),
  nonEmptyString: make<string>({ _tag: "String", nonEmpty: true }),
  number: make<number>({ _tag: "Number" }),
  int: make<number>({ _tag: "Int" }),
  boolean: make<boolean>({ _tag: "Boolean" }),

  literal: <const V extends string | number | boolean>(...values: readonly [V, ...V[]]): Arg<V> =>
    make<V>({ _tag: "Literal", values }),

  struct: <const F extends Fields>(
    fields: F,
    options?: { readonly rejectDuplicate?: ReadonlyArray<keyof F & string> },
  ): Arg<LiveStruct<F>, ReadStruct<F>> => {
    const plans: Record<string, Plan> = {};
    const optional: Array<string> = [];

    for (const [key, field] of Object.entries(fields)) {
      if ("_optional" in field && field._optional === "injected") {
        plans[key] = { _tag: "Injected", plan: field.arg.plan };
        continue;
      }

      plans[key] = planOf(field);

      // `sourceOptional` is optional only in source: the lowered plan requires it (the pre-pass fills it).
      if ("_optional" in field && field._optional === "optional") optional.push(key);
    }

    const plan: Draft<PlanOf<"Struct">> = { _tag: "Struct", fields: plans, optional };

    if (options?.rejectDuplicate !== undefined) plan.rejectDuplicate = options.rejectDuplicate;

    return make(plan);
  },

  /** Absent in source and in the lowered value. */
  optional: <L, R>(arg: Arg<L, R>): OptionalArg<L, R> => ({ _optional: "optional", arg }),

  /** Optional to write; the 0013 pre-pass must fill it, so it is required in `Read`. */
  sourceOptional: <L, R>(arg: Arg<L, R>): SourceOptionalArg<L, R> => ({ _optional: "source", arg }),

  /** Supplied by the collector (e.g. `PersistentModel.schema`); never written in source. */
  injected: <R>(arg: Arg<unknown, R>): InjectedArg<R> => ({
    _optional: "injected",
    arg: make<never, R>(arg.plan),
  }),

  /** `nonEmpty` is a decode check; the written type stays a plain array (use `nonEmptyArray` for a tuple). */
  array: <L, R>(
    item: Arg<L, R>,
    options?: { readonly unique?: true; readonly nonEmpty?: true },
  ): Arg<ReadonlyArray<L>, ReadonlyArray<R>> => {
    const plan: Draft<PlanOf<"Array">> = { _tag: "Array", item: item.plan };

    if (options?.nonEmpty) plan.nonEmpty = true;

    if (options?.unique) plan.unique = true;

    return make(plan);
  },

  nonEmptyArray: <L, R>(
    item: Arg<L, R>,
    options?: { readonly unique?: true },
  ): Arg<readonly [L, ...Array<L>], readonly [R, ...Array<R>]> => {
    const plan: Draft<PlanOf<"Array">> = { _tag: "Array", item: item.plan, nonEmpty: true };

    if (options?.unique) plan.unique = true;

    return make(plan);
  },

  record: <L, R>(value: Arg<L, R>): Arg<Readonly<Record<string, L>>, Readonly<Record<string, R>>> =>
    make({ _tag: "Record", value: value.plan }),

  json: make<JsonValue>({ _tag: "Json" }),
  jsonObject: make<{ readonly [key: string]: JsonValue }>({ _tag: "JsonObject" }),

  taggedUnion: <const Cases extends Readonly<Record<string, Fields>>>(
    cases: Cases,
  ): Arg<TaggedLive<Cases>, TaggedRead<Cases>> =>
    make({
      _tag: "TaggedUnion",
      cases: Object.fromEntries(
        Object.entries(cases).map(([tag, fields]) => [
          tag,
          Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, planOf(field)])),
        ]),
      ),
    }),

  union: <const Members extends readonly [Arg<unknown, unknown>, ...Array<Arg<unknown, unknown>>]>(
    ...members: Members
  ): Arg<LiveOf<Members[number]>, ReadOf<Members[number]>> =>
    make({ _tag: "Union", members: members.map((member) => member.plan) }),

  /** A Schema value; lowered to a reference to its exported declaration, never serialized. */
  schema: (options?: SchemaOptions): Arg<Schema.Top, SchemaMarker> => {
    const plan: Draft<PlanOf<"Schema">> = { _tag: "Schema" };

    if (options?.fieldKeys !== undefined) plan.fieldKeys = options.fieldKeys;

    if (options?.fieldsOptional) plan.fieldsOptional = true;

    if (options?.taggedMessage) plan.taggedMessage = true;

    return make(plan);
  },

  /**
   * Source sugar: the same plan as `arg`, but `Live` also accepts `Sugar` (e.g. `query: true`); a pre-pass
   * (spec 0013) rewrites the sugar before decode, so `Read` is unchanged.
   */
  sugar: <L, R, S>(arg: Arg<L, R>, _sugar: Arg<S, unknown>): Arg<L | S, R> => arg,

  /** A type-only operand for `sugar`: the written type it adds; it has no plan of its own. */
  typed: <L>(): Arg<L, never> => make<L, never>({ _tag: "Json" }),

  /**
   * A transformation-free Effect Schema over the algebra's node kinds, as an argument (spec 0020 §2.2).
   * `Live` is the Schema's `Encoded` (what the author writes and the frontend lowers), `Read` its `Type`
   * (what `read` receives); they are one type for a transformation-free Schema, and any transformation
   * is rejected. Refinement checks beyond the named ones (`isNonEmpty`, `isInt`, `isUnique`) run in the
   * compiler's decode, never in the application. A node the frontend cannot lower makes `define` record
   * an `EFFX1301` diagnostic with its path; see `planOfSchemaAst` for the accepted and rejected kinds.
   */
  fromSchema: <S extends Schema.Top>(schema: S): Arg<S["Encoded"], S["Type"]> =>
    make(planOfSchemaAst(schema.ast)),

  /** An exported application value; `Live` is its static type, supplied by the author. */
  symbol: <Live, Read = SymbolMarker>(options: SymbolOptions): Arg<Live, Read> => {
    const plan: Draft<PlanOf<"Symbol">> = { _tag: "Symbol", check: options.check };

    if (options.message !== undefined) plan.message = options.message;

    return make(plan);
  },

  /** `Capability.make(...)` or a const holding it. */
  capability: <Live>(): Arg<Live, CapabilityMarker> => make({ _tag: "Capability" }),
} as const;

/** The positional argument list of an annotation. */
export const args = {
  list: (...items: ReadonlyArray<Arg<unknown, unknown>>): ArgsPlan => ({
    items: items.map((item) => item.plan),
  }),
  rest: (
    rest: Arg<unknown, unknown>,
    ...items: ReadonlyArray<Arg<unknown, unknown>>
  ): ArgsPlan => ({
    items: items.map((item) => item.plan),
    rest: rest.plan,
  }),
} as const;
