import { Schema } from "effect";
import { Diagnostic } from "../Diagnostic.ts";
import { Delta, IdentifierWitness, ReflectionPair } from "./reflection.ts";

/*
 * The check report of spec 0019 §2.4 step 7: one outcome per requested form, the binding gate carried on
 * its own conclusion, and one derived overall pass. Nothing here is a boolean status fact that duplicates
 * another variant: only a `Pass` carries applied deltas, only a `Mismatch` carries the differences, and
 * only a real executed receipt can build a `Passed` binding (the plain `BindingReport` of the lift core
 * stays literal `UNVERIFIED`).
 */

/** Why a form could not run (EFFX3103 data; the check reports it and never a pass). */
export const CheckReason = Schema.Literals([
  "overlay-compile",
  "root-build",
  "projection-hook",
  "rule-exception",
]);

export type CheckReason = typeof CheckReason.Type;

/**
 * One requested suggestion form. A `Pass` owns the reflections and the applied Δ classes; a `Mismatch`
 * owns the reflections and the differing paths; an `Impossible` owns the EFFX3103 data and never passes.
 * Every variant keeps the actual comparisons "original/generated" it was built from, so the CLI render and
 * the `--json` report are the same document.
 */
export const FormOutcome = Schema.TaggedUnion({
  Pass: {
    reflections: ReflectionPair,
    deltas: Schema.Array(Delta),
  },
  Mismatch: {
    reflections: ReflectionPair,
    differences: Schema.Array(Schema.String),
  },
  Impossible: {
    reason: CheckReason,
    detail: Schema.String,
    diagnostics: Schema.Array(Diagnostic),
  },
});

export type FormOutcome = typeof FormOutcome.Type;

/** Re-exported for the CLI report rendering: one endpoint's Δ2 witness evidence. */
export const CheckIdentifierWitness = IdentifierWitness;

export type CheckIdentifierWitness = IdentifierWitness;

/**
 * The actual key evidence of one binding: the group's endpoint keys as they were read from the untouched
 * model, the binding's registered keys, and the two derived gaps. Both-empty is valid evidence: a group
 * whose endpoint set is empty and whose binding registers none of them proves key equality too.
 */
export const BindingKeyProof = Schema.Struct({
  declared: Schema.Array(Schema.String),
  bound: Schema.Array(Schema.String),
  missing: Schema.Array(Schema.String),
  extra: Schema.Array(Schema.String),
});

export type BindingKeyProof = typeof BindingKeyProof.Type;

/** The executed receipt of the binding typecheck; only a real run builds this and only its own values. */
export const BindingTypeReceipt = Schema.Struct({
  stage: Schema.Literal("overlay-binding-typecheck"),
  exit: Schema.Int,
  diagnostics: Schema.Array(Diagnostic),
});

export type BindingTypeReceipt = typeof BindingTypeReceipt.Type;

/**
 * The binding gate. `Passed` requires an actual key proof plus an actual executed typecheck receipt;
 * `Failed` carries what really failed (the key proof, the receipt, or both) with the registered
 * EFFX3201/3202/3103 diagnostics; `Missing` means the check could not bind anything and never passes.
 */
export const BindingConclusion = Schema.TaggedUnion({
  Passed: { keyProof: BindingKeyProof, receipt: BindingTypeReceipt },
  Failed: {
    keyProof: Schema.optionalKey(BindingKeyProof),
    receipt: Schema.optionalKey(BindingTypeReceipt),
    diagnostics: Schema.Array(Diagnostic),
  },
  Missing: { diagnostics: Schema.Array(Diagnostic) },
});

export type BindingConclusion = typeof BindingConclusion.Type;

/** The forms the check was asked to run (spec 0019 §4.1). */
export const CheckForm = Schema.Literals(["verbose", "dense"]);

export type CheckForm = typeof CheckForm.Type;

/**
 * The `--check` report: one outcome per requested form and one binding gate. `pass` is derived, never
 * stored by construction: it is `true` only when every requested form is a `Pass` and the binding gate is
 * `Passed` (spec 0019 §2.2 items 1–3).
 */
export const LiftCheckResult = Schema.Struct({
  group: Schema.String,
  binding: BindingConclusion,
  verbose: Schema.optionalKey(FormOutcome),
  dense: Schema.optionalKey(FormOutcome),
});

export type LiftCheckResult = typeof LiftCheckResult.Type;
