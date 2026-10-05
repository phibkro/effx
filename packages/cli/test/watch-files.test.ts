import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import {
  Crypto,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Option,
  Path,
  PlatformError,
  Scope,
} from "effect";
import { TestClock } from "effect/testing";
import { expectTypeOf } from "vitest";
import {
  makeWatchFiles,
  WatchClosed,
  WatchLimit,
  type WatchFiles,
  type WatchSnapshot,
} from "../src/watch-files.ts";

const fixture = Effect.fnUntraced(
  function* <A, E, R>(
    use: (fs: FileSystem.FileSystem, path: Path.Path, dir: string) => Effect.Effect<A, E, R>,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const dir = yield* fs.makeTempDirectoryScoped({ prefix: "effx-watch-files-" });

    return yield* use(fs, path, dir);
  },
  Effect.scoped,
  Effect.provide(BunServices.layer),
);

const observe = Effect.fnUntraced(function* (watch: WatchFiles) {
  const result = yield* watch.poll;
  assert.isTrue(Option.isSome(result));

  return Option.getOrThrow(result);
});

describe("explicit native project observation (EX-0031)", () => {
  it("constructs without resolving services or touching disk and preserves channels", () => {
    const value = makeWatchFiles({ inputs: [{ path: "/not-opened", kind: "source" }] });
    expectTypeOf(value).toEqualTypeOf<
      Effect.Effect<
        WatchFiles,
        WatchLimit,
        FileSystem.FileSystem | Path.Path | Crypto.Crypto | Scope.Scope
      >
    >();
    expectTypeOf(value).not.toEqualTypeOf<Effect.Effect<WatchFiles, WatchLimit>>();
    expectTypeOf<WatchFiles["poll"]>().toEqualTypeOf<
      Effect.Effect<
        Option.Option<WatchSnapshot>,
        PlatformError.PlatformError | WatchLimit | WatchClosed
      >
    >();
    expectTypeOf<WatchFiles["poll"]>().not.toEqualTypeOf<
      Effect.Effect<Option.Option<WatchSnapshot>>
    >();
    expectTypeOf<WatchFiles["start"]>().toEqualTypeOf<Effect.Effect<void, WatchClosed>>();
  });

  it.effect("detects equal-size edits, repair, atomic replacement, deletion and recreation", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const name = path.join(dir, "source.ts");
        yield* fs.writeFileString(name, "good");
        const watch = yield* makeWatchFiles({ inputs: [{ path: name, kind: "source" }] });
        const initial = yield* observe(watch);
        assert.deepStrictEqual(yield* watch.takeChanges, { dirty: false, executableDirty: false });
        yield* fs.writeFileString(name, "oops");
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, [name]);
        yield* fs.writeFileString(name, "good");
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, [name]);
        const replacement = path.join(dir, "replacement");
        yield* fs.writeFileString(replacement, "good");
        yield* fs.rename(replacement, name);
        const atomic = yield* observe(watch);
        assert.deepStrictEqual(atomic.changedPaths, [name]);
        assert.notDeepEqual(atomic.fingerprints, initial.fingerprints);
        yield* fs.remove(name);
        assert.strictEqual((yield* observe(watch)).fingerprints[0]?.entries[0]?.type, "missing");
        yield* fs.writeFileString(name, "good");
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, [name]);
      }),
    ),
  );

  it.effect("observes sorted membership, directory creation, rename and deletion", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const root = path.join(dir, "src");

        const watch = yield* makeWatchFiles({
          inputs: [{ path: root, kind: "source", directory: true, recursive: true }],
        });

        yield* observe(watch);
        yield* fs.makeDirectory(root);
        yield* fs.makeDirectory(path.join(root, "nested"));
        yield* fs.writeFileString(path.join(root, "nested", "a.ts"), "a");
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, [root]);
        yield* fs.rename(path.join(root, "nested"), path.join(root, "renamed"));
        const renamed = yield* observe(watch);
        assert.deepStrictEqual(renamed.changedPaths, [root]);
        assert.isTrue(
          renamed.fingerprints[0]?.entries.some((entry) => entry.path.endsWith("renamed/a.ts")),
        );
        yield* fs.remove(root, { recursive: true });
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, [root]);
      }),
    ),
  );

  it.effect("detects an outside-root link route retarget even with equal target bytes", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const a = yield* fs.makeTempDirectoryScoped({ prefix: "effx-target-a-" });
        const b = yield* fs.makeTempDirectoryScoped({ prefix: "effx-target-b-" });
        yield* fs.writeFileString(path.join(a, "dep.ts"), "same");
        yield* fs.writeFileString(path.join(b, "dep.ts"), "same");
        const link = path.join(dir, "dependency");
        yield* fs.symlink(a, link);
        const name = path.join(link, "dep.ts");
        const watch = yield* makeWatchFiles({ inputs: [{ path: name, kind: "source" }] });
        yield* observe(watch);
        yield* fs.remove(link);
        yield* fs.symlink(b, link);
        const result = yield* observe(watch);
        assert.deepStrictEqual(result.changedPaths, [name]);
        assert.isTrue(
          result.fingerprints[0]?.entries.some(
            (entry) => entry.path === link && entry.destination === b,
          ),
        );
      }),
    ),
  );

  it.effect("tracks same-name membership links without traversing undeclared targets", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const outside = yield* fs.makeTempDirectoryScoped({ prefix: "effx-unobserved-" });
        yield* fs.writeFileString(path.join(outside, "large.ts"), "too many bytes");
        const root = path.join(dir, "src");
        yield* fs.makeDirectory(root);
        const link = path.join(root, "linked");
        yield* fs.symlink(outside, link);

        const watch = yield* makeWatchFiles({
          inputs: [{ path: root, kind: "source", directory: true, recursive: true }],
          maxFileBytes: 1,
        });

        const baseline = yield* observe(watch);
        assert.isFalse(
          baseline.fingerprints[0]?.entries.some((entry) => entry.path.endsWith("large.ts")),
        );
        yield* fs.remove(link);
        yield* fs.symlink(dir, link);
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, [root]);
      }),
    ),
  );

  it.effect("bounds traversal and bytes and retains the actionable fault", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        for (let index = 0; index < 20; index++)
          yield* fs.writeFileString(path.join(dir, `${index}.ts`), "1234");

        const bounded = yield* makeWatchFiles({
          inputs: [{ path: dir, kind: "source", directory: true }],
          maxPaths: 10,
        });

        const traversal = yield* Effect.flip(bounded.poll);
        assert.strictEqual(traversal._tag, "WatchLimit");
        assert.strictEqual((yield* bounded.current).error, traversal);

        const bytes = yield* makeWatchFiles({
          inputs: [{ path: path.join(dir, "0.ts"), kind: "source" }],
          maxFileBytes: 3,
        });

        const failure = yield* Effect.flip(bytes.poll);
        assert.strictEqual(failure._tag, "WatchLimit");

        if (failure._tag === "WatchLimit") assert.strictEqual(failure.resource, "fileBytes");

        const total = yield* makeWatchFiles({
          inputs: [
            { path: path.join(dir, "0.ts"), kind: "source" },
            { path: path.join(dir, "1.ts"), kind: "source" },
          ],
          maxBytes: 7,
        });

        const aggregate = yield* Effect.flip(total.poll);

        if (aggregate._tag === "WatchLimit") assert.strictEqual(aggregate.resource, "bytes");
        else assert.fail("expected aggregate byte limit");
      }),
    ),
  );

  it.effect("replaces coverage and OR-retains executable intent across source changes", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const config = path.join(dir, "config.ts");
        const source = path.join(dir, "source.ts");
        yield* fs.writeFileString(config, "a");
        yield* fs.writeFileString(source, "a");

        const watch = yield* makeWatchFiles({
          inputs: [
            { path: config, kind: "executable" },
            { path: source, kind: "source" },
          ],
        });

        yield* observe(watch);
        yield* fs.writeFileString(config, "b");
        yield* observe(watch);
        yield* fs.writeFileString(source, "b");
        yield* observe(watch);
        assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
        assert.deepStrictEqual(yield* watch.takeChanges, { dirty: false, executableDirty: false });
        yield* watch.replaceInputs([
          { path: source, kind: "source" },
          { path: config, kind: "executable" },
        ]);
        assert.deepStrictEqual(yield* watch.takeChanges, { dirty: false, executableDirty: false });
        yield* watch.replaceInputs([{ path: source, kind: "source" }]);
        assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
        yield* fs.writeFileString(config, "c");
        const result = yield* observe(watch);
        assert.strictEqual(result.fingerprints.length, 1);
        assert.deepStrictEqual(result.changedPaths, []);
      }),
    ),
  );

  it.effect("uses caller-resolved exclusions and rejects explicit overlap", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const out = path.join(dir, "custom-output");
        yield* fs.makeDirectory(out);
        yield* fs.writeFileString(path.join(out, "large"), "123456789");

        const watch = yield* makeWatchFiles({
          inputs: [{ path: dir, kind: "source", directory: true, recursive: true }],
          exclusions: [out],
          maxFileBytes: 1,
        });

        const result = yield* observe(watch);
        assert.isFalse(result.fingerprints[0]?.entries.some((entry) => entry.path.startsWith(out)));
        assert.strictEqual(
          (yield* Effect.flip(watch.replaceInputs([{ path: out, kind: "source" }])))._tag,
          "WatchLimit",
        );
      }),
    ),
  );

  it.effect("polls via the Effect clock, wakes change waiters, and stops idempotently", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const name = path.join(dir, "a.ts");
        yield* fs.writeFileString(name, "a");
        const watch = yield* makeWatchFiles({ inputs: [{ path: name, kind: "source" }] });
        yield* watch.start;
        yield* watch.start;
        const baseline = yield* watch.waitForPass(0);
        const waiting = yield* Effect.forkChild(watch.awaitChanges);
        yield* fs.writeFileString(name, "b");
        yield* TestClock.adjust(250);
        const updated = yield* watch.waitForPass(baseline.pass);
        yield* Fiber.join(waiting);
        assert.deepStrictEqual(updated.changedPaths, [name]);
        yield* watch.stop;
        yield* watch.stop;
        yield* TestClock.adjust(1000);
        assert.strictEqual((yield* watch.current).pass, updated.pass);
        assert.deepStrictEqual((yield* watch.current).fingerprints, []);
        assert.strictEqual((yield* Effect.flip(watch.start))._tag, "WatchClosed");
        assert.strictEqual((yield* Effect.flip(watch.awaitChanges))._tag, "WatchClosed");
      }),
    ),
  );

  it.effect("refuses pending passes, discards stale coverage and joins interrupted IO", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        let finalizers = 0;
        const name = path.join(dir, "a.ts");
        yield* fs.writeFileString(name, "a");
        const original = fs.open;

        const controlled = {
          ...fs,
          open: Effect.fnUntraced(function* (...args: Parameters<typeof original>) {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  finalizers++;
                }),
              ),
            );

            return yield* original(...args);
          }),
        };

        const watch = yield* makeWatchFiles({ inputs: [{ path: name, kind: "source" }] }).pipe(
          Effect.provideService(FileSystem.FileSystem, controlled),
        );

        const first = yield* Effect.forkChild(watch.poll);
        yield* Deferred.await(entered);

        for (let index = 0; index < 50; index++) assert.isTrue(Option.isNone(yield* watch.poll));
        yield* watch.replaceInputs([]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(first);
        assert.deepStrictEqual((yield* watch.current).fingerprints, []);
        assert.strictEqual((yield* watch.current).pass, 0);
        yield* observe(watch);
        yield* watch.stop;
        assert.strictEqual(finalizers, 1);
      }),
    ),
  );

  it.effect("owner interruption releases active native pass and makes escaped handles closed", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const entered = yield* Deferred.make<WatchFiles>();
        const opened = yield* Deferred.make<void>();
        let releases = 0;
        const name = path.join(dir, "a.ts");
        yield* fs.writeFileString(name, "a");

        const controlled = {
          ...fs,
          open: Effect.fnUntraced(function* () {
            yield* Deferred.succeed(opened, undefined);

            return yield* Effect.never.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  releases++;
                }),
              ),
            );
          }),
        };

        const user = yield* Effect.forkChild(
          Effect.scoped(
            Effect.gen(function* () {
              const watch = yield* makeWatchFiles({ inputs: [{ path: name, kind: "source" }] });
              yield* Deferred.succeed(entered, watch);
              yield* watch.start;

              return yield* Effect.never;
            }).pipe(Effect.provideService(FileSystem.FileSystem, controlled)),
          ),
        );

        const watch = yield* Deferred.await(entered);
        yield* Deferred.await(opened);
        yield* Fiber.interrupt(user);
        assert.isTrue(Exit.isFailure(yield* Fiber.await(user)));
        assert.strictEqual(releases, 1);
        assert.strictEqual((yield* Effect.flip(watch.poll))._tag, "WatchClosed");
        assert.deepStrictEqual((yield* watch.current).fingerprints, []);
      }),
    ),
  );

  it.effect("observes missing ancestors and repairs a non-directory resolution route", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const parent = path.join(dir, "future");
        const name = path.join(parent, "nested", "dep.ts");
        const watch = yield* makeWatchFiles({ inputs: [{ path: name, kind: "source" }] });

        yield* observe(watch);
        yield* fs.writeFileString(parent, "not a directory");
        yield* observe(watch);
        yield* fs.remove(parent);
        yield* fs.makeDirectory(path.dirname(name), { recursive: true });
        yield* fs.writeFileString(name, "created");
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, [name]);
      }),
    ),
  );

  it.effect("preserves declared directory aliases and skips implicit node_modules traversal", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const external = yield* fs.makeTempDirectoryScoped({ prefix: "effx-explicit-directory-" });
        const alias = path.join(dir, "alias");
        yield* fs.symlink(external, alias);
        yield* fs.makeDirectory(path.join(external, "node_modules"));
        yield* fs.writeFileString(path.join(external, "node_modules", "unrelated"), "too large");
        yield* fs.writeFileString(path.join(external, "dep.ts"), "a");

        const watch = yield* makeWatchFiles({
          inputs: [
            { path: external, kind: "source", directory: true, recursive: true },
            { path: alias, kind: "source", directory: true, recursive: true },
          ],
          maxFileBytes: 1,
        });

        yield* observe(watch);
        yield* fs.writeFileString(path.join(external, "dep.ts"), "b");

        const changed = yield* observe(watch);
        assert.deepStrictEqual(changed.changedPaths, [external, alias]);
        assert.strictEqual(changed.fingerprints.length, 2);
        assert.isFalse(
          changed.fingerprints.some((fingerprint) =>
            fingerprint.entries.some((entry) => entry.path.endsWith("unrelated")),
          ),
        );
      }),
    ),
  );

  it.effect(
    "keeps permission failures typed and retains executable intent on failed observation",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const failure = PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "readLink",
            pathOrDescriptor: dir,
          });

          const controlled = { ...fs, readLink: () => Effect.fail(failure) };

          const watch = yield* makeWatchFiles({
            inputs: [{ path: path.join(dir, "config.ts"), kind: "executable" }],
          }).pipe(Effect.provideService(FileSystem.FileSystem, controlled));

          assert.strictEqual(yield* Effect.flip(watch.poll), failure);
          assert.strictEqual((yield* watch.current).error, failure);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
        }),
      ),
  );

  it.effect("closing a successful or failing owner stops escaped observer handles", () =>
    fixture((_fs, _path, _dir) =>
      Effect.gen(function* () {
        const succeeded = yield* Effect.scoped(makeWatchFiles({ inputs: [] }));
        assert.strictEqual((yield* Effect.flip(succeeded.start))._tag, "WatchClosed");

        const acquired = yield* Deferred.make<WatchFiles>();
        const failure = new WatchLimit({ resource: "selection", path: "test-owner", limit: 1 });

        const failed = yield* Effect.flip(
          Effect.scoped(
            Effect.gen(function* () {
              const watch = yield* makeWatchFiles({ inputs: [] });
              yield* Deferred.succeed(acquired, watch);
              yield* watch.start;

              return yield* failure;
            }),
          ),
        );

        assert.strictEqual(failed, failure);

        const escaped = yield* Deferred.await(acquired);
        assert.strictEqual((yield* Effect.flip(escaped.poll))._tag, "WatchClosed");
        assert.deepStrictEqual((yield* escaped.current).fingerprints, []);
      }),
    ),
  );

  it.effect(
    "walks ordinary and nested membership under explicit node_modules roots and aliases",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const root = path.join(dir, "node_modules");
          const nested = path.join(root, "outer", "node_modules", "inner");
          const alias = path.join(dir, "declared-dependencies");
          const name = path.join(nested, "dep.ts");
          yield* fs.makeDirectory(nested, { recursive: true });
          yield* fs.writeFileString(name, "a");
          yield* fs.symlink(root, alias);

          const watch = yield* makeWatchFiles({
            inputs: [
              { path: root, kind: "source", directory: true, recursive: true },
              { path: alias, kind: "source", directory: true, recursive: true },
            ],
            maxPaths: 128,
            maxBytes: 1024,
            maxFileBytes: 64,
          });

          const initial = yield* observe(watch);
          const before = initial.fingerprints[0]?.entries.find((entry) => entry.path === name);
          assert.strictEqual(before?.type, "file");
          assert.isTrue(before?.digest !== undefined && before.digest.length > 0);
          yield* fs.writeFileString(name, "b");

          const edited = yield* observe(watch);
          assert.deepStrictEqual(edited.changedPaths, [root, alias]);
          assert.notStrictEqual(
            edited.fingerprints[0]?.entries.find((entry) => entry.path === name)?.digest,
            before?.digest,
          );
          yield* fs.rename(name, path.join(nested, "renamed.ts"));
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [root, alias]);
          yield* fs.remove(path.join(nested, "renamed.ts"));
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [root, alias]);
        }),
      ),
  );
});
