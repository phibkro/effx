import { type Annotation, record } from "./Annotation.js";
import * as Builtins from "./builtins.js";
import { group, problems } from "./builder.js";

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

/*
 * Every decorator is its definition from `builtins.ts` (spec 0020 §2.3): calling it yields an
 * `Applied` value that is the decorator and records exactly `{ name, args }`.
 */

export const Query = Builtins.Query;

export const Command = Builtins.Command;

export const Errors = Builtins.Errors;

export const Requirements = Builtins.Requirements;

/**
 * Generic source annotation (spec 0015): records exactly `{ name, args }`, the record an applied
 * definition records (spec 0020 §2.1). An extension, not the runtime, gives the name its meaning.
 */
export const Annotate =
  (name: string, ...args: Annotation["args"]): MethodDecorator =>
  (value) => {
    record(value, { name, args });

    return undefined;
  };

export const Authorize = Builtins.Authorize;

export const Rpc = Builtins.Rpc;

export const Cli = Builtins.Cli;

export const Http = {
  Group: Builtins.HttpGroup,
  group,
  Access: Builtins.HttpAccess,
  Contract: Builtins.HttpContract,
  Problems: problems,
  Get: Builtins.HttpGet,
  Post: Builtins.HttpPost,
  Put: Builtins.HttpPut,
  Patch: Builtins.HttpPatch,
  Delete: Builtins.HttpDelete,
};

export const Foldkit = {
  Command: Builtins.FoldkitCommand,
};

/** Class decorator; the decorated class is the model schema, recorded as `schema` (the definition's `selfAs`, spec 0002). */
export const PersistentModel = Builtins.PersistentModel;
