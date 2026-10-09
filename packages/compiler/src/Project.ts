import { Schema } from "effect";

/*
 * Resolved project settings (spec 0002): moved out of `Collected.ts` so the shared inert facts of
 * `lift/input.ts` can name `ProjectResolution` without importing `Collected.ts` — the one small extraction
 * that keeps `Collected.ts`, `ProjectConfig.lift` and `LiftInput` Schema-defined by a single source with no
 * cycle and no repeated field set. `Collected.ts` re-exports every schema here under its own module path.
 */

export const TargetProfile = Schema.Literals(["effect-4.0"]);

export type TargetProfile = typeof TargetProfile.Type;

export const EmitMode = Schema.Literals(["contract", "handlers", "all"]);

export type EmitMode = typeof EmitMode.Type;

/** Declared naming policy; omission preserves legacy problem-contract IR. */
export const Naming = Schema.Struct({
  problemIdentifier: Schema.optionalKey(Schema.String),
});

export type Naming = typeof Naming.Type;

/** @internal */
export const ProjectResolution = Schema.Struct({
  naming: Schema.optionalKey(Naming),
  target: TargetProfile,
  emit: EmitMode,
  strictAccess: Schema.optionalKey(Schema.Boolean),
  allowImportingTsExtensions: Schema.Boolean,
  /** One output-independent base for local symbols in canonical IR. */
  canonicalImportBase: Schema.String,
  /** Actual directory where this pass emits files. */
  outputDir: Schema.String,
});

/** @internal */
export type ProjectResolution = typeof ProjectResolution.Type;
