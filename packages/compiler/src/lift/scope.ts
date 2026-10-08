import { Option } from "effect";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { Diagnostic } from "../Diagnostic.ts";
import type { Term } from "../generate/term.ts";
import type { Cause } from "./causes.ts";
import {
  findingCause,
  groupPart,
  subjectOf,
  unrecognized,
  upperFirst,
  type Context,
  type Position,
} from "./context.ts";
import type { EndpointRecord } from "./model.ts";
import { nativeCalleeOf, type NativeCallee } from "./native.ts";
import type { CodeReference, Refactor } from "./result.ts";
import type { Finding, SourceFileRecord, SourceRange, TermSlot } from "./source.ts";
import { rootOf, stringOf, type Cursor } from "./view.ts";

/*
 * The state one endpoint recognition accumulates and the few operations every reader needs. Causes and
 * refactors are appended as they are found, so one pass reports EVERY applicable cause of the declaration
 * (spec 0019 §0.6) instead of stopping at the first. The scope is local to a single `recognizeEndpoint` call.
 */

export interface Scope {
  readonly ctx: Context;
  readonly groupId: string;
  readonly endpoint: EndpointRecord;
  /** `<group>.<key>`, as users write it. */
  readonly subject: string;
  readonly key: Option.Option<string>;
  /** The analyzed file that holds the endpoint, when the model has a record of it. */
  readonly use: SourceFileRecord | undefined;
  readonly causes: Array<Cause>;
  readonly refactors: Array<Refactor>;
  readonly codeReferences: Array<CodeReference>;
}

export const makeScope = (ctx: Context, groupId: string, endpoint: EndpointRecord): Scope => {
  const key = endpoint.key._tag === "Lowered" ? stringOf(endpoint.key.term) : Option.none<string>();

  return {
    ctx,
    groupId,
    endpoint,
    subject: subjectOf(groupId, key, endpoint.symbol),
    key,
    use: ctx.files.get(endpoint.range.file),
    causes: [],
    refactors: [],
    codeReferences: [],
  };
};

/** Records a cause with its registered diagnostic. */
export const fail = (scope: Scope, at: SourceRange, diagnostic: Diagnostic): void => {
  scope.causes.push({ at, diagnostic });
};

/** EFFX3001 for a construct the grammar does not contain. */
export const failUnrecognized = (scope: Scope, at: SourceRange, construct: string): void => {
  scope.causes.push(unrecognized(scope.subject, at, construct));
};

const isUnreadable = (finding: Finding): boolean =>
  finding.kind === "non-literal" ||
  finding.kind === "local-reference" ||
  finding.kind === "unresolved";

/**
 * The causes of unlowered findings. At a structural position `what` names a literal the grammar requires
 * (`key`, `path`, `options`), so an unreadable expression there is the computed-construct cause.
 */
export const failFindings = (
  scope: Scope,
  position: Position,
  findings: ReadonlyArray<Finding>,
  what?: string,
): void => {
  for (const finding of findings)
    scope.causes.push(
      what !== undefined && position === "structure" && isUnreadable(finding)
        ? {
            at: finding.range,
            diagnostic: LiftDiagnostics.EFFX3001.emit({
              _tag: "ComputedKey",
              subject: scope.subject,
              construct: what,
            }),
          }
        : findingCause(scope.ctx, scope.subject, position, finding),
    );
};

/** A slot as a cursor, or none after recording the causes of its findings. */
export const open = (
  scope: Scope,
  slot: TermSlot,
  position: Position,
  what?: string,
): Option.Option<Cursor> => {
  if (slot._tag === "Unlowered") {
    failFindings(scope, position, slot.findings, what);

    return Option.none();
  }

  return Option.some(rootOf(slot));
};

/** The validated native identity of a term, under the model's own target. */
export const nativeOf = (scope: Scope, term: Term): NativeCallee | undefined =>
  nativeCalleeOf(scope.ctx.model.target, scope.ctx.model.natives, term);

/** The derived name of an inline export: the group, the endpoint and what the export is. */
export const derivedName = (scope: Scope, suffix: string): string =>
  `${groupPart(scope.groupId)}${upperFirst(Option.getOrElse(scope.key, () => scope.endpoint.symbol.export))}${suffix}`;

/** The `LiftInput.names` key of an endpoint-local planned export. */
export const plannedKey = (scope: Scope, role: string): string =>
  `${scope.groupId}.${Option.getOrElse(scope.key, () => scope.endpoint.symbol.export)}#${role}`;
