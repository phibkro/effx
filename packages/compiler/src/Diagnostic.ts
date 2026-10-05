import { Option, Schema } from "effect";

export { DiagnosticCode, Location, Severity } from "@effx/diagnostics";

import {
  DiagnosticCode,
  Location,
  Severity,
  type Diagnostic as DiagnosticData,
} from "@effx/diagnostics";

export type Diagnostic = DiagnosticData;

/** Diagnostics are data, not failures (spec 0001). Serializable into the manifest. */
export const Diagnostic = Schema.Struct({
  code: DiagnosticCode,
  severity: Severity,
  message: Schema.String,
  location: Schema.optionalKey(Location),
  related: Schema.optionalKey(
    Schema.Array(Schema.suspend((): Schema.Codec<Diagnostic> => Diagnostic)),
  ),
});

export const hasErrors = (diagnostics: ReadonlyArray<Diagnostic>): boolean =>
  diagnostics.some((d) => d.severity === "error");

/**
 * Every pipeline stage returns one of these; diagnostics accumulate across stages.
 *
 * @internal
 */
export interface StageResult<A> {
  readonly value: Option.Option<A>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/** @internal */
export const StageResult = {
  succeed: <A>(value: A, diagnostics: ReadonlyArray<Diagnostic> = []): StageResult<A> => ({
    value: Option.some(value),
    diagnostics,
  }),
  skip: <A = never>(diagnostics: ReadonlyArray<Diagnostic> = []): StageResult<A> => ({
    value: Option.none(),
    diagnostics,
  }),
};
