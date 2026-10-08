import { Array as Arr, Option, Result } from "effect";
import type { SymbolRef } from "@effx/ir";
import type { Diagnostic } from "../Diagnostic.ts";
import { LiftDiagnostics } from "../diagnostics/index.ts";
import type { Term } from "../generate/term.ts";
import { nameOfSymbol, unrecognized, type Context } from "./context.ts";
import { exportRefactors, planExport, structTerm } from "./plan.ts";
import { refIdentity } from "./refs.ts";
import type { Refactor } from "./result.ts";
import { locationOf } from "./source.ts";
import { isJsonObject, literalOf } from "./view.ts";

/*
 * Response-header refactors (spec 0019 §4.3, EFFX3003). An application success wrapper is registered as data
 * (`SuccessWrapper`), and the rule names the exported schema its response headers are. When the helper builds
 * those headers inline instead, nothing exports the schema yet: the frontend records the inline expression
 * (`WrapperFact`) and lift plans, once per wrapper, the export that holds it and the edit that makes the
 * helper use it. The suggestion already refers to that planned export by its real reference.
 */

export interface WrapperPlans {
  readonly refactors: ReadonlyArray<Refactor>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const isFields = (term: Term): boolean => {
  const json = literalOf(term);

  return term._tag === "Obj" || (Option.isSome(json) && isJsonObject(json.value));
};

const planOne = (ctx: Context, callee: SymbolRef): WrapperPlans => {
  const none: WrapperPlans = { refactors: [], diagnostics: [] };
  const rule = ctx.successRules.get(refIdentity(callee));
  const headers = rule?.responseHeaders;
  const fact = ctx.wrappers.get(refIdentity(callee));
  const target = headers === undefined ? undefined : ctx.filesByModule.get(headers.module);

  // Nothing to plan: no headers named, no inline expression recorded, or the named export already exists.
  if (
    headers === undefined ||
    fact === undefined ||
    fact.headers._tag !== "Inline" ||
    fact.headers.expression._tag !== "Lowered" ||
    target === undefined ||
    target.exports.includes(headers.export)
  )
    return none;

  const expression = fact.headers.expression;
  const use = ctx.files.get(fact.range.file);
  const subject = nameOfSymbol(callee);

  const cannot = (reason: string): WrapperPlans => {
    const cause = unrecognized(subject, fact.range, reason);

    return {
      refactors: [],
      diagnostics: [{ ...cause.diagnostic, location: locationOf(cause.at) }],
    };
  };

  if (use === undefined) return cannot(`source file record for ${fact.range.file}`);

  const key = `${callee.module}#${callee.export}#headers`;
  const plan = planExport(ctx, key, headers.export, target, "schema");

  if (Result.isFailure(plan)) return cannot(plan.failure);

  if (plan.success.ref.module !== headers.module || plan.success.name !== headers.export)
    return cannot(
      `the rule names ${headers.export} in ${headers.module} but the export is planned as ${plan.success.name} in ${plan.success.ref.module}`,
    );

  return {
    refactors: exportRefactors(ctx, {
      code: "EFFX3003",
      subject,
      cause: {
        ...LiftDiagnostics.EFFX3003.emit({ subject, wrapper: subject, planned: plan.success.name }),
        location: locationOf(expression.range),
      },
      key,
      role: "responseHeaders",
      use,
      anchor: fact.range.start,
      replace: expression.range,
      plan: plan.success,
      initializer: isFields(expression.term) ? structTerm(ctx, expression.term) : expression.term,
      asConst: false,
    }),
    diagnostics: [],
  };
};

/** The header refactors of every distinct registered wrapper the lifted endpoints are written through. */
export const planWrapperHeaders = (
  ctx: Context,
  wrappers: ReadonlyArray<SymbolRef>,
): WrapperPlans => {
  const distinct = Arr.dedupeWith(
    wrappers,
    (left, right) => refIdentity(left) === refIdentity(right),
  );

  const plans = distinct.map((callee) => planOne(ctx, callee));

  return {
    refactors: plans.flatMap((plan) => plan.refactors),
    diagnostics: plans.flatMap((plan) => plan.diagnostics),
  };
};
