import type { Effect, Option } from "effect";
import type { DefinitionData } from "@effx/runtime";
import type { ApplicationIR, Edge, GraphIndex, Node, OperationNode, StableId } from "@effx/ir";
import type { Annotation, Collected, Declaration, HttpApiGroupInventory } from "./Collected.ts";
import type { HttpGroupBinding } from "./bindings.ts";
import type { EmitMode, TargetProfile } from "./Collected.ts";
import type { CompilerFault } from "./CompilerFault.ts";
import type { Diagnostic } from "./Diagnostic.ts";
import type { DiagnosticEntry } from "@effx/diagnostics";

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

/** The import collector a fragment renders into: registers `name` from `module`, returns the local name. */
export interface FragmentImports {
  add(module: string, name: string): string;
}

/** One rendered method-call suffix of a generated endpoint (it starts with `.`, e.g. `.annotate(K, v)`). */
export interface EndpointFragmentPart {
  readonly render: (imports: FragmentImports) => string;
}

/**
 * What an extension appends to the generated HTTP endpoint of an operation (spec 0020 §6): zero or more
 * method-call suffixes, appended after the generator's own annotations. Pure and total; any import is
 * registered only by `render`, so computing the parts does no work on the generated file.
 */
export type EndpointFragment = (
  operation: OperationNode,
  ctx: { readonly ir: ApplicationIR; readonly index: GraphIndex },
) => ReadonlyArray<EndpointFragmentPart>;

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
  /** Checker-proven concrete root groups, outside the IR and semantic hash. */
  readonly httpApiGroups?: ReadonlyArray<HttpApiGroupInventory>;
  readonly bindings?: ReadonlyArray<HttpGroupBinding>;
  /** The extensions' endpoint fragments in extension-list order; `generate` fills it from the extensions. */
  readonly fragments?: ReadonlyArray<EndpointFragment>;
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

/** What a pre-pass leaves of `Collected.declarations`, and the diagnostics it found. */
export interface Expansion {
  readonly declarations: ReadonlyArray<Declaration>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/**
 * A cross-annotation pre-pass over the collected declarations, run before any interpreter (spec 0020 §3,
 * the 0013 seam). Pure; it may rewrite annotations (source sugar becomes ordinary annotations) but never
 * adds IR. `declarations` replaces the input's, in the order returned.
 */
export type Expand = (collected: Collected) => Expansion;

export interface Extension {
  readonly name: string;
  /** Entry declarations, Schema-decoded and collision-checked with the bundled catalogue before frontend analysis. */
  readonly diagnosticEntries?: ReadonlyArray<DiagnosticEntry>;
  /** Definitions this extension implements; their plans drive frontend lowering (spec 0020). */
  readonly annotations?: ReadonlyArray<DefinitionData>;
  readonly interpreters: Readonly<Record<string, Interpreter>>;
  readonly analyses: ReadonlyArray<Analysis>;
  /**
   * An optional pre-pass over Collected, run in extension order. Its diagnostics (including related
   * occurrences) are registry-checked before reporting; violations become EFFX0010 and block output.
   */
  readonly expand?: Expand;
  /**
   * Endpoint fragments, in declaration order (spec 0020 §6). `extension()` derives one for every
   * definition with an `effect` clause; the pipeline hands them to the generators through
   * `GenerationContext.fragments`.
   */
  readonly fragments?: ReadonlyArray<EndpointFragment>;
  readonly generators: ReadonlyArray<Generator>;
}
