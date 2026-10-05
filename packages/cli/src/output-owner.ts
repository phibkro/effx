import { Crypto, Effect, Exit, FileSystem, Path, Schema, Scope } from "effect";
import type { PlatformError } from "effect/PlatformError";

export class OutputBusy extends Schema.TaggedError<OutputBusy>()("OutputBusy", {
  resource: Schema.String,
  message: Schema.String,
}) {}

export interface OutputResources {
  readonly generatedDir: string;
  readonly effxDir: string;
}

const authority = Symbol("OutputOwner");

export interface OutputOwner {
  readonly [authority]: true;
  readonly resources: ReadonlyArray<string>;
  readonly token: string;
}

const lockName = ".effx-output-owner.lock";

/** Resolve missing suffixes through their nearest existing physical parent. */
const canonicalPath = Effect.fnUntraced(function* (
  file: string,
): Effect.fn.Return<string, PlatformError, FileSystem.FileSystem | Path.Path> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  let candidate = path.resolve(file);
  const suffix: Array<string> = [];

  while (true) {
    const physical = yield* fs
      .realPath(candidate)
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));

    if (physical !== undefined) return path.join(physical, ...suffix.reverse());

    const link = yield* fs
      .readLink(candidate)
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));

    if (link !== undefined) {
      return path.join(
        yield* canonicalPath(path.resolve(path.dirname(candidate), link)),
        ...suffix.reverse(),
      );
    }

    suffix.push(path.basename(candidate));
    candidate = path.dirname(candidate);
  }
});

const resourceSet = Effect.fnUntraced(function* (resources: OutputResources) {
  const path = yield* Path.Path;

  return [
    ...new Set([
      yield* canonicalPath(resources.generatedDir),
      yield* canonicalPath(resources.effxDir),
      path.dirname(yield* canonicalPath(path.join(resources.effxDir, "manifest.json"))),
    ]),
  ].sort();
});

/**
 * Local filesystem custody, shared across processes, for exact canonical output and
 * manifest/metadata directories. No waiting, retries, stale-lock reclamation or
 * nested-output exclusion claim. The caller owns the scope; watch may retain it.
 * Only this token is released. A crash (or failed token write) leaves a fail-closed
 * lock for explicit operator recovery, never an automatically stolen lease.
 * Construction is lazy. Check-only/LSP must not call this operation.
 */
export const acquireOutputOwner = Effect.fnUntraced(function* (resources: OutputResources) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const directories = yield* resourceSet(resources);
  const token = yield* crypto.randomUUIDv4;
  const scope = yield* Scope.fork(yield* Scope.Scope);

  return yield* Effect.gen(function* () {
    for (const directory of directories) {
      yield* fs.makeDirectory(directory, { recursive: true });
      const lock = path.join(directory, lockName);
      yield* Effect.acquireRelease(
        fs.writeFileString(lock, token, { flag: "wx", mode: 0o600 }).pipe(
          Effect.catchReason("PlatformError", "AlreadyExists", () =>
            Effect.fail(
              new OutputBusy({
                resource: directory,
                message: "effx output is already owned: " + directory + " (" + lock + ")",
              }),
            ),
          ),
        ),
        () =>
          Effect.gen(function* () {
            const current = yield* fs
              .readFileString(lock)
              .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));

            if (current === token) yield* fs.remove(lock);
          }).pipe(
            Effect.catch((error) =>
              Effect.logError("failed to release effx output custody", error),
            ),
          ),
      );
    }

    return { [authority]: true, resources: directories, token } satisfies OutputOwner;
  }).pipe(
    Scope.provide(scope),
    Effect.onExit((exit) => (Exit.isFailure(exit) ? Scope.close(scope, exit) : Effect.void)),
    Effect.uninterruptible,
  );
});

/** Recheck authority and canonical identities before each admitted write batch. */
export const assertOutputOwner = Effect.fnUntraced(function* (
  owner: OutputOwner,
  resources: OutputResources,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directories = yield* resourceSet(resources);

  if (
    owner[authority] !== true ||
    directories.length !== owner.resources.length ||
    directories.some((directory, index) => directory !== owner.resources[index])
  ) {
    return yield* new OutputBusy({
      resource: resources.generatedDir,
      message: "output custody does not cover this build",
    });
  }

  for (const directory of directories) {
    const current = yield* fs
      .readFileString(path.join(directory, lockName))
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));

    if (current !== owner.token) {
      return yield* new OutputBusy({
        resource: directory,
        message: "effx output custody was lost: " + directory,
      });
    }
  }
});
