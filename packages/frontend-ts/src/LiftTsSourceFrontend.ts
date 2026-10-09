import { Crypto, Effect, type FileSystem, Layer, Path, Predicate } from "effect";
import { Hex } from "effect/encoding";
import {
  CompilerFault,
  LiftFrontend,
  StageResult,
  type EffectModel,
  type ProjectConfig,
  type SourceFileRecord,
} from "@effx/compiler";
import { loadProject } from "./project.ts";
import { makeResolver } from "./resolve.ts";
import { tryTs } from "./ts.ts";
import { finishModel, modelDraft } from "./lift/model.ts";

const utf8 = new TextEncoder();

const isCompilerFault = Predicate.isTagged("CompilerFault");

/**
 * Analyze a real TypeScript Program without importing or executing application modules.
 *
 * Construction is inert. Each run owns transient checker state; it retains no Program after returning.
 * The caller owns FileSystem, Path, and Crypto. Their failures and compiler API invariant failures are
 * CompilerFault; missing/unsupported Effect profiles return None with the existing project diagnostics.
 * Cancellation propagates through the services. A synchronous TypeScript compiler call cannot be
 * preempted, but starts only during execution and acquires no persistent resource. No retries or writes.
 */
export const analyze = Effect.fn("LiftTsSourceFrontend.analyze")(function* (
  config: ProjectConfig,
): Effect.fn.Return<
  StageResult<EffectModel>,
  CompilerFault,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto
> {
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;

  const project = yield* loadProject(config).pipe(
    Effect.mapError((cause) =>
      isCompilerFault(cause)
        ? cause
        : new CompilerFault({ stage: "lift", message: cause.message, cause }),
    ),
  );

  const resolution = project.resolution;

  if (resolution === undefined) return StageResult.skip(project.diagnostics);

  const draft = yield* tryTs("lift", () =>
    modelDraft(makeResolver(project, path), resolution.target),
  );

  const files: Array<SourceFileRecord> = [];

  for (let index = 0; index < draft.sources.length; index++) {
    const source = draft.sources[index];
    const file = draft.files[index];

    if (source === undefined || file === undefined)
      return yield* new CompilerFault({
        stage: "lift",
        message: "source closure and file inventory differ",
      });

    const digest = yield* crypto
      .digest("SHA-256", utf8.encode(source.text))
      .pipe(
        Effect.mapError(
          (cause) =>
            new CompilerFault({ stage: "lift", message: `cannot hash ${file.file}`, cause }),
        ),
      );

    files.push({ ...file, sha256: Hex.encode(digest) });
  }

  return StageResult.succeed(finishModel(draft, files), project.diagnostics);
});

/** Provides only the compiler's LiftFrontend capability; platform authority stays caller-owned. */
export const layer: Layer.Layer<
  LiftFrontend,
  never,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto
> = Layer.effect(
  LiftFrontend,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | Crypto.Crypto>();

    return LiftFrontend.of({ analyze: (config) => analyze(config).pipe(Effect.provide(context)) });
  }),
);
