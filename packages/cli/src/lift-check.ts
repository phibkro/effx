import { Array as Arr, Crypto, Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import {
  CheckReason,
  CompilerFault,
  Diagnostic,
  LiftDiagnostics,
  LiftFrontend,
  StageResult,
  applyRefactors,
  checkFactsOf,
  compile,
  groupKeysOf,
  hasErrors,
  liftRegistryOf,
  wireCompare,
  type BindingConclusion,
  type CheckFacts,
  type EffectModel,
  type EmitMode,
  type Extension,
  type FormOutcome,
  type GroupKeys,
  type LiftCheckResult,
  type ProjectConfig,
  type SourceFrontend,
} from "@effx/compiler";
import { LiftCheckExecution, LiftToolchain, type CheckChildResult } from "./lift-boundaries.ts";
import { loadPatchTexts, suggestionsOf, type LiftRunParams } from "./lift.ts";
import { makeOverlay, type Overlay } from "./lift-overlay.ts";
import {
  bindingSkeleton,
  readWitnessDocument,
  typecheckFindings,
  witnessProgram,
  type TypecheckFinding,
  type WitnessPlan,
  type WitnessStage,
} from "./lift-witness.ts";

/*
 * The native `--check` pipeline of spec 0019 §2.4 and §7. For each requested form the exact printer bytes
 * are written into a scoped overlay of the owning project, COLLECTED by the real frontend, compiled and
 * generated as a contract, and the resulting contract group is reflected by ONE static witness together
 * with the untouched original group, each alone on a fresh root with the original root's identity. The
 * binding gate compares the original model's complete endpoint key set with the generated group's and
 * typechecks the generated handler factory against the ACTUAL original root. Every inability is data
 * (EFFX3103), a real wire difference is EFFX3101, a binding gap EFFX3201; `CompilerFault` is IO/invariant
 * breakage only. Application modules run only inside the one child, which prints stage names and error
 * names, never messages or values.
 */

type CheckDraft = { -readonly [K in keyof LiftCheckResult]: LiftCheckResult[K] };

/**
 * The explicit execution bounds of one check run (spec 0019 §2.4): the per-pipe capture cap and the
 * forced-stop deadline granted to the witness and to the binding typecheck.
 */
export interface LiftCheckBounds {
  readonly captureBytes: number;
  readonly witnessDeadlineMs: number;
  readonly typecheckDeadlineMs: number;
}

/** Reviewed defaults: a 16 MiB cap per pipe, two minutes for the witness, ten for the typecheck. */
export const defaultLiftCheckBounds: LiftCheckBounds = {
  captureBytes: 16 * 1024 * 1024,
  witnessDeadlineMs: 120_000,
  typecheckDeadlineMs: 600_000,
};

const MAX_TYPECHECK_DIAGNOSTICS = 20;

/** What one check run is asked: the canonical lift request plus the selected extensions it compiles with. */
export interface LiftCheckRequest {
  readonly run: LiftRunParams;
  readonly extensions: ReadonlyArray<Extension>;
  /** Defaults to `defaultLiftCheckBounds`. */
  readonly bounds?: LiftCheckBounds;
}

/** A form that cannot run: data, converted to `FormOutcome.Impossible` at the form boundary. */
class FormUnavailable extends Schema.TaggedError<FormUnavailable>()("FormUnavailable", {
  reason: CheckReason,
  detail: Schema.String,
  related: Schema.Array(Diagnostic),
}) {}

const unavailable = (
  reason: CheckReason,
  detail: string,
  related: ReadonlyArray<Diagnostic> = [],
): FormUnavailable => new FormUnavailable({ reason, detail, related });

const inability = (
  reason: CheckReason,
  detail: string,
  related: ReadonlyArray<Diagnostic> = [],
): Diagnostic =>
  LiftDiagnostics.EFFX3103.emit({ reason, detail }, related.length === 0 ? {} : { related });

const impossible = (error: FormUnavailable): FormOutcome => ({
  _tag: "Impossible",
  reason: error.reason,
  detail: error.detail,
  diagnostics: [inability(error.reason, error.detail, error.related)],
});

const errorsOf = (diagnostics: ReadonlyArray<Diagnostic>): ReadonlyArray<Diagnostic> =>
  diagnostics.filter((diagnostic) => diagnostic.severity === "error");

/** One reported form: its outcome and, when this form carried the binding gate, the binding conclusion. */
interface FormRun {
  readonly outcome: FormOutcome;
  readonly binding: Option.Option<BindingConclusion>;
}

const fileOfModule = (model: EffectModel, module: string): Option.Option<string> =>
  Option.map(
    Option.fromUndefinedOr(model.files.find((file) => file.module === module)),
    (file) => file.file,
  );

type ProjectDraft = { -readonly [K in keyof ProjectConfig]: ProjectConfig[K] };

/** The overlay's compile project for one emit mode; relative entries resolve from its tsconfig directory. */
const overlayProject = (
  path: Path.Path,
  project: ProjectConfig,
  overlay: Overlay,
  emit: EmitMode,
  entry: string,
): ProjectConfig => {
  const draft: ProjectDraft = {
    tsconfigPath: overlay.tsconfigPath,
    entry: [path.relative(path.dirname(overlay.tsconfigPath), entry)],
    outDir: overlay.outDir,
    projectRoot: overlay.projectRoot,
    emit,
  };

  if (project.target !== undefined) draft.target = project.target;

  if (project.strictAccess !== undefined) draft.strictAccess = project.strictAccess;

  if (project.naming !== undefined) draft.naming = project.naming;

  return draft;
};

/** The specifier a file writes to import another: relative, with the extension the project permits. */
const importSpecifier = (
  path: Path.Path,
  from: string,
  to: string,
  allowImportingTsExtensions: boolean,
): string => {
  const relative = path.relative(path.dirname(from), to).split(path.sep).join("/");
  const prefixed = relative.startsWith(".") ? relative : `./${relative}`;

  return allowImportingTsExtensions ? prefixed : prefixed.replace(/\.ts$/u, ".js");
};

const projectionName = (key: {
  readonly module: string;
  readonly export: string;
  readonly member?: string | undefined;
}): string => `${key.module}#${key.export}${key.member === undefined ? "" : `.${key.member}`}`;

/** The registered EFFX3103 reason of a witness stage (spec 0019 §6: overlay, root, projection hook). */
const reasonOf = (stage: WitnessStage): CheckReason =>
  stage === "import-projection" ||
  stage === "projection-original" ||
  stage === "projection-generated"
    ? "projection-hook"
    : "root-build";

/** The child's receipt as an observation: real exit, real duration, never a synthetic zero. */
const describeStop = (receipt: CheckChildResult): string =>
  receipt.exit._tag === "Stopped"
    ? `stopped (${receipt.exit.reason}) after ${receipt.durationMs}ms`
    : `exited with code ${receipt.exit.code}`;

const decodeWitness = (receipt: CheckChildResult) =>
  readWitnessDocument(receipt.stdout).pipe(
    Effect.mapError((error) =>
      unavailable("root-build", `the witness produced no valid document (${error.reason})`),
    ),
  );

/** Reads exactly the texts the refactors were planned against and applies them in memory. */
const patchedFiles = Effect.fnUntraced(function* (run: LiftRunParams) {
  if (run.result.refactors.length === 0) return [];

  const texts = yield* loadPatchTexts(run.result.refactors);

  return yield* applyRefactors({
    refactors: run.result.refactors,
    files: run.model.files,
    texts,
    allowImportingTsExtensions: run.model.project.allowImportingTsExtensions,
  }).pipe(
    Effect.catchTag("CompilerFault", (fault) =>
      Effect.fail(unavailable("overlay-compile", fault.message)),
    ),
  );
});

/** The binding typecheck's structured findings as registered diagnostics, capped and never raw output. */
const findingDiagnostics = (
  findings: ReadonlyArray<TypecheckFinding>,
): ReadonlyArray<Diagnostic> => {
  const shown = findings
    .slice(0, MAX_TYPECHECK_DIAGNOSTICS)
    .map((finding) =>
      LiftDiagnostics.EFFX3103.emit(
        { reason: "overlay-compile", detail: `${finding.code}: ${finding.message}` },
        finding.location === undefined ? {} : { location: finding.location },
      ),
    );

  const omitted = findings.length - shown.length;

  return omitted > 0
    ? [
        ...shown,
        inability("overlay-compile", `${omitted} further TypeScript diagnostics were omitted`),
      ]
    : shown;
};

/**
 * The binding gate for one overlay (spec 0019 §7, §0.8): the ORIGINAL model's complete group key set
 * against the generated group's, then a real typecheck of the generated handler factory against the
 * ACTUAL original root. `Passed` needs both an actual key proof and an executed zero-exit receipt.
 */
const bindingGate = Effect.fnUntraced(function* (
  request: LiftCheckRequest,
  facts: CheckFacts,
  generated: GroupKeys,
  overlay: Overlay,
) {
  const path = yield* Path.Path;
  const { run, extensions } = request;
  const bounds = request.bounds ?? defaultLiftCheckBounds;

  if (facts.unreadableKeys > 0 || generated.unreadableKeys > 0) {
    return {
      _tag: "Missing",
      diagnostics: [
        inability(
          "root-build",
          `group ${facts.groupId} has endpoint keys that are not literals; the key set is not provable`,
        ),
      ],
    } satisfies BindingConclusion;
  }

  const declared = facts.endpointKeys;
  const bound = generated.endpointKeys;
  const missing = declared.filter((key) => !bound.includes(key));
  const extra = bound.filter((key) => !declared.includes(key));
  const keyProof = { declared, bound, missing, extra };

  // The application's own registrations are statically reported by the lift (EFFX3201): carry them verbatim.
  const registered = run.result.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX3201");

  if (missing.length > 0 || extra.length > 0) {
    return {
      _tag: "Failed",
      keyProof,
      diagnostics: [
        LiftDiagnostics.EFFX3201.emit({ group: facts.groupId, missing, extra }),
        ...registered,
      ],
    } satisfies BindingConclusion;
  }

  const handlers = yield* compile(
    overlayProject(path, run.project, overlay, "handlers", overlay.suggestionFile),
    extensions,
  );

  const handlerFiles = Option.getOrUndefined(handlers.files.value);

  if (hasErrors(handlers.diagnostics) || handlerFiles === undefined) {
    return {
      _tag: "Failed",
      keyProof,
      diagnostics: [
        inability(
          "overlay-compile",
          "the handlers pass did not generate a factory for the suggestion",
          errorsOf(handlers.diagnostics),
        ),
        ...registered,
      ],
    } satisfies BindingConclusion;
  }

  const factories = handlerFiles.filter((file) => file.path.endsWith("-handlers.ts"));

  const [factory] = factories;

  if (factory === undefined || factories.length !== 1) {
    return {
      _tag: "Failed",
      keyProof,
      diagnostics: [
        inability(
          "overlay-compile",
          `the handlers pass generated ${factories.length} handler modules for one group`,
        ),
        ...registered,
      ],
    } satisfies BindingConclusion;
  }

  yield* Effect.forEach(
    handlerFiles,
    (file) => overlay.writeFile(path.join(".effx", "generated", file.path), file.contents),
    { discard: true },
  );

  const factoryFile = path.join(overlay.outDir, factory.path);

  const skeletonFile = path.join(overlay.projectRoot, ".effx", "lift-binding.skeleton.ts");

  const skeleton = yield* overlay.writeFile(
    path.relative(overlay.projectRoot, skeletonFile),
    bindingSkeleton({
      handlers: importSpecifier(
        path,
        skeletonFile,
        factoryFile,
        run.model.project.allowImportingTsExtensions,
      ),
      declared,
    }),
  );

  const project = yield* overlay.writeProject("tsconfig.effx-lift-binding.json", [
    factoryFile,
    skeleton,
  ]);

  const toolchain = yield* LiftToolchain;
  const execution = yield* LiftCheckExecution;

  const receipt = yield* execution.runTypecheck({
    binary: toolchain.runtime,
    cwd: overlay.projectRoot,
    args: [toolchain.typescript, "-p", project, "--noEmit", "--pretty", "false"],
    captureBytes: bounds.captureBytes,
    forcedStopMs: bounds.typecheckDeadlineMs,
  });

  if (receipt.exit._tag !== "Exit") {
    return {
      _tag: "Failed",
      keyProof,
      diagnostics: [
        inability("overlay-compile", `the binding typecheck was ${describeStop(receipt)}`),
        ...registered,
      ],
    } satisfies BindingConclusion;
  }

  const executed = {
    stage: "overlay-binding-typecheck" as const,
    exit: receipt.exit.code,
    diagnostics: findingDiagnostics(typecheckFindings(receipt.output)),
  };

  if (receipt.exit.code === 0 && registered.length === 0) {
    return { _tag: "Passed", keyProof, receipt: executed } satisfies BindingConclusion;
  }

  return {
    _tag: "Failed",
    keyProof,
    receipt: executed,
    diagnostics:
      executed.diagnostics.length > 0 || registered.length > 0
        ? [...executed.diagnostics, ...registered]
        : [
            inability(
              "overlay-compile",
              `the binding typecheck exited with code ${receipt.exit.code}`,
            ),
          ],
  } satisfies BindingConclusion;
});

/** The witness stage of one form: mounts the original and the generated group alone and compares them. */
const reflectForm = Effect.fnUntraced(function* (
  request: LiftCheckRequest,
  facts: CheckFacts,
  overlay: Overlay,
  generatedModel: EffectModel,
  generated: GroupKeys,
) {
  const path = yield* Path.Path;
  const { model } = request.run;
  const bounds = request.bounds ?? defaultLiftCheckBounds;

  const original = fileOfModule(model, facts.group.module);

  if (Option.isNone(original)) {
    return yield* unavailable(
      "root-build",
      `the original group module ${facts.group.module} is not part of the analyzed project`,
    );
  }

  const generatedFile = fileOfModule(generatedModel, generated.group.module);

  if (Option.isNone(generatedFile)) {
    return yield* unavailable(
      "overlay-compile",
      `the generated group module ${generated.group.module} was not analyzed`,
    );
  }

  const projections = yield* Effect.forEach(
    request.run.project.lift?.projections ?? [],
    (projection) => {
      const hookFile = fileOfModule(model, projection.hook.module);

      return Option.isNone(hookFile)
        ? Effect.fail(
            unavailable(
              "projection-hook",
              `projection hook module ${projection.hook.module} is not part of the analyzed project`,
            ),
          )
        : Effect.succeed({
            name: projectionName(projection.key),
            hook: {
              file: hookFile.value,
              export: projection.hook.export,
              member: projection.hook.member,
            },
          });
    },
  );

  const plan: WitnessPlan = {
    rootId: facts.rootId,
    original: { file: original.value, export: facts.group.export, member: facts.group.member },
    generated: {
      file: generatedFile.value,
      export: generated.group.export,
      member: generated.group.member,
    },
    projections,
  };

  const witness = yield* overlay.writeFile(
    path.join(".effx", "lift-check.ts"),
    witnessProgram(plan),
  );

  const toolchain = yield* LiftToolchain;
  const execution = yield* LiftCheckExecution;

  const receipt = yield* execution.runChild({
    binary: toolchain.runtime,
    cwd: overlay.projectRoot,
    args: ["--no-env-file", "--no-install", witness],
    captureBytes: bounds.captureBytes,
    forcedStopMs: bounds.witnessDeadlineMs,
  });

  if (receipt.exit._tag !== "Exit" || receipt.exit.code !== 0) {
    return yield* unavailable("root-build", `the witness ${describeStop(receipt)}`);
  }

  if (receipt.stdoutTruncated) {
    return yield* unavailable("root-build", "the witness output exceeded its capture bound");
  }

  const document = yield* decodeWitness(receipt);

  if (document._tag === "Failed") {
    return yield* unavailable(reasonOf(document.stage), `${document.stage}: ${document.cause}`);
  }

  const compared = wireCompare(document.pair.original, document.pair.generated);

  const outcome: FormOutcome =
    compared._tag === "Pass"
      ? { _tag: "Pass", reflections: document.pair, deltas: compared.applied }
      : { _tag: "Mismatch", reflections: document.pair, differences: compared.differences };

  return outcome;
});

/** One form: scoped overlay, real COLLECT/compile/generate, one witness child, mechanical comparison. */
const checkForm = Effect.fnUntraced(function* (
  request: LiftCheckRequest,
  facts: CheckFacts,
  text: string,
  withBinding: boolean,
) {
  const path = yield* Path.Path;
  const { run, extensions } = request;
  const { model } = run;

  const projectRoot = path.dirname(path.dirname(model.project.canonicalImportBase));

  const patched = yield* patchedFiles(run);

  const suggestionFile = path.resolve(
    model.project.canonicalImportBase,
    `${run.input.output.module}.ts`,
  );

  const overlay = yield* makeOverlay({
    projectRoot,
    tsconfigPath: run.project.tsconfigPath,
    patched,
    suggestion: { file: suggestionFile, contents: text },
  }).pipe(
    Effect.catchTag("OverlayUnavailable", (error) =>
      Effect.fail(unavailable("overlay-compile", error.detail)),
    ),
  );

  // COLLECT (L5), compile and generate the contract from the PRINTED text, never from the in-memory lift.
  const contract = yield* compile(
    overlayProject(path, run.project, overlay, "contract", overlay.suggestionFile),
    extensions,
  );

  const contractFiles = Option.getOrUndefined(contract.files.value);

  if (hasErrors(contract.diagnostics) || contractFiles === undefined) {
    return yield* unavailable(
      "overlay-compile",
      "the printed suggestion does not compile to a contract",
      errorsOf(contract.diagnostics),
    );
  }

  const contracts = contractFiles.filter((file) => file.path.endsWith("-contract.ts"));

  const [onlyContract] = contracts;

  if (onlyContract === undefined || contracts.length !== 1) {
    return yield* unavailable(
      "overlay-compile",
      `the contract pass generated ${contracts.length} contract modules for one group`,
    );
  }

  yield* Effect.forEach(
    contractFiles,
    (file) => overlay.writeFile(path.join(".effx", "generated", file.path), file.contents),
    { discard: true },
  );

  // The ACTUAL generated group export, read by the same frontend that reads every other group.
  const frontend = yield* LiftFrontend;
  const contractFile = path.join(overlay.outDir, onlyContract.path);

  const analyzed = yield* frontend.analyze(
    overlayProject(path, run.project, overlay, "contract", contractFile),
  );

  const generatedModel = Option.getOrUndefined(analyzed.value);

  if (generatedModel === undefined) {
    return yield* unavailable(
      "overlay-compile",
      "the generated contract could not be analyzed",
      errorsOf(analyzed.diagnostics),
    );
  }

  // The analyzed program also holds the original group the contract imports its schemas from, so the
  // contract's own module, not the group id alone, selects the generated group.
  const contractModule = Arr.findFirst(generatedModel.files, (file) => file.file === contractFile);

  if (Option.isNone(contractModule)) {
    return yield* unavailable(
      "overlay-compile",
      "the generated contract is not part of its own analysis",
    );
  }

  const generated = groupKeysOf(generatedModel, facts.groupId, contractModule.value.module);

  if (Option.isNone(generated)) {
    return yield* unavailable(
      "overlay-compile",
      `the generated contract does not declare exactly one group ${facts.groupId}`,
    );
  }

  // A witness failure is this form's outcome; the binding gate stays independent evidence either way.
  const outcome = yield* reflectForm(request, facts, overlay, generatedModel, generated.value).pipe(
    Effect.catchTag("FormUnavailable", (error) => Effect.succeed(impossible(error))),
  );

  const binding = withBinding
    ? Option.some(yield* bindingGate(request, facts, generated.value, overlay))
    : Option.none<BindingConclusion>();

  return { outcome, binding } satisfies FormRun;
});

const diagnosticsOf = (group: string, check: LiftCheckResult): ReadonlyArray<Diagnostic> => {
  const form = (name: "verbose" | "dense"): ReadonlyArray<Diagnostic> => {
    const outcome = check[name];

    if (outcome === undefined) return [];

    switch (outcome._tag) {
      case "Pass":
        return [LiftDiagnostics.EFFX3102.emit({ group, applied: outcome.deltas })];
      case "Mismatch":
        return outcome.differences.map((difference) =>
          LiftDiagnostics.EFFX3101.emit({ group, difference }),
        );
      case "Impossible":
        return outcome.diagnostics;
    }
  };

  return [
    ...form("verbose"),
    ...form("dense"),
    ...(check.binding._tag === "Passed" ? [] : check.binding.diagnostics),
  ];
};

/**
 * Runs the check for every requested form. The result always carries the report; whether it PASSED is
 * derived by `liftCheckPassed` from the outcomes alone. `skip` only when the group cannot be selected or
 * the shared printer produced no suggestion, because then there is nothing to check.
 */
export const runLiftCheck = Effect.fn("lift.check")(function* (
  request: LiftCheckRequest,
): Effect.fn.Return<
  StageResult<LiftCheckResult>,
  CompilerFault,
  | FileSystem.FileSystem
  | Path.Path
  | Crypto.Crypto
  | LiftFrontend
  | LiftCheckExecution
  | LiftToolchain
  | SourceFrontend
> {
  const { run, extensions } = request;
  const facts = checkFactsOf(run.model, run.input, liftRegistryOf(extensions));

  if (Option.isNone(facts)) {
    return StageResult.skip([
      inability(
        "root-build",
        `group ${run.input.group} could not be selected from the analyzed project`,
      ),
    ]);
  }

  const printed = suggestionsOf(run);

  if (Result.isFailure(printed)) {
    return StageResult.skip([inability("overlay-compile", printed.failure)]);
  }

  const forms = Arr.getSomes([
    Option.fromUndefinedOr(printed.success.verbose).pipe(
      Option.map((text) => ["verbose", text] as const),
    ),
    Option.fromUndefinedOr(printed.success.dense).pipe(
      Option.map((text) => ["dense", text] as const),
    ),
  ]);

  let verbose: FormOutcome | undefined;

  let dense: FormOutcome | undefined;

  let binding = Option.none<BindingConclusion>();

  for (const [name, text] of forms) {
    const form = yield* Effect.scoped(
      checkForm(request, facts.value, text, Option.isNone(binding)),
    ).pipe(
      Effect.catchTag("FormUnavailable", (error) =>
        Effect.succeed({ outcome: impossible(error), binding: Option.none<BindingConclusion>() }),
      ),
    );

    if (name === "verbose") verbose = form.outcome;
    else dense = form.outcome;

    if (Option.isNone(binding)) binding = form.binding;
  }

  const result: CheckDraft = {
    group: facts.value.groupId,
    binding: Option.getOrElse(binding, (): BindingConclusion => ({
      _tag: "Missing",
      diagnostics: [
        inability(
          "overlay-compile",
          "no requested form produced a generated contract, so no binding evidence exists",
        ),
      ],
    })),
  };

  if (verbose !== undefined) result.verbose = verbose;

  if (dense !== undefined) result.dense = dense;

  return StageResult.succeed(result, diagnosticsOf(facts.value.groupId, result));
});

/** `--check` passes only when every requested form passed and the binding gate holds (spec 0019 §2.2). */
export const liftCheckPassed = (check: LiftCheckResult): boolean =>
  check.binding._tag === "Passed" &&
  (check.verbose !== undefined || check.dense !== undefined) &&
  [check.verbose, check.dense].every((outcome) => outcome === undefined || outcome._tag === "Pass");
