import { Schema } from "effect";
import { SchemaRef, SymbolRef } from "@effx/ir";
import { LiftRule } from "./rules.ts";

// One source for the project-config data and the pure lift input. Projection refs are appended only to
// ProjectConfig.lift; the pure LiftInput never carries check-only projection references.

/** The stable inert facts both the config and one LiftInput share. */
export const LiftProjectFields = {
  rules: Schema.Array(LiftRule),
  names: Schema.Record(Schema.String, SymbolRef),
  emptyInput: Schema.optionalKey(SchemaRef),
  output: Schema.Struct({ module: Schema.String }),
};

/** Config-only projection references: inert data consumed by the native check adapter, never by lift. */
export const LiftProjectInput = Schema.Struct({
  ...LiftProjectFields,
  projections: Schema.optionalKey(Schema.Array(Schema.Struct({ key: SymbolRef, hook: SymbolRef }))),
});

export type LiftProjectInput = typeof LiftProjectInput.Type;
/**
 * Everything the pure core needs besides the model. `names` pins the real exports that enter the IR hash.
 * Its keys are exactly: a resolver id (the value an access builder passes as its resolver), which maps to
 * the exported resolver symbol; `<group>.<endpointKey>#<role>` with role `params|query|headers|payload|success`,
 * which maps to the export planned for an inline request or success schema; `<module>#<export>#codes` for the
 * code tuple planned for a problem union; and `<module>#<export>#headers` for the header schema planned for
 * a success wrapper. A name that is not pinned is derived deterministically; one that cannot be resolved is a
 * diagnostic, never a placeholder.
 */

export const LiftInput = Schema.Struct({
  ...LiftProjectFields,
  group: Schema.String,
});

export type LiftInput = typeof LiftInput.Type;
