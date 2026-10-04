import { Effect, Option } from "effect";
import { type ApplicationIR, type GraphIndex, IRGraph, make, normalize } from "@effx/ir";
import type { Collected, ProjectConfig } from "./Collected.ts";
import type { CompilerFault } from "./CompilerFault.ts";
import { type Diagnostic, type Location, StageResult, error, hasErrors } from "./Diagnostic.ts";
import {
  Contribution,
  type AnalysisContext,
  type Extension,
  type GenerationContext,
  type GeneratedFile,
  defaultGenerationContext,
} from "./Extension.ts";
import { SourceFrontend } from "./SourceFrontend.ts";
import { operationIdOf } from "./extensions/core.ts";
import { expandGroupDefaults } from "./group-defaults.ts";
import { unsupportedModules } from "./generate/target.ts";

/** @internal */
export interface CompileResult {
  readonly collected: StageResult<Collected>;
  readonly ir: StageResult<ApplicationIR>;
  readonly index: Option.Option<GraphIndex>;
  readonly files: StageResult<ReadonlyArray<GeneratedFile>>;
  /** Every diagnostic from every stage, in stage order. */
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const withLocation = (diagnostic: Diagnostic, location: Location): Diagnostic => {
  if (diagnostic.related === undefined) {
    return {
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      location,
    };
  }

  return {
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    location,
    related: diagnostic.related,
  };
};

/**
 * interpret → merge → normalize. Pure. Unknown annotations are `EFFX1101`.
 *
 * @internal
 */
export const interpret = (
  collected: Collected,
  extensions: ReadonlyArray<Extension>,
): StageResult<ApplicationIR> => {
  const contributions: Array<Contribution> = [];
  const expanded = expandGroupDefaults(collected);
  contributions.push(Contribution.diagnostics(...expanded.diagnostics));

  for (const declaration of expanded.declarations) {
    const ctx = { operationId: operationIdOf(declaration) };

    for (const annotation of declaration.annotations) {
      const owners = extensions.filter((extension) => annotation.name in extension.interpreters);

      if (owners.length === 0) {
        contributions.push(
          Contribution.diagnostics(
            error(
              "EFFX1101",
              `@${annotation.name} on ${declaration.id}: no extension interprets this annotation`,
              declaration.location,
            ),
          ),
        );
      }

      for (const owner of owners) {
        const contribution = owner.interpreters[annotation.name]!(annotation, declaration, ctx);
        const location = declaration.location;

        if (location === undefined || contribution.diagnostics.length === 0) {
          contributions.push(contribution);
          continue;
        }

        const diagnostics = contribution.diagnostics.map((diagnostic) =>
          diagnostic.location === undefined ? withLocation(diagnostic, location) : diagnostic,
        );

        contributions.push(Contribution.make(contribution.nodes, contribution.edges, diagnostics));
      }
    }
  }

  const merged = Contribution.concat(contributions);

  return StageResult.succeed(normalize(make(merged.nodes, merged.edges)), merged.diagnostics);
};

/**
 * Runs every extension's analyses over the normalized IR and its graph index. Pure.
 *
 * @internal
 */
export const analyze = (
  ir: ApplicationIR,
  index: GraphIndex,
  extensions: ReadonlyArray<Extension>,
  context: AnalysisContext = { strictAccess: false },
): ReadonlyArray<Diagnostic> =>
  extensions.flatMap((extension) =>
    extension.analyses.flatMap((analysis) => analysis(ir, index, context)),
  );

/**
 * Runs every generator; output is sorted by path so the file set is deterministic.
 *
 * @internal
 */
export const generate = Effect.fn("generate")(function* (
  ir: ApplicationIR,
  index: GraphIndex,
  extensions: ReadonlyArray<Extension>,
  context: GenerationContext = defaultGenerationContext,
) {
  const generated = yield* Effect.forEach(
    extensions.flatMap((extension) => extension.generators),
    (generator) => generator(ir, index, context),
  );

  return generated.flat().toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
});

/**
 * The pipeline after collection; usable without a `SourceFrontend` (tests, cached IR).
 *
 * @internal
 */
export const compileCollected = Effect.fn("compileCollected")(function* (
  collected: Collected,
  extensions: ReadonlyArray<Extension>,
  context: AnalysisContext = { strictAccess: false },
): Effect.fn.Return<CompileResult, CompilerFault> {
  const irStage = interpret(collected, extensions);
  const ir = Option.getOrThrow(irStage.value);
  const index = IRGraph.toGraph(ir);
  const analysis = analyze(ir, index, extensions, context);
  const base = collected.project ?? defaultGenerationContext;

  const generationContext: GenerationContext =
    collected.resolveEffectModule === undefined
      ? base
      : { ...base, resolveEffectModule: collected.resolveEffectModule };

  const sourceLocation = collected.declarations.find(
    (declaration) => declaration.location !== undefined,
  )?.location;

  const importDiagnostics = unsupportedModules(ir, generationContext).map((module) =>
    error(
      "EFFX2701",
      `unsupported ${generationContext.target} source module ${module}`,
      sourceLocation,
    ),
  );

  const diagnostics = [
    ...collected.diagnostics,
    ...irStage.diagnostics,
    ...analysis,
    ...importDiagnostics,
  ];

  const files = hasErrors(diagnostics)
    ? StageResult.skip<ReadonlyArray<GeneratedFile>>()
    : StageResult.succeed(yield* generate(ir, index, extensions, generationContext));

  return {
    collected: StageResult.succeed(collected),
    ir: { value: irStage.value, diagnostics },
    index: Option.some(index),
    files,
    diagnostics,
  };
});

/** collect → interpret → merge → normalize → analyze → generate. */
export const compile = Effect.fn("compile")(function* (
  project: ProjectConfig,
  extensions: ReadonlyArray<Extension>,
): Effect.fn.Return<CompileResult, CompilerFault, SourceFrontend> {
  const frontend = yield* SourceFrontend;
  const collected = yield* frontend.analyze(project);

  return yield* compileCollected(collected, extensions, {
    strictAccess: project.strictAccess ?? collected.project?.strictAccess ?? false,
  });
});
