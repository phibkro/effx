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

interface OutputLease {
  readonly directory: string;
  readonly token: string;
  readonly scope: Scope.Closeable;
}

export interface OutputOwner {
  readonly [authority]: ReadonlyArray<OutputLease>;
  readonly resources: ReadonlyArray<string>;
  readonly generatedDirs: ReadonlyArray<string>;
}

const lockName = ".effx-output-owner.lock";

/** Resolve missing suffixes through their nearest existing physical parent. */
export const canonicalOutputPath = Effect.fnUntraced(function* (
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
        yield* canonicalOutputPath(path.resolve(path.dirname(candidate), link)),
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
      yield* canonicalOutputPath(resources.generatedDir),
      yield* canonicalOutputPath(resources.effxDir),
      path.dirname(yield* canonicalOutputPath(path.join(resources.effxDir, "manifest.json"))),
    ]),
  ].sort();
});

const ownerOf = (
  leases: ReadonlyArray<OutputLease>,
  generatedDirs: ReadonlyArray<string>,
): OutputOwner => ({
  [authority]: leases,
  resources: leases.map((lease) => lease.directory),
  generatedDirs,
});

const acquireDirectories = Effect.fnUntraced(function* (directories: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const parent = yield* Scope.Scope;
  const leases: Array<OutputLease> = [];

  return yield* Effect.gen(function* () {
    for (const directory of directories) {
      const token = yield* crypto.randomUUIDv4;
      const scope = yield* Scope.fork(parent);
      const lock = path.join(directory, lockName);
      leases.push({ directory, token, scope });
      yield* fs.makeDirectory(directory, { recursive: true });
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
            // Losing custody cleanup is an unrecoverable scope fault, not a
            // successful best-effort release. Keep the native IO error as the defect.
          }).pipe(Effect.orDie),
      ).pipe(Scope.provide(scope));
    }

    return leases;
  }).pipe(
    Effect.onExit((exit) =>
      Exit.isFailure(exit)
        ? Effect.forEach(leases, (lease) => Scope.close(lease.scope, exit), { discard: true })
        : Effect.void,
    ),
    Effect.uninterruptible,
  );
});

/**
 * Local filesystem exact-directory custody across processes, including canonical
 * output and manifest aliases. No waiting, stale reclamation, or nested exclusion
 * guarantee. Session scope owns each native lease; finalizers remove only its token.
 * Crash/failed token writes fail closed for explicit operator recovery. Native
 * release IO failures surface as scope defects; missing/changed tokens are not deleted.
 */
export const acquireOutputOwner = Effect.fnUntraced(function* (
  resources: OutputResources,
): Effect.fn.Return<
  OutputOwner,
  OutputBusy | PlatformError,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto | Scope.Scope
> {
  const directories = yield* resourceSet(resources);
  const generatedDir = yield* canonicalOutputPath(resources.generatedDir);
  const leases = yield* acquireDirectories(directories);

  return ownerOf(leases, [generatedDir]);
});

/** Recheck every union token; the current target must be a covered subset. */
export const assertOutputOwner = Effect.fnUntraced(function* (
  owner: OutputOwner,
  resources: OutputResources,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directories = yield* resourceSet(resources);
  const leases = owner[authority];

  if (
    leases === undefined ||
    directories.some((directory) => !owner.resources.includes(directory))
  ) {
    return yield* new OutputBusy({
      resource: resources.generatedDir,
      message: "output custody does not cover this build",
    });
  }

  for (const lease of leases) {
    const current = yield* fs
      .readFileString(path.join(lease.directory, lockName))
      .pipe(Effect.catchReason("PlatformError", "NotFound", () => Effect.void));

    if (current !== lease.token) {
      return yield* new OutputBusy({
        resource: lease.directory,
        message: "effx output custody was lost: " + lease.directory,
      });
    }
  }
});

/**
 * One serialized migration: hold old + new + metadata during use. The callback
 * includes pre-admission reconciliation and the admitted writer. Interruption or
 * failure closes only new leases and leaves the old owner usable. Success retires
 * old leases after use completes, returning the sole next owner. Callers replace
 * their retained owner only on success; no epoch history or pending work is stored.
 */
export const migrateOutputOwner = Effect.fnUntraced(function* <A, E, R>(
  owner: OutputOwner,
  resources: OutputResources,
  use: (owner: OutputOwner) => Effect.Effect<A, E, R>,
): Effect.fn.Return<
  { readonly owner: OutputOwner; readonly value: A },
  E | OutputBusy | PlatformError,
  R | FileSystem.FileSystem | Path.Path | Crypto.Crypto | Scope.Scope
> {
  if (owner.generatedDirs.length !== 1) {
    return yield* new OutputBusy({
      resource: resources.generatedDir,
      message: "nested output migration is not admitted",
    });
  }

  const directories = yield* resourceSet(resources);
  const generatedDir = yield* canonicalOutputPath(resources.generatedDir);

  return yield* Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const retained = owner[authority];

      const added = yield* acquireDirectories(
        directories.filter((directory) => !owner.resources.includes(directory)),
      );

      const union = ownerOf(
        [...retained, ...added],
        [...new Set([...owner.generatedDirs, generatedDir])],
      );

      const value = yield* restore(
        Effect.gen(function* () {
          yield* assertOutputOwner(union, resources);

          return yield* use(union);
        }),
      ).pipe(
        Effect.onExit((exit) =>
          Exit.isFailure(exit)
            ? Effect.forEach(added, (lease) => Scope.close(lease.scope, exit), { discard: true })
            : Effect.void,
        ),
      );

      const next = [...retained, ...added].filter((lease) => directories.includes(lease.directory));
      yield* Effect.forEach(
        retained.filter((lease) => !directories.includes(lease.directory)),
        (lease) => Scope.close(lease.scope, Exit.void),
        { discard: true },
      );

      return { owner: ownerOf(next, [generatedDir]), value };
    }),
  );
});
