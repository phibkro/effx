import { Effect, type FileSystem, Layer, Path, Predicate } from "effect";
import {
  type AnalyzeOptions,
  type Collected,
  CompilerFault,
  type ProjectConfig,
  SourceFrontend,
} from "@effx/compiler";
import { collect } from "./collect.ts";
import { loadProject } from "./project.ts";
import { makeResolver } from "./resolve.ts";
import { ts, tryTs } from "./ts.ts";

/** The analysis TypeScript version (ADR 0009); the manifest records it next to the project pin. */
export const typescriptVersion: string = ts.version;

const isCompilerFault = Predicate.isTagged("CompilerFault");

type CollectedDraft = { -readonly [K in keyof Collected]: Collected[K] };

/** `SourceFrontend` over TypeScript 6 (ADR 0009). Nothing `ts.*` leaves `analyze`. */
export const analyze = Effect.fn("TsSourceFrontend.analyze")(function* (
  config: ProjectConfig,
  options: AnalyzeOptions = {},
): Effect.fn.Return<Collected, CompilerFault, FileSystem.FileSystem | Path.Path> {
  const path = yield* Path.Path;

  const project = yield* loadProject(config, options).pipe(
    Effect.mapError((cause) =>
      isCompilerFault(cause)
        ? cause
        : new CompilerFault({ stage: "collect", message: cause.message, cause }),
    ),
  );

  const resolver = makeResolver(project, path);

  const collected = yield* tryTs("collect", () => collect(resolver, options.definitions));

  const result: CollectedDraft = {
    declarations: collected.declarations,
    diagnostics: [...project.diagnostics, ...collected.diagnostics],
  };

  if (collected.spreads !== undefined) result.spreads = collected.spreads;

  if (collected.bindings !== undefined) result.bindings = collected.bindings;

  if (collected.resolveHttpApiInventory !== undefined)
    result.resolveHttpApiInventory = collected.resolveHttpApiInventory;

  if (project.resolution !== undefined) result.project = project.resolution;

  if (project.resolveEffectModule !== undefined) {
    result.resolveEffectModule = project.resolveEffectModule;
  }

  return result;
});

export const layer: Layer.Layer<SourceFrontend, never, FileSystem.FileSystem | Path.Path> =
  Layer.effect(
    SourceFrontend,
    Effect.gen(function* () {
      const context = yield* Effect.context<FileSystem.FileSystem | Path.Path>();

      return {
        analyze: (config: ProjectConfig, options?: AnalyzeOptions) =>
          analyze(config, options).pipe(Effect.provide(context)),
      };
    }),
  );
