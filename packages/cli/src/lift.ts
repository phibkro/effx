import { Crypto, Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import {
  CompilerFault,
  Diagnostic,
  LiftCheckResult,
  LiftResult as LiftResultSchema,
  renderPatch,
  type Collected,
  type EffectModel,
  type LiftInput,
  type LiftResult,
  type ProjectConfig,
  type Refactor,
  type SourceFileRecord,
} from "@effx/compiler";
import { printedSuggestion } from "./lift-suggest.ts";
import { count, report, summary } from "./report.ts";

/*
 * The retrospective lift command's rendering and boundary surface (spec 0019 §4.1–4.3). The CLI owns the
 * file/printing surface and nothing else: the pure core (`lift`) recognizes, the check pipeline owns its
 * own receipts, and every renderable fact is real data of the actual result. The default prints to stdout
 * only; `--write <file>` writes the suggestion to a NEW file and refuses to overwrite before writing;
 * `--emit-patch` prints the refactors' unified diff and never applies it; the `--json` flag renders the
 * same result as one Schema-encoded document.
 */

export class LiftUsageError extends Schema.TaggedError<LiftUsageError>()("LiftUsageError", {
  message: Schema.String,
}) {
  override readonly _tag = "LiftUsageError";
}

/** The `--form verbose|dense|both` flag value (spec 0019 §4.1). */
export const LiftForm = Schema.Literals(["verbose", "dense", "both"]);

export type LiftForm = typeof LiftForm.Type;

/** One strict JSON document shape shared by stdout and the command's data result. */
export const LiftJsonReport = Schema.fromJsonString(
  Schema.Struct({
    form: LiftForm,
    result: LiftResultSchema,
    diagnostics: Schema.Array(Diagnostic),
    suggestions: Schema.Array(Schema.String),
    patch: Schema.String,
    check: Schema.optionalKey(LiftCheckResult),
  }),
);

export type LiftJsonReport = typeof LiftJsonReport.Type;

/** Schema encodes the JSON document; callers handle any impossible shape mismatch as an invariant fault. */
export const encodeLiftJsonReport = (report: LiftJsonReport) =>
  Schema.encodeResult(LiftJsonReport)(report);

/** Output choices; group and module paths live only in LiftInput. */
export interface LiftParams {
  readonly check: boolean;
  readonly write: string | undefined;
  readonly emitPatch: boolean;
  readonly json: boolean;
}

/**
 * One canonical request from the actual project, model, input, result and selected form. `dense` is the
 * rewrite whose canonical IR equality with the verbose lift was proven (none when it was not): the one
 * place that decides whether a dense suggestion exists, for every surface.
 */
export interface LiftRunParams {
  readonly project: ProjectConfig;
  readonly model: EffectModel;
  readonly input: LiftInput;
  readonly result: LiftResult;
  readonly form: LiftForm;
  readonly dense: Option.Option<Collected>;
}

/** The analyzed files plus exact texts the refactors were planned against. */
export interface PatchContext {
  readonly files: ReadonlyArray<SourceFileRecord>;
  readonly texts: ReadonlyMap<string, string>;
  readonly allowImportingTsExtensions: boolean;
}

/** Reads the exact texts the refactors were planned against, as map path → text (only the files they touch). */
export const loadPatchTexts = Effect.fn("lift.loadPatchTexts")(function* (
  refactors: ReadonlyArray<Refactor>,
): Effect.fn.Return<ReadonlyMap<string, string>, CompilerFault, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;

  const entries = yield* Effect.forEach(
    [...new Set(refactors.map((refactor) => refactor.file))].toSorted(),
    (file) =>
      fs.readFileString(file).pipe(
        Effect.map((text): readonly [string, string] => [file, text]),
        Effect.mapError(
          (cause) =>
            new CompilerFault({
              stage: "lift",
              message: `cannot read the analyzed file ${file}`,
              cause,
            }),
        ),
      ),
    { concurrency: 1 },
  );

  return new Map(entries);
});

/** Refuses a `--write` target before any write and returns its canonical path. */
export const refuseWriteTarget = Effect.fn("lift.refuseWriteTarget")(function* (
  target: string,
): Effect.fn.Return<string, LiftUsageError | CompilerFault, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const resolvedTarget = path.resolve(target);

  const exists = yield* fs.exists(resolvedTarget).pipe(
    Effect.mapError(
      (cause) =>
        new CompilerFault({
          stage: "collect",
          message: `cannot stat ${resolvedTarget}: ${cause.message}`,
          cause,
        }),
    ),
  );

  if (exists) {
    return yield* new LiftUsageError({
      message: `${resolvedTarget} exists; --write writes a new file only`,
    });
  }

  const parent = path.dirname(resolvedTarget);

  const parentExists = yield* fs.exists(parent).pipe(
    Effect.mapError(
      (cause) =>
        new CompilerFault({
          stage: "collect",
          message: `cannot stat ${parent}: ${cause.message}`,
          cause,
        }),
    ),
  );

  if (!parentExists) {
    return yield* new LiftUsageError({
      message: `${resolvedTarget}: the containing directory does not exist`,
    });
  }

  return resolvedTarget;
});

/** The exact printer bytes of each requested form; a form that was not requested stays absent. */
export interface LiftSuggestions {
  readonly verbose?: string;
  readonly dense?: string;
}

/** The exact source bytes produced by the shared printer, with failures kept in the error channel. */
export const suggestionSection = (
  collected: Collected,
  input: LiftInput,
  codeReferences: LiftResult["codeReferences"],
): Result.Result<string, string> =>
  printedSuggestion(collected, input.output.module, codeReferences);

/** The verbose text, printed by the one shared printer; none when only the dense form was requested. */
const verboseOf = (run: LiftRunParams): Result.Result<string | undefined, string> =>
  run.form === "dense"
    ? Result.succeed(undefined)
    : suggestionSection(run.result.collected, run.input, run.result.codeReferences);

const denseOf = (run: LiftRunParams): Result.Result<string | undefined, string> => {
  if (run.form === "verbose") return Result.succeed(undefined);

  if (Option.isNone(run.dense))
    return run.form === "dense"
      ? Result.fail("dense suggestion unavailable: canonical IR equality was not proven")
      : Result.succeed(undefined);

  return suggestionSection(run.dense.value, run.input, run.result.codeReferences);
};

type SuggestionsDraft = { -readonly [K in keyof LiftSuggestions]: LiftSuggestions[K] };

/**
 * The suggestions every surface shares. `verbose` and `dense` print one form each; `both` prints the
 * dense form only when its canonical IR equality was proven and otherwise leaves it absent. An explicit
 * `dense` request without a proven dense form is an error, never a silent fallback.
 */
export const suggestionsOf = (run: LiftRunParams): Result.Result<LiftSuggestions, string> =>
  Result.flatMap(verboseOf(run), (verbose) =>
    Result.map(denseOf(run), (dense): LiftSuggestions => {
      const suggestions: SuggestionsDraft = {};

      if (verbose !== undefined) suggestions.verbose = verbose;

      if (dense !== undefined) suggestions.dense = dense;

      return suggestions;
    }),
  );

/** One per-form report rendering with the §4.2 sections in the order the CLI prints. */
export interface LiftReportRendering {
  /** Human report bytes; suggestion snippets remain byte-identical to the printer outputs. */
  readonly text: string;
  /** Exact printer bytes retained for --write, --json and the real overlay check. */
  readonly suggestions: LiftSuggestions;
}

export const renderLiftReport = (
  run: LiftRunParams,
): Result.Result<LiftReportRendering, string> => {
  const { result } = run;
  const printed = suggestionsOf(run);

  if (Result.isFailure(printed)) return Result.fail(printed.failure);

  const suggestions = printed.success;
  const sections: Array<string> = [];

  if (suggestions.verbose !== undefined)
    sections.push(`SUGGESTION (verbose)\n${suggestions.verbose}`);

  if (suggestions.dense !== undefined) sections.push(`SUGGESTION (dense)\n${suggestions.dense}`);
  else if (run.form === "both")
    sections.push(
      "SUGGESTION (dense)\n  unavailable: its canonical IR equality with the verbose form was not proven",
    );

  if (result.refactors.length > 0) {
    sections.push(
      [
        "REFACTORS REQUIRED",
        ...result.refactors.map(
          (refactor) =>
            `  ${refactor.code} ${refactor.subject} ${refactor.file}: ${refactor.cause.message}`,
        ),
      ].join("\n"),
    );
  }

  if (result.decisions.length > 0) {
    sections.push(
      [
        "DECISIONS TO REVIEW",
        ...result.decisions.map((decision) => `  ${decision._tag}: ${decision.subject}`),
      ].join("\n"),
    );
  }

  if (result.adapterPrerequisites.length > 0) {
    sections.push(
      [
        "ADAPTER PREREQUISITES",
        ...result.adapterPrerequisites.map(
          (prerequisite) =>
            `  ${prerequisite.rule} (${prerequisite.role}) ${prerequisite.ref.module}/${prerequisite.ref.export}`,
        ),
      ].join("\n"),
    );
  }

  if (result.unsupported.length > 0) {
    sections.push(
      ["UNLIFTABLE", ...result.unsupported.map((site) => `  ${site.primary.message}`)].join("\n"),
    );
  }

  return Result.succeed({ text: sections.join("\n\n"), suggestions });
};

/** The `--check` section of the report: one line per requested form and the binding gate, never source text. */
export const renderCheckSection = (check: LiftCheckResult): string => {
  const form = (name: "verbose" | "dense"): ReadonlyArray<string> => {
    const outcome = check[name];

    if (outcome === undefined) return [];

    switch (outcome._tag) {
      case "Pass":
        return [
          outcome.deltas.length === 0
            ? `  ${name}: PASS`
            : `  ${name}: PASS(${outcome.deltas.join(", ")})`,
        ];
      case "Mismatch":
        return [`  ${name}: FAIL`, ...outcome.differences.map((difference) => `    ${difference}`)];
      case "Impossible":
        return [`  ${name}: COULD NOT RUN (${outcome.reason}) ${outcome.detail}`];
    }
  };

  const binding = ((): string => {
    switch (check.binding._tag) {
      case "Passed":
        return `  binding: PASSED (keys ${check.binding.keyProof.declared.join(", ") || "none"}; typecheck exit ${check.binding.receipt.exit})`;
      case "Failed":
        return "  binding: FAILED";
      case "Missing":
        return "  binding: MISSING (never accepted without evidence)";
    }
  })();

  return ["CHECK", ...form("verbose"), ...form("dense"), binding].join("\n");
};

/** The diagnostics-only rendering a diagnosed run prints after its own sections (counts are data). */
export const printLiftDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
): ReadonlyArray<string> => [...report(diagnostics, (file) => file), summary(count(diagnostics))];

/** Atomically creates a new suggestion file; `wx` makes overwrites impossible even after preflight. */
export const writeSuggestion = Effect.fn("lift.writeSuggestion")(function* (
  target: string,
  suggestion: string,
): Effect.fn.Return<void, LiftUsageError | CompilerFault, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.writeFileString(target, suggestion, { flag: "wx" }).pipe(
    Effect.mapError((cause) =>
      cause.reason._tag === "AlreadyExists"
        ? new LiftUsageError({ message: `${target} exists; --write writes a new file only` })
        : new CompilerFault({
            stage: "generate",
            message: `cannot write ${target}: ${cause.message}`,
            cause,
          }),
    ),
  );
});

/** Renders the refactors' unified diff, a pure function of a real analyzed text set (never applied). */
export const renderRefactorPatch = Effect.fn("lift.renderRefactorPatch")(function* (
  result: LiftResult,
  context: PatchContext,
): Effect.fn.Return<string, CompilerFault, FileSystem.FileSystem | Crypto.Crypto> {
  return yield* renderPatch({
    refactors: result.refactors,
    files: context.files,
    texts: context.texts,
    allowImportingTsExtensions: context.allowImportingTsExtensions,
  });
});
