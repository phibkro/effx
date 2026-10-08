import { Option, Result } from "effect";
import type { SymbolRef } from "@effx/ir";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { Term } from "../generate/term.ts";
import { nameOfSymbol, stripSuffix, type ProblemRule } from "./context.ts";
import type { OptionEntry, ValueRecord } from "./model.ts";
import { exportRefactors, planExport } from "./plan.ts";
import { refIdentity, sameRef } from "./refs.ts";
import { nativeName } from "./native.ts";
import { fail, failUnrecognized, nativeOf, open, type Scope } from "./scope.ts";
import type { SourceRange } from "./source.ts";
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

/** The EFFX3004 refactor extracting an inline code array of a union into an exported tuple. */
const planCodes = (
  scope: Scope,
  value: ValueRecord,
  init: LoweredSlot,
  call: CallView,
  codes: Term,
  identifier: string,
  union: SymbolRef,
): void => {
  const home = scope.ctx.files.get(value.range.file);

  if (home === undefined) {
    failUnrecognized(scope, value.range, `source file record for ${value.range.file}`);

    return;
  }

  const key = `${union.module}#${union.export}#codes`;

  const plan = planExport(
    scope.ctx,
    key,
    `${stripSuffix(union.export, "Problem")}Codes`,
    home,
    "value",
  );

  if (Result.isFailure(plan)) {
    failUnrecognized(scope, value.range, plan.failure);

    return;
  }

  const at = rangeOf(descend(rootOf(init), codes, ...call.argPath(1)));
  const subject = nameOfSymbol(union);

  scope.refactors.push(
    ...exportRefactors(scope.ctx, {
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
    }),
  );

  scope.codeReferences.push({
    identifier,
    ref: { module: plan.success.ref.module, export: plan.success.ref.export },
  });
};

/** The union a hand-written `response(union)` names: its identifier and codes, with the refactor if needed. */
const readUnion = (
  scope: Scope,
  rule: ProblemRule,
  unionTerm: Term | undefined,
  at: SourceRange,
): Option.Option<ProblemsUse> => {
  const union = unionTerm === undefined ? Option.none<SymbolRef>() : symbolOnly(unionTerm);
  const value = Option.isSome(union) ? scope.ctx.values.get(refIdentity(union.value)) : undefined;

  if (Option.isNone(union) || value === undefined || value.init._tag === "Unlowered") {
    failUnrecognized(scope, at, "a problem union without a recorded declaration");

    return Option.none();
  }

  const init = callView(value.init.term);
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
  const unionName = nameOfSymbol(union.value);

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

  planCodes(scope, value, value.init, init, codesTerm, identifier.value, union.value);

  return Option.some({ registry: rule.registry, identifier: identifier.value, codes: codes.value });
};

/** Reads the `error` option of an endpoint. */
export const readProblems = (
  scope: Scope,
  entry: Extract<OptionEntry, { readonly _tag: "Property" }>,
): Option.Option<ProblemsUse> => {
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
