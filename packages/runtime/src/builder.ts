import type { Schema } from "effect";
import type {
  Annotation,
  HttpGroupOptions,
  HttpProblemsOptions,
  PersistentModelOptions,
} from "./Annotation.js";
import * as Builtins from "./builtins.js";
import type { Applied } from "./define/index.js";

/** A local operation keeps the author's untouched handler. */
export interface OperationValue<Handler> {
  readonly _tag: "Operation";
  readonly annotations: ReadonlyArray<Annotation>;
  readonly handler: Handler;
}

/** A declaration-only operation has no callable handler; the application binds it externally. */
export interface ExternalOperationValue {
  readonly _tag: "Operation";
  readonly annotations: ReadonlyArray<Annotation>;
}

export interface HttpGroupValue {
  readonly _tag: "HttpGroup";
  readonly annotations: ReadonlyArray<Annotation>;
}

/** A builder group or a class decorated with @Http.Group, resolved by the source collector. */
export type HttpGroupReference = HttpGroupValue | (abstract new (...args: never[]) => object);

export const group = (options: HttpGroupOptions): HttpGroupValue => ({
  _tag: "HttpGroup",
  annotations: [Builtins.HttpGroup(options).annotation],
});

/**
 * `Http.Problems` keeps its `Code` generic, which the (non-generic) definition cannot carry.
 * `ProblemRegistry<Code>` is contravariant in `Code`, so no assignment widens it to
 * `ProblemRegistry<string>`; an overload (whose implementation signature TypeScript checks
 * with type parameters erased) states the generic public signature without an assertion.
 * The runtime never calls the registry: the compiler reads it by symbol.
 */
export function problems<Code extends string>(
  options: HttpProblemsOptions<Code>,
): Applied<typeof Builtins.HttpProblems.name, "operation">;
export function problems(
  options: HttpProblemsOptions,
): Applied<typeof Builtins.HttpProblems.name, "operation"> {
  return Builtins.HttpProblems(options);
}

export interface ModelValue<S extends Schema.Top> {
  readonly _tag: "Model";
  readonly annotations: ReadonlyArray<Annotation>;
  readonly schema: S;
}

/**
 * Value-level twin of the decorators. Each step appends exactly the annotation the matching
 * decorator would record, so `Reflect.annotationsOf(Class.method)` equals `value.annotations`.
 * Every step is its definition from `builtins.ts` applied through `with`.
 */
export class OperationBuilder {
  constructor(readonly annotations: ReadonlyArray<Annotation>) {}

  private append(annotation: Annotation): OperationBuilder {
    return new OperationBuilder([...this.annotations, annotation]);
  }

  /** Appends any applied operation annotation, built-in or user-defined (spec 0020 §2.1). */
  with(applied: Applied<string, "operation">): OperationBuilder {
    return this.append(applied.annotation);
  }

  /** Generic annotation (spec 0015): records exactly `{ name, args }`, as `@Annotate(name, ...args)` does. */
  annotate(name: string, ...args: Annotation["args"]): OperationBuilder {
    return this.append({ name, args });
  }

  in(...args: Parameters<typeof Builtins.HttpIn>): OperationBuilder {
    return this.with(Builtins.HttpIn(...args));
  }

  readonly http = {
    access: (...args: Parameters<typeof Builtins.HttpAccess>): OperationBuilder =>
      this.with(Builtins.HttpAccess(...args)),
    contract: (...args: Parameters<typeof Builtins.HttpContract>): OperationBuilder =>
      this.with(Builtins.HttpContract(...args)),
    problems: <Code extends string>(options: HttpProblemsOptions<Code>): OperationBuilder =>
      this.with(problems(options)),
    get: (...args: Parameters<typeof Builtins.HttpGet>): OperationBuilder =>
      this.with(Builtins.HttpGet(...args)),
    post: (...args: Parameters<typeof Builtins.HttpPost>): OperationBuilder =>
      this.with(Builtins.HttpPost(...args)),
    put: (...args: Parameters<typeof Builtins.HttpPut>): OperationBuilder =>
      this.with(Builtins.HttpPut(...args)),
    patch: (...args: Parameters<typeof Builtins.HttpPatch>): OperationBuilder =>
      this.with(Builtins.HttpPatch(...args)),
    delete: (...args: Parameters<typeof Builtins.HttpDelete>): OperationBuilder =>
      this.with(Builtins.HttpDelete(...args)),
  };

  readonly foldkit = {
    command: (...args: Parameters<typeof Builtins.FoldkitCommand>): OperationBuilder =>
      this.with(Builtins.FoldkitCommand(...args)),
  };

  rpc(...args: Parameters<typeof Builtins.Rpc>): OperationBuilder {
    return this.with(Builtins.Rpc(...args));
  }

  cli(...args: Parameters<typeof Builtins.Cli>): OperationBuilder {
    return this.with(Builtins.Cli(...args));
  }

  authorize(...args: Parameters<typeof Builtins.Authorize>): OperationBuilder {
    return this.with(Builtins.Authorize(...args));
  }

  errors(...args: Parameters<typeof Builtins.Errors>): OperationBuilder {
    return this.with(Builtins.Errors(...args));
  }

  requirements(...args: Parameters<typeof Builtins.Requirements>): OperationBuilder {
    return this.with(Builtins.Requirements(...args));
  }

  handler<Handler>(handler: Handler): OperationValue<Handler> {
    return { _tag: "Operation", annotations: this.annotations, handler };
  }

  declare(): ExternalOperationValue {
    return { _tag: "Operation", annotations: this.annotations };
  }
}

/**
 * Value-level twin of the `@Query` and `@Command` decorators. Each builder step appends the
 * annotation the matching decorator would record; nothing is generated at runtime (ADR 0001).
 *
 * @example
 * ```ts
 * import { Operation, Reflect } from "@effx/runtime"
 * import { Schema } from "effect"
 * import assert from "node:assert"
 *
 * const GetUser = Operation.query({
 *   name: "User.Get",
 *   input: Schema.Struct({ id: Schema.String }),
 *   success: Schema.Struct({ id: Schema.String })
 * }).http.get("/users/:id").declare()
 *
 * assert.deepStrictEqual(GetUser.annotations.map((a) => a.name), ["Query", "Http.Get"])
 * assert.strictEqual(typeof Reflect.annotationsOf, "function")
 * ```
 */
export const Operation = {
  query: (...args: Parameters<typeof Builtins.Query>): OperationBuilder =>
    new OperationBuilder([Builtins.Query(...args).annotation]),
  command: (...args: Parameters<typeof Builtins.Command>): OperationBuilder =>
    new OperationBuilder([Builtins.Command(...args).annotation]),
};

export const Model = {
  persistent: <S extends Schema.Top>(
    schema: S,
    options: PersistentModelOptions,
  ): ModelValue<S> => ({
    _tag: "Model",
    // The builder has no decorated class: `schema` is the definition's `selfAs` supplied explicitly.
    annotations: [{ name: Builtins.PersistentModel.name, args: [{ ...options, schema }] }],
    schema,
  }),
};
