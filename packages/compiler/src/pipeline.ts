import { Effect, Option } from "effect";
import type { Registry } from "@effx/diagnostics";
import { type ApplicationIR, type GraphIndex, IRGraph, make, normalize } from "@effx/ir";
import type { Collected, HttpApiGroupInventory, ProjectConfig } from "./Collected.ts";
import type { CompilerFault } from "./CompilerFault.ts";
import { type Diagnostic, type Location, StageResult, hasErrors } from "./Diagnostic.ts";
import {
  Contribution,
  type AnalysisContext,
  type Expansion,
  type Extension,
  type GenerationContext,
  type GeneratedFile,
  defaultGenerationContext,
} from "./Extension.ts";
import { SourceFrontend, type AnalyzeOptions } from "./SourceFrontend.ts";
import { operationIdOf } from "./extensions/core.ts";
import { definitionDiagnostics, definitionsOf } from "./annotation.ts";
import { unsupportedModules } from "./generate/target.ts";
import { CoreDiagnostics, HttpDiagnostics } from "./diagnostics/index.ts";
import {
  hasDiagnosticContractErrors,
  registryOf,
  validateDiagnostics,
} from "./diagnostics/validation.ts";
import {
  externalHttpApiGroups,
  httpApiRootKey,
  httpApiInventoryDiagnostics,
} from "./http-api-inventory.ts";

/** @internal */
export interface CompileResult {
  readonly collected: StageResult<Collected>;
  readonly ir: StageResult<ApplicationIR>;
  readonly index: Option.Option<GraphIndex>;
  readonly files: StageResult<ReadonlyArray<GeneratedFile>>;
  /** Every diagnostic from every stage, in stage order. */
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const withLocation = (diagnostic: Diagnostic, location: Location): Diagnostic => ({
  ...diagnostic,
  location,
});

/** Run pre-passes in list order, checking each callback before the next stage receives it. */
const expandAll = (
  collected: Collected,
  extensions: ReadonlyArray<Extension>,
  registry: Registry,
  context: AnalysisContext,
): Expansion => {
  let declarations = collected.declarations;

  const diagnostics: Array<Diagnostic> = [];

  for (const extension of extensions) {
    if (extension.expand === undefined) continue;

    const expansion = extension.expand({ ...collected, declarations });

    declarations = expansion.declarations;

    diagnostics.push(
      ...validateDiagnostics(expansion.diagnostics, registry, extension.name, {
        ...context,
        phase: "expand",
      }),
    );
  }

  return { declarations, diagnostics };
};

const interpretRegistered = (
  collected: Collected,
  extensions: ReadonlyArray<Extension>,
  registry: Registry,
  context: AnalysisContext,
): StageResult<ApplicationIR> => {
  const contributions: Array<Contribution> = [];

  const expanded = expandAll(collected, extensions, registry, context);

  contributions.push(
    Contribution.diagnostics(
      ...validateDiagnostics(
        definitionDiagnostics(extensions),
        registry,
        "annotation definitions",
        { ...context, phase: "interpret" },
      ),
    ),
  );

  contributions.push(Contribution.diagnostics(...expanded.diagnostics));

  for (const declaration of expanded.declarations) {
    const ctx = { operationId: operationIdOf(declaration) };

    for (const annotation of declaration.annotations) {
      const owners = extensions.filter((extension) => annotation.name in extension.interpreters);

      if (owners.length === 0) {
        contributions.push(
          Contribution.diagnostics(
            CoreDiagnostics["EFFX1101"].emit(
              { annotation: annotation.name, subject: declaration.id },
              declaration.location === undefined ? undefined : { location: declaration.location },
            ),
          ),
        );
      }

      for (const owner of owners) {
        const contribution = owner.interpreters[annotation.name]!(annotation, declaration, ctx);

        const diagnostics = validateDiagnostics(contribution.diagnostics, registry, owner.name, {
          ...context,
          phase: "interpret",
        }).map((diagnostic) =>
          diagnostic.location === undefined && declaration.location !== undefined
            ? withLocation(diagnostic, declaration.location)
            : diagnostic,
        );

        contributions.push(Contribution.make(contribution.nodes, contribution.edges, diagnostics));
      }
    }
  }

  const merged = Contribution.concat(contributions);

  return StageResult.succeed(normalize(make(merged.nodes, merged.edges)), merged.diagnostics);
};

/** interpret → merge → normalize. Pure; registry violations are diagnostics, not faults. @internal */
export const interpret = (
  collected: Collected,
  extensions: ReadonlyArray<Extension>,
): StageResult<ApplicationIR> => {
  const registration = registryOf(extensions);

  if (Option.isNone(registration.value)) return StageResult.skip(registration.diagnostics);

  return interpretRegistered(collected, extensions, registration.value.value, {
    strictAccess: collected.project?.strictAccess ?? false,
  });
};

const analyzeRegistered = (
  ir: ApplicationIR,
  index: GraphIndex,
  extensions: ReadonlyArray<Extension>,
  registry: Registry,
  context: AnalysisContext,
): ReadonlyArray<Diagnostic> =>
  extensions.flatMap((extension) =>
    extension.analyses.flatMap((analysis) =>
      validateDiagnostics(analysis(ir, index, context), registry, extension.name, {
        ...context,
        phase: "analyze",
      }),
    ),
  );

/** Runs every extension's analyses over normalized IR, checking each callback's diagnostics. @internal */
export const analyze = (
  ir: ApplicationIR,
  index: GraphIndex,
  extensions: ReadonlyArray<Extension>,
  context: AnalysisContext = { strictAccess: false },
): ReadonlyArray<Diagnostic> => {
  const registration = registryOf(extensions);

  if (Option.isNone(registration.value)) return registration.diagnostics;

  return analyzeRegistered(ir, index, extensions, registration.value.value, context);
};

/**
 * Runs every generator; output is sorted by path so the file set is deterministic. The extensions' endpoint
 * fragments reach the generators through GenerationContext.fragments in extension-list order.
 * @internal
 */
export const generate = Effect.fn("generate")(function* (
  ir: ApplicationIR,
  index: GraphIndex,
  extensions: ReadonlyArray<Extension>,
  context: GenerationContext = defaultGenerationContext,
) {
  const withFragments: GenerationContext = {
    ...context,
    fragments: extensions.flatMap((extension) => extension.fragments ?? []),
  };

  const generated = yield* Effect.forEach(
    extensions.flatMap((extension) => extension.generators),
    (generator) => generator(ir, index, withFragments),
  );

  return generated.flat().toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
});

type GenerationContextDraft = { -readonly [K in keyof GenerationContext]: GenerationContext[K] };

const rejected = (
  diagnostics: ReadonlyArray<Diagnostic>,
  collected?: Collected,
): CompileResult => ({
  collected:
    collected === undefined ? StageResult.skip(diagnostics) : StageResult.succeed(collected),
  ir: StageResult.skip(diagnostics),
  index: Option.none(),
  files: StageResult.skip(),
  diagnostics,
});

const compileRegistered = Effect.fnUntraced(function* (
  input: Collected,
  extensions: ReadonlyArray<Extension>,
  registry: Registry,
  context: AnalysisContext,
): Effect.fn.Return<CompileResult, CompilerFault> {
  const collectionDiagnostics = validateDiagnostics(
    input.diagnostics,
    registry,
    "source frontend",
    {
      ...context,
      phase: "collect",
    },
  );

  const collected: Collected = { ...input, diagnostics: collectionDiagnostics };

  if (hasDiagnosticContractErrors(collectionDiagnostics))
    return rejected(collectionDiagnostics, collected);

  const irStage = interpretRegistered(collected, extensions, registry, context);

  if (Option.isNone(irStage.value))
    return rejected([...collectionDiagnostics, ...irStage.diagnostics], collected);

  const ir = irStage.value.value;

  const index = IRGraph.toGraph(ir);

  const analysis = analyzeRegistered(ir, index, extensions, registry, context);

  const base = collected.project ?? defaultGenerationContext;

  const generationContext: GenerationContextDraft = { ...base };

  if (collected.resolveEffectModule !== undefined)
    generationContext.resolveEffectModule = collected.resolveEffectModule;

  const sourceLocation = collected.declarations.find(
    (declaration) => declaration.location !== undefined,
  )?.location;

  const importDiagnostics = unsupportedModules(ir, generationContext).map((module) =>
    CoreDiagnostics["EFFX2701"].emit(
      { _tag: "SourceModule", target: generationContext.target, module },
      sourceLocation === undefined ? undefined : { location: sourceLocation },
    ),
  );

  const diagnostics = [
    ...collectionDiagnostics,
    ...irStage.diagnostics,
    ...analysis,
    ...importDiagnostics,
  ];

  // Inventory is a generation precondition; avoid cascades when emission is already blocked.
  if (
    !hasErrors(diagnostics) &&
    !hasDiagnosticContractErrors(diagnostics) &&
    generationContext.emit !== "contract"
  ) {
    const inventories: Array<HttpApiGroupInventory> = [];

    const resolved = new Set<string>();

    const failed = new Set<string>();

    for (const group of externalHttpApiGroups(ir)) {
      const root = group.metadata?.rootSymbol;

      if (root === undefined) continue;

      const key = httpApiRootKey(root);

      if (resolved.has(key)) continue;

      resolved.add(key);

      if (collected.resolveHttpApiInventory === undefined) continue;

      const proof = yield* collected.resolveHttpApiInventory(root);

      const proofDiagnostics = validateDiagnostics(
        proof.diagnostics,
        registry,
        "HTTP inventory frontend",
        {
          ...context,
          phase: "collect",
        },
      );

      diagnostics.push(...proofDiagnostics);

      if (Option.isSome(proof.value)) inventories.push(...proof.value.value);
      else {
        failed.add(key);

        if (!hasErrors(proofDiagnostics) && !hasDiagnosticContractErrors(proofDiagnostics))
          diagnostics.push(
            HttpDiagnostics["EFFX2415"].emit({ _tag: "InventoryUnavailable", root: root.export }),
          );
      }
    }

    generationContext.httpApiGroups = inventories;

    diagnostics.push(
      ...validateDiagnostics(
        httpApiInventoryDiagnostics(ir, generationContext, failed),
        registry,
        "HTTP inventory",
        context,
      ),
    );
  }

  const files =
    hasErrors(diagnostics) || hasDiagnosticContractErrors(diagnostics)
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

/** The pipeline after collection; applies the same registry contract without a frontend. @internal */
export const compileCollected = Effect.fn("compileCollected")(function* (
  collected: Collected,
  extensions: ReadonlyArray<Extension>,
  context: AnalysisContext = { strictAccess: collected.project?.strictAccess ?? false },
): Effect.fn.Return<CompileResult, CompilerFault> {
  const registration = registryOf(extensions);

  if (Option.isNone(registration.value)) return rejected(registration.diagnostics);

  return yield* compileRegistered(collected, extensions, registration.value.value, context);
});

/** collect → interpret → merge → normalize → analyze → generate; registration precedes frontend analysis. */
export const compile = Effect.fn("compile")(function* (
  project: ProjectConfig,
  extensions: ReadonlyArray<Extension>,
  options?: Omit<AnalyzeOptions, "definitions">,
): Effect.fn.Return<CompileResult, CompilerFault, SourceFrontend> {
  const registration = registryOf(extensions);

  if (Option.isNone(registration.value)) return rejected(registration.diagnostics);
  const frontend = yield* SourceFrontend;

  const collected = yield* frontend.analyze(project, {
    ...options,
    definitions: definitionsOf(extensions),
  });

  return yield* compileRegistered(collected, extensions, registration.value.value, {
    strictAccess: project.strictAccess ?? collected.project?.strictAccess ?? false,
  });
});
