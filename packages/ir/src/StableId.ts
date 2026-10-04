import { Schema } from "effect";

/**
 * `StableId := kind ":" name`; see docs/specs/0001-compiler-kernel.md.
 * `kind` is lowercase; `name` may contain `.` `/` `:` `-` `_` `$`.
 */
export const pattern = /^[a-z][a-z0-9-]*:[A-Za-z0-9_$][A-Za-z0-9_$./:-]*$/;

export const StableId = Schema.String.check(
  Schema.isPattern(pattern, {
    message: "Expected a StableId of the form <kind>:<qualified.name>",
  }),
).pipe(Schema.brand("effx/StableId"));

export type StableId = typeof StableId.Type;

export type Kind =
  | "schema"
  | "model"
  | "service"
  | "operation"
  | "group"
  | "capability"
  | "focus"
  | "exposure"
  | "ext";

/** Builds an id from parts; throws only on malformed input (programmer error). */
export const make = (kind: Kind, name: string): StableId => StableId.make(`${kind}:${name}`);

export const kindOf = (id: StableId): string => id.slice(0, id.indexOf(":"));

export const nameOf = (id: StableId): string => id.slice(id.indexOf(":") + 1);

export const isStableId = Schema.is(StableId);
