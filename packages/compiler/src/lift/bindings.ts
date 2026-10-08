import { Array as Arr, Option, Order } from "effect";
import type { Diagnostic } from "../Diagnostic.ts";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import { findingCause, type Context } from "./context.ts";
import type { GroupFacts } from "./group.ts";
import type { BindingRecord, EndpointRecord } from "./model.ts";
import { sameRef } from "./refs.ts";
import type { BindingReport } from "./result.ts";
import { locationOf } from "./source.ts";
import { refOf, stringOf } from "./view.ts";

/*
 * Handler binding (spec 0019 §7), reported statically: the key set of an application's
 * `HttpApiBuilder.group(root, "group", h => …)` registrations is compared with the group's endpoint keys
 * (EFFX3201), the registrations are listed with the handlers the frontend resolved, and every site that
 * needs hand adaptation is listed (EFFX3202). Nothing is executed and no handler code is invented; the
 * report is always UNVERIFIED because only the real binding typecheck can verify it.
 */

export interface BindingOutcome {
  readonly reports: ReadonlyArray<BindingReport>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/** One binding record's report with the diagnostics it raises. */
interface BindingEntry {
  readonly report: BindingReport;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const keyOf = (endpoint: EndpointRecord): ReadonlyArray<string> =>
  endpoint.key._tag === "Lowered" ? Option.toArray(stringOf(endpoint.key.term)) : [];

const sorted = (keys: ReadonlyArray<string>): ReadonlyArray<string> =>
  Arr.dedupe(keys).toSorted(Order.String);

/** Does the record bind this group of this root? An unreadable root slot cannot contradict the group id. */
const bindsGroup = (record: BindingRecord, facts: GroupFacts): boolean =>
  record.group._tag === "Lowered" &&
  Option.exists(stringOf(record.group.term), (id) => id === facts.groupId) &&
  (record.root._tag !== "Lowered" ||
    Option.match(refOf(record.root.term), {
      onNone: () => true,
      onSome: (ref) => sameRef(ref, facts.root.symbol),
    }));

const reportOf = (
  ctx: Context,
  facts: GroupFacts,
  declared: ReadonlyArray<string>,
  record: BindingRecord,
): BindingEntry => {
  const group = facts.groupId;

  const registrations = record.registrations.map((registration) => {
    if (registration._tag === "Unsupported")
      return { key: Option.none<string>(), registration, problem: registration.finding };

    const key =
      registration.key._tag === "Lowered" ? stringOf(registration.key.term) : Option.none();

    return {
      key,
      registration,
      problem: registration.key._tag === "Unlowered" ? registration.key.findings[0] : undefined,
    };
  });

  const bound = sorted(registrations.flatMap((entry) => Option.toArray(entry.key)));
  const missing = declared.filter((key) => !bound.includes(key));
  const extra = bound.filter((key) => !declared.includes(key));

  const unreadable = registrations.flatMap((entry) => {
    if (Option.isSome(entry.key)) return [];

    const cause =
      entry.problem === undefined
        ? undefined
        : findingCause(ctx, group, "structure", entry.problem);

    return cause === undefined
      ? []
      : [{ ...cause.diagnostic, location: locationOf(cause.at) } satisfies Diagnostic];
  });

  const adaptation = [
    ...record.authorizeCalls.map((range) =>
      LiftDiagnostics.EFFX3202.emit(
        { subject: group, site: "authorize" },
        { location: locationOf(range) },
      ),
    ),
    ...registrations.flatMap((entry) =>
      entry.registration._tag === "Registered" &&
      entry.registration.kind === "normal" &&
      Option.isSome(entry.key)
        ? [
            LiftDiagnostics.EFFX3202.emit(
              { subject: `${group}.${entry.key.value}`, site: "handle" },
              { location: locationOf(entry.registration.range) },
            ),
          ]
        : [],
    ),
  ];

  const differs =
    missing.length > 0 || extra.length > 0
      ? [
          LiftDiagnostics.EFFX3201.emit(
            { group, missing, extra },
            { location: locationOf(record.range) },
          ),
        ]
      : [];

  return {
    report: {
      group,
      declared,
      bound,
      missing,
      extra,
      registrations: registrations.flatMap((entry) =>
        entry.registration._tag === "Registered" && Option.isSome(entry.key)
          ? [
              {
                key: entry.key.value,
                kind: entry.registration.kind,
                handler: entry.registration.handler,
              },
            ]
          : [],
      ),
      authorizeCalls: record.authorizeCalls,
      verification: "UNVERIFIED",
    },
    diagnostics: [...unreadable, ...differs, ...adaptation],
  };
};

/** The reports and diagnostics of every application binding of the selected group. */
export const bindingOutcome = (ctx: Context, facts: GroupFacts): BindingOutcome => {
  const declared = sorted(facts.endpoints.flatMap(keyOf));

  const results = ctx.model.bindings.flatMap((record) =>
    bindsGroup(record, facts) ? [reportOf(ctx, facts, declared, record)] : [],
  );

  return {
    reports: results.map((result) => result.report),
    diagnostics: results.flatMap((result) => result.diagnostics),
  };
};
