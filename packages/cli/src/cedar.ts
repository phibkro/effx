import { Effect, FileSystem, Option, Path } from "effect";
import {
  CompilerFault,
  CoreDiagnostics,
  type Diagnostic,
  cedarOf,
  hasErrors,
} from "@effx/compiler";
import { semanticHash } from "@effx/ir";
import { CheckFailed, type Project, compileAndReport } from "./commands.ts";
import { CEDAR_WASM_VERSION, type CedarIssue, CedarValidator } from "./cedar-validate.ts";
import { count, report, summary } from "./report.ts";
import { printLines, printOut } from "./output.ts";

/*
 * Spec 0017 §4: `effx cedar` projects the IR's authorization facts to `.effx/cedar/` and validates
 * them with the real Cedar validator. It is separate from `build`: nothing here is reachable from
 * `check` or `build`, and no file outside the Cedar output directory is written.
 */

export const CEDAR_SCHEMA_FILE = "schema.cedarschema";

export const CEDAR_POLICIES_FILE = "policies.cedar";

export interface CedarCommandOptions {
  readonly namespace: string;
  /** Application-authored policy files, validated against the emitted schema. */
  readonly policies: ReadonlyArray<string>;
  readonly denyWarnings: boolean;
  /** The output directory as given on the command line; defaults to `<tsconfig dir>/.effx/cedar`. */
  readonly outDir: string | undefined;
}

const issueParams = (
  file: string,
  issue: CedarIssue,
): Parameters<typeof CoreDiagnostics.EFFX4102.emit>[0] => {
  if (issue.policyId === undefined) {
    return issue.help === undefined
      ? { _tag: "File", file, validatorMessage: issue.message }
      : { _tag: "FileHelp", file, validatorMessage: issue.message, help: issue.help };
  }

  return issue.help === undefined
    ? { _tag: "Policy", file, policyId: issue.policyId, validatorMessage: issue.message }
    : {
        _tag: "PolicyHelp",
        file,
        policyId: issue.policyId,
        validatorMessage: issue.message,
        help: issue.help,
      };
};

export const cedarCommand = Effect.fn("cedar")(function* (
  project: Project,
  options: CedarCommandOptions,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const validator = yield* CedarValidator;
  const result = yield* compileAndReport(project);

  // Pipeline errors fail first, exactly as `check` does (they were already printed).
  if (hasErrors(result.diagnostics)) {
    return yield* new CheckFailed({ errors: count(result.diagnostics).errors });
  }

  // After the pipeline succeeded every stage produced a value; absence is an invariant breach.
  const ir = Option.getOrThrow(result.ir.value);
  const index = Option.getOrThrow(result.index);

  const projection = cedarOf(ir, index, yield* semanticHash(ir), {
    namespace: options.namespace,
  });

  const diagnostics: Array<Diagnostic> = [...projection.diagnostics];
  const cwd = path.resolve();

  const relative = (file: string): string => {
    const location = path.relative(cwd, file);

    return location === ".." || location.startsWith(`..${path.sep}`) ? file : location;
  };

  const finish = Effect.fnUntraced(function* (note: string) {
    const counts = count(diagnostics);

    yield* printLines("stdout", [...report(diagnostics, relative), summary(counts)]);

    if (counts.errors > 0 || (options.denyWarnings && counts.warnings > 0)) {
      return yield* new CheckFailed({ errors: counts.errors + counts.warnings });
    }

    yield* printOut(note);
  });

  if (Option.isNone(projection.files)) {
    return yield* finish("cedar: nothing written");
  }

  const files = projection.files.value;
  const emitted = yield* validator.validate(files.schema, files.policies);

  // The emitted text is effx's own output: Cedar rejecting it is a projection bug, not a user error.
  if (emitted.errors.length > 0 || emitted.warnings.length > 0) {
    return yield* new CompilerFault({
      stage: "cedar",
      message: `effx emitted Cedar text that the validator reports on (invariant breach): ${[
        ...emitted.errors,
        ...emitted.warnings,
      ]
        .map((issue) => CoreDiagnostics.EFFX4102.emit(issueParams("emitted", issue)).message)
        .join("; ")}`,
    });
  }

  for (const file of options.policies) {
    const text = yield* fs.readFileString(path.resolve(file)).pipe(
      Effect.mapError(
        (cause) =>
          new CompilerFault({
            stage: "cedar",
            message: `cannot read the --policies file ${file}`,
            cause,
          }),
      ),
    );

    const verdict = yield* validator.validate(files.schema, text);

    for (const issue of verdict.errors)
      diagnostics.push(CoreDiagnostics.EFFX4102.emit(issueParams(file, issue)));

    for (const issue of verdict.warnings) {
      diagnostics.push(CoreDiagnostics.EFFX4106.emit(issueParams(file, issue)));
    }
  }

  const outDir =
    options.outDir === undefined
      ? path.join(project.effxDir, "cedar")
      : path.resolve(options.outDir);

  yield* fs.makeDirectory(outDir, { recursive: true });
  yield* fs.writeFileString(path.join(outDir, CEDAR_SCHEMA_FILE), files.schema);
  yield* fs.writeFileString(path.join(outDir, CEDAR_POLICIES_FILE), files.policies);

  return yield* finish(
    `wrote ${relative(outDir)}/{${CEDAR_SCHEMA_FILE}, ${CEDAR_POLICIES_FILE}}; validated by cedar-wasm ${CEDAR_WASM_VERSION}`,
  );
});
