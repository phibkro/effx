import { Context, Effect, Layer } from "effect";
import type { Collected, ProjectConfig } from "./Collected.ts";
import type { CompilerFault } from "./CompilerFault.ts";

/**
 * The only seam to a concrete language frontend (ADR 0001). Nothing `ts.*` crosses it.
 *
 * @internal
 */
export class SourceFrontend extends Context.Service<
  SourceFrontend,
  {
    readonly analyze: (project: ProjectConfig) => Effect.Effect<Collected, CompilerFault>;
  }
>()("effx/compiler/SourceFrontend") {
  /** In-memory frontend for tests and fixtures. */
  static readonly fromCollected = (collected: Collected): Layer.Layer<SourceFrontend> =>
    Layer.succeed(SourceFrontend, { analyze: () => Effect.succeed(collected) });
}
