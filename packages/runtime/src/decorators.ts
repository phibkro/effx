import type { Schema } from "effect";
import {
  type Annotation,
  type Capability,
  type FoldkitCommandOptions,
  type HttpAccessOptions,
  type HttpContractOptions,
  type HttpGroupOptions,
  type HttpProblemsOptions,
  type OperationOptions,
  type PersistentModelOptions,
  type ServiceLike,
  record,
} from "./Annotation.js";
import { group } from "./builder.js";

/**
 * TC39 standard method decorator. Records the annotation on the method function and returns
 * `undefined`: the method is never replaced and no behaviour is generated (ADR 0001).
 */
export type MethodDecorator = <This, Args extends ReadonlyArray<never>, Return>(
  value: (this: This, ...args: Args) => Return,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Return>,
) => undefined;

export type ClassDecorator = <Class extends abstract new (...args: never) => object>(
  value: Class,
  context: ClassDecoratorContext<Class>,
) => undefined;

const method =
  (annotation: Annotation): MethodDecorator =>
  (value) => {
    record(value, annotation);

    return undefined;
  };

const classAnnotation =
  (annotation: Annotation): ClassDecorator =>
  (value) => {
    record(value, annotation);

    return undefined;
  };

/** Generic source annotation; an extension, not the runtime, gives it meaning. */
export const Annotate = (name: string, ...args: Annotation["args"]): MethodDecorator =>
  method({ name, args });

export const Query = (options: OperationOptions): MethodDecorator =>
  method({ name: "Query", args: [options] });

export const Command = (options: OperationOptions): MethodDecorator =>
  method({ name: "Command", args: [options] });

export const Errors = (...schemas: ReadonlyArray<Schema.Top>): MethodDecorator =>
  method({ name: "Errors", args: schemas });

export const Requirements = (...services: ReadonlyArray<ServiceLike>): MethodDecorator =>
  method({ name: "Requirements", args: services });

export const Authorize = (capability: Capability): MethodDecorator =>
  method({ name: "Authorize", args: [capability] });

export const Rpc = (name: string): MethodDecorator => method({ name: "Rpc", args: [name] });

export const Cli = (words: string): MethodDecorator => method({ name: "Cli", args: [words] });

export const Http = {
  Group: (options: HttpGroupOptions): ClassDecorator =>
    classAnnotation({ name: "Http.Group", args: [options] }),
  group,
  Access: (options: HttpAccessOptions): MethodDecorator =>
    method({ name: "Http.Access", args: [options] }),
  Contract: (options: HttpContractOptions): MethodDecorator =>
    method({ name: "Http.Contract", args: [options] }),
  Problems: <Code extends string>(options: HttpProblemsOptions<Code>): MethodDecorator =>
    method({ name: "Http.Problems", args: [options] }),
  Get: (path: string): MethodDecorator => method({ name: "Http.Get", args: [path] }),
  Post: (path: string): MethodDecorator => method({ name: "Http.Post", args: [path] }),
  Put: (path: string): MethodDecorator => method({ name: "Http.Put", args: [path] }),
  Patch: (path: string): MethodDecorator => method({ name: "Http.Patch", args: [path] }),
  Delete: (path: string): MethodDecorator => method({ name: "Http.Delete", args: [path] }),
};

export const Foldkit = {
  Command: (options: FoldkitCommandOptions): MethodDecorator =>
    method({ name: "Foldkit.Command", args: [options] }),
};

/** Class decorator; the decorated class is the model schema, so it is recorded as `schema` (spec 0002). */
export const PersistentModel =
  (options: PersistentModelOptions): ClassDecorator =>
  (value) => {
    record(value, { name: "PersistentModel", args: [{ ...options, schema: value }] });

    return undefined;
  };
