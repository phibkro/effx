import { Context, Effect, Layer } from "effect";
import { CompilerFault } from "@effx/compiler";
import type { DetailedError } from "@cedar-policy/cedar-wasm/nodejs";

/*
 * Spec 0017 §3: the one seam to the real Cedar validator, `@cedar-policy/cedar-wasm` pinned to
 * 4.13.0. Only `policySetTextToParts` and `validate` are used; there is no request-evaluation
 * entry point here and none may be added (ADR 0007, spec 0017 F5). The module is loaded with a
 * dynamic `import()` on first use, so `check` and `build` never load 13 MB of wasm.
 *
 * The package root fails to load under Bun 1.4.2 (esm/cedar_wasm.js), so the `/nodejs` subpath is
 * the entry. `validate` answers `{ type: "success" }` even when `validationErrors` is non-empty
 * (the Cedar CLI exits 3 for the same input), so the verdict here is computed from the lists and
 * never from `type`.
 */

export const CEDAR_WASM_INSTALL = "bun add @cedar-policy/cedar-wasm@4.13.0";

export interface CedarIssue {
  readonly policyId?: string;
  readonly message: string;
  readonly help?: string;
}

export interface CedarVerdict {
  readonly errors: ReadonlyArray<CedarIssue>;
  readonly warnings: ReadonlyArray<CedarIssue>;
}

export class CedarValidator extends Context.Service<
  CedarValidator,
  {
    /** Validate one policy text (static policies and/or templates) against one Cedar schema text. */
    readonly validate: (
      schema: string,
      policies: string,
    ) => Effect.Effect<CedarVerdict, CompilerFault>;
  }
>()("effx/cli/CedarValidator") {}

const byCodeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Cedar reports from hash maps, so order is not stable; sort for reproducible output. */
const ordered = (issues: ReadonlyArray<CedarIssue>): ReadonlyArray<CedarIssue> =>
  issues.toSorted(
    (a, b) => byCodeUnit(a.policyId ?? "", b.policyId ?? "") || byCodeUnit(a.message, b.message),
  );

type CedarIssueDraft = { -readonly [K in keyof CedarIssue]: CedarIssue[K] };

const issueOf = (error: DetailedError, policyId?: string): CedarIssue => {
  const issue: CedarIssueDraft = { message: error.message };

  if (policyId !== undefined) issue.policyId = policyId;

  if (error.help !== null) issue.help = error.help;

  return issue;
};

const policyIdOf = (text: string, fallback: string): string => {
  const annotated = /@id\("((?:[^"\\]|\\.)*)"\)/.exec(text)?.[1];

  return annotated === undefined ? fallback : annotated.replace(/\\(.)/g, "$1");
};

/** A repeated `@id` keeps both policies: the later one is suffixed with its position. */
const keyed = (
  texts: ReadonlyArray<string>,
  fallback: string,
): Readonly<Record<string, string>> => {
  const seen = new Set<string>();
  const entries: Array<readonly [string, string]> = [];

  for (const [position, text] of texts.entries()) {
    const id = policyIdOf(text, `${fallback}${position}`);
    const unique = seen.has(id) ? `${id}#${position}` : id;

    seen.add(unique);
    entries.push([unique, text]);
  }

  return Object.fromEntries(entries);
};

const load = Effect.tryPromise({
  try: () => import("@cedar-policy/cedar-wasm/nodejs"),
  catch: (cause) =>
    new CompilerFault({
      stage: "cedar",
      message: `the Cedar validator @cedar-policy/cedar-wasm is not installed or failed to load; run: ${CEDAR_WASM_INSTALL}`,
      cause,
    }),
});

const validate = Effect.fn("CedarValidator.validate")(function* (schema: string, policies: string) {
  const cedar = yield* load;
  const parts = cedar.policySetTextToParts(policies);

  if (parts.type === "failure") {
    return {
      errors: ordered(parts.errors.map((error) => issueOf(error))),
      warnings: [],
    } satisfies CedarVerdict;
  }

  const answer = cedar.validate({
    validationSettings: { mode: "strict" },
    schema,
    policies: {
      staticPolicies: keyed(parts.policies, "policy"),
      templates: keyed(parts.policy_templates, "template"),
      templateLinks: [],
    },
  });

  if (answer.type === "failure") {
    return {
      errors: ordered(answer.errors.map((error) => issueOf(error))),
      warnings: ordered(answer.warnings.map((warning) => issueOf(warning))),
    } satisfies CedarVerdict;
  }

  return {
    errors: ordered(answer.validationErrors.map(({ policyId, error }) => issueOf(error, policyId))),
    warnings: ordered([
      ...answer.validationWarnings.map(({ policyId, error }) => issueOf(error, policyId)),
      ...answer.otherWarnings.map((warning) => issueOf(warning)),
    ]),
  } satisfies CedarVerdict;
});

export const CedarWasm: Layer.Layer<CedarValidator> = Layer.succeed(CedarValidator, { validate });
