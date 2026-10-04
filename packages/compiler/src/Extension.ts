import type { Effect, Option } from "effect";
import type { ApplicationIR, Edge, GraphIndex, Node, StableId } from "@effx/ir";
import type { Annotation, Declaration } from "./Collected.ts";
import type { EmitMode, TargetProfile } from "./Collected.ts";
import type { CompilerFault } from "./CompilerFault.ts";
import type { Diagnostic } from "./Diagnostic.ts";

/** What one annotation on one declaration contributes to the IR. Never behaviour. */
export interface Contribution {
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

export const Contribution = {
  empty: { nodes: [], edges: [], diagnostics: [] } satisfies Contribution,
  make: (
    nodes: ReadonlyArray<Node> = [],
    edges: ReadonlyArray<Edge> = [],
    diagnostics: ReadonlyArray<Diagnostic> = [],
  ): Contribution => ({ nodes, edges, diagnostics }),
  diagnostics: (...diagnostics: ReadonlyArray<Diagnostic>): Contribution => ({
    nodes: [],
    edges: [],
    diagnostics,
  }),
  concat: (contributions: Iterable<Contribution>): Contribution => {
    const nodes: Array<Node> = [];
    const edges: Array<Edge> = [];
    const diagnostics: Array<Diagnostic> = [];

    for (const c of contributions) {
      nodes.push(...c.nodes);
      edges.push(...c.edges);
      diagnostics.push(...c.diagnostics);
    }

    return { nodes, edges, diagnostics };
  },
};

/** @internal */
export interface InterpretContext {
  /** The operation this declaration defines (from its `Query`/`Command` annotation), if any. */
  readonly operationId: Option.Option<StableId.StableId>;
}

export type Interpreter = (
  annotation: Annotation,
  declaration: Declaration,
  ctx: InterpretContext,
) => Contribution;

/** @internal */
export interface AnalysisContext {
  readonly strictAccess: boolean;
}

export type Analysis = (
  ir: ApplicationIR,
  index: GraphIndex,
  context: AnalysisContext,
) => ReadonlyArray<Diagnostic>;

export interface GeneratedFile {
  readonly path: string;
  readonly contents: string;
}

/**
 * Output policy never enters ApplicationIR or its semantic hash.
 *
 * @internal
 */
export interface GenerationContext {
  readonly target: TargetProfile;
  readonly emit: EmitMode;
  readonly allowImportingTsExtensions: boolean;
  readonly canonicalImportBase?: string;
  readonly outputDir?: string;
  /** Runtime-only target-project resolver; never part of serialized IR or project settings. */
  readonly resolveEffectModule?: (specifier: string) => boolean;
}

/** @internal */
export const defaultGenerationContext: GenerationContext = {
  target: "effect-4.0",
  emit: "all",
  allowImportingTsExtensions: false,
};

export type Generator = (
  ir: ApplicationIR,
  index: GraphIndex,
  context?: GenerationContext,
) => Effect.Effect<ReadonlyArray<GeneratedFile>, CompilerFault>;

export interface Extension {
  readonly name: string;
  readonly interpreters: Readonly<Record<string, Interpreter>>;
  readonly analyses: ReadonlyArray<Analysis>;
  readonly generators: ReadonlyArray<Generator>;
}
