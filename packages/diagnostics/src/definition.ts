import type { Schema } from "effect";
import type { Diagnostic, DiagnosticEntry, Location, Severity } from "./model.ts";

/** Only occurrence context is caller-controlled; no code, message or severity override. */
export interface EmitOptions {
  readonly location?: Location;
  readonly related?: ReadonlyArray<Diagnostic>;
}

/** An inert typed reference to entry data and its structured message parameters. */
export interface Definition<E extends DiagnosticEntry, S extends Schema.Top> {
  readonly entry: E;
  readonly paramsSchema: S;
  readonly emit: (
    params: S["Type"],
    options?: EmitOptions,
  ) => Diagnostic & { readonly code: E["code"] };
}

interface MutableDiagnostic<C extends string> {
  code: C;
  severity: Severity;
  message: string;
  location?: Location;
  related?: ReadonlyArray<Diagnostic>;
}

/**
 * Defines a plain, total factory for trusted typed params. Construction does not
 * render or decode anything. A boundary receiving unknown params owns decoding
 * with paramsSchema, preserving its decoding error and requirement channels.
 * Fixed entries cannot accept a severity resolver; named policies require one.
 * Neither construction nor emission acquires resources or starts Effect work.
 */
export const defineDiagnostic = <const E extends DiagnosticEntry, S extends Schema.Top>(
  entry: E,
  paramsSchema: S,
  render: (params: S["Type"]) => string,
  ...policy: E["severityPolicy"] extends { readonly kind: "fixed" }
    ? readonly []
    : readonly [severityFromParams: (params: S["Type"]) => Severity]
): Definition<E, S> => ({
  entry,
  paramsSchema,
  emit: (params, options) => {
    const diagnostic: MutableDiagnostic<E["code"]> = {
      code: entry.code,
      severity: policy[0] === undefined ? entry.severity : policy[0](params),
      message: render(params),
    };

    if (options?.location !== undefined) diagnostic.location = options.location;

    if (options?.related !== undefined) diagnostic.related = options.related;

    return diagnostic;
  },
});
