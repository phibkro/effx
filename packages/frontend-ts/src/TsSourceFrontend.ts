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
import type { Resolver } from "./resolve.ts";
import { ts, tryTs } from "./ts.ts";

/** The analysis TypeScript version (ADR 0009); the manifest records it next to the project pin. */
export const typescriptVersion: string = ts.version;

const isCompilerFault = Predicate.isTagged("CompilerFault");

const stripExtension = (file: string): string => file.replace(/(\.d)?\.[cm]?[jt]sx?$/, "");

type CollectedDraft = { -readonly [K in keyof Collected]: Collected[K] };

/**
 * Symbols declared inside `node_modules` are imported by package specifier: the path after the
 * last `node_modules/` with a `dist/` segment and the extension removed (`effect/dist/sql/SqlError.d.ts`
 * → `effect/sql/SqlError`). [INFERENCE] relies on the package exposing that subpath; verified for `effect`.
 */
const packageSpecifier = (file: string): string | undefined => {
  const marker = file.lastIndexOf("/node_modules/");

  if (marker < 0) return undefined;

  return stripExtension(file.slice(marker + "/node_modules/".length)).replace(/\/dist\//, "/");
};

/** `SourceFrontend` over TypeScript 6 (ADR 0009). Nothing `ts.*` leaves `analyze`. */
export const analyze = Effect.fn("TsSourceFrontend.analyze")(function* (
  config: ProjectConfig,
  options: AnalyzeOptions = {},
) {
  const path = yield* Path.Path;

  const project = yield* loadProject(config).pipe(
    Effect.mapError((cause) =>
      isCompilerFault(cause)
        ? cause
        : new CompilerFault({ stage: "collect", message: cause.message, cause }),
    ),
  );

  const posix = (relative: string): string => stripExtension(relative).split(path.sep).join("/");

  const resolver: Resolver = {
    project,
    moduleOf: (file) => {
      const external = packageSpecifier(file);

      if (external !== undefined) return external;
      const relative = posix(path.relative(path.join(project.rootDir, ".effx", "generated"), file));

      return relative.startsWith(".") ? relative : `./${relative}`;
    },
    idPathOf: (file) => {
      const external = packageSpecifier(file);

      if (external !== undefined) return external;
      const relative = posix(path.relative(project.rootDir, file));

      // Outside the project root: fall back to the import specifier without its leading dots.
      return relative.startsWith(".") ? relative.replace(/^(\.\.?\/)+/, "") : relative;
    },
  };

  const collected = yield* tryTs("collect", () => collect(resolver, options.definitions));

  const result: CollectedDraft = {
    declarations: collected.declarations,
    diagnostics: [...project.diagnostics, ...collected.diagnostics],
  };

  if (collected.spreads !== undefined) result.spreads = collected.spreads;

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
