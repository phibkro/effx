import { Schema } from "effect";
import { defineDiagnostic, type DiagnosticEntry } from "@effx/diagnostics";

const Params = Schema.Struct({
  domain: Schema.String,
  detail: Schema.String,
  scope: Schema.Int,
  steps: Schema.Int,
});

const entry = <const Code extends string, const Severity extends "error" | "warning">(
  code: Code,
  title: string,
  severity: Severity,
  explanation: string,
) =>
  ({
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
  }) as const;

const render =
  (title: string) =>
  ({ domain, detail, scope, steps }: typeof Params.Type) =>
    `${domain}: ${title} (scope ${scope}, steps ${steps}): ${detail}`;

const titles = {
  EFFX4301: "Invalid domain description",
  EFFX4302: "Guard not modelled",
  EFFX4303: "Alloy 6.2.0 unavailable",
  EFFX4304: "Alloy execution or receipt invalid",
  EFFX4305: "A1 state reachability",
  EFFX4306: "A2 nonterminal exit",
  EFFX4307: "A3 command grant",
  EFFX4308: "A4 admin self-change",
  EFFX4309: "A5 ended membership",
  EFFX4310: "A6 system job authority",
  EFFX4311: "Nondeterministic time condition",
  EFFX4312: "A7 clock monotonicity",
  EFFX4313: "Command effect not modelled precisely",
} as const;

export const DomainDiagnostics = {
  EFFX4301: defineDiagnostic(
    entry(
      "EFFX4301",
      titles.EFFX4301,
      "error",
      "The description does not decode or contains an unresolved domain reference.",
    ),
    Params,
    render(titles.EFFX4301),
  ),
  EFFX4302: defineDiagnostic(
    entry(
      "EFFX4302",
      titles.EFFX4302,
      "warning",
      "No Alloy compiler is registered for a guard representation; the transition is modelled without that guard.",
    ),
    Params,
    render(titles.EFFX4302),
  ),
  EFFX4303: defineDiagnostic(
    entry(
      "EFFX4303",
      titles.EFFX4303,
      "error",
      "The required Alloy executable is missing or reports a different version.",
    ),
    Params,
    render(titles.EFFX4303),
  ),
  EFFX4304: defineDiagnostic(
    entry(
      "EFFX4304",
      titles.EFFX4304,
      "error",
      "The child failed, or its receipt is missing, malformed, or does not contain all expected commands.",
    ),
    Params,
    render(titles.EFFX4304),
  ),
  EFFX4305: defineDiagnostic(
    entry(
      "EFFX4305",
      titles.EFFX4305,
      "error",
      "No trace reached the named state from the initial state within the stated scope and step bound.",
    ),
    Params,
    render(titles.EFFX4305),
  ),
  EFFX4306: defineDiagnostic(
    entry(
      "EFFX4306",
      titles.EFFX4306,
      "error",
      "A state not declared terminal has no transition out.",
    ),
    Params,
    render(titles.EFFX4306),
  ),
  EFFX4307: defineDiagnostic(
    entry(
      "EFFX4307",
      titles.EFFX4307,
      "error",
      "A command has no applicable grant, or a job-only command is granted outside its job.",
    ),
    Params,
    render(titles.EFFX4307),
  ),
  EFFX4308: defineDiagnostic(
    entry(
      "EFFX4308",
      titles.EFFX4308,
      "error",
      "A principal outside the active admin set can change its own admin status.",
    ),
    Params,
    render(titles.EFFX4308),
  ),
  EFFX4309: defineDiagnostic(
    entry(
      "EFFX4309",
      titles.EFFX4309,
      "error",
      "A membership outside the declared granting states contributes permission.",
    ),
    Params,
    render(titles.EFFX4309),
  ),
  EFFX4310: defineDiagnostic(
    entry(
      "EFFX4310",
      titles.EFFX4310,
      "error",
      "A system principal is permitted a different set of commands than its own job.",
    ),
    Params,
    render(titles.EFFX4310),
  ),
  EFFX4311: defineDiagnostic(
    entry(
      "EFFX4311",
      titles.EFFX4311,
      "warning",
      "A calculated transition or expiry lacks a supported clock-bound guard, so its time condition is modelled nondeterministically.",
    ),
    Params,
    render(titles.EFFX4311),
  ),
  EFFX4312: defineDiagnostic(
    entry(
      "EFFX4312",
      titles.EFFX4312,
      "error",
      "The domain clock moves backward in a model trace.",
    ),
    Params,
    render(titles.EFFX4312),
  ),
  EFFX4313: defineDiagnostic(
    entry(
      "EFFX4313",
      titles.EFFX4313,
      "warning",
      "A declared stored-field write is modelled as any value in the field order, not as the command's precise effect.",
    ),
    Params,
    render(titles.EFFX4313),
  ),
} as const;

export const domainEntries: ReadonlyArray<DiagnosticEntry> = Object.values(DomainDiagnostics).map(
  (definition) => definition.entry,
);
