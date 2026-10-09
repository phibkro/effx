import { Option, Predicate, Result, Schema } from "effect";
import { SchemaRef, type SymbolRef } from "@effx/ir";
import type { AnnotationArg } from "../Collected.ts";
import { SchemaArg } from "../args.ts";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { ArgsPlan, Plan } from "@effx/runtime";
import type { Term } from "../generate/term.ts";
import { sameRef, symbolRefOf } from "./refs.ts";
import { refIdentity } from "./refs.ts";
import type { Scope } from "./scope.ts";
import { fail } from "./scope.ts";
import type { SourceRange } from "./source.ts";
import { type Cursor, callView, descend, keyName, rangeOf, rootOf } from "./view.ts";

/*
 * The default `.annotate` recognizer's lowering (spec 0019 §5, S1): the ONE existing lowering plan and
 * codec of a definition, walked over the neutral `Term` the frontend already lowered. It mirrors the
 * semantics `packages/frontend-ts/src/lower.ts` applies to the same expression and plan: generic object
 * and array entries lower generically, only `Struct` and `Array` positions direct per-field or per-item
 * plans, and only the closed source literal and runtime-constructor forms the plan admits are lowered.
 * Nothing is ever evaluated: an unrecorded runtime symbol is a cause, never a fallback claim, and every
 * failure is a registered cause at its own source range.
 *
 * The differential law test (frontend-ts) compares the same source expression lowered by the frontend's
 * real TypeScript `Program` with the same lowered `Term` walked here: the adapters differ (ts.* AST versus
 * neutral Term), the lowering semantics may not. Where the model does not record a checker-derived fact the
 * frontend uses (the callability of an exported value, the static fields of a schema), the walker carries
 * the recorded reference or names the missing fact and the definition's own derived codec stays the
 * authority: no second schema, no silently widened claim.
 */

/** One rejected form of the walk: the construct names the neutral shape, the cause names the site. */
interface Failure {
  readonly construct: string;
}

/** The ABI `lowerPlanArg` promises: `AnnotationArg` on success, one `Failure` on a non-lowered form. */
export type Lowering = Result.Result<AnnotationArg, Failure>;

const failure = (construct: string): Failure => ({ construct });

/** The plan without its `Injected` and `Refine` wrappers; the frontend lowers by the same underlying plan. */
const unwrapPlan = (plan: Plan | undefined): Plan | undefined =>
  plan?._tag === "Injected" || plan?._tag === "Refine" ? unwrapPlan(plan.plan) : plan;

const unwrapTerm = (term: Term): Term => (term._tag === "Paren" ? unwrapTerm(term.term) : term);

/** The runtime constructor namespaces whose members the annotate lowering admits (the closed frontend set). */
type RuntimeNamespace = "Capability" | "Concealment" | "Focus";

const RUNTIME_MODULE = "@effx/runtime";

/** A runtime constructor identity: the namespace the reference names and the member the call selects. */
const runtimeMemberOf = (
  term: Term,
): { readonly namespace: RuntimeNamespace; readonly member: string } | undefined => {
  const unwrapped = unwrapTerm(term);

  if (unwrapped._tag !== "Member" || unwrapped.member === undefined) return undefined;

  const base = unwrapTerm(unwrapped.term);

  if (base._tag !== "Ref") return undefined;

  const module = base.ref.module;

  if (!(module === RUNTIME_MODULE || module.startsWith(`${RUNTIME_MODULE}/`))) return undefined;

  switch (base.ref.export) {
    case "Capability":
      return { namespace: "Capability", member: unwrapped.member };
    case "Concealment":
      return { namespace: "Concealment", member: unwrapped.member };
    case "Focus":
      return { namespace: "Focus", member: unwrapped.member };
    default:
      return undefined;
  }
};

/**
 * A string a term spells itself (the frontend's `sourceString`): a non-empty string literal, or a
 * reference to a recorded constant whose initializer spells one exactly once, never a cycle or an eval.
 */
const literalStringOf = (
  scope: Scope,
  term: Term,
  seen: ReadonlySet<string>,
): string | undefined => {
  if (term._tag === "Lit" && Predicate.isString(term.json) && term.json.length > 0)
    return term.json;

  if (term._tag !== "Ref") return undefined;

  const identity = refIdentity(term.ref);
  const value = scope.ctx.values.get(identity);

  if (value === undefined || seen.has(identity)) return undefined;

  if ("symbolId" in value.symbol) return undefined;

  return value.init._tag === "Lowered"
    ? literalStringOf(scope, unwrapTerm(value.init.term), new Set([...seen, identity]))
    : undefined;
};

/** Emits the registered 3001 cause of one unsuccessful walk step at its own range. */
const emitCause = (scope: Scope, at: SourceRange, construct: string): void => {
  fail(
    scope,
    at,
    LiftDiagnostics.EFFX3001.emit({
      _tag: "UnrecognizedConstruct",
      subject: scope.subject,
      construct,
    }),
  );
};

/** The first failure of `items`, short-circuiting like the frontend lowers (one cause per step). */
const collect = (items: ReadonlyArray<Lowering>): Result.Result<Array<AnnotationArg>, Failure> => {
  const values: Array<AnnotationArg> = [];

  for (const item of items) {
    if (Result.isFailure(item)) return Result.fail(item.failure);

    values.push(item.success);
  }

  return Result.succeed(values);
};

/** Rejects a walk step with one faithful EFFX3001 cause and the unified failure result. */
const reject = <T>(scope: Scope, at: SourceRange, failure: Failure): Result.Result<T, Failure> => {
  emitCause(scope, at, failure.construct);

  return Result.fail(failure);
};

/** Lowers one term against its plan; see the module contract for the semantics this mirrors. */
const lowerTerm = (
  scope: Scope,
  cursor: Cursor,
  plan: Plan | undefined,
  seen: ReadonlySet<string>,
): Lowering => {
  const term = unwrapTerm(cursor.term);
  const at = rangeOf(cursor);
  const planInner = unwrapPlan(plan);

  if (term._tag === "Lit") {
    const json = term.json;

    if (Predicate.isString(json) || Predicate.isNumber(json) || Predicate.isBoolean(json))
      return Result.succeed(json);

    return reject(scope, at, failure("a literal the annotate site does not accept"));
  }

  if (term._tag === "Arr") {
    const itemPlan = planInner?._tag === "Array" ? planInner.item : undefined;
    const lowered: Lowering[] = [];

    for (const [index, item] of term.items.entries())
      lowered.push(lowerTerm(scope, descend(cursor, item, "items", index), itemPlan, seen));

    return collect(lowered);
  }

  if (term._tag === "Obj") return lowerObject(scope, cursor, planInner, seen);

  if (term._tag === "Call") return lowerCall(scope, cursor, planInner, seen);

  if (term._tag === "Ref") return lowerRef(scope, cursor, term, planInner, seen);

  if (term._tag === "Member") return lowerMember(scope, cursor, term, planInner);

  return reject(scope, at, failure("a term the annotate lowering cannot read"));
};

/** One object literal under a Struct plan (per-field plans) or generically (the 0020 sugar direction). */
const lowerObject = (
  scope: Scope,
  cursor: Cursor,
  plan: Plan | undefined,
  seen: ReadonlySet<string>,
): Lowering => {
  const term = unwrapTerm(cursor.term);

  if (term._tag !== "Obj") return Result.fail(failure("an object literal"));

  const struct = plan?._tag === "Struct" ? plan : undefined;
  const seenKeys = new Set<string>();

  // A local mutable accumulator avoids a readonly index error; the shape still satisfies the
  // `{ readonly [key: string]: AnnotationArg }` member of `AnnotationArg` exactly.
  const record: { [key: string]: AnnotationArg } = {};

  for (const [index, entry] of term.entries.entries()) {
    const key = keyName(entry.key);

    if (struct?.rejectDuplicate?.includes(key) === true && seenKeys.has(key)) {
      return reject(scope, rangeOf(cursor), failure(`an object literal declaring ${key} twice`));
    }

    seenKeys.add(key);

    const value = lowerTerm(
      scope,
      descend(cursor, entry.value, "entries", index, "value"),
      struct?.fields[key],
      seen,
    );

    if (Result.isFailure(value)) return value;

    record[key] = value.success;
  }

  return Result.succeed(record);
};

/** One call: a runtime constructor the plan admits, or a cause naming what the frontend rejects too. */
/** One call: a runtime constructor the plan admits, or a cause naming what the frontend rejects too. */
const lowerCall = (
  scope: Scope,
  cursor: Cursor,
  plan: Plan | undefined,
  seen: ReadonlySet<string>,
): Lowering => {
  const at = rangeOf(cursor);
  const view = callView(cursor.term);

  if (view === undefined)
    return reject(scope, at, failure("a chain the annotate lowering cannot read"));

  const member = runtimeMemberOf(view.callee);

  if (member === undefined)
    return reject(scope, at, failure("a call the annotate lowering does not read"));

  // Words follow the frontend's `sourceString`: a string literal, or exactly one level of a recorded
  // constant. `Capability.make` and `Focus.key` keep the stricter frontend shape.
  const wordArgs = view.args.map(
    (argument, index) => [argument, descend(cursor, argument, ...view.argPath(index))] as const,
  );

  if (member.namespace === "Focus" && member.member === "key") {
    const segments: Array<string> = [];

    for (const [argument] of wordArgs.slice(1)) {
      const segment = wordLiteral(argument);

      if (segment === undefined)
        return reject(scope, at, failure("a Focus.key path segment that is not a literal string"));

      segments.push(segment);
    }

    return Result.succeed(segments);
  }

  const forOne = (construct: string): Lowering => reject(scope, at, failure(construct));

  if (member.namespace === "Concealment" && member.member === "notFound") {
    const lowered = lowerWords(scope, at, wordArgs, seen, "a Concealment.notFound call");

    if (Result.isFailure(lowered)) return lowered;

    if (lowered.success.length === 0)
      return forOne("a Concealment.notFound call without literal stage words");

    return Result.succeed({ _tag: "NotFound", stages: lowered.success } satisfies AnnotationArg);
  }

  if (member.namespace === "Capability") {
    switch (member.member) {
      case "none":
        return Result.succeed({ _tag: "None" } satisfies AnnotationArg);
      case "one": {
        const lowered = lowerWords(scope, at, wordArgs, seen, "a Capability.one call");

        if (Result.isFailure(lowered)) return lowered;

        const [word] = lowered.success;

        if (word === undefined)
          return forOne("a Capability.one call without exactly one literal word");

        return Result.succeed({ _tag: "One", capability: word } satisfies AnnotationArg);
      }

      case "any":
      case "all": {
        if (member.member !== "any" && member.member !== "all")
          return forOne("a Capability member the annotate lowering does not read");

        const which: "any" | "all" = member.member === "any" ? "any" : "all";

        const lowered = lowerWords(scope, at, wordArgs, seen, `a Capability.${which} call`);

        if (Result.isFailure(lowered)) return lowered;

        if (lowered.success.length === 0)
          return forOne(`a Capability.${which} call without literal capability words`);

        return Result.succeed({
          _tag: which === "any" ? "Any" : "All",
          capabilities: lowered.success,
        } satisfies AnnotationArg);
      }

      case "make":
        return lowerCapabilityMake(scope, cursor, wordArgs, seen, at);
      default:
        return forOne(`a Capability.${member.member} member the annotate lowering does not read`);
    }
  }

  return reject(scope, at, failure("a runtime call the annotate lowering does not read"));
};

/** The strict `Focus.key`/`Capability.make` name segment: a literal string, never a constant reference. */
const wordLiteral = (term: Term): string | undefined =>
  term._tag === "Lit" && Predicate.isString(term.json) ? term.json : undefined;

/** The lowered literal words of one runtime constructor call, at its own source ranges. */
const lowerWords = (
  scope: Scope,
  at: SourceRange,
  wordArgs: ReadonlyArray<readonly [Term, Cursor]>,
  seen: ReadonlySet<string>,
  callee: string,
): Result.Result<Array<string>, Failure> => {
  const words: Array<string> = [];

  for (const [argument] of wordArgs) {
    const spelling = literalStringOf(scope, unwrapTerm(argument), seen);

    if (spelling === undefined)
      return reject(scope, at, failure(`${callee}: one argument is not a literal word`));

    words.push(spelling);
  }

  return Result.succeed(words);
};

/** `Capability.make(<literal name>, <literal options>)`; the resource names the model's schema export. */
const lowerCapabilityMake = (
  scope: Scope,
  cursor: Cursor,
  wordArgs: ReadonlyArray<readonly [Term, Cursor]>,
  seen: ReadonlySet<string>,
  at: SourceRange,
): Lowering => {
  if (wordArgs.length !== 2)
    return reject(
      scope,
      at,
      failure("a Capability.make call without a name and an options object"),
    );

  const [nameEntry, optionsEntry] = [wordArgs[0], wordArgs[1]];

  if (nameEntry === undefined || optionsEntry === undefined)
    return reject(
      scope,
      at,
      failure("a Capability.make call without a name and an options object"),
    );

  const name = wordLiteral(nameEntry[0]);

  if (name === undefined)
    return reject(scope, at, failure("a Capability.make name that is not a literal string"));

  const options = lowerTerm(scope, optionsEntry[1], undefined, seen);

  if (Result.isFailure(options)) return options;

  const resource = capabilityResourceOf(options.success);

  if (resource === undefined)
    return reject(scope, at, failure("a Capability.make resource that is not a lowered schema"));

  const focus = capabilityFocusOf(options.success);

  if (focus === undefined)
    return reject(scope, at, failure("a Capability.make focus that is not an array of strings"));

  return Result.succeed({ name, resource, focus } satisfies AnnotationArg);
};

const capabilityResourceOf = (value: AnnotationArg): string | undefined => {
  const resource = Schema.decodeUnknownOption(SchemaArg)(value);

  if (Option.isNone(resource)) return undefined;

  const ref = resource.value.ref;

  return ref.export.length > 0 ? ref.export : undefined;
};

const capabilityFocusOf = (value: AnnotationArg): ReadonlyArray<string> | undefined =>
  Option.match(
    Schema.decodeUnknownOption(
      Schema.Struct({ focus: Schema.optionalKey(Schema.Array(Schema.String)) }),
    )(value),
    {
      onNone: () => undefined,
      onSome: (record) => record.focus,
    },
  );

/** One identifier lowered the model recorded: a schema value, a symbol value, or a recorded constant. */
const lowerRef = (
  scope: Scope,
  cursor: Cursor,
  term: Extract<Term, { readonly _tag: "Ref" }>,
  plan: Plan | undefined,
  seen: ReadonlySet<string>,
): Lowering => {
  const at = rangeOf(cursor);
  const ref = term.ref;

  if ("symbolId" in ref) return lowerSchemaValue(scope, cursor, ref, plan, at);

  const identity = refIdentity(ref);

  if (!seen.has(identity) && scope.ctx.values.get(identity) !== undefined) {
    const value = scope.ctx.values.get(identity);

    // The frontend descends into a recorded constant initializer when the type is neither Schema nor a
    // service; in the model the same decision is `values` membership whose recorded initializer lowers
    // against the same plan. The `seen` set guards the cycle the frontend's `sourceString` guards.
    if (value !== undefined && value.init._tag === "Lowered")
      return lowerTerm(scope, rootOf(value.init), plan, new Set([...seen, identity]));
  }

  return lowerSymbol(scope, cursor, ref, plan, at);
};

/**
 * The leaf plan an identifier position resolves against: the first `Symbol` or `Schema` member of a
 * `Union` plan (the frontend's `identifierPlan`), otherwise the unwrapped plan itself.
 */
const leafOf = (plan: Plan | undefined): Plan | undefined => {
  const inner = unwrapPlan(plan);

  if (inner?._tag === "Union") {
    const leaf = inner.members.find(
      (member) => member._tag === "Symbol" || member._tag === "Schema",
    );

    return leaf ?? inner;
  }

  return inner;
};

const lowerSymbol = (
  scope: Scope,
  cursor: Cursor,
  ref: SymbolRef,
  plan: Plan | undefined,
  at: SourceRange,
): Lowering => {
  const leaf = leafOf(plan);
  const check = leaf !== undefined && leaf._tag === "Symbol" ? leaf.check : undefined;

  if (check === undefined) return Result.succeed({ _tag: "Symbol", ref } satisfies AnnotationArg);

  if (check === "httpapi-root") return lowerRoot(scope, cursor, ref, at);

  if (check === "security-marker") return lowerSecurity(scope, cursor, ref);

  return Result.succeed({ _tag: "Symbol", ref } satisfies AnnotationArg);
};

/** A schema value, with the fields/key marker the position's plan and the model's facts record. */
const lowerSchemaValue = (
  scope: Scope,
  cursor: Cursor,
  ref: SchemaRef,
  plan: Plan | undefined,
  at: SourceRange,
): Lowering => {
  const fact = scope.ctx.schemaFacts.get(refIdentity(ref));
  const marked = fact?.headers === true;
  const leaf = leafOf(plan);
  const schemaPlan = leaf !== undefined && leaf._tag === "Schema" ? leaf : undefined;

  const fieldKeys =
    schemaPlan?.fieldKeys === undefined ? undefined : marked ? "required" : schemaPlan.fieldKeys;

  const base: AnnotationArg = marked ? { _tag: "Schema", ref } : { _tag: "Schema", ref };

  if (fieldKeys === undefined) return Result.succeed(base);

  const optional = schemaPlan?.fieldsOptional === true && !marked;

  if (fact === undefined || (fact.allKeys === undefined && optional)) return Result.succeed(base);

  if (fact.allKeys === undefined)
    return reject(scope, at, failure("a schema whose static field keys the model does not record"));

  const fields = fieldKeys === "required" ? fact.requiredKeys : fact.allKeys;

  if (fields === undefined)
    return reject(
      scope,
      at,
      failure("a schema whose required field keys the model does not record"),
    );

  return Result.succeed(
    marked
      ? { _tag: "Schema", ref, fields: [...fields], marker: "headers" }
      : { _tag: "Schema", ref, fields: [...fields] },
  );
};

/** A `security` fact recorded for the middleware marker reference, when the profile model has one. */
const lowerSecurity = (scope: Scope, cursor: Cursor, ref: SymbolRef): Lowering => {
  const fact = scope.ctx.markers.get(refIdentity(ref));

  return fact?.security === true
    ? Result.succeed({
        _tag: "Symbol",
        ref: symbolRefOf(ref),
        security: true,
      } satisfies AnnotationArg)
    : Result.succeed({ _tag: "Symbol", ref: symbolRefOf(ref) } satisfies AnnotationArg);
};

/** A concretely recorded `HttpApi` root symbol with its literal identifier (the 0013 root identity). */
const lowerRoot = (scope: Scope, cursor: Cursor, ref: SymbolRef, at: SourceRange): Lowering => {
  const record = scope.ctx.model.roots.find((root) => sameRef(root.symbol, ref));

  if (record === undefined || record.id._tag !== "Lowered")
    return reject(scope, at, failure("an HttpApi root the model does not record"));

  const id = record.id.term._tag === "Lit" ? Predicate.isString(record.id.term.json) : false;

  if (id === false)
    return reject(scope, at, failure("an HttpApi root identifier that is not literal"));

  return Result.succeed({
    _tag: "Symbol",
    ref: symbolRefOf(ref),
    identifier: rootIdentifierOf(record.id.term),
  } satisfies AnnotationArg);
};

const rootIdentifierOf = (term: Term): string =>
  term._tag === "Lit" && Predicate.isString(term.json) ? term.json : "";

/** A static member: a runtime constructor value, a schema-family member, or a plain symbol reference. */
const lowerMember = (
  scope: Scope,
  cursor: Cursor,
  term: Extract<Term, { readonly _tag: "Member" }>,
  plan: Plan | undefined,
): Lowering => {
  const at = rangeOf(cursor);
  const runtime = runtimeMemberOf(term);

  if (runtime !== undefined) {
    if (runtime.namespace === "Capability" && runtime.member === "none")
      return Result.succeed({ _tag: "None" } satisfies AnnotationArg);

    if (runtime.namespace === "Concealment" && runtime.member === "reveal")
      return Result.succeed({ _tag: "Reveal" } satisfies AnnotationArg);
  }

  const base = unwrapTerm(term.term);

  if (base._tag !== "Ref")
    return reject(scope, at, failure("a member reference the annotate lowering cannot resolve"));

  const ref = base.ref;

  const memberRef: SymbolRef = {
    module: ref.module,
    export: ref.export,
    member: term.member,
  };

  const fact = scope.ctx.schemaFacts.get(refIdentity(memberRef));

  if (fact !== undefined) return lowerSchemaValue(scope, cursor, fact.ref, plan, at);

  return Result.succeed({ _tag: "Symbol", ref: memberRef } satisfies AnnotationArg);
};

/**
 * The lowered arguments of one `.annotate` site: each value cursor against the positional argument plan.
 * Values beyond the fixed items are the plan's `rest`; more than that is a cause, never a silent drop.
 */
export const lowerPlanArgs = (
  scope: Scope,
  plan: ArgsPlan,
  values: ReadonlyArray<Cursor>,
): Result.Result<Array<AnnotationArg>, Failure> => {
  if (plan.rest === undefined && values.length > plan.items.length) {
    const at = rangeOf(values[plan.items.length] ?? rootOf(values[0]!.slot));

    return reject(scope, at, failure("annotate values exceeding the definition's argument plan"));
  }

  const lowered = values.map((value, index) =>
    lowerTerm(scope, value, index < plan.items.length ? plan.items[index] : plan.rest, new Set()),
  );

  return collect(lowered);
};
