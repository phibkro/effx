import type { Schema } from "effect";
import type {
  Annotation,
  Capability,
  FoldkitCommandOptions,
  HttpAccessOptions,
  HttpContractOptions,
  HttpGroupOptions,
  HttpProblemsOptions,
  OperationOptions,
  PersistentModelOptions,
  ServiceLike,
} from "./Annotation.js";

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
  annotations: [{ name: "Http.Group", args: [options] }],
});

export interface ModelValue<S extends Schema.Top> {
  readonly _tag: "Model";
  readonly annotations: ReadonlyArray<Annotation>;
  readonly schema: S;
}

/**
 * Value-level twin of the decorators. Each step appends exactly the annotation the matching
 * decorator would record, so `Reflect.annotationsOf(Class.method)` equals `value.annotations`.
 */
export class OperationBuilder {
  constructor(readonly annotations: ReadonlyArray<Annotation>) {}

  private with(annotation: Annotation): OperationBuilder {
    return new OperationBuilder([...this.annotations, annotation]);
  }
  annotate(name: string, ...args: Annotation["args"]): OperationBuilder {
    return this.with({ name, args });
  }

  in(group: HttpGroupReference): OperationBuilder {
    return this.with({ name: "Http.In", args: [group] });
  }

  readonly http = {
    access: (options: HttpAccessOptions): OperationBuilder =>
      this.with({ name: "Http.Access", args: [options] }),
    contract: (options: HttpContractOptions): OperationBuilder =>
      this.with({ name: "Http.Contract", args: [options] }),
    problems: <Code extends string>(options: HttpProblemsOptions<Code>): OperationBuilder =>
      this.with({ name: "Http.Problems", args: [options] }),
    get: (path: string): OperationBuilder => this.with({ name: "Http.Get", args: [path] }),
    post: (path: string): OperationBuilder => this.with({ name: "Http.Post", args: [path] }),
    put: (path: string): OperationBuilder => this.with({ name: "Http.Put", args: [path] }),
    patch: (path: string): OperationBuilder => this.with({ name: "Http.Patch", args: [path] }),
    delete: (path: string): OperationBuilder => this.with({ name: "Http.Delete", args: [path] }),
  };

  readonly foldkit = {
    command: (options: FoldkitCommandOptions): OperationBuilder =>
      this.with({ name: "Foldkit.Command", args: [options] }),
  };

  rpc(name: string): OperationBuilder {
    return this.with({ name: "Rpc", args: [name] });
  }

  cli(words: string): OperationBuilder {
    return this.with({ name: "Cli", args: [words] });
  }

  authorize(capability: Capability): OperationBuilder {
    return this.with({ name: "Authorize", args: [capability] });
  }

  errors(...schemas: ReadonlyArray<Schema.Top>): OperationBuilder {
    return this.with({ name: "Errors", args: schemas });
  }

  requirements(...services: ReadonlyArray<ServiceLike>): OperationBuilder {
    return this.with({ name: "Requirements", args: services });
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
  query: (options: OperationOptions): OperationBuilder =>
    new OperationBuilder([{ name: "Query", args: [options] }]),
  command: (options: OperationOptions): OperationBuilder =>
    new OperationBuilder([{ name: "Command", args: [options] }]),
};

export const Model = {
  persistent: <S extends Schema.Top>(
    schema: S,
    options: PersistentModelOptions,
  ): ModelValue<S> => ({
    _tag: "Model",
    annotations: [{ name: "PersistentModel", args: [{ ...options, schema }] }],
    schema,
  }),
};
