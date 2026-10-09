import { Schema } from "effect";
import { SchemaRef, SymbolRef } from "@effx/ir";
import { ProjectResolution } from "../Collected.ts";
import { LiftRule } from "./rules.ts";

// Shared struct fields of both the serialized `LiftInput` and the frozen `ProjectConfig.lift`: one
// declaration, composed by struct field spread, so neither shape repeats the other's field set (spec 0019
// §5.2, single Schema source, no import cycle, no lazy masking).

/** The inert, frozen facts of one lift input (see `LiftProjectInput`). */
export const LiftProjectFields = {
  rules: Schema.Array(LiftRule),
  names: Schema.Record(Schema.String, SymbolRef),
  emptyInput: Schema.optionalKey(SchemaRef),
  output: Schema.Struct({ module: Schema.String }),
  projections: Schema.optionalKey(Schema.Array(Schema.Struct({ key: SymbolRef, hook: SymbolRef }))),
};

/**
 * The inert, frozen facts of one lift input: the data rules (each Schema-valued slot a `SchemaRef` and
 * function-valued slot a `SymbolRef`), the pinned export names the IR hashes, the optional `emptyInput`
 * schema of endpoints without a request channel, the suggestion module, and the inert projection
 * references of the native `--check` adapter. A projection reference is `{ key, hook }` data that names the
 * registered Context key and the check adapter's hook; the adapter alone executes it and no definition
 * hook, rule, `LiftInput` value or IR node ever does.
 */
export const LiftProjectInput = Schema.Struct(LiftProjectFields);

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
  project: Schema.optionalKey(ProjectResolution),
});

export type LiftInput = typeof LiftInput.Type;
