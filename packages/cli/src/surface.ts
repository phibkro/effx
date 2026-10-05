import { Console, Effect, FileSystem, Option, Path } from "effect";
import {
  type CompileResult,
  type Diagnostic,
  type GeneratedSource,
  checkWiring,
  hasErrors,
  surfaceOf,
  surfaceText,
  CoreDiagnostics,
} from "@effx/compiler";
import { Wiring } from "@effx/frontend-ts";
import { semanticHash } from "@effx/ir";
import { CheckFailed, type Project, compileAndReport } from "./commands.ts";
import { count, report, summary } from "./report.ts";
import { SURFACE_FILE } from "./surface-file.ts";

/*
 * Spec 0021 §4: `effx surface check --against <entry>` compares the surface recomputed from the IR
 * with the static wiring of a deployment program. It never executes the program.
 */

/** The check's diagnostics for an error-free compile result; pure over files, never writes. */
export const wiringDiagnostics = Effect.fn("wiringDiagnostics")(function* (
  project: Project,
  result: CompileResult,
  against: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entry = path.resolve(against);

  if (!(yield* fs.exists(entry))) {
    return [CoreDiagnostics.EFFX2804.emit({ against })];
  }

  // After the pipeline succeeded every stage produced a value; absence is an invariant breach.
  const ir = Option.getOrThrow(result.ir.value);
  const index = Option.getOrThrow(result.index);
  const files = Option.getOrThrow(result.files.value);
  const collected = Option.getOrThrow(result.collected.value);
  const generatedDir = collected.project?.outputDir ?? path.join(project.effxDir, "generated");
  const surface = yield* surfaceOf(ir, index, yield* semanticHash(ir));

  const generated: ReadonlyArray<GeneratedSource> = files.map((file) => ({
    path: path.join(generatedDir, file.path).split(path.sep).join("/"),
    contents: file.contents,
  }));

  const facts = yield* Wiring.analyzeWiring({
    tsconfigPath: project.tsconfigPath,
    entry,
    generatedDir,
    overlay: generated,
  });

  const diagnostics: Array<Diagnostic> = [
    ...checkWiring({ surface, generated, facts, entry: against }),
  ];

  const onDisk = path.join(project.effxDir, SURFACE_FILE);

  if ((yield* fs.exists(onDisk)) && (yield* fs.readFileString(onDisk)) !== surfaceText(surface)) {
    diagnostics.push(CoreDiagnostics.EFFX2805.emit({ file: onDisk }));
  }

  return diagnostics;
});

export const surfaceCheck = Effect.fn("surfaceCheck")(function* (
  project: Project,
  against: string,
) {
  const path = yield* Path.Path;
  const result = yield* compileAndReport(project);
  const cwd = path.resolve();

  const relative = (file: string): string => {
    const location = path.relative(cwd, file);

    return location === ".." || location.startsWith(`..${path.sep}`) ? file : location;
  };

  // Pipeline errors fail first, exactly as `check` does (they were already printed).
  if (hasErrors(result.diagnostics)) {
    return yield* new CheckFailed({ errors: count(result.diagnostics).errors });
  }

  const diagnostics = yield* wiringDiagnostics(project, result, against);

  for (const line of report(diagnostics, relative)) yield* Console.log(line);
  yield* Console.log(summary(count(diagnostics)));

  if (hasErrors(diagnostics)) {
    return yield* new CheckFailed({ errors: count(diagnostics).errors });
  }

  yield* Console.log(`surface check: ${against} wires the generated handlers the surface requires`);
});
