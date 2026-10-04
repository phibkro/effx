import { Option, Schema } from "effect";

export const Severity = Schema.Literals(["error", "warning", "info"]);

export type Severity = typeof Severity.Type;

export const Location = Schema.Struct({ file: Schema.String, line: Schema.Int, col: Schema.Int });

export type Location = typeof Location.Type;

/** @internal */
export const DiagnosticCode = Schema.String.check(
  Schema.isPattern(/^EFFX\d{4}$/, { message: "Expected a diagnostic code of the form EFFX####" }),
);

export interface Diagnostic {
  readonly code: string;
  readonly severity: Severity;
  readonly message: string;
  readonly location?: Location;
  readonly related?: ReadonlyArray<Diagnostic>;
}

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

const makeDiagnostic = (
  severity: Severity,
  code: string,
  message: string,
  location: Location | undefined,
): Diagnostic => {
  if (location === undefined) return { code, severity, message };

  return { code, severity, message, location };
};

export const error = (code: string, message: string, location?: Location): Diagnostic =>
  makeDiagnostic("error", code, message, location);

export const warning = (code: string, message: string, location?: Location): Diagnostic =>
  makeDiagnostic("warning", code, message, location);

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
