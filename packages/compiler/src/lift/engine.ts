import { Array as Arr, Option } from "effect";
import type { Collected, Declaration } from "../Collected.ts";
import type { Diagnostic } from "../Diagnostic.ts";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import { unsupportedSite, type Cause, type UnsupportedSite } from "./causes.ts";
import { bindingOutcome } from "./bindings.ts";
import { chooseInput, groupDeclaration, operationDeclaration } from "./collect.ts";
import {
  groupPart,
  makeContext,
  nameOfSymbol,
  restoreTaken,
  snapshotTaken,
  upperFirst,
  type Context,
} from "./context.ts";
import {
  groupDecision,
  operationDecisions,
  refactorDecisions,
  type Reviewed,
} from "./decisions.ts";
import { recognizeEndpoint } from "./endpoint.ts";
import { selectGroup, type GroupFacts } from "./group.ts";
import type { EffectModel, EndpointRecord } from "./model.ts";
import { adapterPrerequisites } from "./prerequisites.ts";
import { planWrapperHeaders } from "./wrappers.ts";
import type { CodeReference, LiftResult, Refactor } from "./result.ts";
import type { LiftInput } from "./rules.ts";
import { schemaUseOf } from "./schema-use.ts";
import type { Outcome, Recognized } from "./types.ts";
import { stringOf } from "./view.ts";

/*
 * The pure core of lift (spec 0019 §3, §4): `EffectModel` and rules in, `LiftResult` out. It is total and
 * never throws: every unsupported construct is a registered diagnostic with its source range, every
 * applicable cause of an unsupported declaration is kept, and an unsupported endpoint is omitted from the
 * suggestion. It reads only its two inputs: no filesystem, no clock, no evaluation of application code.
 */

/** Names the runtime import of a printed suggestion already takes; a declaration may not reuse them. */
const reservedNames: ReadonlyArray<string> = ["Operation", "Http", "Capability", "Concealment"];

const keyOf = (endpoint: EndpointRecord): Option.Option<string> =>
  endpoint.key._tag === "Lowered" ? stringOf(endpoint.key.term) : Option.none();

const collectedOf = (input: LiftInput, declarations: ReadonlyArray<Declaration>): Collected => {
  const base: Collected = { declarations, diagnostics: [] };

  return input.project === undefined ? base : { ...base, project: input.project };
};

/** One endpoint after recognition: every cause (recognizer causes and group-level ones), in one list. */
interface Processed {
  readonly endpoint: EndpointRecord;
  readonly outcome: Outcome;
  readonly causes: ReadonlyArray<Cause>;
}

const duplicateKeys = (endpoints: ReadonlyArray<EndpointRecord>): ReadonlySet<string> => {
  const keys = endpoints.flatMap((endpoint) => Option.toArray(keyOf(endpoint)));

  return new Set(keys.filter((key, index) => keys.indexOf(key) !== index));
};

/**
 * Recognizes every endpoint in `.add` order. Names an endpoint reserved while being recognized are released
 * when it is rejected, so an unsupported endpoint never changes the names of the supported ones.
 */
const processEndpoints = (ctx: Context, facts: GroupFacts): ReadonlyArray<Processed> => {
  const duplicated = duplicateKeys(facts.endpoints);
  const processed: Array<Processed> = [];

  for (const endpoint of facts.endpoints) {
    const before = snapshotTaken(ctx);
    const plansBefore = new Set(ctx.codePlans.keys());
    const outcome = recognizeEndpoint(ctx, facts.groupId, endpoint);

    const duplicate: ReadonlyArray<Cause> = Option.exists(keyOf(endpoint), (key) =>
      duplicated.has(key),
    )
      ? [
          {
            at: endpoint.range,
            diagnostic: LiftDiagnostics.EFFX3001.emit({
              _tag: "UnrecognizedConstruct",
              subject: outcome.subject,
              construct: `an endpoint key that another endpoint of group ${facts.groupId} also uses`,
            }),
          },
        ]
      : [];

    const causes = [...outcome.causes, ...duplicate];

    if (causes.length > 0) {
      restoreTaken(ctx, before);

      for (const key of ctx.codePlans.keys()) if (!plansBefore.has(key)) ctx.codePlans.delete(key);
    }

    processed.push({ endpoint, outcome, causes });
  }

  return processed;
};

interface Ready {
  readonly processed: Processed;
  readonly recognized: Recognized;
}

const readyOf = (processed: Processed): ReadonlyArray<Ready> =>
  processed.causes.length === 0 && processed.outcome.recognized !== undefined
    ? [{ processed, recognized: processed.outcome.recognized }]
    : [];

/** A collision-free export name in the suggestion module. */
const reserve = (taken: Set<string>, preferred: string): string => {
  const name =
    [preferred, ...Array.from({ length: 1000 }, (_, index) => `${preferred}${index + 2}`)].find(
      (candidate) => !taken.has(candidate),
    ) ?? `${preferred}${taken.size}`;

  taken.add(name);

  return name;
};

interface Built {
  readonly declarations: ReadonlyArray<Declaration>;
  readonly decisions: ReadonlyArray<Reviewed>;
  readonly causes: ReadonlyArray<{ readonly processed: Processed; readonly cause: Cause }>;
}

/** The declarations (group first, then endpoints in `.add` order) and the decisions of the ready endpoints. */
const build = (ctx: Context, facts: GroupFacts, ready: ReadonlyArray<Ready>): Built => {
  const module = ctx.input.output.module;
  const taken = new Set(reservedNames);
  const groupName = reserve(taken, `${groupPart(facts.groupId)}Group`);

  const empty =
    ctx.input.emptyInput === undefined ? undefined : schemaUseOf(ctx, ctx.input.emptyInput);

  const declarations: Array<Declaration> = [];
  const decisions: Array<Reviewed> = [];
  const causes: Array<Built["causes"][number]> = [];

  for (const entry of ready) {
    const { recognized, processed } = entry;
    const input = chooseInput(recognized, empty);
    const exportName = reserve(taken, upperFirst(recognized.key));

    const declaration = Option.flatMap(input, (chosen) =>
      operationDeclaration({
        module,
        exportName,
        rootId: facts.rootId,
        groupId: facts.groupId,
        recognized,
        input: chosen,
      }),
    );

    if (Option.isNone(input) || Option.isNone(declaration)) {
      causes.push({
        processed,
        cause: {
          at: processed.endpoint.range,
          diagnostic: Option.isNone(input)
            ? LiftDiagnostics.EFFX3009.emit({ subject: recognized.subject })
            : LiftDiagnostics.EFFX3005.emit({
                subject: recognized.subject,
                form: "non-literal-argument",
                builder: nameOfSymbol(recognized.access?.annotator ?? facts.root.symbol),
              }),
        },
      });

      taken.delete(exportName);
      continue;
    }

    declarations.push(declaration.value);

    decisions.push(
      ...operationDecisions({
        recognized,
        input: input.value,
        operation: exportName,
        module,
        at: processed.endpoint.range,
        planned: processed.outcome.refactors.flatMap((refactor) => refactor.planned),
      }),
    );
  }

  const withGroup =
    declarations.length === 0
      ? declarations
      : [groupDeclaration({ module, exportName: groupName, facts }), ...declarations];

  return {
    declarations: withGroup,
    decisions:
      declarations.length === 0
        ? decisions
        : [groupDecision(facts.groupId, groupName, module, facts.group.range), ...decisions],
    causes,
  };
};

const uniqueReferences = (references: ReadonlyArray<CodeReference>): ReadonlyArray<CodeReference> =>
  Arr.dedupeWith(
    references,
    (left, right) =>
      left.identifier === right.identifier &&
      left.ref.module === right.ref.module &&
      left.codes.length === right.codes.length &&
      left.codes.every((code, index) => code === right.codes[index]) &&
      left.ref.export === right.ref.export,
  );

const missingResult = (
  ctx: Context,
  diagnostics: ReadonlyArray<Diagnostic>,
  unsupported: ReadonlyArray<UnsupportedSite>,
): LiftResult => ({
  group: ctx.input.group,
  collected: collectedOf(ctx.input, []),
  refactors: [],
  decisions: [],
  unsupported,
  adapterPrerequisites: adapterPrerequisites(ctx, []),
  codeReferences: [],
  bindings: [],
  diagnostics,
});

const readyResult = (ctx: Context, facts: GroupFacts): LiftResult => {
  const processed = processEndpoints(ctx, facts);
  const ready = processed.flatMap(readyOf);
  const built = build(ctx, facts, ready);

  const rejected = new Set(built.causes.map((entry) => entry.processed));
  const accepted = ready.filter((entry) => !rejected.has(entry.processed));

  const sites = [
    ...processed.flatMap((entry) =>
      Option.toArray(
        unsupportedSite(entry.outcome.subject, entry.endpoint.range, [
          ...entry.causes,
          ...built.causes.flatMap((late) => (late.processed === entry ? [late.cause] : [])),
        ]),
      ),
    ),
    ...facts.missing.flatMap((member) =>
      Option.toArray(unsupportedSite(member.subject, facts.group.range, [member.cause])),
    ),
  ];

  const wrapperPlans = planWrapperHeaders(
    ctx,
    accepted.flatMap((entry) => Option.toArray(Option.fromUndefinedOr(entry.recognized.wrapper))),
  );

  const refactors: ReadonlyArray<Refactor> = Arr.dedupe([
    ...accepted.flatMap((entry) => entry.processed.outcome.refactors),
    ...wrapperPlans.refactors,
  ]);

  const decisions = [...built.decisions, ...wrapperPlans.refactors.flatMap(refactorDecisions)];
  const binding = bindingOutcome(ctx, facts);

  return {
    group: ctx.input.group,
    collected: collectedOf(ctx.input, built.declarations),
    refactors,
    decisions: decisions.map((reviewed) => reviewed.decision),
    unsupported: sites,
    adapterPrerequisites: adapterPrerequisites(
      ctx,
      refactors.flatMap((refactor) => refactor.planned.map((planned) => planned.ref)),
    ),
    codeReferences: uniqueReferences(
      accepted.flatMap((entry) => entry.processed.outcome.codeReferences),
    ),
    bindings: binding.reports,
    diagnostics: [
      ...sites.map((site) => site.primary),
      ...wrapperPlans.diagnostics,
      ...refactors.map((refactor) => refactor.cause),
      ...decisions.map((reviewed) => reviewed.diagnostic),
      ...binding.diagnostics,
    ],
  };
};

/**
 * Lifts one group of an analyzed project into a verbose `Collected` (spec 0019 §3.4, §4.2). The result
 * carries the suggestion's declarations, the wire-preserving refactors, the decisions to review, every
 * unsupported declaration with all its causes, the unresolved adapter prerequisites and the binding reports.
 */
export const lift = (model: EffectModel, input: LiftInput): LiftResult => {
  const ctx = makeContext(model, input);
  const selection = selectGroup(ctx);

  switch (selection._tag) {
    case "Missing":
      return missingResult(ctx, [selection.diagnostic], []);
    case "Blocked": {
      const site = unsupportedSite(input.group, selection.group.range, selection.causes);

      return missingResult(
        ctx,
        Option.toArray(Option.map(site, (found) => found.primary)),
        Option.toArray(site),
      );
    }

    case "Ready":
      return readyResult(ctx, selection.facts);
  }
};
