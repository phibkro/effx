import { Option, Predicate, Result, Schema } from "effect";
import type { SymbolRef } from "@effx/ir";
import type { DefinitionData } from "@effx/runtime";
import type { ArgsPlan } from "@effx/runtime";
import { RuntimeDiagnostics } from "@effx/runtime/diagnostics";
import { LiftDiagnostics, HttpDiagnostics } from "../diagnostics/index.ts";
import { AccessContractData } from "../extensions/access-contract.ts";
import {
  LiftRecognitionErrorSchema,
  type LiftDefinitionEntry,
  type LiftRecognitionError,
  type LiftSite,
} from "../annotation.ts";
import { AnnotationArg, type Annotation } from "../Collected.ts";
import { nameOfSymbol, type AccessRule, type MetadataRule } from "./context.ts";
import type { Cause } from "./causes.ts";
import type { DefinitionRecord, StepRecord } from "./model.ts";
import { nativeName } from "./native.ts";
import { refIdentity, sameRef, symbolRefOf } from "./refs.ts";
import type { ArgSpec } from "./rules.ts";
import { lowerPlanArgs } from "./plan-args.ts";
import { fail, failUnrecognized, nativeOf, open, type Scope } from "./scope.ts";
import type { SourceRange, TermSlot } from "./source.ts";
import { evaluate, type TemplateArgs } from "./template.ts";
import type { AccessUse, MetadataUse } from "./types.ts";
import { SchemaArg, SymbolArg } from "../args.ts";
import type { RefLike } from "../generate/term.ts";
import {
  rootOf,
  callView,
  descend,
  fieldOf,
  isJsonObject,
  keyName,
  literalOf,
  objectOf,
  rangeOf,
  refOf,
  stringField,
  stringOf,
  type CallView,
  type Cursor,
  type LoweredSlot,
  unwrap,
} from "./view.ts";

/*
 * Endpoint annotations: OpenAPI metadata (native `OpenApi.annotations`, registered `Metadata` rules) and
 * access (registered `Access` builders with literal arguments, or the generator's own `annotator({ … })`).
 * Everything read is literal; a non-literal registered metadata argument is EFFX3001, an unregistered helper
 * EFFX3006, and access that is not a registered builder call with literal arguments is EFFX3005 (spec 0019
 * §0.6, §6). Nothing is ever evaluated.
 */

/** What one `annotateMerge` or application step contributed. */
export type StepRead =
  | { readonly _tag: "Metadata"; readonly patch: MetadataUse }
  | { readonly _tag: "Access"; readonly use: AccessUse }
  | { readonly _tag: "Failed" };

const failed: StepRead = { _tag: "Failed" };

const noMetadata: MetadataUse = {
  annotator: undefined,
  operationId: undefined,
  summary: undefined,
  description: undefined,
  tags: undefined,
};

const isStrings = (json: Schema.Json | undefined): json is ReadonlyArray<string> =>
  Array.isArray(json) && json.every(Predicate.isString);

const nonLiteral = (scope: Scope, cursor: Cursor, callee: string, argument: string): StepRead => {
  fail(
    scope,
    rangeOf(cursor),
    LiftDiagnostics.EFFX3001.emit({
      _tag: "NonLiteralArgument",
      subject: scope.subject,
      callee,
      argument,
    }),
  );

  return failed;
};

const stringIn = (object: Schema.JsonObject, key: string): string | undefined =>
  Option.getOrUndefined(stringField(object, key));

/** Native `OpenApi.annotations({ identifier, summary, description, override: { tags } })`. */
const readOpenApi = (scope: Scope, cursor: Cursor, view: CallView): StepRead => {
  const [argument] = view.args;

  const object =
    argument === undefined || view.args.length !== 1 ? Option.none() : objectOf(argument);

  if (Option.isNone(object))
    return nonLiteral(scope, cursor, "OpenApi.annotations", "annotations object");

  const argumentCursor =
    argument === undefined ? cursor : descend(cursor, argument, ...view.argPath(0));

  const overrideCursor = fieldOf(argumentCursor, "override");

  const known = ["identifier", "summary", "description", "override"];

  for (const name of Object.keys(object.value).filter((candidate) => !known.includes(candidate)))
    fail(
      scope,
      rangeOf(fieldOf(argumentCursor, name)),
      LiftDiagnostics.EFFX3001.emit({
        _tag: "UnsupportedOption",
        subject: scope.subject,
        callee: "OpenApi.annotations",
        option: name,
      }),
    );

  const override = object.value.override;

  if (override !== undefined) {
    if (!isJsonObject(override))
      nonLiteral(scope, overrideCursor, "OpenApi.annotations", "override object");
    else
      for (const name of Object.keys(override)) {
        if (name === "tags" && isStrings(override.tags)) continue;
        fail(
          scope,
          rangeOf(fieldOf(overrideCursor, name)),
          LiftDiagnostics.EFFX3001.emit({
            _tag: "UnsupportedOption",
            subject: scope.subject,
            callee: "OpenApi.annotations",
            option: `override.${name}`,
          }),
        );
      }
  }

  for (const name of ["identifier", "summary", "description"])
    if (object.value[name] !== undefined && !Predicate.isString(object.value[name]))
      nonLiteral(scope, fieldOf(argumentCursor, name), "OpenApi.annotations", name);
  const tags = override !== undefined && isJsonObject(override) ? override.tags : undefined;

  return {
    _tag: "Metadata",
    patch: {
      ...noMetadata,
      operationId: stringIn(object.value, "identifier"),
      summary: stringIn(object.value, "summary"),
      description: stringIn(object.value, "description"),
      tags: isStrings(tags) ? tags : undefined,
    },
  };
};

/** A registered metadata helper: `helper(summary, description)` or the generated `annotator({ … })`. */
const readMetadataCall = (
  scope: Scope,
  cursor: Cursor,
  view: CallView,
  rule: MetadataRule,
): StepRead => {
  const callee = refOf(view.callee);
  const name = nameOfSymbol(rule.callee);

  if (Option.isSome(callee) && sameRef(rule.annotator, callee.value)) {
    const [argument] = view.args;

    const object =
      argument === undefined || view.args.length !== 1 ? Option.none() : objectOf(argument);

    if (Option.isNone(object))
      return nonLiteral(scope, cursor, nameOfSymbol(rule.annotator), "metadata object");

    const tags = object.value.tags;

    return {
      _tag: "Metadata",
      patch: {
        annotator: rule.annotator,
        operationId: stringIn(object.value, "operationId"),
        summary: stringIn(object.value, "summary"),
        description: stringIn(object.value, "description"),
        tags: isStrings(tags) ? tags : undefined,
      },
    };
  }

  if (view.args.length > rule.positional.length) {
    fail(
      scope,
      rangeOf(cursor),
      LiftDiagnostics.EFFX3001.emit({
        _tag: "UnsupportedOption",
        subject: scope.subject,
        callee: name,
        option: "extra arguments",
      }),
    );

    return failed;
  }

  const values = rule.positional.map((position, index) => {
    const argument = view.args[index];

    return [position, argument === undefined ? Option.none<string>() : stringOf(argument)] as const;
  });

  const bad = values.findIndex(
    ([, value], index) => view.args[index] !== undefined && Option.isNone(value),
  );

  const badArgument = view.args[bad];

  if (bad >= 0 && badArgument !== undefined)
    return nonLiteral(
      scope,
      descend(cursor, badArgument, ...view.argPath(bad)),
      name,
      rule.positional[bad] ?? "argument",
    );

  const text = (position: "summary" | "description"): string | undefined =>
    Option.getOrUndefined(
      values.find(([candidate]) => candidate === position)?.[1] ?? Option.none(),
    );

  return {
    _tag: "Metadata",
    patch: {
      ...noMetadata,
      annotator: rule.annotator,
      summary: text("summary"),
      description: text("description"),
    },
  };
};

const matchesKind = (value: Schema.Json, kind: ArgSpec["kind"]): boolean =>
  kind === "string"
    ? Predicate.isString(value)
    : kind === "boolean"
      ? Predicate.isBoolean(value)
      : isStrings(value);

/** The literal arguments of one registered builder call by declared name, with declared defaults applied. */
const builderArgs = (
  scope: Scope,
  cursor: Cursor,
  view: CallView,
  rule: AccessRule,
): Option.Option<TemplateArgs> => {
  const specs = rule.arguments._tag === "Object" ? rule.arguments.fields : rule.arguments.params;
  const bound = new Map<string, Schema.Json>();

  const reject = (): Option.Option<TemplateArgs> => {
    fail(
      scope,
      rangeOf(cursor),
      LiftDiagnostics.EFFX3005.emit({
        subject: scope.subject,
        form: "non-literal-argument",
        builder: nameOfSymbol(rule.callee),
      }),
    );

    return Option.none();
  };

  if (rule.arguments._tag === "Object") {
    const [argument] = view.args;

    const object =
      argument === undefined || view.args.length !== 1 ? Option.none() : objectOf(argument);

    if (Option.isNone(object)) return reject();

    for (const [name, value] of Object.entries(object.value)) {
      const spec = specs.find((candidate) => candidate.name === name);

      if (spec === undefined || !matchesKind(value, spec.kind)) return reject();
      bound.set(name, value);
    }
  } else {
    if (view.args.length > specs.length) return reject();

    for (const [index, spec] of specs.entries()) {
      const argument = view.args[index];
      const value = argument === undefined ? Option.none() : literalOf(argument);

      if (argument === undefined) continue;

      if (Option.isNone(value) || !matchesKind(value.value, spec.kind)) return reject();
      bound.set(spec.name, value.value);
    }
  }

  for (const spec of specs) {
    if (bound.has(spec.name)) continue;

    if (spec.default !== undefined) bound.set(spec.name, spec.default);
    else if (spec.required) return reject();
  }

  return Option.some(bound);
};

/** The access data read from source, before the IR schema decides whether it is complete and valid. */
interface AccessCandidate {
  readonly fields: ReadonlyArray<readonly [string, Schema.Json]>;
  readonly annotator: SymbolRef;
  readonly canonicalScopeResolver: SymbolRef | undefined;
}

/** Validates access data with the existing IR schema; anything else is not a registered literal builder call. */
const accessOf = (
  scope: Scope,
  cursor: Cursor,
  rule: AccessRule,
  candidate: AccessCandidate,
): StepRead =>
  Option.match(
    Schema.decodeUnknownOption(AccessContractData)(
      Object.fromEntries([
        ...candidate.fields,
        ["annotator", candidate.annotator],
        ["canonicalScopeResolver", candidate.canonicalScopeResolver],
      ]),
    ),
    {
      onNone: () => {
        fail(
          scope,
          rangeOf(cursor),
          LiftDiagnostics.EFFX3005.emit({
            subject: scope.subject,
            form: "non-literal-argument",
            builder: nameOfSymbol(rule.callee),
          }),
        );

        return failed;
      },
      onSome: (use) => ({ _tag: "Access", use }),
    },
  );

/** Access through a registered builder and its data template. */
export const readAccessBuilder = (
  scope: Scope,
  cursor: Cursor,
  view: CallView,
  rule: AccessRule,
): StepRead => {
  const args = builderArgs(scope, cursor, view, rule);

  if (Option.isNone(args)) return failed;

  const emit = rule.emit;
  const resolver = evaluate(rule.resolver, args.value);

  const fields = Result.all({
    exposure: evaluate(emit.exposure, args.value),
    acceptedCredentials: evaluate(emit.acceptedCredentials, args.value),
    principalKinds: evaluate(emit.principalKinds, args.value),
    capabilities: evaluate(emit.capabilities, args.value),
    requirements: evaluate(emit.requirements, args.value),
    concealment: evaluate(emit.concealment, args.value),
    decisionTime: evaluate(emit.decisionTime, args.value),
  });

  if (
    Result.isFailure(resolver) ||
    Result.isFailure(fields) ||
    !Predicate.isString(resolver.success)
  ) {
    fail(
      scope,
      rangeOf(cursor),
      LiftDiagnostics.EFFX3005.emit({
        subject: scope.subject,
        form: "non-literal-argument",
        builder: nameOfSymbol(rule.callee),
      }),
    );

    return failed;
  }

  const named = scope.ctx.input.names[resolver.success];

  if (named === undefined) {
    failUnrecognized(
      scope,
      rangeOf(cursor),
      `canonicalScopeResolver ${JSON.stringify(resolver.success)} is not pinned in names`,
    );

    return failed;
  }

  return accessOf(scope, cursor, rule, {
    fields: Object.entries(fields.success),
    annotator: rule.annotator,
    canonicalScopeResolver: named,
  });
};

/** Access in the generator's own spelling: `annotator({ exposure, …, canonicalScopeResolver, … })`. */
export const readAccessGenerated = (
  scope: Scope,
  cursor: Cursor,
  view: CallView,
  rule: AccessRule,
): StepRead => {
  const [argument] = view.args;
  const object = argument === undefined ? undefined : unwrap(argument);

  if (view.args.length !== 1 || object === undefined || object._tag !== "Obj") {
    fail(
      scope,
      rangeOf(cursor),
      LiftDiagnostics.EFFX3005.emit({
        subject: scope.subject,
        form: "non-literal-argument",
        builder: nameOfSymbol(rule.annotator),
      }),
    );

    return failed;
  }

  const entries = object.entries.map((entry) => [keyName(entry.key), entry.value] as const);
  const resolverTerm = entries.find(([name]) => name === "canonicalScopeResolver")?.[1];
  const resolver = resolverTerm === undefined ? Option.none() : refOf(resolverTerm);

  const data = entries.flatMap(([name, term]) => {
    const json = literalOf(term);

    return name !== "canonicalScopeResolver" && Option.isSome(json)
      ? [[name, json.value] as const]
      : [];
  });

  return accessOf(scope, cursor, rule, {
    fields: data,
    annotator: rule.annotator,
    canonicalScopeResolver: Option.isSome(resolver) ? symbolRefOf(resolver.value) : undefined,
  });
};

/** `.annotateMerge(X)`: native OpenAPI metadata, a registered metadata helper, or a registered access helper. */
export const readAnnotateMerge = (
  scope: Scope,
  step: Extract<StepRecord, { readonly _tag: "Method" }>,
): StepRead => {
  const [slot] = step.args;

  if (step.args.length !== 1 || slot === undefined) {
    failUnrecognized(scope, step.range, ".annotateMerge without exactly one argument");

    return failed;
  }

  const opened = open(scope, slot, "metadata");

  if (Option.isNone(opened)) return failed;

  const cursor = opened.value;
  const at = rangeOf(cursor);
  const view = callView(cursor.term);
  const callee = view === undefined ? undefined : nativeOf(scope, view.callee);
  const calleeRef = view === undefined ? Option.none() : refOf(view.callee);

  if (view !== undefined && callee?.kind === "OpenApi" && nativeName(callee) === "annotations")
    return readOpenApi(scope, cursor, view);

  if (view === undefined || Option.isNone(calleeRef)) {
    failUnrecognized(scope, at, ".annotateMerge argument");

    return failed;
  }

  const metadataRule = scope.ctx.metadataRules.find(
    (rule) => sameRef(rule.callee, calleeRef.value) || sameRef(rule.annotator, calleeRef.value),
  );

  if (metadataRule !== undefined) return readMetadataCall(scope, cursor, view, metadataRule);

  const accessRule = scope.ctx.accessRules.find(
    (rule) =>
      sameRef(rule.annotator, calleeRef.value) ||
      (rule.apply === undefined && sameRef(rule.callee, calleeRef.value)),
  );

  if (accessRule !== undefined)
    return sameRef(accessRule.annotator, calleeRef.value)
      ? readAccessGenerated(scope, cursor, view, accessRule)
      : readAccessBuilder(scope, cursor, view, accessRule);

  fail(
    scope,
    at,
    LiftDiagnostics.EFFX3006.emit({
      subject: scope.subject,
      position: "metadata",
      callee: nameOfSymbol(symbolRefOf(calleeRef.value)),
    }),
  );

  return failed;
};

/** `.pipe((e) => W(e, builder(args)))` and `W(endpoint, builder(args))`: access through a registered applier. */
export const readApply = (
  scope: Scope,
  step: Extract<StepRecord, { readonly _tag: "Apply" }>,
): StepRead => {
  const opened = open(scope, step.callee, "structure");

  if (Option.isNone(opened)) return failed;

  const callee = refOf(opened.value.term);

  const rule = Option.isSome(callee)
    ? scope.ctx.accessRules.find(
        (candidate) => candidate.apply !== undefined && sameRef(candidate.apply, callee.value),
      )
    : undefined;

  if (rule === undefined) {
    fail(
      scope,
      step.range,
      LiftDiagnostics.EFFX3001.emit({
        _tag: "UnknownPipeStep",
        subject: scope.subject,
        construct: Option.isSome(callee) ? nameOfSymbol(symbolRefOf(callee.value)) : "wrapper",
      }),
    );

    return failed;
  }

  const [argument] = step.args;

  if (step.args.length !== 1 || argument === undefined) {
    fail(
      scope,
      step.range,
      LiftDiagnostics.EFFX3005.emit({
        subject: scope.subject,
        form: "non-literal-argument",
        builder: nameOfSymbol(rule.callee),
      }),
    );

    return failed;
  }

  const built = open(scope, argument, "access");

  if (Option.isNone(built)) return failed;

  const view = callView(built.value.term);
  const called = view === undefined ? Option.none() : refOf(view.callee);

  if (view !== undefined && Option.isSome(called)) {
    const matched = scope.ctx.accessRules.find((candidate) =>
      sameRef(candidate.callee, called.value),
    );

    if (matched !== undefined) return readAccessBuilder(scope, built.value, view, matched);

    fail(
      scope,
      rangeOf(built.value),
      LiftDiagnostics.EFFX3006.emit({
        subject: scope.subject,
        position: "access",
        callee: nameOfSymbol(symbolRefOf(called.value)),
      }),
    );

    return failed;
  }

  fail(
    scope,
    rangeOf(built.value),
    LiftDiagnostics.EFFX3005.emit({
      subject: scope.subject,
      form: Option.isSome(refOf(built.value.term)) ? "constant" : "non-literal-argument",
    }),
  );

  return failed;
};

/** The key an `.annotate(Key, value)` step names for its faithful 3001 diagnostic (the blank reject text). */
export const annotationKeyOf = (step: Extract<StepRecord, { readonly _tag: "Method" }>): string => {
  const [first] = step.args;

  return first === undefined || first._tag === "Unlowered"
    ? "(unreadable key)"
    : Option.match(refOf(first.term), {
        onNone: () => "(non-reference key)",
        onSome: (reference) => nameOfSymbol(reference),
      });
};

/** The 3001 blanket rejection the engine reported for unclaimed keys, kept exactly as it spelled them. */
const unknownKey = (scope: Scope, at: SourceRange, key: string): Option.Option<Annotation> => {
  fail(
    scope,
    at,
    LiftDiagnostics.EFFX3001.emit({
      _tag: "UnknownAnnotationKey",
      subject: scope.subject,
      key,
    }),
  );

  return Option.none();
};

/** The canonical definition record a `.annotate` key names, or none after a registered rejection cause. */
const annotateRecordOf = (scope: Scope, cursor: Cursor): Option.Option<DefinitionRecord> => {
  const key = unwrap(cursor.term);

  if (key._tag === "Ref") {
    const record = scope.ctx.definitionsByRef.get(refIdentity(key.ref));

    return record === undefined ? Option.none() : Option.some(record);
  }

  // Other lowered shapes are keys the current engine could never read, exactly as the blanket rejection
  // reported them (a literal, a call): the 3001 reader handles them below ("spec 0019 §0.6").
  if (key._tag !== "Member") return Option.none();

  // The writer's spelling: `.annotate(<Definition>.effect.key, value)`. A member chain of any other shape
  // cannot be resolved to a literal key identity: EFFX3012, never approximated (spec 0019 §0.6, S1).
  if (key.member !== "key") {
    fail(
      scope,
      rangeOf(cursor),
      LiftDiagnostics.EFFX3012.emit({
        subject: scope.subject,
        construct: "a member chain that is not a registered definition `effect.key` spelling",
      }),
    );

    return Option.none();
  }

  const effect = unwrap(key.term);

  if (effect._tag !== "Member" || effect.member !== "effect") {
    fail(
      scope,
      rangeOf(cursor),
      LiftDiagnostics.EFFX3012.emit({
        subject: scope.subject,
        construct: "a member chain whose `.effect.key` shape the analyzed source does not resolve",
      }),
    );

    return Option.none();
  }

  const owner = unwrap(effect.term);

  if (owner._tag !== "Ref") {
    fail(
      scope,
      rangeOf(cursor),
      LiftDiagnostics.EFFX3012.emit({
        subject: scope.subject,
        construct:
          "a `.effect.key` chain whose definition export the analyzed source does not resolve",
      }),
    );

    return Option.none();
  }

  const record = scope.ctx.definitionsByRef.get(refIdentity(owner.ref));

  return record === undefined ? Option.none() : Option.some(record);
};

/** The cross-check between a source record's key fact and the selected definition's own key id. */
const annotateCrossCheck = (
  scope: Scope,
  at: SourceRange,
  record: DefinitionRecord,
  definition: DefinitionData,
): ReadonlyArray<Cause> => {
  if (definition.effect === undefined) {
    return [
      {
        at,
        diagnostic: LiftDiagnostics.EFFX3012.emit({
          subject: scope.subject,
          construct: `the definition ${definition.name} does not declare an effect clause for its annotated key`,
        }),
      },
    ];
  }

  if (record.key === undefined || definition.effect.key.key !== record.key.id) {
    return [
      {
        at,
        diagnostic: LiftDiagnostics.EFFX3012.emit({
          subject: scope.subject,
          construct:
            record.key === undefined
              ? "the analyzed source does not resolve the definition's effect-key identity"
              : "the annotated key id does not match the definition's own key id",
        }),
      },
    ];
  }

  return [];
};

/** The lowered annotation values, both the slots and the lowered argument list, per successful site. */
interface LoweredAnnotationValues {
  readonly slots: ReadonlyArray<LoweredSlot>;
  readonly args: ReadonlyArray<AnnotationArg>;
}

/** The lowered annotation values: value slots opened, never silently approximated (spec 0019 §0.6). */
const annotateValues = (
  scope: Scope,
  plan: ArgsPlan,
  valueSlots: ReadonlyArray<TermSlot>,
): LoweredAnnotationValues | undefined => {
  for (const slot of valueSlots) {
    if (slot._tag !== "Lowered") {
      open(scope, slot, "metadata", "annotate value");

      return undefined;
    }
  }

  const slots: ReadonlyArray<LoweredSlot> = valueSlots.filter(
    (slot): slot is LoweredSlot => slot._tag === "Lowered",
  );

  const lowered = lowerPlanArgs(
    scope,
    plan,
    slots.map((slot) => rootOf(slot)),
  );

  if (Result.isFailure(lowered)) return undefined;

  return { slots, args: lowered.success };
};

const annotateRefsOf = (
  _scope: Scope,
  args: ReadonlyArray<AnnotationArg>,
): ReadonlyArray<RefLike> =>
  args.reduce<ReadonlyArray<RefLike>>((refs, arg) => annotateRefWalk(arg, refs), []);

/** The two tagged argument shapes that carry a reference, decoded at the walk boundary. */
const RefArg = Schema.Union([SchemaArg, SymbolArg]);

const annotateRefWalk = (
  arg: AnnotationArg,
  refs: ReadonlyArray<RefLike>,
): ReadonlyArray<RefLike> => {
  if (Predicate.isString(arg) || Predicate.isNumber(arg) || Predicate.isBoolean(arg)) return refs;

  if (Array.isArray(arg)) {
    return arg.reduce<ReadonlyArray<RefLike>>((all, item) => annotateRefWalk(item, all), refs);
  }

  const reference = Schema.decodeUnknownOption(RefArg)(arg);

  if (Option.isSome(reference)) return [...refs, reference.value.ref];

  // Every remaining tagged member (Lambda, capability and concealment shapes) carries no reference.
  if ("_tag" in arg) return refs;

  return Object.values(arg).reduce<ReadonlyArray<RefLike>>(
    (all, child) => annotateRefWalk(child, all),
    refs,
  );
};

/** The `adapterPrerequisites` resolution rule applied to one argument reference (a real export). */
const resolvesRef = (scope: Scope, ref: RefLike): boolean =>
  scope.ctx.schemaFacts.get(refIdentity(ref)) !== undefined ||
  scope.ctx.markers.get(refIdentity(ref)) !== undefined ||
  scope.ctx.values.get(refIdentity(ref)) !== undefined ||
  scope.ctx.wrappers.get(refIdentity(ref)) !== undefined ||
  scope.ctx.filesByModule.get(ref.module)?.exports.includes(ref.export) === true;

/** The first unresolved reference cause of the produced arguments, or none when every ref resolves. */
const annotateRefIssue = (
  scope: Scope,
  at: SourceRange,
  refs: ReadonlyArray<RefLike>,
): Option.Option<Cause> => {
  for (const ref of refs) {
    if (resolvesRef(scope, ref)) continue;

    return Option.some({
      at,
      diagnostic: LiftDiagnostics.EFFX3011.emit({
        subject: scope.subject,
        reason: "unresolved-ref",
        construct: nameOfSymbol(ref),
      }),
    });
  }

  return Option.none();
};

/**
 * The annotation arguments a recognizer produced: decoded once against the definition's codec, encoded
 * once to the lowered form, and decoded back once, so no hook output is trusted without both proof
 * directions (spec 0019 §5, S1; the writer prints the lowered form). `undefined` means a registered 3011
 * cause already reported the step.
 */
/** The default lowering decode: one decode of lowered args against the definition codec, authoritative. */
const annotateArgsDecoded = (
  scope: Scope,
  at: SourceRange,
  definition: DefinitionData,
  loweredArgs: ReadonlyArray<AnnotationArg>,
): boolean => {
  const codec = scope.ctx.registry.codecs.get(definition.name);

  if (codec === undefined) return false;

  const decoded = Schema.decodeResult(codec)(loweredArgs);

  if (Result.isFailure(decoded)) {
    scope.causes.push({
      at,
      diagnostic: LiftDiagnostics.EFFX3011.emit({
        subject: scope.subject,
        reason: "decode-failed",
        issue: decoded.failure.toString(),
      }),
    });

    return false;
  }

  const issue = annotateRefIssue(scope, at, annotateRefsOf(scope, loweredArgs));

  if (Option.isSome(issue)) {
    scope.causes.push(issue.value);

    return false;
  }

  return true;
};

/**
 * The definition's recognizer at the erased registry boundary and the validation of what it produced:
 * a throw cannot escape (the registered `hook-threw` cause carries no payload), a non-`Result` is
 * `invalid-return`, and the produced value is decoded, encoded and decoded back through the definition's
 * own codec (spec 0019 §5, S1). `None` without causes keeps the recognized nothing; `Some` carries the
 * lowered arguments that entered the annotation.
 */
const recognizedArgsOf = (
  scope: Scope,
  at: SourceRange,
  entry: LiftDefinitionEntry,
  site: LiftSite,
): Option.Option<ReadonlyArray<AnnotationArg>> => {
  const hook = entry.recognize;

  if (hook === undefined) return Option.none();

  let outcome: Result.Result<unknown, LiftRecognitionError>;

  try {
    outcome = hook(site);
  } catch {
    scope.causes.push({
      at,
      diagnostic: LiftDiagnostics.EFFX3011.emit({
        subject: scope.subject,
        reason: "hook-threw",
      }),
    });

    return Option.none();
  }

  const invalidReturn = (): Option.Option<ReadonlyArray<AnnotationArg>> => {
    scope.causes.push({
      at,
      diagnostic: LiftDiagnostics.EFFX3011.emit({
        subject: scope.subject,
        reason: "invalid-return",
      }),
    });

    return Option.none();
  };

  if (!Result.isResult(outcome)) return invalidReturn();

  if (Result.isSuccess(outcome)) {
    const decoded = Schema.decodeUnknownResult(site.schema)(outcome.success);

    if (Result.isFailure(decoded)) {
      scope.causes.push({
        at,
        diagnostic: LiftDiagnostics.EFFX3011.emit({
          subject: scope.subject,
          reason: "decode-failed",
          issue: decoded.failure.message,
        }),
      });

      return Option.none();
    }

    const lowered = Schema.encodeResult(site.schema)(decoded.success);

    if (Result.isFailure(lowered)) {
      scope.causes.push({
        at,
        diagnostic: LiftDiagnostics.EFFX3011.emit({
          subject: scope.subject,
          reason: "encode-failed",
          issue: lowered.failure.message,
        }),
      });

      return Option.none();
    }

    const symmetric = Schema.decodeResult(site.schema)(lowered.success);

    if (Result.isFailure(symmetric)) {
      scope.causes.push({
        at,
        diagnostic: LiftDiagnostics.EFFX3011.emit({
          subject: scope.subject,
          reason: "decode-failed",
          issue: symmetric.failure.message,
        }),
      });

      return Option.none();
    }

    const issue = annotateRefIssue(scope, at, annotateRefsOf(scope, lowered.success));

    if (Option.isSome(issue)) {
      scope.causes.push(issue.value);

      return Option.none();
    }

    return Option.some(lowered.success);
  }

  if (!Result.isFailure(outcome)) return invalidReturn();

  const failure = Schema.decodeOption(LiftRecognitionErrorSchema)(outcome.failure);

  if (Option.isNone(failure)) return invalidReturn();

  scope.causes.push({
    at,
    diagnostic: LiftDiagnostics.EFFX3011.emit({
      subject: scope.subject,
      reason: "hook-failed",
      construct: failure.value.construct,
    }),
  });

  return Option.none();
};

/** The one real `.annotate` reader of the lift core (spec 0019 §5, S1). */
export const readAnnotate = (
  scope: Scope,
  step: Extract<StepRecord, { readonly _tag: "Method" }>,
  definitionAnnotations: ReadonlyArray<Annotation>,
): Option.Option<Annotation> => {
  const at = step.range;
  const [keySlot, ...valueSlots] = step.args;

  if (keySlot === undefined || keySlot._tag === "Unlowered")
    return unknownKey(scope, at, annotationKeyOf(step));

  const record = annotateRecordOf(scope, rootOf(keySlot));

  if (Option.isNone(record)) {
    // A resolvable reference no selected definition claims, a literal key or an unlowered key: the
    // faithful 3001 the blanket rejection reported, with the key spelled the way the term spells it.
    return unknownKey(scope, at, annotationKeyOf(step));
  }

  const entry = scope.ctx.registry.definitions.get(record.value.name);

  if (entry === undefined) return unknownKey(scope, at, record.value.name);

  const definition = entry.definition;

  // A definition recorded EFFX1301 problems at build time: they become per-site causes here and block the
  // site, exactly as `definitionDiagnostics` reports them in the forward pipeline (spec 0020 §3).
  for (const problem of definition.diagnostics) {
    scope.causes.push({
      at,
      diagnostic: { ...problem, severity: RuntimeDiagnostics["EFFX1301"].entry.severity },
    });
  }

  if (definition.diagnostics.length > 0) return Option.none();

  const crossCheck = annotateCrossCheck(scope, at, record.value, definition);

  if (crossCheck.length > 0) {
    scope.causes.push(...crossCheck);

    return Option.none();
  }

  if (
    definition.cardinality === "one" &&
    definitionAnnotations.filter((annotation) => annotation.name === definition.name).length > 0
  ) {
    scope.causes.push({
      at,
      diagnostic: HttpDiagnostics["EFFX2402"].emit({
        _tag: "DuplicateAnnotation",
        subject: scope.subject,
        annotation: definition.name,
      }),
    });

    return Option.none();
  }

  const values = annotateValues(scope, definition.plan, valueSlots);

  if (values === undefined) return Option.none();

  const name = definition.name;
  const codec = scope.ctx.registry.codecs.get(name);
  const recognize = entry.recognize;

  if (codec === undefined) return Option.none();

  if (recognize !== undefined) {
    // The recognizer only sees the site it claims: one value lowering to its own single positional
    // argument. Anything else has no site representation, so the hook never runs (no silent fallback).
    if (
      values.slots.length !== 1 ||
      definition.plan.items.length !== 1 ||
      definition.plan.rest !== undefined
    ) {
      scope.causes.push({
        at,
        diagnostic: LiftDiagnostics.EFFX3011.emit({
          subject: scope.subject,
          reason: "hook-arity",
        }),
      });

      return Option.none();
    }

    const [slot] = values.slots;

    if (slot === undefined || recognize === undefined) return Option.none();

    const site: LiftSite = {
      definition,
      schema: codec,
      value: slot.term,
      subject: scope.subject,
      range: slot.range,
      names: scope.ctx.input.names,
      emptyInput: scope.ctx.input.emptyInput,
      project: scope.ctx.input.project,
    };

    const produced = recognizedArgsOf(scope, at, entry, site);

    if (Option.isNone(produced)) return Option.none();

    return Option.some({ name, args: [...produced.value], definition: record.value.ref });
  }

  const valid = annotateArgsDecoded(scope, at, definition, values.args);

  return valid !== true
    ? Option.none()
    : Option.some({ name, args: values.args, definition: record.value.ref });
};

/** Merges metadata contributions; two different values for one field are a cause, never a silent choice. */
export const mergeMetadata = (
  current: MetadataUse | undefined,
  patch: MetadataUse,
): Result.Result<MetadataUse, string> => {
  const conflict = (["operationId", "summary", "description"] as const).find(
    (field) =>
      patch[field] !== undefined &&
      current?.[field] !== undefined &&
      patch[field] !== current[field],
  );

  return conflict !== undefined
    ? Result.fail(`conflicting ${conflict} in two annotateMerge steps`)
    : Result.succeed({
        annotator: patch.annotator ?? current?.annotator,
        operationId: patch.operationId ?? current?.operationId,
        summary: patch.summary ?? current?.summary,
        description: patch.description ?? current?.description,
        tags: patch.tags ?? current?.tags,
      });
};
