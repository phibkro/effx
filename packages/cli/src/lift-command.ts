import {
  Crypto,
  Effect,
  FileSystem,
  Option,
  Path,
  Result,
  Runtime,
  Schema,
  Stdio,
  Stream,
} from "effect";
import {
  CompilerFault,
  Diagnostic,
  LiftFrontend,
  hasErrors,
  lift,
  liftRegistryOf,
  type Collected,
  type LiftInput,
  type SourceFrontend,
} from "@effx/compiler";
import type { Project } from "./commands.ts";
import type { LiftCheckExecution, LiftToolchain } from "./lift-boundaries.ts";
import { liftCheckPassed, runLiftCheck } from "./lift-check.ts";
import { provenDense } from "./lift-suggest.ts";
import {
  LiftUsageError,
  encodeLiftJsonReport,
  loadPatchTexts,
  printLiftDiagnostics,
  refuseWriteTarget,
  renderCheckSection,
  renderLiftReport,
  renderRefactorPatch,
  writeSuggestion,
  type LiftForm,
  type LiftJsonReport,
  type LiftRunParams,
} from "./lift.ts";

/*
 * `effx lift` (spec 0019 §4.1): analyze the selected project with the production lift frontend, run the
 * pure core with the registry of the SELECTED extensions, and print one report. Static by default: no
 * application module runs and no file is written. `--check` executes the untouched original module and the
 * generated module in the one native child; `--write <file>` creates a NEW file (never overwrites);
 * `--emit-patch` prints the refactors' unified diff and applies nothing; `--json` prints the same report as
 * one Schema-encoded document.
 *
 * Exit codes: 0 = lifted (and, with `--check`, every requested form passed and the binding gate held);
 * 1 = usage error, or the analysis/lift reported error diagnostics; 2 = `--check` ran or could not run and
 * did not pass.
 */

/** The process exit code of a finished command; the report has already been printed. */
export class LiftExit extends Schema.TaggedError<LiftExit>()("LiftExit", { code: Schema.Int }) {
  override readonly [Runtime.errorReported] = false;

  override get [Runtime.errorExitCode]() {
    return this.code;
  }
}

/**
 * One line on a standard stream through the process root's `Stdio` service. Its sink completes only after the
 * stream accepted the bytes, so a report larger than the pipe buffer reaches a slow reader before the exit
 * code is raised; a global `console.log` drops what a full non-blocking descriptor refuses (observed: a
 * 289 KB report cut at the 256 KiB the socket held, exit code 1).
 */
const printLine = (stream: "stdout" | "stderr", text: string) =>
  Effect.flatMap(Stdio.Stdio, (stdio) =>
    Stream.make(`${text}\n`).pipe(
      Stream.run(
        stream === "stdout"
          ? stdio.stdout({ endOnDone: false })
          : stdio.stderr({ endOnDone: false }),
      ),
    ),
  ).pipe(
    Effect.mapError(
      (cause) => new CompilerFault({ stage: "lift", message: `cannot write to ${stream}`, cause }),
    ),
  );

/** The project could not be analyzed at all: its diagnostics are the only report. */
export class LiftAnalysisFailed extends Schema.TaggedError<LiftAnalysisFailed>()(
  "LiftAnalysisFailed",
  { diagnostics: Schema.Array(Diagnostic) },
) {}

/** What one lift is asked to lift. */
export interface LiftSelection {
  readonly group: string;
  /** The suggestion file: its module key is derived from this path. Defaults to the config's output module. */
  readonly module: Option.Option<string>;
  readonly form: LiftForm;
}

/** The flags of `effx lift`; every one is explicit and none reads the environment. */
export interface LiftCommandOptions extends LiftSelection {
  readonly check: boolean;
  readonly emitPatch: boolean;
  readonly write: Option.Option<string>;
  readonly json: boolean;
}

/** The canonical request plus the analysis diagnostics that belong to every surface of the report. */
export interface PreparedLift {
  readonly analysis: ReadonlyArray<Diagnostic>;
  readonly run: LiftRunParams;
}

type InputDraft = { -readonly [K in keyof LiftInput]: LiftInput[K] };

type ReportDraft = { -readonly [K in keyof LiftJsonReport]: LiftJsonReport[K] };

/** The extensionless module key of a suggestion file, relative to the model's canonical import base. */
const moduleKeyOf = (path: Path.Path, base: string, file: string): string =>
  path
    .relative(base, path.resolve(file))
    .split(path.sep)
    .join("/")
    .replace(/\.[cm]?tsx?$/u, "");

/**
 * Analyzes the selected project and lifts one group with the registry of the SELECTED extensions. The one
 * place that builds the canonical request every surface (stdout, `--write`, `--json`, `--check`) shares.
 */
export const prepareLift = Effect.fn("lift.prepare")(function* (
  project: Project,
  selection: LiftSelection,
): Effect.fn.Return<
  PreparedLift,
  LiftAnalysisFailed | LiftUsageError | CompilerFault,
  Path.Path | LiftFrontend
> {
  const path = yield* Path.Path;
  const frontend = yield* LiftFrontend;
  const analyzed = yield* frontend.analyze(project.config);
  const model = Option.getOrUndefined(analyzed.value);

  if (model === undefined)
    return yield* new LiftAnalysisFailed({ diagnostics: analyzed.diagnostics });

  const configured = project.config.lift;

  const outputModule = Option.match(selection.module, {
    onNone: () => configured?.output.module,
    onSome: (file) => moduleKeyOf(path, model.project.canonicalImportBase, file),
  });

  if (outputModule === undefined) {
    return yield* new LiftUsageError({
      message: "--module is required: the config declares no lift output module",
    });
  }

  const input: InputDraft = {
    group: selection.group,
    rules: configured?.rules ?? [],
    names: configured?.names ?? {},
    output: { module: outputModule },
  };

  if (configured?.emptyInput !== undefined) input.emptyInput = configured.emptyInput;

  const result = lift(model, input, liftRegistryOf(project.extensions));

  const dense: Option.Option<Collected> =
    selection.form === "verbose" || result.collected.declarations.length === 0
      ? Option.none()
      : yield* provenDense(result.collected, project.extensions);

  return {
    analysis: analyzed.diagnostics,
    run: { project: project.config, model, input, result, form: selection.form, dense },
  };
});

/** Runs `effx lift`; every outcome after the usage preflight has been printed before the exit code is raised. */
export const liftCommand = Effect.fn("lift")(function* (
  project: Project,
  options: LiftCommandOptions,
): Effect.fn.Return<
  void,
  CompilerFault | LiftExit,
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | Stdio.Stdio
  | LiftFrontend
  | LiftCheckExecution
  | LiftToolchain
  | SourceFrontend
> {
  const exit = (code: number) => Effect.fail(new LiftExit({ code }));

  const usage = (message: string) =>
    Effect.flatMap(printLine("stderr", `error: ${message}`), () => exit(1));

  if (Option.isSome(options.write) && options.form === "both") {
    return yield* usage("--write writes one file: choose --form verbose or --form dense");
  }

  // Preflight before any analysis: an existing target is refused and left byte-for-byte untouched.
  const target = yield* Option.match(options.write, {
    onNone: () => Effect.succeed(Option.none<string>()),
    onSome: (file) =>
      refuseWriteTarget(file).pipe(
        Effect.asSome,
        Effect.catchTag("LiftUsageError", (error) => usage(error.message)),
      ),
  });

  const { analysis, run } = yield* prepareLift(project, options).pipe(
    Effect.catchTags({
      LiftAnalysisFailed: (error) =>
        Effect.flatMap(
          Effect.forEach(
            printLiftDiagnostics(error.diagnostics),
            (line) => printLine("stderr", line),
            { discard: true },
          ),
          () => exit(1),
        ),
      LiftUsageError: (error) => usage(error.message),
    }),
  );

  const { result, model } = run;

  const rendering = renderLiftReport(run);

  if (Result.isFailure(rendering)) {
    for (const line of printLiftDiagnostics([...analysis, ...result.diagnostics]))
      yield* printLine("stderr", line);

    return yield* usage(rendering.failure);
  }

  const { text, suggestions } = rendering.success;

  const checked = options.check
    ? yield* runLiftCheck({ run, extensions: project.extensions })
    : undefined;

  const check = checked === undefined ? undefined : Option.getOrUndefined(checked.value);

  const patch = options.emitPatch
    ? yield* renderRefactorPatch(result, {
        files: model.files,
        texts: yield* loadPatchTexts(result.refactors),
        allowImportingTsExtensions: model.project.allowImportingTsExtensions,
      })
    : "";

  const liftDiagnostics: ReadonlyArray<Diagnostic> = [...analysis, ...result.diagnostics];

  const diagnostics: ReadonlyArray<Diagnostic> = [
    ...liftDiagnostics,
    ...(checked?.diagnostics ?? []),
  ];

  const passed = !options.check || (check !== undefined && liftCheckPassed(check));

  const code = !passed ? 2 : hasErrors(liftDiagnostics) ? 1 : 0;

  if (options.json) {
    const report: ReportDraft = {
      form: options.form,
      result,
      diagnostics,
      suggestions: [suggestions.verbose, suggestions.dense].filter((text) => text !== undefined),
      patch,
    };

    if (check !== undefined) report.check = check;

    const encoded = encodeLiftJsonReport(report);

    if (Result.isFailure(encoded)) {
      return yield* new CompilerFault({
        stage: "lift",
        message: "the lift report does not encode as its own schema",
        cause: encoded.failure,
      });
    }

    yield* printLine("stdout", encoded.success);
  } else {
    yield* printLine("stdout", text);

    if (patch !== "") yield* printLine("stdout", `REFACTOR PATCH\n${patch}`);

    if (check !== undefined) yield* printLine("stdout", renderCheckSection(check));

    for (const line of printLiftDiagnostics(diagnostics)) yield* printLine("stdout", line);
  }

  if (Option.isSome(target)) {
    const written = options.form === "dense" ? suggestions.dense : suggestions.verbose;

    if (written === undefined) return yield* usage("there is no suggestion to write");

    yield* writeSuggestion(target.value, written).pipe(
      Effect.catchTag("LiftUsageError", (error) => usage(error.message)),
    );
  }

  if (code !== 0) return yield* exit(code);
});
