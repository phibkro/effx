import { Effect, FileSystem, Option, Path, Result, Schema } from "effect";
import {
  CompilerFault,
  DomainDiagnostics,
  type Diagnostic,
  type GeneratedFile,
} from "@effx/compiler";
import {
  AlloyReceiptJson,
  AlloySymbols,
  ConformanceVectorsJson,
  alloyBasename,
  alloyStaticBasename,
  receiptCommandMatches,
  snapshotsFromSolutions,
  vectorsFromReceipt,
  type AlloyReceipt,
  type VectorSnapshot,
} from "@effx/domain-model";
import { AlloyExecution } from "./alloy-boundary.ts";
import {
  acquireBuildOutput,
  CheckFailed,
  compileAndReport,
  failOnErrors,
  type Project,
} from "./commands.ts";
import { canonicalOutputPath } from "./output-owner.ts";
import { printLines, printOut } from "./output.ts";
import { count, report, summary } from "./report.ts";

const decodeSymbols = Schema.decodeUnknownEffect(Schema.fromJsonString(AlloySymbols));

const decodeReceipt = Schema.decodeUnknownEffect(AlloyReceiptJson);

const encodeVectors = Schema.encodeEffect(ConformanceVectorsJson);

const metadataPrefix = "// effx-model-metadata ";

const checks = [
  { name: "A7_TimeMonotonic", diagnostic: DomainDiagnostics.EFFX4312 },
  { name: "A2_NonterminalExit", diagnostic: DomainDiagnostics.EFFX4306 },
  { name: "A3_CommandGrant", diagnostic: DomainDiagnostics.EFFX4307 },
  { name: "A4_AdminSelfChange", diagnostic: DomainDiagnostics.EFFX4308 },
  { name: "A5_EndedMembership", diagnostic: DomainDiagnostics.EFFX4309 },
  { name: "A6_SystemJob", diagnostic: DomainDiagnostics.EFFX4310 },
] as const;

const describeCounterexample = (snapshot: VectorSnapshot, symbols: AlloySymbols): string => {
  const principals = snapshot.principals.map(
    (principal) =>
      `${principal.id}:${principal.kind}${principal.job === undefined ? "" : `(${principal.job})`}${principal.admin ? "/Admin" : ""}`,
  );

  const memberships = snapshot.memberships.map(
    (membership) =>
      `${membership.id}(person=${membership.person},team=${membership.team},position=${membership.position},active=${membership.active})`,
  );

  const teams = snapshot.teams.map(
    (team) => `${team.id}(function=${team.function},department=${team.department})`,
  );

  const allows = snapshot.allows.map(
    (entry) => `${entry.principal}:${entry.permission}@${entry.target}`,
  );

  const states = snapshot.machineStates.map(
    (state) => `${state.machine}:${state.id}:${state.state}`,
  );

  const declaredStates = symbols.machines.flatMap((machine) =>
    machine.states.map((state) => `${machine.name}:${state.name}`),
  );

  const targets = snapshot.targets.map(
    (target) =>
      `${target.id}(owner=${target.owner ?? "none"},department=${target.department ?? "none"})`,
  );

  const commands = symbols.permissions.flatMap((permission) =>
    permission.kind === "Command" ? [permission.name] : [],
  );

  return `principals=[${principals.join(", ")}]; memberships=[${memberships.join(", ")}]; teams=[${teams.join(", ")}]; targets=[${targets.join(", ")}]; commands=[${commands.join(", ")}]; allowed=[${allows.join(", ")}]; states=[${states.join(", ")}]; declaredStates=[${declaredStates.join(", ")}]`;
};

const reportFailure = Effect.fnUntraced(function* (
  diagnostics: ReadonlyArray<Diagnostic>,
  lines: ReadonlyArray<string>,
) {
  const counts = count(diagnostics);
  yield* printLines("stdout", [...lines, ...report(diagnostics, (file) => file), summary(counts)]);

  if (counts.errors > 0) return yield* new CheckFailed({ errors: counts.errors });
});

const modelError = (domain: string, detail: string, scope = 1, steps = 1): Diagnostic =>
  DomainDiagnostics.EFFX4304.emit({ domain, detail, scope, steps });

const readReceipt = Effect.fnUntraced(function* (directory: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = yield* Effect.result(fs.readFileString(path.join(directory, "receipt.json")));

  if (Result.isFailure(file)) return Result.fail("missing Alloy receipt: " + file.failure.message);
  const decoded = yield* Effect.result(decodeReceipt(file.success));

  return Result.isFailure(decoded)
    ? Result.fail("malformed Alloy receipt: " + decoded.failure.message)
    : Result.succeed(decoded.success);
});

const checkReachability = (receipt: AlloyReceipt, symbols: AlloySymbols) => {
  const diagnostics: Array<Diagnostic> = [];
  const lines: Array<string> = [];

  for (const [machineIndex, machine] of symbols.machines.entries()) {
    for (const [stateIndex, state] of machine.states.slice(1).entries()) {
      const name = `Reach${machineIndex}_${stateIndex}`;
      const command = receipt.commands[name];

      if (command === undefined || !receiptCommandMatches(command, name, symbols, "temporal-run")) {
        diagnostics.push(
          modelError(
            symbols.domain,
            `missing or invalid reachability ${name}`,
            symbols.scope,
            symbols.steps,
          ),
        );
        continue;
      }

      if (command.solution === undefined || command.solution.length === 0) {
        diagnostics.push(
          DomainDiagnostics.EFFX4305.emit({
            domain: symbols.domain,
            detail: `${machine.name}:${state.name} not reached within ${symbols.steps} steps at scope ${symbols.scope}; bounds=[${symbols.scopeParts.join(", ")}]`,
            scope: symbols.scope,
            steps: symbols.steps,
          }),
        );
      } else {
        lines.push(
          `${symbols.domain} A1_Reachability ${machine.name}:${state.name} PASS (scope ${symbols.scope}, steps ${symbols.steps}, ${symbols.scopeParts.join(", ")})`,
        );
      }
    }
  }

  return { diagnostics, lines };
};

const checkReceipt = (receipt: AlloyReceipt, symbols: AlloySymbols) => {
  const diagnostics: Array<Diagnostic> = [];
  const lines: Array<string> = [];

  for (const check of checks) {
    if (
      (check.name === "A4_AdminSelfChange" && !symbols.adminApplicable) ||
      (check.name === "A5_EndedMembership" && symbols.memberships === null) ||
      (check.name === "A7_TimeMonotonic" && symbols.clock === null)
    ) {
      lines.push(
        `${symbols.domain} ${check.name} NOT APPLICABLE (scope ${symbols.scope}, steps ${symbols.steps}, ${symbols.scopeParts.join(", ")})`,
      );
      continue;
    }

    const command = receipt.commands[check.name];

    if (command === undefined || !receiptCommandMatches(command, check.name, symbols, "check")) {
      diagnostics.push(
        modelError(
          symbols.domain,
          `missing or invalid check ${check.name}`,
          symbols.scope,
          symbols.steps,
        ),
      );
      continue;
    }

    const solutions = command.solution ?? [];

    if (solutions.length === 0) {
      lines.push(
        `${symbols.domain} ${check.name} PASS (scope ${symbols.scope}, steps ${symbols.steps}, ${symbols.scopeParts.join(", ")})`,
      );
      continue;
    }

    const vectors = snapshotsFromSolutions(solutions, symbols);

    if (Result.isFailure(vectors) || vectors.success.length === 0) {
      diagnostics.push(
        modelError(
          symbols.domain,
          `malformed ${check.name} counterexample: ${Result.isFailure(vectors) ? vectors.failure : "empty instance"}`,
          symbols.scope,
          symbols.steps,
        ),
      );
      continue;
    }

    diagnostics.push(
      check.diagnostic.emit({
        domain: symbols.domain,
        detail: `${describeCounterexample(vectors.success[0]!, symbols)}; bounds=[${symbols.scopeParts.join(", ")}]`,
        scope: symbols.scope,
        steps: symbols.steps,
      }),
    );
  }

  return { diagnostics, lines };
};

interface AcceptedModel {
  readonly symbols: AlloySymbols;
  readonly temporal: GeneratedFile;
  readonly staticModel: GeneratedFile;
  readonly temporalPath: string;
  readonly staticPath: string;
}

/** Check current generated files, then enumerate static instances using the same declarations. */
export const modelsCheck = Effect.fn("modelsCheck")(function* (project: Project) {
  if (project.config.models?.alloy !== true) {
    yield* printOut("alloy models disabled; no files written and no tool started");

    return;
  }

  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const result = yield* failOnErrors(yield* compileAndReport(project));

  const files = Option.getOrThrow(result.files.value).filter(
    (file) =>
      file.destination === "model" && file.path.startsWith("alloy/") && file.path.endsWith(".als"),
  );

  const primary = files.filter((file) => !file.path.endsWith(".static.als"));

  if (primary.length === 0) {
    yield* printOut("alloy: no generated domain models");

    return;
  }

  const diagnostics: Array<Diagnostic> = [];
  const lines: Array<string> = [];
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* acquireBuildOutput(project, result);
      const effxRoot = yield* canonicalOutputPath(project.effxDir);
      const alloyRoot = yield* canonicalOutputPath(path.join(project.effxDir, "models", "alloy"));
      const relative = path.relative(effxRoot, alloyRoot);

      if (
        relative === "" ||
        relative === ".." ||
        relative.startsWith(".." + path.sep) ||
        path.isAbsolute(relative)
      ) {
        diagnostics.push(modelError("<models>", "model directory escapes .effx"));

        return;
      }

      const models: Array<AcceptedModel> = [];

      for (const temporal of primary) {
        const metadata = temporal.contents
          .split("\n")
          .filter((line) => line.startsWith(metadataPrefix));

        if (metadata.length !== 1) {
          diagnostics.push(modelError(temporal.path, "model metadata is missing or ambiguous"));
          continue;
        }

        const decoded = yield* Effect.result(
          decodeSymbols(metadata[0]!.slice(metadataPrefix.length)),
        );

        if (Result.isFailure(decoded)) {
          diagnostics.push(
            modelError(temporal.path, `model metadata is malformed: ${decoded.failure.message}`),
          );
          continue;
        }

        const symbols = decoded.success;

        const staticModel = files.find(
          (file) => file.path === `alloy/${alloyStaticBasename(symbols.domain)}`,
        );

        if (
          staticModel === undefined ||
          temporal.path !== `alloy/${alloyBasename(symbols.domain)}`
        ) {
          diagnostics.push(
            modelError(
              symbols.domain,
              "generated model pair is incomplete",
              symbols.scope,
              symbols.steps,
            ),
          );
          continue;
        }

        const temporalPath = path.join(project.effxDir, "models", temporal.path);
        const staticPath = path.join(project.effxDir, "models", staticModel.path);
        const physicalTemporal = yield* canonicalOutputPath(temporalPath);
        const physicalStatic = yield* canonicalOutputPath(staticPath);

        if (
          physicalTemporal !== path.join(alloyRoot, path.basename(temporalPath)) ||
          physicalStatic !== path.join(alloyRoot, path.basename(staticPath))
        ) {
          diagnostics.push(
            modelError(
              symbols.domain,
              "model path is an alias outside its owned destination",
              symbols.scope,
              symbols.steps,
            ),
          );
          continue;
        }

        const actual = yield* Effect.result(
          Effect.all([fs.readFileString(temporalPath), fs.readFileString(staticPath)]),
        );

        if (
          Result.isFailure(actual) ||
          actual.success[0] !== temporal.contents ||
          actual.success[1] !== staticModel.contents
        ) {
          diagnostics.push(
            modelError(
              symbols.domain,
              "generated model missing or stale; run effx build",
              symbols.scope,
              symbols.steps,
            ),
          );
          continue;
        }

        models.push({ symbols, temporal, staticModel, temporalPath, staticPath });
      }

      if (models.length === 0) return;
      const alloy = yield* AlloyExecution;
      const version = yield* Effect.result(alloy.version);

      if (
        Result.isFailure(version) ||
        version.success.code !== 0 ||
        version.success.stdout.trim() !== "6.2.0" ||
        version.success.truncated
      ) {
        const first = models[0]!.symbols;

        const detail = Result.isFailure(version)
          ? version.failure.detail
          : `expected 6.2.0; observed ${version.success.stdout.trim() || "no version"} (exit ${version.success.code})`;

        diagnostics.push(
          DomainDiagnostics.EFFX4303.emit({
            domain: first.domain,
            detail,
            scope: first.scope,
            steps: first.steps,
          }),
        );

        return;
      }

      const temporary = yield* fs.makeTempDirectoryScoped({
        directory: project.effxDir,
        prefix: "alloy-check-",
      });

      for (const [index, model] of models.entries()) {
        const { symbols } = model;

        const reachCount = symbols.machines.reduce(
          (total, machine) => total + machine.states.length - 1,
          0,
        );

        if (reachCount === 0) {
          lines.push(
            `${symbols.domain} A1_Reachability NOT APPLICABLE (scope ${symbols.scope}, steps ${symbols.steps})`,
          );
        } else {
          const reachOutput = path.join(temporary, `${index}-reachability`);

          const reached = yield* Effect.result(
            alloy.run({
              model: model.temporalPath,
              outputDirectory: reachOutput,
              workingDirectory: project.rootDir,
              kind: "reachability",
            }),
          );

          if (Result.isFailure(reached) || reached.success.code !== 0) {
            diagnostics.push(
              modelError(
                symbols.domain,
                Result.isFailure(reached)
                  ? reached.failure.detail
                  : `Alloy reachability exited ${reached.success.code}: ${reached.success.stderr}`,
                symbols.scope,
                symbols.steps,
              ),
            );
            continue;
          }

          const reachReceipt = yield* readReceipt(reachOutput);

          if (Result.isFailure(reachReceipt)) {
            diagnostics.push(
              modelError(symbols.domain, reachReceipt.failure, symbols.scope, symbols.steps),
            );
            continue;
          }

          const reach = checkReachability(reachReceipt.success, symbols);
          diagnostics.push(...reach.diagnostics);
          lines.push(...reach.lines);
        }

        const assertionsOutput = path.join(temporary, `${index}-assertions`);

        const assertions = yield* Effect.result(
          alloy.run({
            model: model.temporalPath,
            outputDirectory: assertionsOutput,
            workingDirectory: project.rootDir,
            kind: "assertions",
          }),
        );

        if (Result.isFailure(assertions) || assertions.success.code !== 0) {
          diagnostics.push(
            modelError(
              symbols.domain,
              Result.isFailure(assertions)
                ? assertions.failure.detail
                : `Alloy check exited ${assertions.success.code}: ${assertions.success.stderr}`,
              symbols.scope,
              symbols.steps,
            ),
          );
          continue;
        }

        lines.push(
          `${symbols.domain}: Alloy 6.2.0 assertion process exit 0; reading receipt (scope ${symbols.scope}, steps ${symbols.steps})`,
        );
        const checkOutput = yield* readReceipt(assertionsOutput);

        if (Result.isFailure(checkOutput)) {
          diagnostics.push(
            modelError(symbols.domain, checkOutput.failure, symbols.scope, symbols.steps),
          );
          continue;
        }

        const checked = checkReceipt(checkOutput.success, symbols);
        diagnostics.push(...checked.diagnostics);
        lines.push(...checked.lines);

        if (symbols.unknownGuards.length > 0)
          lines.push(
            `${symbols.domain}: unmodelled guards: ${symbols.unknownGuards.join(", ")} (scope ${symbols.scope}, steps ${symbols.steps})`,
          );

        if (symbols.nondeterministic.length > 0)
          lines.push(
            `${symbols.domain}: nondeterministic time: ${symbols.nondeterministic.join(", ")} (scope ${symbols.scope}, steps ${symbols.steps})`,
          );
        const vectorOutput = path.join(temporary, `${index}-vectors`);

        const enumeration = yield* Effect.result(
          alloy.run({
            model: model.staticPath,
            outputDirectory: vectorOutput,
            workingDirectory: project.rootDir,
            kind: "vectors",
          }),
        );

        if (Result.isFailure(enumeration) || enumeration.success.code !== 0) {
          diagnostics.push(
            modelError(
              symbols.domain,
              Result.isFailure(enumeration)
                ? enumeration.failure.detail
                : `Alloy vector run exited ${enumeration.success.code}: ${enumeration.success.stderr}`,
              symbols.scope,
              symbols.steps,
            ),
          );
          continue;
        }

        const vectorReceipt = yield* readReceipt(vectorOutput);

        if (Result.isFailure(vectorReceipt)) {
          diagnostics.push(
            modelError(symbols.domain, vectorReceipt.failure, symbols.scope, symbols.steps),
          );
          continue;
        }

        const vectors = vectorsFromReceipt(vectorReceipt.success, symbols);

        if (Result.isFailure(vectors)) {
          diagnostics.push(
            modelError(
              symbols.domain,
              `invalid vector receipt: ${vectors.failure}`,
              symbols.scope,
              symbols.steps,
            ),
          );
          continue;
        }

        const vectorPath = path.join(
          project.effxDir,
          "models",
          "alloy",
          `${alloyBasename(symbols.domain).slice(0, -4)}.vectors.json`,
        );

        if (
          (yield* canonicalOutputPath(vectorPath)) !==
          path.join(alloyRoot, path.basename(vectorPath))
        ) {
          diagnostics.push(
            modelError(
              symbols.domain,
              "vector path is an alias outside its owned destination",
              symbols.scope,
              symbols.steps,
            ),
          );
          continue;
        }

        const encoded = yield* encodeVectors(vectors.success).pipe(
          Effect.mapError(
            (cause) =>
              new CompilerFault({
                stage: "generate",
                message: "cannot encode Alloy vectors",
                cause,
              }),
          ),
        );

        yield* fs.writeFileString(vectorPath, encoded + "\n");
        lines.push(
          `${symbols.domain}: wrote ${vectors.success.instances.length} vector instances (scope ${symbols.scope}, steps ${symbols.steps}, order atoms ${symbols.orderedAtoms})`,
        );
      }
    }).pipe(
      Effect.mapError((cause) =>
        cause._tag === "PlatformError"
          ? new CompilerFault({ stage: "generate", message: "Alloy model IO failed", cause })
          : cause,
      ),
    ),
  );
  yield* reportFailure(diagnostics, lines);
});
