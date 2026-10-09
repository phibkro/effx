import { Option, Result } from "effect";
import type { SymbolRef } from "@effx/ir";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { Term } from "../generate/term.ts";
import {
  localDeclarationIdentity,
  nameOfSymbol,
  sourceRangeIdentity,
  stripSuffix,
  type ProblemRule,
} from "./context.ts";
import type { LocalValueCall, LocalValueRecord, OptionEntry, ValueRecord } from "./model.ts";
import { exportRefactors, planExport } from "./plan.ts";
import { refIdentity, sameRef } from "./refs.ts";
import { nativeName } from "./native.ts";
import { fail, failUnrecognized, nativeOf, open, type Scope } from "./scope.ts";
import type { SourceRange, TermSlot } from "./source.ts";
import type { ProblemsUse } from "./types.ts";
import {
  callView,
  descend,
  rangeOf,
  refOf,
  rootOf,
  stringOf,
  stringsOf,
  unwrap,
  type CallView,
  type LoweredSlot,
} from "./view.ts";

/*
 * Problems (spec 0019 §3.3). Hand-written: `response(union)` where the union is `union("Id", [codes])`.
 * Generated: `registry("Id", [codes])`. Codes must be literal strings. An inline array is read and an EFFX3004
 * refactor plans the exported tuple; an array that is not literal is unliftable until it is named. The
 * tuple a declaration references is recorded so the suggestion names it instead of copying the codes.
 */

const symbolOnly = (term: Term): Option.Option<SymbolRef> =>
  Option.flatMap(refOf(term), (reference) =>
    "symbolId" in reference ? Option.none() : Option.some(reference),
  );

const nonLiteral = (scope: Scope, at: SourceRange, callee: string, argument: string): void =>
  fail(
    scope,
    at,
    LiftDiagnostics.EFFX3001.emit({
      _tag: "NonLiteralArgument",
      subject: scope.subject,
      callee,
      argument,
    }),
  );

interface UnionSource {
  readonly declaration: Pick<ValueRecord, "range" | "init">;
  readonly identity: string;
  readonly module: string;
  readonly name: string;
  readonly label: string;
}

/** The EFFX3004 refactor extracting an inline code array of a union into an exported tuple. */
const planCodes = (
  scope: Scope,
  source: UnionSource,
  init: LoweredSlot,
  call: CallView,
  codes: Term,
  identifier: string,
  literalCodes: ReadonlyArray<string>,
): void => {
  const { declaration: value, identity } = source;
  const cached = scope.ctx.codePlans.get(identity);

  if (cached !== undefined) {
    scope.refactors.push(...cached.refactors);
    scope.codeReferences.push(cached.reference);

    return;
  }

  const home = scope.ctx.files.get(value.range.file);

  if (home === undefined) {
    failUnrecognized(scope, value.range, `source file record for ${value.range.file}`);

    return;
  }

  const key = `${source.module}#${source.name}#codes`;

  const plan = planExport(
    scope.ctx,
    key,
    `${stripSuffix(source.name, "Problem")}Codes`,
    home,
    "value",
  );

  if (Result.isFailure(plan)) {
    failUnrecognized(scope, value.range, plan.failure);

    return;
  }

  const at = rangeOf(descend(rootOf(init), codes, ...call.argPath(1)));
  const subject = source.label;

  const refactors = exportRefactors(scope.ctx, {
    code: "EFFX3004",
    subject,
    cause: {
      ...LiftDiagnostics.EFFX3004.emit({
        _tag: "ExportCodes",
        subject,
        union: subject,
        planned: plan.success.name,
      }),
      location: { file: at.file, line: at.start.line, col: at.start.col },
    },
    key,
    role: "codes",
    use: home,
    anchor: value.range.start,
    replace: at,
    plan: plan.success,
    initializer: codes,
    asConst: true,
  });

  const reference = {
    identifier,
    codes: literalCodes,
    ref: { module: plan.success.ref.module, export: plan.success.ref.export },
  };

  scope.ctx.codePlans.set(identity, { refactors, reference });
  scope.refactors.push(...refactors);

  scope.codeReferences.push(reference);
};

/** Reads one exact recorded initializer; exported and local const declarations share every semantic rule. */
const readUnionSource = (
  scope: Scope,
  rule: ProblemRule,
  source: UnionSource,
): Option.Option<ProblemsUse> => {
  const value = source.declaration;
  const opened = open(scope, value.init, "problems");

  if (Option.isNone(opened)) return Option.none();

  const init = callView(opened.value.term);
  const initCallee = init === undefined ? Option.none() : refOf(init.callee);
  const [identifierTerm, codesTerm] = init?.args ?? [];

  if (
    init === undefined ||
    Option.isNone(initCallee) ||
    !sameRef(initCallee.value, rule.union) ||
    init.args.length !== 2 ||
    identifierTerm === undefined ||
    codesTerm === undefined
  ) {
    failUnrecognized(scope, value.range, "a problem union declaration");

    return Option.none();
  }

  const identifier = stringOf(identifierTerm);
  const unionName = source.label;

  if (Option.isNone(identifier)) {
    nonLiteral(scope, value.range, nameOfSymbol(rule.union), "identifier");

    return Option.none();
  }

  const tupleRef = symbolOnly(codesTerm);

  // Codes already exported as a tuple: use that export.
  if (Option.isSome(tupleRef)) {
    const tuple = scope.ctx.values.get(refIdentity(tupleRef.value));

    const codes =
      tuple === undefined || tuple.init._tag === "Unlowered"
        ? Option.none()
        : stringsOf(tuple.init.term);

    if (Option.isNone(codes)) {
      fail(
        scope,
        value.range,
        LiftDiagnostics.EFFX3004.emit({
          _tag: "NonLiteralCodes",
          subject: scope.subject,
          union: unionName,
        }),
      );

      return Option.none();
    }

    scope.codeReferences.push({
      identifier: identifier.value,
      codes: codes.value,
      ref: { module: tupleRef.value.module, export: tupleRef.value.export },
    });

    return Option.some({
      registry: rule.registry,
      identifier: identifier.value,
      codes: codes.value,
    });
  }

  const codes = stringsOf(codesTerm);

  if (Option.isNone(codes)) {
    fail(
      scope,
      value.range,
      LiftDiagnostics.EFFX3004.emit({
        _tag: "NonLiteralCodes",
        subject: scope.subject,
        union: unionName,
      }),
    );

    return Option.none();
  }

  planCodes(scope, source, opened.value.slot, init, codesTerm, identifier.value, codes.value);

  return Option.some({ registry: rule.registry, identifier: identifier.value, codes: codes.value });
};

/** The union a hand-written response names must resolve to its exact exported declaration. */
const readUnion = (
  scope: Scope,
  rule: ProblemRule,
  term: Term | undefined,
  at: SourceRange,
): Option.Option<ProblemsUse> => {
  const union = term === undefined ? Option.none<SymbolRef>() : symbolOnly(term);
  const value = Option.isSome(union) ? scope.ctx.values.get(refIdentity(union.value)) : undefined;

  if (Option.isNone(union) || value === undefined) {
    failUnrecognized(scope, at, "a problem union without a recorded declaration");

    return Option.none();
  }

  return readUnionSource(scope, rule, {
    declaration: value,
    identity: refIdentity(union.value),
    module: union.value.module,
    name: union.value.export,
    label: nameOfSymbol(union.value),
  });
};

/** The source fact must join the sole unlowered identifier, its immutable declaration and both file records. */
const exactLocalCall = (
  scope: Scope,
  slot: TermSlot,
  call: LocalValueCall,
  value: LocalValueRecord,
): boolean => {
  const [finding] = slot._tag === "Unlowered" ? slot.findings : [];
  const home = scope.ctx.files.get(value.range.file);

  return (
    slot._tag === "Unlowered" &&
    slot.findings.length === 1 &&
    finding?.kind === "local-reference" &&
    finding.construct === call.argument.name &&
    finding.enclosingCall !== undefined &&
    sameRef(finding.enclosingCall.callee, call.callee) &&
    finding.range.file === call.range.file &&
    finding.range.start.offset >= call.range.start.offset &&
    finding.range.end.offset <= call.range.end.offset &&
    call.range.file === scope.endpoint.range.file &&
    call.argument.file === value.range.file &&
    call.argument.name === value.id.name &&
    value.kind === "const" &&
    home !== undefined &&
    home.topLevel.includes(value.id.name)
  );
};

const readLocalUnion = (
  scope: Scope,
  call: LocalValueCall,
  value: LocalValueRecord,
): Option.Option<ProblemsUse> => {
  const rule = scope.ctx.problemRules.find((candidate) => sameRef(candidate.response, call.callee));

  if (rule === undefined) {
    fail(
      scope,
      call.range,
      LiftDiagnostics.EFFX3006.emit({
        subject: scope.subject,
        position: "problems",
        callee: nameOfSymbol(call.callee),
      }),
    );

    return Option.none();
  }

  const home = scope.ctx.files.get(value.range.file);

  if (home === undefined) {
    failUnrecognized(scope, value.range, "source file record for a local problem union");

    return Option.none();
  }

  return readUnionSource(scope, rule, {
    declaration: value,
    identity: localDeclarationIdentity(value.id),
    module: home.module,
    name: value.id.name,
    label: `${home.module}#${value.id.name}`,
  });
};

/** Reads the `error` option of an endpoint. */
export const readProblems = (
  scope: Scope,
  entry: Extract<OptionEntry, { readonly _tag: "Property" }>,
): Option.Option<ProblemsUse> => {
  if (entry.value._tag === "Unlowered") {
    const call = scope.ctx.localCalls.get(sourceRangeIdentity(entry.value.range));

    const value =
      call === undefined
        ? undefined
        : scope.ctx.localValues.get(localDeclarationIdentity(call.argument));

    if (
      call !== undefined &&
      value !== undefined &&
      exactLocalCall(scope, entry.value, call, value)
    )
      return readLocalUnion(scope, call, value);
  }

  const opened = open(scope, entry.value, "problems");

  if (Option.isNone(opened)) return Option.none();

  const cursor = opened.value;
  const at = rangeOf(cursor);
  const never = nativeOf(scope, unwrap(cursor.term));

  // `error: Schema.Never` is what the generator writes for an endpoint with no problem contract.
  if (never?.kind === "Schema" && nativeName(never) === "Never") return Option.none();
  const view = callView(cursor.term);
  const callee = view === undefined ? Option.none<SymbolRef>() : symbolOnly(view.callee);

  if (view === undefined || Option.isNone(callee)) {
    failUnrecognized(scope, at, "error expression");

    return Option.none();
  }

  const name = nameOfSymbol(callee.value);

  // The generated spelling `registry(identifier, [codes])`.
  const direct = scope.ctx.problemRules.find((rule) => sameRef(rule.registry, callee.value));

  if (direct !== undefined) {
    const [identifier, codes] = view.args;
    const id = identifier === undefined ? Option.none<string>() : stringOf(identifier);
    const list = codes === undefined ? Option.none<ReadonlyArray<string>>() : stringsOf(codes);

    if (view.args.length === 2 && Option.isSome(id) && Option.isSome(list))
      return Option.some({ registry: direct.registry, identifier: id.value, codes: list.value });

    nonLiteral(scope, at, name, "identifier or codes");

    return Option.none();
  }

  const rule = scope.ctx.problemRules.find((candidate) =>
    sameRef(candidate.response, callee.value),
  );

  if (rule === undefined) {
    fail(
      scope,
      at,
      LiftDiagnostics.EFFX3006.emit({ subject: scope.subject, position: "problems", callee: name }),
    );

    return Option.none();
  }

  if (view.args.length !== 1) {
    fail(
      scope,
      at,
      LiftDiagnostics.EFFX3001.emit({
        _tag: "UnsupportedOption",
        subject: scope.subject,
        callee: name,
        option: "options argument",
      }),
    );

    return Option.none();
  }

  return readUnion(scope, rule, view.args[0], at);
};
