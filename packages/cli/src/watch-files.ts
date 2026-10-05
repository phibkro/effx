import {
  Crypto,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Latch,
  Option,
  Path,
  PlatformError,
  Schema,
  Scope,
  Semaphore,
} from "effect";
import { Hex } from "effect/encoding";

export interface WatchInput {
  readonly path: string;
  readonly kind: "source" | "executable";
  readonly directory?: boolean;
  readonly recursive?: boolean;
}

export interface WatchFilesOptions {
  readonly inputs: ReadonlyArray<WatchInput>;
  /** Absolute, resolved subtree exclusions. Explicit inputs overlapping them fail admission. */
  readonly exclusions?: ReadonlyArray<string>;
  readonly maxPaths?: number;
  readonly maxBytes?: number;
  readonly maxFileBytes?: number;
}

export class WatchLimit extends Schema.TaggedError<WatchLimit>()("WatchLimit", {
  resource: Schema.Literals(["paths", "bytes", "fileBytes", "selection", "cycle"]),
  path: Schema.String,
  limit: Schema.Int,
}) {}

export class WatchClosed extends Schema.TaggedError<WatchClosed>()("WatchClosed", {}) {}

export type WatchFailure = PlatformError.PlatformError | WatchLimit;

/** Pure data: link identity is its logical route/destination plus resolved target identity.
 * Native FileSystem has no lstat; it does not expose the link inode itself.
 */
export interface WatchEntry {
  readonly path: string;
  readonly type: "missing" | "file" | "directory" | "symlink" | "other";
  readonly identity: string;
  readonly destination: string;
  readonly digest: string;
}

export interface WatchFingerprint {
  readonly input: WatchInput;
  /** Sorted relevant membership, explicit link route and target. No arbitrary link recursion. */
  readonly entries: ReadonlyArray<WatchEntry>;
}

export interface WatchSnapshot {
  readonly pass: number;
  readonly fingerprints: ReadonlyArray<WatchFingerprint>;
  readonly changedPaths: ReadonlyArray<string>;
  readonly error: WatchFailure | undefined;
}

export interface WatchChanges {
  readonly dirty: boolean;
  readonly executableDirty: boolean;
}

export interface WatchFiles {
  readonly replaceInputs: (
    inputs: ReadonlyArray<WatchInput>,
    /** Omit to retain exclusions; supply [] to clear. Inputs and exclusions change atomically. */
    exclusions?: ReadonlyArray<string>,
  ) => Effect.Effect<void, WatchLimit | WatchClosed>;
  /** Refuses concurrent passes immediately (None); no waiting producers. */
  readonly poll: Effect.Effect<Option.Option<WatchSnapshot>, WatchFailure | WatchClosed>;
  readonly current: Effect.Effect<WatchSnapshot>;
  readonly takeChanges: Effect.Effect<WatchChanges>;
  readonly awaitChanges: Effect.Effect<void, WatchClosed>;
  readonly waitForPass: (after: number) => Effect.Effect<WatchSnapshot, WatchClosed>;
  readonly start: Effect.Effect<void, WatchClosed>;
  /** Terminal, idempotent: joins the poller, discards retained state, wakes waiters. */
  readonly stop: Effect.Effect<void>;
}

export const sameFingerprint = (a: WatchFingerprint, b: WatchFingerprint): boolean =>
  a.entries.length === b.entries.length &&
  a.entries.every((entry, index) => {
    const other = b.entries[index];

    return (
      other !== undefined &&
      entry.path === other.path &&
      entry.type === other.type &&
      entry.identity === other.identity &&
      entry.destination === other.destination &&
      entry.digest === other.digest
    );
  });

const nonLink = Schema.is(Schema.Struct({ code: Schema.Literal("EINVAL") }));

const notDirectory = Schema.is(Schema.Struct({ code: Schema.Literal("ENOTDIR") }));

/** EX-0031: sequential native observation of caller-declared coverage, not discovery.
 * Construction is lazy. The caller scope owns one polling fiber; start is idempotent.
 * One pass is active, zero passes wait, and one dirty state coalesces notifications.
 * Executable intent is OR-retained until takeChanges, including coverage replacement.
 * Defaults admit 8192 paths (including routes/parents), 64 MiB/pass and 16 MiB/file.
 * Explicit logical routes expand successive raw link targets under the same path
 * and unresolved-component budgets; repeated route states fail with WatchLimit "cycle".
 * replaceInputs may atomically replace resolved exclusions; every pass captures
 * its coverage and exclusion policy, retaining unchanged fingerprints on cutover.
 * Directory listing IO returns a whole native array; these are retained/admitted
 * coverage bounds, not a constant-memory claim about arbitrarily large listings.
 * Polling starts immediately then sleeps 250 ms after completion. Typed faults are
 * retained for the parent and retried on the next pass; defects are not recovered.
 * No config evaluation, disk mutation, callbacks, native watchers or global runtime.
 */
export const makeWatchFiles = Effect.fnUntraced(function* (
  options: WatchFilesOptions,
): Effect.fn.Return<
  WatchFiles,
  WatchLimit,
  FileSystem.FileSystem | Path.Path | Crypto.Crypto | Scope.Scope
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const owner = yield* Effect.scope;
  const gate = yield* Semaphore.make(1);
  const dirtySignal = yield* Latch.make();
  let milestone = yield* Deferred.make<void>();
  const stopped = yield* Deferred.make<void>();
  const maxPaths = options.maxPaths ?? 8192;
  const maxBytes = options.maxBytes ?? 64 * 1024 * 1024;
  const maxFileBytes = options.maxFileBytes ?? 16 * 1024 * 1024;

  for (const limit of [maxPaths, maxBytes, maxFileBytes]) {
    if (!Number.isSafeInteger(limit) || limit <= 0)
      return yield* new WatchLimit({ resource: "selection", path: "", limit: 0 });
  }

  let exclusions = [
    ...new Set((options.exclusions ?? []).map((name) => path.resolve(name))),
  ].sort();

  const excluded = (name: string, roots: ReadonlyArray<string> = exclusions) =>
    roots.some(
      (root) => name === root || name.startsWith(root.endsWith(path.sep) ? root : root + path.sep),
    );

  const admit = Effect.fnUntraced(function* (
    values: ReadonlyArray<WatchInput>,
    roots: ReadonlyArray<string> = exclusions,
  ) {
    if (values.length > maxPaths || roots.length > maxPaths)
      return yield* new WatchLimit({ resource: "paths", path: "", limit: maxPaths });
    const result: Array<WatchInput> = [];

    for (const input of values) {
      const name = path.resolve(input.path);

      if (!path.isAbsolute(input.path) || excluded(name, roots))
        return yield* new WatchLimit({ resource: "selection", path: input.path, limit: maxPaths });
      result.push({ ...input, path: name });
    }

    return result;
  });

  let inputs = yield* admit(options.inputs);
  let epoch = 0;
  let closed = false;
  let polling: Fiber.Fiber<void> | undefined;
  let active: Fiber.Fiber<WatchSnapshot, WatchFailure | WatchClosed> | undefined;
  let dirty = false;
  let executableDirty = false;
  let snapshot: WatchSnapshot = { pass: 0, fingerprints: [], changedPaths: [], error: undefined };

  const signal = Effect.sync(() => {
    dirty = true;
    dirtySignal.openUnsafe();
  });

  const notifyPass = Effect.fnUntraced(function* () {
    const previous = milestone;
    milestone = yield* Deferred.make<void>();
    yield* Deferred.succeed(previous, undefined);
  });

  const scan = Effect.fnUntraced(function* (
    coverage: ReadonlyArray<WatchInput>,
    selectedExclusions: ReadonlyArray<string>,
  ) {
    let bytes = 0;
    let admitted = 0;

    const count = Effect.fnUntraced(function* (name: string) {
      admitted++;

      if (admitted > maxPaths)
        return yield* new WatchLimit({ resource: "paths", path: name, limit: maxPaths });
    });

    const link = Effect.fnUntraced(function* (name: string) {
      return yield* fs.readLink(name).pipe(
        Effect.asSome,
        Effect.catchIf(
          (error) =>
            error.reason._tag === "NotFound" ||
            nonLink(error.reason.cause) ||
            (error.reason._tag === "BadResource" && notDirectory(error.reason.cause)),
          () => Effect.succeed(Option.none<string>()),
        ),
      );
    });

    const info = Effect.fnUntraced(function* (name: string) {
      return yield* fs.stat(name).pipe(
        Effect.asSome,
        Effect.catchReason("PlatformError", "NotFound", () =>
          Effect.succeed(Option.none<FileSystem.File.Info>()),
        ),
        Effect.catchIf(
          (error) => error.reason._tag === "BadResource" && notDirectory(error.reason.cause),
          () => Effect.succeed(Option.none<FileSystem.File.Info>()),
        ),
      );
    });

    const identity = (stat: FileSystem.File.Info, real: string) =>
      `${real}:${stat.dev}:${Option.getOrElse(stat.ino, () => -1)}:${stat.mode}`;

    const fingerprints: Array<WatchFingerprint> = [];

    for (const input of coverage) {
      const entries = new Map<string, WatchEntry>();
      const visited = new Set<string>();
      let declaredDependencyRoot = input.path.split(path.sep).includes("node_modules");

      const visit = Effect.fnUntraced(function* (
        name: string,
        enumerate: boolean,
        recurse: boolean,
        explicit: boolean,
      ): Effect.fn.Return<void, WatchFailure> {
        if (excluded(name, selectedExclusions)) return;
        yield* count(name);
        const destination = yield* link(name);
        const stat = yield* info(name);

        if (Option.isNone(stat)) {
          let parent = path.dirname(name);
          let parentInfo = yield* info(parent);

          while (Option.isNone(parentInfo) && parent !== path.dirname(parent)) {
            yield* count(parent);
            parent = path.dirname(parent);
            parentInfo = yield* info(parent);
          }

          yield* count(parent);

          const parentIdentity = Option.isSome(parentInfo)
            ? identity(parentInfo.value, yield* fs.realPath(parent))
            : "";

          entries.set(name, {
            path: name,
            type: Option.isSome(destination) ? "symlink" : "missing",
            identity: parentIdentity,
            destination: Option.getOrElse(destination, () => ""),
            digest: "",
          });

          return;
        }

        const real = yield* fs.realPath(name);

        if (explicit) declaredDependencyRoot ||= real.split(path.sep).includes("node_modules");

        if (excluded(real, selectedExclusions))
          return yield* new WatchLimit({ resource: "selection", path: name, limit: maxPaths });
        const physical = identity(stat.value, real);

        const type = Option.isSome(destination)
          ? "symlink"
          : stat.value.type === "File"
            ? "file"
            : stat.value.type === "Directory"
              ? "directory"
              : "other";

        let digest = "";

        if (stat.value.type === "File" && (explicit || Option.isNone(destination))) {
          digest = yield* Effect.scoped(
            Effect.gen(function* () {
              const file = yield* fs.open(name);
              const chunks: Array<Uint8Array> = [];
              let length = 0;

              while (true) {
                const chunk = yield* file.readAlloc(
                  Math.min(64 * 1024, maxFileBytes - length + 1, maxBytes - bytes + 1),
                );

                if (Option.isNone(chunk)) break;
                length += chunk.value.length;
                bytes += chunk.value.length;

                if (length > maxFileBytes)
                  return yield* new WatchLimit({
                    resource: "fileBytes",
                    path: name,
                    limit: maxFileBytes,
                  });

                if (bytes > maxBytes)
                  return yield* new WatchLimit({ resource: "bytes", path: name, limit: maxBytes });
                chunks.push(chunk.value);
              }

              const content = new Uint8Array(length);
              let offset = 0;

              for (const chunk of chunks) {
                content.set(chunk, offset);
                offset += chunk.length;
              }

              return Hex.encode(yield* crypto.digest("SHA-256", content));
            }),
          );
        }

        entries.set(name, {
          path: name,
          type,
          identity: physical,
          destination: Option.getOrElse(destination, () => ""),
          digest,
        });

        if (
          stat.value.type !== "Directory" ||
          !enumerate ||
          (Option.isSome(destination) && !explicit) ||
          visited.has(real)
        )
          return;
        visited.add(real);
        const names = (yield* fs.readDirectory(name, { recursive: false })).sort();

        for (const child of names) {
          const childPath = path.join(name, child);

          if (excluded(childPath, selectedExclusions)) continue;
          // Recursive executable declarations authorize ordinary dependency subtrees; source enumeration does not.
          yield* visit(
            childPath,
            recurse &&
              (input.kind === "executable" || declaredDependencyRoot || child !== "node_modules"),
            recurse,
            false,
          );
        }
      });
      // Follow only this declared route, expanding raw destinations component by
      // component. Resolving '..' after preceding links matches filesystem meaning.
      // Parent membership is limited to the next selected component, not siblings.

      let routeRoot = path.parse(input.path).root;

      let components = input.path
        .slice(routeRoot.length)
        .split(path.sep)
        .filter((part) => part.length > 0);

      if (components.length > maxPaths)
        return yield* new WatchLimit({ resource: "paths", path: input.path, limit: maxPaths });

      let componentIndex = 0;
      const expandedLinks = new Set<string>();

      while (componentIndex < components.length) {
        const component = components[componentIndex++];

        if (component === undefined || component === ".") continue;

        if (component === "..") {
          routeRoot = path.dirname(routeRoot);
          continue;
        }

        const name = path.join(routeRoot, component);
        yield* count(name);

        if (excluded(name, selectedExclusions))
          return yield* new WatchLimit({ resource: "selection", path: name, limit: maxPaths });

        const destination = yield* link(name);

        if (Option.isSome(destination)) {
          const routeState = name + "\0" + components.slice(componentIndex).join(path.sep);

          if (expandedLinks.has(routeState))
            return yield* new WatchLimit({ resource: "cycle", path: name, limit: maxPaths });

          expandedLinks.add(routeState);
          entries.set(name, {
            path: name,
            type: "symlink",
            identity: "",
            destination: destination.value,
            digest: "",
          });
          routeRoot = path.isAbsolute(destination.value)
            ? path.parse(destination.value).root
            : path.dirname(name);

          const target = path.isAbsolute(destination.value)
            ? destination.value.slice(routeRoot.length)
            : destination.value;

          const targetComponents = target.split(path.sep).filter((part) => part.length > 0);

          if (targetComponents.length + components.length - componentIndex > maxPaths)
            return yield* new WatchLimit({ resource: "paths", path: name, limit: maxPaths });

          components = [...targetComponents, ...components.slice(componentIndex)];
          componentIndex = 0;
          continue;
        }

        const stat = yield* info(name);

        if (Option.isNone(stat)) {
          yield* count(routeRoot);

          const ancestor = yield* info(routeRoot);

          const ancestorIdentity = Option.isSome(ancestor)
            ? identity(ancestor.value, yield* fs.realPath(routeRoot))
            : "";

          const unresolved =
            name +
            (componentIndex < components.length
              ? path.sep + components.slice(componentIndex).join(path.sep)
              : "");

          entries.set(name, {
            path: name,
            type: "missing",
            identity: ancestorIdentity,
            destination: "",
            digest: "",
          });

          if (unresolved !== name) {
            yield* count(unresolved);
            entries.set(unresolved, {
              path: unresolved,
              type: "missing",
              identity: ancestorIdentity,
              destination: "",
              digest: "",
            });
          }

          break;
        }

        const real = yield* fs.realPath(name);

        if (excluded(real, selectedExclusions))
          return yield* new WatchLimit({ resource: "selection", path: name, limit: maxPaths });

        entries.set(name, {
          path: name,
          type:
            stat.value.type === "Directory"
              ? "directory"
              : stat.value.type === "File"
                ? "file"
                : "other",
          identity: identity(stat.value, real),
          destination: "",
          digest: "",
        });
        routeRoot = real;
      }

      yield* visit(input.path, input.directory === true, input.recursive === true, true);
      fingerprints.push({
        input,
        entries: [...entries.values()].sort((a, b) =>
          a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
        ),
      });
    }

    return fingerprints;
  });

  const pass = Effect.fnUntraced(function* () {
    if (closed) return yield* new WatchClosed();
    const version = epoch;
    const coverage = inputs;

    const result = yield* scan(coverage, exclusions).pipe(
      Effect.match({
        onFailure: (error) => ({ error, fingerprints: undefined }),
        onSuccess: (fingerprints) => ({ error: undefined, fingerprints }),
      }),
    );

    if (closed || epoch !== version) return snapshot;
    const changedPaths: Array<string> = [];

    if (result.fingerprints !== undefined) {
      for (const fingerprint of result.fingerprints) {
        const previous = snapshot.fingerprints.find(
          (old) =>
            old.input.path === fingerprint.input.path && old.input.kind === fingerprint.input.kind,
        );

        if (previous !== undefined && !sameFingerprint(previous, fingerprint)) {
          changedPaths.push(fingerprint.input.path);
          executableDirty ||= fingerprint.input.kind === "executable";
        }
      }
    }

    if (result.error !== undefined)
      executableDirty ||= coverage.some((input) => input.kind === "executable");

    snapshot = {
      pass: snapshot.pass + 1,
      fingerprints: result.fingerprints ?? snapshot.fingerprints,
      changedPaths,
      error: result.error,
    };

    if (changedPaths.length > 0 || result.error !== undefined) yield* signal;
    yield* notifyPass();

    if (result.error !== undefined) return yield* result.error;

    return snapshot;
  });

  const poll = Effect.fnUntraced(function* () {
    if (closed) return yield* new WatchClosed();

    return yield* gate.withPermitsIfAvailable(1)(
      Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          if (closed) return yield* new WatchClosed();
          const running = yield* Effect.forkIn(pass(), owner, { uninterruptible: false });
          active = running;

          return yield* restore(Fiber.join(running)).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                yield* Fiber.interrupt(running);
                active = undefined;
              }),
            ),
          );
        }),
      ),
    );
  });

  const stop = Effect.fnUntraced(function* () {
    if (closed) return yield* Deferred.await(stopped);
    closed = true;

    if (polling !== undefined) yield* Fiber.interrupt(polling);

    if (active !== undefined) yield* Fiber.interrupt(active);
    inputs = [];
    snapshot = { pass: snapshot.pass, fingerprints: [], changedPaths: [], error: undefined };
    dirty = false;
    executableDirty = false;
    dirtySignal.openUnsafe();
    yield* notifyPass();
    yield* Deferred.succeed(stopped, undefined);
  }, Effect.uninterruptible);

  yield* Effect.addFinalizer(() => stop());

  const start = Effect.fnUntraced(function* () {
    if (closed) return yield* new WatchClosed();

    if (polling !== undefined) return;
    polling = yield* Effect.forkIn(
      Effect.gen(function* () {
        while (!closed) {
          yield* poll().pipe(
            Effect.catch((error) => (error._tag === "WatchClosed" ? Effect.void : signal)),
          );
          yield* Effect.sleep("250 millis");
        }
      }),
      owner,
    );
  }, Effect.uninterruptible);

  const sameInput = (a: WatchInput, b: WatchInput) =>
    a.path === b.path &&
    a.kind === b.kind &&
    (a.directory === true) === (b.directory === true) &&
    (a.recursive === true) === (b.recursive === true);

  const replaceInputs = Effect.fnUntraced(function* (
    values: ReadonlyArray<WatchInput>,
    nextExclusions?: ReadonlyArray<string>,
  ) {
    if (closed) return yield* new WatchClosed();

    const replacementExclusions =
      nextExclusions === undefined
        ? exclusions
        : [...new Set(nextExclusions.map((name) => path.resolve(name)))].sort();

    const replacement = yield* admit(values, replacementExclusions);

    if (
      inputs.length === replacement.length &&
      inputs.every((input) => replacement.some((next) => sameInput(input, next))) &&
      exclusions.length === replacementExclusions.length &&
      exclusions.every((name, index) => name === replacementExclusions[index])
    )
      return;

    executableDirty ||=
      inputs.some(
        (input) =>
          input.kind === "executable" && !replacement.some((next) => sameInput(input, next)),
      ) ||
      replacement.some(
        (input) =>
          input.kind === "executable" && !inputs.some((previous) => sameInput(input, previous)),
      );
    inputs = replacement;
    exclusions = replacementExclusions;
    epoch++;
    snapshot = {
      ...snapshot,
      fingerprints: snapshot.fingerprints.filter((old) =>
        inputs.some((input) => sameInput(input, old.input)),
      ),
      changedPaths: [],
    };
    yield* signal;
  });

  const waitForPass = Effect.fnUntraced(function* (after: number) {
    while (!closed && snapshot.pass <= after) yield* Deferred.await(milestone);

    if (closed) return yield* new WatchClosed();

    return snapshot;
  });

  const awaitChanges = Effect.gen(function* () {
    yield* dirtySignal.await;

    if (closed) return yield* new WatchClosed();
  });

  const takeChanges = Effect.sync(() => {
    const result = { dirty, executableDirty };
    dirty = false;
    executableDirty = false;

    if (!closed) dirtySignal.closeUnsafe();

    return result;
  });

  return {
    replaceInputs,
    poll: poll(),
    current: Effect.sync(() => snapshot),
    takeChanges,
    awaitChanges,
    waitForPass,
    start: start(),
    stop: stop(),
  };
});
