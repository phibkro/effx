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
  type SourceFileRecord,
} from "@effx/compiler";
import { denseSuggestion, printedSuggestion } from "./lift-suggest.ts";
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

/** One canonical request from the actual project/model/input/result and selected form. */
export interface LiftRunParams {
  readonly project: ProjectConfig;
  readonly model: EffectModel;
  readonly input: LiftInput;
  readonly result: LiftResult;
  readonly form: LiftForm;
}

/** The analyzed files plus exact texts the refactors were planned against. */
export interface PatchContext {
  readonly files: ReadonlyArray<SourceFileRecord>;
  readonly texts: ReadonlyMap<string, string>;
  readonly allowImportingTsExtensions: boolean;
}

/** One truthful output receipt; JSON is derived from its schema-backed report. */
export interface LiftRunReceipt {
  readonly exitCode: 0 | 1 | 2;
  readonly rendering: LiftReportRendering;
  readonly report: LiftJsonReport;
}

/** Reads the exact analyze-time texts the refactors were planned against, as map path → text. */
export const loadPatchTexts = Effect.fn("lift.loadPatchTexts")(function* (
  model: EffectModel,
): Effect.fn.Return<ReadonlyMap<string, string>, CompilerFault, FileSystem.FileSystem> {
  const fs = yield* FileSystem.FileSystem;

  const entries = yield* Effect.forEach(
    model.files,
    (file) =>
      fs.readFileString(file.file).pipe(
        Effect.map((text): readonly [string, string] => [file.file, text]),
        Effect.mapError(
          (cause) =>
            new CompilerFault({
              stage: "lift",
              message: `cannot read the analyzed file ${file.file}`,
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

/** The exact source bytes produced by the shared printer, with failures kept in the error channel. */
export const suggestionSection = (
  collected: Collected,
  input: LiftInput,
  codeReferences: LiftResult["codeReferences"],
): Result.Result<string, string> =>
  printedSuggestion(collected, input.output.module, codeReferences);

/** One per-form report rendering with the §4.2 sections in the order the CLI prints. */
export interface LiftReportRendering {
  /** Human report bytes; suggestion snippets remain byte-identical to the printer outputs. */
  readonly text: string;
  /** Exact printer bytes retained for --write, --json and the real overlay check. */
  readonly suggestions: ReadonlyArray<string>;
}

export const renderLiftReport = (
  run: LiftRunParams,
): Result.Result<LiftReportRendering, string> => {
  const { result, input, form } = run;
  const sections: Array<string> = [];
  const suggestions: Array<string> = [];

  if (form !== "dense") {
    const verbose = suggestionSection(result.collected, input, result.codeReferences);

    if (Result.isFailure(verbose)) return Result.fail(verbose.failure);

    suggestions.push(verbose.success);
    sections.push(`SUGGESTION (verbose)\n${verbose.success}`);
  }

  if (form !== "verbose") {
    const dense = denseSuggestion(result.collected);

    if (!Option.isSome(dense)) {
      return Result.fail("dense suggestion unavailable: canonical IR equality was not proven");
    }

    const denseText = suggestionSection(dense.value, input, result.codeReferences);

    if (Result.isFailure(denseText)) return Result.fail(denseText.failure);

    suggestions.push(denseText.success);
    sections.push(`SUGGESTION (dense)\n${denseText.success}`);
  }

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
