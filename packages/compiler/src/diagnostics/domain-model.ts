import { Schema } from "effect";
import { defineDiagnostic, type DiagnosticEntry } from "@effx/diagnostics";

const Params = Schema.Struct({
  domain: Schema.String,
  detail: Schema.String,
  scope: Schema.Int,
  steps: Schema.Int,
});

const diagnostic = <const Code extends string, const Severity extends "error" | "warning">(
  code: Code,
  title: string,
  severity: Severity,
  explanation: string,
) =>
  defineDiagnostic(
    {
      code,
      owner: "domain-model",
      title,
      severity,
      severityPolicy: { kind: "fixed" },
      explanation,
      examples: [
        {
          before: "A domain description or model that triggers this diagnostic",
          after: "A corrected declaration and a new bounded model check",
          explanation: "Correct the named input or condition and check the generated model again.",
        },
      ],
    } as const,
    Params,
    ({ domain, detail, scope, steps }) =>
      `${domain}: ${title} (scope ${scope}, steps ${steps}): ${detail}`,
  );

export const DomainDiagnostics = {
  EFFX4301: diagnostic(
    "EFFX4301",
    "Invalid domain description",
    "error",
    "The description does not decode or contains an unresolved domain reference.",
  ),
  EFFX4302: diagnostic(
    "EFFX4302",
    "Guard not modelled",
    "warning",
    "No Alloy compiler is registered for a guard representation; the transition is modelled without that guard.",
  ),
  EFFX4303: diagnostic(
    "EFFX4303",
    "Alloy 6.2.0 unavailable",
    "error",
    "The required Alloy executable is missing or reports a different version.",
  ),
  EFFX4304: diagnostic(
    "EFFX4304",
    "Alloy execution or receipt invalid",
    "error",
    "The child failed, or its receipt is missing, malformed, or does not contain all expected commands.",
  ),
  EFFX4305: diagnostic(
    "EFFX4305",
    "A1 state reachability",
    "error",
    "No trace reached the named state from the initial state within the stated scope and step bound.",
  ),
  EFFX4306: diagnostic(
    "EFFX4306",
    "A2 nonterminal exit",
    "error",
    "A state not declared terminal has no transition out.",
  ),
  EFFX4307: diagnostic(
    "EFFX4307",
    "A3 command grant",
    "error",
    "A command has no applicable grant, or a job-only command is granted outside its job.",
  ),
  EFFX4308: diagnostic(
    "EFFX4308",
    "A4 admin self-change",
    "error",
    "A principal outside the active admin set can change its own admin status.",
  ),
  EFFX4309: diagnostic(
    "EFFX4309",
    "A5 ended membership",
    "error",
    "A membership outside the declared granting states contributes permission.",
  ),
  EFFX4310: diagnostic(
    "EFFX4310",
    "A6 system job authority",
    "error",
    "A system principal is permitted a different set of commands than its own job.",
  ),
  EFFX4311: diagnostic(
    "EFFX4311",
    "Nondeterministic time condition",
    "warning",
    "A calculated transition or expiry lacks a supported clock-bound guard, so its time condition is modelled nondeterministically.",
  ),
  EFFX4312: diagnostic(
    "EFFX4312",
    "A7 clock monotonicity",
    "error",
    "The domain clock moves backward in a model trace.",
  ),
  EFFX4313: diagnostic(
    "EFFX4313",
    "Command effect not modelled precisely",
    "warning",
    "A declared stored-field write is modelled as any value in the field order, not as the command's precise effect.",
  ),
} as const;

export const domainEntries: ReadonlyArray<DiagnosticEntry> = Object.values(DomainDiagnostics).map(
  (definition) => definition.entry,
);
