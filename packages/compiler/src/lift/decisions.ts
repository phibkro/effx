import type { Diagnostic } from "../Diagnostic.ts";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { ChosenInput } from "./collect.ts";
import { isQuery } from "./collect.ts";
import type { Decision, PlannedExport } from "./result.ts";
import { locationOf, type SourceRange } from "./source.ts";
import type { Recognized } from "./types.ts";

/*
 * The lift decisions of spec 0019 §2.3: facts of the IR with no Effect twin, so no wire check can validate
 * them. They are printed as a reviewable list (`Decision`) and each one also carries the registered EFFX3010
 * warning, so a consumer that only reads diagnostics still sees that nothing here is "verified".
 */

/** One decision with the warning that asks for its review. */
export interface Reviewed {
  readonly decision: Decision;
  readonly diagnostic: Diagnostic;
}

export interface OperationDecisions {
  readonly recognized: Recognized;
  readonly input: ChosenInput;
  /** The suggestion's export for the operation, and the module the suggestion lives in. */
  readonly operation: string;
  readonly module: string;
  /** Where the declaration sits in the analyzed source. */
  readonly at: SourceRange;
  /** Every export the endpoint's refactors plan. */
  readonly planned: ReadonlyArray<PlannedExport>;
}

/** The kind, input and export-name decisions of one recognized endpoint. */
export const operationDecisions = (parts: OperationDecisions): ReadonlyArray<Reviewed> => {
  const { recognized, input, at } = parts;
  const subject = recognized.subject;
  const location = locationOf(at);
  const kind = isQuery(recognized) ? "Query" : "Command";

  return [
    {
      decision: { _tag: "OperationKind", subject, kind, method: recognized.method },
      diagnostic: LiftDiagnostics.EFFX3010.emit(
        { subject, decision: "kind", value: `${kind} for ${recognized.method}` },
        { location },
      ),
    },
    {
      decision: {
        _tag: "OperationInput",
        subject,
        channel: input.channel,
        schema: input.ref,
        others: input.others,
      },
      diagnostic: LiftDiagnostics.EFFX3010.emit(
        { subject, decision: "input", value: `${input.channel} ${input.ref.export}` },
        { location },
      ),
    },
    {
      decision: {
        _tag: "ExportName",
        subject,
        role: "operation",
        name: parts.operation,
        source: "derived",
        module: parts.module,
      },
      diagnostic: LiftDiagnostics.EFFX3010.emit(
        { subject, decision: "export", value: parts.operation },
        { location },
      ),
    },
    ...parts.planned.map((planned): Reviewed => ({
      decision: {
        _tag: "ExportName",
        subject,
        role: planned.role,
        name: planned.name,
        source: planned.source,
        module: planned.ref.module,
      },
      diagnostic: LiftDiagnostics.EFFX3010.emit(
        { subject, decision: "export", value: planned.name },
        { location },
      ),
    })),
  ];
};

/** The export name chosen for the group declaration. */
export const groupDecision = (
  group: string,
  name: string,
  module: string,
  at: SourceRange,
): Reviewed => ({
  decision: {
    _tag: "ExportName",
    subject: group,
    role: "group",
    name,
    source: "derived",
    module,
  },
  diagnostic: LiftDiagnostics.EFFX3010.emit(
    { subject: group, decision: "export", value: name },
    { location: locationOf(at) },
  ),
});
