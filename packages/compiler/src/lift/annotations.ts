import { Option, Predicate, Result, Schema } from "effect";
import type { SymbolRef } from "@effx/ir";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import { AccessContractData } from "../extensions/access-contract.ts";
import { nameOfSymbol, type AccessRule, type MetadataRule } from "./context.ts";
import type { StepRecord } from "./model.ts";
import { nativeName } from "./native.ts";
import { sameRef, symbolRefOf } from "./refs.ts";
import type { ArgSpec } from "./rules.ts";
import { fail, failUnrecognized, nativeOf, open, type Scope } from "./scope.ts";
import { evaluate, type TemplateArgs } from "./template.ts";
import type { AccessUse, MetadataUse } from "./types.ts";
import {
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
  unwrap,
  type CallView,
  type Cursor,
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
