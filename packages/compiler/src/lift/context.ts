import { Option } from "effect";
import { StableId, type SchemaRef, type SymbolRef } from "@effx/ir";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { Cause } from "./causes.ts";
import type { EffectModel, MiddlewareFact, SchemaFact, ValueRecord, WrapperFact } from "./model.ts";
import { refIdentity } from "./refs.ts";
import type { LiftInput, LiftRule } from "./rules.ts";
import type { Finding, SourceFileRecord, SourceRange } from "./source.ts";
import { groupExportPart } from "../generate/http-contracts.ts";
import type { CodeReference, Refactor } from "./result.ts";

/*
 * What every recognizer shares: the model and rules indexed by reference identity, the collision-free
 * planner for new exports, and the one place where a syntactic finding at a semantic position becomes a
 * registered diagnostic (spec 0019 §0.6, §6). Indexing and planning are pure over the inputs of one `lift`
 * call; the planner's name sets are local to that call.
 */

type RuleOf<Tag extends LiftRule["_tag"]> = Extract<LiftRule, { readonly _tag: Tag }>;

export type SuccessRule = RuleOf<"SuccessWrapper">;

export type NoSchemaRule = RuleOf<"NoSchemaSuccess">;

export type ProblemRule = RuleOf<"ProblemRegistry">;

export type MetadataRule = RuleOf<"Metadata">;

export type AccessRule = RuleOf<"Access">;

/** Where a finding sits semantically; the diagnostic code is a function of position and finding kind. */
export type Position = "structure" | "channel" | "success" | "problems" | "metadata" | "access";

export interface Context {
  readonly model: EffectModel;
  readonly input: LiftInput;
  readonly files: ReadonlyMap<string, SourceFileRecord>;
  readonly filesByModule: ReadonlyMap<string, SourceFileRecord>;
  readonly schemaFacts: ReadonlyMap<string, SchemaFact>;
  readonly markers: ReadonlyMap<string, MiddlewareFact>;
  readonly values: ReadonlyMap<string, ValueRecord>;
  readonly wrappers: ReadonlyMap<string, WrapperFact>;
  readonly successRules: ReadonlyMap<string, SuccessRule>;
  readonly noSchemaRules: ReadonlyMap<string, NoSchemaRule>;
  readonly problemRules: ReadonlyArray<ProblemRule>;
  readonly metadataRules: ReadonlyArray<MetadataRule>;
  readonly accessRules: ReadonlyArray<AccessRule>;
  /** Names already taken per file, extended as exports are planned (collision-free by construction). */
  readonly taken: Map<string, Set<string>>;
  /** Successful extraction plans shared by every consumer of the same resolved union. */
  readonly codePlans: Map<
    string,
    { readonly refactors: ReadonlyArray<Refactor>; readonly reference: CodeReference }
  >;
}

const indexBy = <A>(
  items: ReadonlyArray<A>,
  identity: (item: A) => string,
): ReadonlyMap<string, A> => new Map(items.map((item) => [identity(item), item] as const));

const isRule =
  <Tag extends LiftRule["_tag"]>(tag: Tag) =>
  (rule: LiftRule): rule is RuleOf<Tag> =>
    rule._tag === tag;

const rulesOf = <Tag extends LiftRule["_tag"]>(
  rules: ReadonlyArray<LiftRule>,
  tag: Tag,
): ReadonlyArray<RuleOf<Tag>> => rules.filter(isRule(tag));

export const makeContext = (model: EffectModel, input: LiftInput): Context => ({
  model,
  input,
  files: indexBy(model.files, (file) => file.file),
  filesByModule: indexBy(model.files, (file) => file.module),
  schemaFacts: indexBy(model.schemas, (fact) => refIdentity(fact.ref)),
  markers: indexBy(model.markers, (fact) => refIdentity(fact.ref)),
  values: indexBy(model.values, (value) => refIdentity(value.symbol)),
  wrappers: indexBy(model.wrappers, (wrapper) => refIdentity(wrapper.helper)),
  successRules: indexBy(rulesOf(input.rules, "SuccessWrapper"), (rule) => refIdentity(rule.callee)),
  noSchemaRules: indexBy(rulesOf(input.rules, "NoSchemaSuccess"), (rule) =>
    refIdentity(rule.callee),
  ),
  problemRules: rulesOf(input.rules, "ProblemRegistry"),
  metadataRules: rulesOf(input.rules, "Metadata"),
  accessRules: rulesOf(input.rules, "Access"),
  taken: new Map(),
  codePlans: new Map(),
});

/** `Group.key` as users write it; the key falls back to the declared symbol when it is not a literal. */
export const subjectOf = (group: string, key: Option.Option<string>, symbol: SymbolRef): string =>
  `${group}.${Option.getOrElse(key, () => symbol.export)}`;

/** `profile.readOwnProfile` → `ReadOwnProfile`: the export name of an operation const. */
export const upperFirst = (name: string): string => name.charAt(0).toUpperCase() + name.slice(1);

/** `social-events` → `SocialEvents`: the group part the generator already uses in export names. */
export const groupPart = groupExportPart;

/** `ProfileReadProblem` without its `Problem` suffix; a name without the suffix is unchanged. */
export const stripSuffix = (name: string, suffix: string): string =>
  name.endsWith(suffix) && name.length > suffix.length ? name.slice(0, -suffix.length) : name;

/** `Callee` or `Callee.member`, the way a diagnostic names an application symbol. */
export const nameOfSymbol = (ref: SymbolRef): string =>
  ref.member === undefined ? ref.export : `${ref.export}.${ref.member}`;

/** Every name a file already binds at its top level: exports, declarations and imported locals. */
const boundNames = (file: SourceFileRecord): ReadonlyArray<string> => [
  ...file.exports,
  ...file.topLevel,
  ...file.imports.map((binding) => binding.local),
];

/** A collision-free, deterministic name: `preferred`, then `preferred2`, `preferred3`, … */
export const reserveName = (ctx: Context, file: SourceFileRecord, preferred: string): string => {
  const taken = ctx.taken.get(file.file) ?? new Set(boundNames(file));

  const name = [
    preferred,
    ...Array.from({ length: 1000 }, (_, index) => `${preferred}${index + 2}`),
  ].find((candidate) => !taken.has(candidate));

  const chosen = name ?? `${preferred}${taken.size}`;

  taken.add(chosen);
  ctx.taken.set(file.file, taken);

  return chosen;
};

/** Whether a name is already bound at the top level of a file (before any planning). */
export const isDeclared = (file: SourceFileRecord, name: string): boolean =>
  boundNames(file).includes(name);

/** The planner's reserved names, copied so a rejected endpoint cannot leave its names reserved. */
export const snapshotTaken = (ctx: Context): ReadonlyMap<string, ReadonlySet<string>> =>
  new Map([...ctx.taken].map(([file, names]) => [file, new Set(names)] as const));

/** Restores the reserved names to a snapshot (every file the snapshot does not know is forgotten). */
export const restoreTaken = (
  ctx: Context,
  snapshot: ReadonlyMap<string, ReadonlySet<string>>,
): void => {
  ctx.taken.clear();

  for (const [file, names] of snapshot) ctx.taken.set(file, new Set(names));
};

/** The real `SchemaRef` an export planned into `file` will have: module and identity path of that file. */
export const plannedSchemaRef = (file: SourceFileRecord, name: string): SchemaRef => ({
  module: file.module,
  export: name,
  symbolId: StableId.make("schema", `${file.idPath}/${name}`),
});

/** The reference an exported value planned into `file` will have. */
export const plannedSymbolRef = (file: SourceFileRecord, name: string): SymbolRef => ({
  module: file.module,
  export: name,
});

const cause = (at: SourceRange, diagnostic: Cause["diagnostic"]): Cause => ({ at, diagnostic });

/** EFFX3001 for a construct the grammar does not contain. */
export const unrecognized = (subject: string, at: SourceRange, construct: string): Cause =>
  cause(at, LiftDiagnostics.EFFX3001.emit({ _tag: "UnrecognizedConstruct", subject, construct }));

/** A finding becomes a diagnostic by the position it occurred in (§6). */
export const findingCause = (
  ctx: Context,
  subject: string,
  position: Position,
  finding: Finding,
): Cause => {
  const at = finding.range;
  const enclosing = finding.enclosingCall?.callee;

  if (position === "access") {
    const builder = enclosing === undefined ? undefined : nameOfSymbol(enclosing);

    const form =
      finding.kind === "closure"
        ? "closure"
        : finding.kind === "local-reference"
          ? "constant"
          : finding.kind === "spread"
            ? "spread"
            : "non-literal-argument";

    return cause(
      at,
      LiftDiagnostics.EFFX3005.emit(
        builder === undefined ? { subject, form } : { subject, form, builder },
      ),
    );
  }

  if (
    enclosing !== undefined &&
    (position === "success" || position === "problems" || position === "metadata")
  ) {
    const registered =
      position === "success"
        ? ctx.successRules.has(refIdentity(enclosing)) ||
          ctx.noSchemaRules.has(refIdentity(enclosing))
        : position === "problems"
          ? ctx.problemRules.some((rule) => refIdentity(rule.response) === refIdentity(enclosing))
          : ctx.metadataRules.some((rule) => refIdentity(rule.callee) === refIdentity(enclosing));

    return registered
      ? cause(
          at,
          LiftDiagnostics.EFFX3001.emit({
            _tag: "NonLiteralArgument",
            subject,
            callee: nameOfSymbol(enclosing),
            argument: finding.construct,
          }),
        )
      : cause(
          at,
          LiftDiagnostics.EFFX3006.emit({ subject, position, callee: nameOfSymbol(enclosing) }),
        );
  }

  return finding.kind === "spread"
    ? cause(
        at,
        LiftDiagnostics.EFFX3001.emit({ _tag: "Spread", subject, construct: finding.construct }),
      )
    : finding.kind === "computed-key"
      ? cause(
          at,
          LiftDiagnostics.EFFX3001.emit({
            _tag: "ComputedKey",
            subject,
            construct: finding.construct,
          }),
        )
      : unrecognized(subject, at, finding.construct);
};
