import { Context, Effect, Layer } from "effect";
import type { DefinitionData } from "@effx/runtime";
import type { Collected, ProjectConfig } from "./Collected.ts";
import type { CompilerFault } from "./CompilerFault.ts";

/**
 * What the frontend reads of an extension-declared definition: how to lower it, and where it may be written.
 *
 * @internal
 */
export type DefinitionEntry = Pick<DefinitionData, "plan" | "target">;

/** A logical dependency or resolution probe consulted by one analysis. */
export interface ObservedInput {
  readonly kind: "file" | "directory" | "missing" | "symlink";
  readonly path: string;
}

/**
 * Per-call frontend input that is not serializable project configuration.
 *
 * @internal
 */
export interface AnalyzeOptions {
  /**
   * Extension-declared definitions by annotation name (spec 0020): the frontend lowers by their `plan` in
   * addition to its built-in plans, and rejects a use that does not fit their `target` (`EFFX1303`). A name
   * without a definition lowers generically and keeps `EFFX1101`; the generic `Annotate(name, ...)` of spec
   * 0015 takes the same path, by the name it carries.
   */
  readonly definitions?: ReadonlyMap<string, DefinitionEntry>;
  /** Absolute logical source paths; undefined masks a file as absent. Never persisted.
   * The caller excludes executable and selected JSON configuration overlays.
   * Each execution copies this input before reading the saved project.
   */
  readonly sources?: ReadonlyMap<string, string | undefined>;
  /** Synchronous observation only; no filesystem mutation or application evaluation. */
  readonly onObserve?: (input: ObservedInput) => void;
  /** Captures each successfully consulted absolute source path and immutable text once.
   * Includes saved configuration and logical/physical paths actually read by the host.
   * Capture is synchronous; a throwing callback fails through CompilerFault. No ts objects escape.
   */
  readonly onReadSource?: (path: string, text: string) => void;
  /** Observes selected absolute declaration roots once before program creation.
   * Uses actual tsconfig membership or explicit entry selection, not imported dependencies.
   * Synchronous observation only; throwing fails through CompilerFault. Never persisted.
   */
  readonly onRootSources?: (paths: ReadonlyArray<string>) => void;
}

/**
 * The only seam to a concrete language frontend (ADR 0001). Nothing `ts.*` crosses it.
 *
 * @internal
 */
export class SourceFrontend extends Context.Service<
  SourceFrontend,
  {
    readonly analyze: (
      project: ProjectConfig,
      options?: AnalyzeOptions,
    ) => Effect.Effect<Collected, CompilerFault>;
  }
>()("effx/compiler/SourceFrontend") {
  /** In-memory frontend for tests and fixtures. */
  static readonly fromCollected = (collected: Collected): Layer.Layer<SourceFrontend> =>
    Layer.succeed(SourceFrontend, { analyze: () => Effect.succeed(collected) });
}
