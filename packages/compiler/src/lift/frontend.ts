import { Context, type Effect } from "effect";
import type { ProjectConfig } from "../Collected.ts";
import type { CompilerFault } from "../CompilerFault.ts";
import type { EffectModel } from "./model.ts";

/**
 * The only seam to a concrete language frontend for lifting (spec 0019 §8 S7), parallel to `SourceFrontend`.
 * It is an abstract capability: this package defines no production layer and no stand-in. The TypeScript
 * frontend provides the layer; code that already holds a model calls the pure `lift` function directly.
 * Nothing `ts.*` crosses it; unsupported source is data inside the model, and only IO or invariant breakage
 * is a `CompilerFault`.
 */
export class LiftFrontend extends Context.Service<
  LiftFrontend,
  {
    readonly analyze: (project: ProjectConfig) => Effect.Effect<EffectModel, CompilerFault>;
  }
>()("effx/compiler/LiftFrontend") {}
