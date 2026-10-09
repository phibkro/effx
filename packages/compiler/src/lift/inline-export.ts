import { Option, Result } from "effect";
import type { SchemaRef } from "@effx/ir";
import type { Diagnostic } from "../Diagnostic.ts";
import type { Term } from "../generate/term.ts";
import { exportRefactors, planExport } from "./plan.ts";
import type { PlannedExport } from "./result.ts";
import { failUnrecognized, plannedKey, type Scope } from "./scope.ts";
import { rangeOf, type Cursor } from "./view.ts";

/** One inline expression of an endpoint that a refactor exports under a planned name. */
export interface InlineExport {
  /** The expression being replaced. */
  readonly cursor: Cursor;
  readonly role: Extract<
    PlannedExport["role"],
    "params" | "query" | "headers" | "payload" | "success" | "responseHeaders"
  >;
  readonly code: "EFFX3002" | "EFFX3003";
  /** The registered diagnostic explaining the refactor, given the planned name. */
  readonly describe: (planned: string) => Diagnostic;
  /** What the new export holds. */
  readonly initializer: Term;
  /** The deterministic name used when `LiftInput.names` pins none. */
  readonly derived: string;
}

/**
 * Plans the export for an inline expression of the endpoint and records its refactor. The result is the REAL
 * `SchemaRef` the suggestion then uses; when the plan cannot be made (an unusable pin, no file record) the
 * cause is recorded and the result is none, so no placeholder reference ever exists.
 */
export const exportInline = (scope: Scope, request: InlineExport): Option.Option<SchemaRef> => {
  const at = rangeOf(request.cursor);

  if (request.cursor.exactRange === false) {
    failUnrecognized(scope, at, "an inline schema whose Chain receiver has no exact source span");

    return Option.none();
  }

  if (scope.use === undefined) {
    failUnrecognized(
      scope,
      scope.endpoint.range,
      `source file record for ${scope.endpoint.range.file}`,
    );

    return Option.none();
  }

  const key = plannedKey(scope, request.role);
  const plan = planExport(scope.ctx, key, request.derived, scope.use, "schema");

  if (Result.isFailure(plan)) {
    failUnrecognized(scope, at, plan.failure);

    return Option.none();
  }

  const planned = plan.success;
  const ref = planned.ref;

  if (!("symbolId" in ref)) return Option.none();

  scope.refactors.push(
    ...exportRefactors(scope.ctx, {
      code: request.code,
      subject: scope.subject,
      cause: {
        ...request.describe(planned.name),
        location: { file: at.file, line: at.start.line, col: at.start.col },
      },
      key,
      role: request.role,
      use: scope.use,
      anchor: scope.endpoint.range.start,
      replace: at,
      plan: planned,
      initializer: request.initializer,
      asConst: false,
    }),
  );

  return Option.some(ref);
};
