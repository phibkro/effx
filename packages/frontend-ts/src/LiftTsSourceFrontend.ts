import { Effect, type FileSystem, Layer, Path, Predicate } from "effect";
import { Digest } from "effect/crypto";
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
 * The caller owns FileSystem, Path, and Digest. FileSystem and Path failures and compiler API invariant failures are
 * CompilerFault; missing/unsupported Effect profiles return None with the existing project diagnostics.
 * Cancellation propagates through the services. A synchronous TypeScript compiler call cannot be
 * preempted, but starts only during execution and acquires no persistent resource. No retries or writes.
 */
export const analyze = Effect.fn("LiftTsSourceFrontend.analyze")(function* (
  config: ProjectConfig,
): Effect.fn.Return<
  StageResult<EffectModel>,
  CompilerFault,
  FileSystem.FileSystem | Path.Path | Digest.Digest
> {
  const path = yield* Path.Path;
  const digest = yield* Digest.Digest;

  const project = yield* loadProject(config).pipe(
    Effect.mapError((cause) =>
      isCompilerFault(cause)
        ? cause
        : new CompilerFault({ stage: "lift", message: cause.message, cause }),
    ),
  );

  const resolution = project.resolution;

  if (resolution === undefined) return StageResult.skip(project.diagnostics);

  const draft = yield* tryTs("lift", () => modelDraft(makeResolver(project, path), resolution));

  const files: Array<SourceFileRecord> = [];

  for (let index = 0; index < draft.sources.length; index++) {
    const source = draft.sources[index];
    const file = draft.files[index];

    if (source === undefined || file === undefined)
      return yield* new CompilerFault({
        stage: "lift",
        message: "source closure and file inventory differ",
      });

    files.push({
      ...file,
      sha256: yield* digest.digestHex(Digest.sha256, utf8.encode(source.text)),
    });
  }

  return StageResult.succeed(finishModel(draft, files), project.diagnostics);
});

/** Provides only the compiler's LiftFrontend capability; platform authority stays caller-owned. */
export const layer: Layer.Layer<
  LiftFrontend,
  never,
  FileSystem.FileSystem | Path.Path | Digest.Digest
> = Layer.effect(
  LiftFrontend,
  Effect.gen(function* () {
    const context = yield* Effect.context<FileSystem.FileSystem | Path.Path | Digest.Digest>();

    return LiftFrontend.of({ analyze: (config) => analyze(config).pipe(Effect.provide(context)) });
  }),
);
