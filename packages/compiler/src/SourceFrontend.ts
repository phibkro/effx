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
