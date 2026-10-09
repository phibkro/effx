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
    expectTypeOf<WatchFiles["replaceInputs"]>().toEqualTypeOf<
      (
        inputs: ReadonlyArray<import("../src/watch-files.ts").WatchInput>,
        exclusions?: ReadonlyArray<string>,
      ) => Effect.Effect<void, WatchLimit | WatchClosed>
    >();
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
        assert.strictEqual(
          (yield* observe(watch)).fingerprints[0]?.entries.find((entry) => entry.path === name)
            ?.type,
          "missing",
        );
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
        const released = yield* Deferred.make<void>();
        let releases = 0;
        const name = path.join(dir, "a.ts");
        yield* fs.writeFileString(name, "a");

        const original = fs.open;

        const controlled = {
          ...fs,
          open: Effect.fnUntraced(function* (...args: Parameters<typeof original>) {
            // Receipt precedes native acquisition: LIFO scope close releases the
            // real file first, then acknowledges completion of pass cleanup.
            yield* Effect.addFinalizer(() =>
              Effect.gen(function* () {
                releases++;
                yield* Deferred.succeed(released, undefined);
              }),
            );
            yield* original(...args);
            yield* Deferred.succeed(opened, undefined);

            return yield* Effect.never;
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

        const exit = yield* Fiber.await(user);
        assert.isTrue(Exit.hasInterrupts(exit));
        assert.isFalse(Exit.hasDies(exit));
        assert.isTrue(yield* Deferred.isDone(released));
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

  it.effect("covers ordinary node_modules descendants of a recursive executable declaration", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const nested = path.join(dir, "node_modules", "pkg");
        const candidate = path.join(nested, "helper.mjs");
        yield* fs.makeDirectory(nested, { recursive: true });
        yield* fs.writeFileString(candidate, "a");

        const watch = yield* makeWatchFiles({
          inputs: [{ path: dir, kind: "executable", directory: true, recursive: true }],
        });

        yield* observe(watch);
        yield* fs.writeFileString(candidate, "b");
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, [dir]);
        assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, []);
        assert.deepStrictEqual(yield* watch.takeChanges, { dirty: false, executableDirty: false });
      }),
    ),
  );

  it.effect(
    "retains successive outside-route raw destinations when terminal identity and bytes are unchanged",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const outside = yield* fs.makeTempDirectoryScoped({ prefix: "effx-successive-route-" });
          const terminal = path.join(outside, "terminal");
          const middle = path.join(outside, "middle");
          const bridge = path.join(outside, "bridge");
          const logical = path.join(dir, "entry.mjs");
          yield* fs.makeDirectory(terminal);
          yield* fs.writeFileString(path.join(terminal, "dep.mjs"), "same");
          yield* fs.symlink("terminal", middle);
          yield* fs.symlink("middle", bridge);
          yield* fs.symlink(path.join(bridge, "dep.mjs"), logical);

          const watch = yield* makeWatchFiles({ inputs: [{ path: logical, kind: "executable" }] });

          const initial = yield* observe(watch);
          const first = initial.fingerprints[0]?.entries.find((entry) => entry.path === logical);
          yield* fs.remove(bridge);
          yield* fs.symlink("middle/.", bridge);

          const retargeted = yield* observe(watch);

          const second = retargeted.fingerprints[0]?.entries.find(
            (entry) => entry.path === logical,
          );

          assert.strictEqual(second?.identity, first?.identity);
          assert.strictEqual(second?.digest, first?.digest);
          assert.isTrue(
            retargeted.fingerprints[0]?.entries.some(
              (entry) => entry.path === bridge && entry.destination === "middle/.",
            ),
          );
          assert.deepStrictEqual(retargeted.changedPaths, [logical]);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
          yield* fs.remove(middle);
          yield* fs.symlink("./terminal", middle);
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [logical]);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
        }),
      ),
  );

  it.effect(
    "keeps a missing successive route suffix until its intermediate component is created",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const outside = yield* fs.makeTempDirectoryScoped({ prefix: "effx-missing-successive-" });
          const bridge = path.join(outside, "bridge");
          const logical = path.join(dir, "entry.mjs");
          yield* fs.symlink(path.join(bridge, "nested", "dep.mjs"), logical);

          const watch = yield* makeWatchFiles({ inputs: [{ path: logical, kind: "executable" }] });

          const missing = yield* observe(watch);
          assert.isTrue(
            missing.fingerprints[0]?.entries.some(
              (entry) =>
                entry.path === path.join(bridge, "nested", "dep.mjs") && entry.type === "missing",
            ),
          );
          yield* fs.makeDirectory(path.join(bridge, "nested"), { recursive: true });
          yield* fs.writeFileString(path.join(bridge, "nested", "dep.mjs"), "created");

          const repaired = yield* observe(watch);
          assert.deepStrictEqual(repaired.changedPaths, [logical]);
          assert.isTrue(
            repaired.fingerprints[0]?.entries.some(
              (entry) => entry.path === logical && entry.digest.length > 0,
            ),
          );
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
        }),
      ),
  );

  it.effect(
    "fails successive link cycles and path expansion limits without publishing partial coverage",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const logical = path.join(dir, "entry.mjs");
          const bridge = path.join(dir, "bridge");
          yield* fs.symlink(bridge, logical);
          yield* fs.symlink(logical, bridge);

          const cycle = yield* makeWatchFiles({ inputs: [{ path: logical, kind: "executable" }] });

          const failure = yield* Effect.flip(cycle.poll);
          assert.strictEqual(failure._tag, "WatchLimit");

          if (failure._tag === "WatchLimit") assert.strictEqual(failure.resource, "cycle");

          assert.deepStrictEqual((yield* cycle.current).fingerprints, []);
          yield* fs.remove(logical);
          yield* fs.remove(bridge);
          yield* fs.writeFileString(path.join(dir, "terminal.mjs"), "a");

          for (let index = 0; index < 20; index++)
            yield* fs.symlink(
              path.join(dir, index === 19 ? "terminal.mjs" : "chain-" + (index + 1)),
              path.join(dir, "chain-" + index),
            );

          const limited = yield* makeWatchFiles({
            inputs: [{ path: path.join(dir, "chain-0"), kind: "executable" }],
            maxPaths: 16,
          });

          const limit = yield* Effect.flip(limited.poll);
          assert.strictEqual(limit._tag, "WatchLimit");

          if (limit._tag === "WatchLimit") assert.strictEqual(limit.resource, "paths");

          assert.deepStrictEqual((yield* limited.current).fingerprints, []);
        }),
      ),
  );

  it.effect("expands relative link dot-dot after preceding symlink components", () =>
    fixture((fs, path, dir) =>
      Effect.gen(function* () {
        const outside = yield* fs.makeTempDirectoryScoped({ prefix: "effx-dot-dot-route-" });
        const nested = path.join(outside, "nested");
        const portal = path.join(dir, "portal");
        const logical = path.join(dir, "entry.mjs");
        yield* fs.makeDirectory(nested);
        yield* fs.writeFileString(path.join(outside, "dep.mjs"), "outside");
        yield* fs.symlink(nested, portal);
        yield* fs.symlink("portal/../dep.mjs", logical);

        const watch = yield* makeWatchFiles({ inputs: [{ path: logical, kind: "executable" }] });

        const initial = yield* observe(watch);
        assert.isTrue(
          initial.fingerprints[0]?.entries.some(
            (entry) => entry.path === path.join(outside, "dep.mjs") && entry.type === "file",
          ),
        );
        assert.isFalse(
          initial.fingerprints[0]?.entries.some(
            (entry) => entry.path === path.join(dir, "dep.mjs"),
          ),
        );
        yield* fs.writeFileString(path.join(outside, "dep.mjs"), "changed");
        assert.deepStrictEqual((yield* observe(watch)).changedPaths, [logical]);
        assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
      }),
    ),
  );

  it.effect(
    "atomically replaces exclusions, restores old-output observation and preserves executable fingerprints",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const oldOutput = path.join(dir, "old-output");
          const newOutput = path.join(dir, "new-output");
          const executable = path.join(dir, "config.mjs");
          const oldSource = path.join(oldOutput, "authored.ts");
          const newGenerated = path.join(newOutput, "generated.ts");

          const inputs = [
            { path: dir, kind: "source", directory: true, recursive: true },
            { path: executable, kind: "executable" },
          ] as const;

          yield* fs.makeDirectory(oldOutput);
          yield* fs.makeDirectory(newOutput);
          yield* fs.writeFileString(oldSource, "a");
          yield* fs.writeFileString(newGenerated, "a");
          yield* fs.writeFileString(executable, "a");

          const watch = yield* makeWatchFiles({ inputs, exclusions: [oldOutput] });

          const baseline = yield* observe(watch);
          yield* fs.writeFileString(executable, "b");
          yield* watch.replaceInputs(inputs, [newOutput]);
          assert.deepStrictEqual((yield* watch.current).fingerprints, baseline.fingerprints);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: false });

          const moved = yield* observe(watch);
          assert.isTrue(moved.fingerprints[0]?.entries.some((entry) => entry.path === oldSource));
          assert.isFalse(
            moved.fingerprints[0]?.entries.some((entry) => entry.path.startsWith(newOutput)),
          );
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
          yield* fs.writeFileString(newGenerated, "b");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, []);
          yield* fs.writeFileString(oldSource, "b");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [dir]);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: false });
          yield* watch.replaceInputs(inputs);
          yield* watch.replaceInputs(inputs, [newOutput, newOutput]);
          assert.deepStrictEqual(yield* watch.takeChanges, {
            dirty: false,
            executableDirty: false,
          });
          assert.strictEqual(
            (yield* Effect.flip(watch.replaceInputs(inputs, [dir])))._tag,
            "WatchLimit",
          );
          assert.deepStrictEqual(yield* watch.takeChanges, {
            dirty: false,
            executableDirty: false,
          });
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, []);
          yield* watch.replaceInputs(inputs, []);
          yield* observe(watch);
          yield* watch.takeChanges;
          yield* fs.writeFileString(newGenerated, "c");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [dir]);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: false });
        }),
      ),
  );

  it.effect(
    "invalidates an in-flight old exclusion pass without baselining away executable changes",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const executable = path.join(dir, "config.mjs");
          const oldOutput = path.join(dir, "old-output");
          const newOutput = path.join(dir, "new-output");
          const inputs = [{ path: executable, kind: "executable" }] as const;
          let block = false;
          yield* fs.writeFileString(executable, "a");

          const original = fs.open;

          const controlled = {
            ...fs,
            open: Effect.fnUntraced(function* (...args: Parameters<typeof original>) {
              if (block) {
                yield* Deferred.succeed(entered, undefined);
                yield* Deferred.await(release);
              }

              return yield* original(...args);
            }),
          };

          const watch = yield* makeWatchFiles({ inputs, exclusions: [oldOutput] }).pipe(
            Effect.provideService(FileSystem.FileSystem, controlled),
          );

          const baseline = yield* observe(watch);
          block = true;
          yield* fs.writeFileString(executable, "b");

          const stale = yield* Effect.forkChild(watch.poll);
          yield* Deferred.await(entered);
          yield* watch.replaceInputs(inputs, [newOutput]);
          block = false;
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(stale);
          assert.strictEqual((yield* watch.current).pass, baseline.pass);
          assert.deepStrictEqual((yield* watch.current).fingerprints, baseline.fingerprints);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: false });
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [executable]);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
        }),
      ),
  );

  it.effect(
    "allows a repeated link with a different unresolved suffix instead of inventing a cycle",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const identityLink = path.join(dir, "a");
          const redirected = path.join(dir, "x");
          const terminalDirectory = path.join(dir, "y");
          const logical = path.join(identityLink, "x", "dep.mjs");
          yield* fs.makeDirectory(terminalDirectory);
          yield* fs.writeFileString(path.join(terminalDirectory, "dep.mjs"), "a");
          yield* fs.symlink(".", identityLink);
          yield* fs.symlink("a/y", redirected);

          const watch = yield* makeWatchFiles({ inputs: [{ path: logical, kind: "executable" }] });

          const initial = yield* observe(watch);
          assert.strictEqual(initial.error, undefined);
          assert.isTrue(
            initial.fingerprints[0]?.entries.some(
              (entry) => entry.path === logical && entry.digest.length > 0,
            ),
          );
          yield* fs.writeFileString(path.join(terminalDirectory, "dep.mjs"), "b");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [logical]);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: true });
        }),
      ),
  );

  it.effect(
    "keeps readable file and directory aliases to own output quiet and observes retargets away",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const ownOutput = path.join(dir, "own-output");
          const ownContract = path.join(ownOutput, "contract.ts");
          const fileAlias = path.join(dir, "contract-alias.ts");
          const directoryAlias = path.join(dir, "contracts-alias");
          const directoryDependency = path.join(directoryAlias, "contract.ts");
          yield* fs.symlink(ownContract, fileAlias);
          yield* fs.symlink(ownOutput, directoryAlias);

          const watch = yield* makeWatchFiles({
            inputs: [
              { path: dir, kind: "source", directory: true, recursive: true },
              { path: fileAlias, kind: "source" },
              { path: directoryAlias, kind: "source", directory: true, recursive: true },
              { path: directoryDependency, kind: "source" },
            ],
            exclusions: [ownOutput],
          });

          const missingOutput = yield* observe(watch);
          assert.isTrue(
            missingOutput.fingerprints[1]?.entries.some(
              (entry) => entry.path === fileAlias && entry.destination === ownContract,
            ),
          );
          assert.isTrue(
            missingOutput.fingerprints[3]?.entries.some(
              (entry) => entry.path === directoryAlias && entry.destination === ownOutput,
            ),
          );
          yield* fs.makeDirectory(ownOutput);
          yield* fs.writeFileString(ownContract, "generated-a");
          assert.strictEqual(
            yield* fs.readFileString(fileAlias),
            yield* fs.readFileString(ownContract),
          );
          assert.strictEqual(
            yield* fs.readFileString(directoryDependency),
            yield* fs.readFileString(ownContract),
          );
          assert.deepStrictEqual((yield* observe(watch)).fingerprints, missingOutput.fingerprints);
          assert.deepStrictEqual(yield* watch.takeChanges, {
            dirty: false,
            executableDirty: false,
          });
          yield* fs.writeFileString(path.join(ownOutput, "replacement.ts"), "generated-b");
          yield* fs.rename(path.join(ownOutput, "replacement.ts"), ownContract);
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, []);

          const otherProject = yield* fs.makeTempDirectoryScoped({
            prefix: "effx-other-contract-",
          });

          const otherOutput = path.join(otherProject, ".effx");
          const otherContract = path.join(otherOutput, "contract.ts");
          yield* fs.makeDirectory(otherOutput);
          yield* fs.writeFileString(otherContract, "other-a");
          yield* fs.remove(fileAlias);
          yield* fs.remove(directoryAlias);
          yield* fs.symlink(otherContract, fileAlias);
          yield* fs.symlink(otherOutput, directoryAlias);

          const retargeted = yield* observe(watch);
          assert.deepStrictEqual(retargeted.changedPaths, [
            dir,
            fileAlias,
            directoryAlias,
            directoryDependency,
          ]);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: false });
          assert.strictEqual(
            yield* fs.readFileString(fileAlias),
            yield* fs.readFileString(otherContract),
          );
          assert.strictEqual(
            yield* fs.readFileString(directoryDependency),
            yield* fs.readFileString(otherContract),
          );

          const direct = yield* makeWatchFiles({
            inputs: [{ path: otherContract, kind: "source" }],
            exclusions: [ownOutput],
          });

          yield* observe(direct);
          yield* fs.writeFileString(otherContract, "other-b");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [
            fileAlias,
            directoryAlias,
            directoryDependency,
          ]);
          assert.deepStrictEqual((yield* observe(direct)).changedPaths, [otherContract]);
          assert.deepStrictEqual(yield* watch.takeChanges, yield* direct.takeChanges);
        }),
      ),
  );

  it.effect(
    "retains successive dependency link metadata when its current target is own output",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const ownOutput = path.join(dir, "own-output");
          const ownContract = path.join(ownOutput, "contract.ts");
          const outside = yield* fs.makeTempDirectoryScoped({ prefix: "effx-owned-alias-route-" });
          const bridge = path.join(outside, "bridge.ts");
          const otherContract = path.join(outside, "other.ts");
          const alias = path.join(dir, "contract-alias.ts");
          yield* fs.makeDirectory(ownOutput);
          yield* fs.writeFileString(ownContract, "own-a");
          yield* fs.writeFileString(otherContract, "other-a");
          yield* fs.symlink(ownContract, bridge);
          yield* fs.symlink(bridge, alias);

          const watch = yield* makeWatchFiles({
            inputs: [{ path: alias, kind: "source" }],
            exclusions: [ownOutput],
          });

          const initial = yield* observe(watch);
          assert.isTrue(
            initial.fingerprints[0]?.entries.some(
              (entry) => entry.path === bridge && entry.destination === ownContract,
            ),
          );
          yield* fs.writeFileString(ownContract, "own-b");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, []);
          yield* fs.remove(bridge);
          yield* fs.symlink(otherContract, bridge);

          const retargeted = yield* observe(watch);
          assert.deepStrictEqual(retargeted.changedPaths, [alias]);
          assert.isTrue(
            retargeted.fingerprints[0]?.entries.some(
              (entry) => entry.path === alias && entry.digest.length > 0,
            ),
          );
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: false });
          yield* fs.writeFileString(otherContract, "other-b");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [alias]);
        }),
      ),
  );

  it.effect(
    "ignores implicit child-link targets but rejects explicit executable own-output aliases",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const ownOutput = path.join(dir, "own-output");
          const ownContract = path.join(ownOutput, "contract.mjs");
          const fileAlias = path.join(dir, "contract-alias.mjs");
          const directoryAlias = path.join(dir, "contracts-alias");
          yield* fs.symlink(ownContract, fileAlias);
          yield* fs.symlink(ownOutput, directoryAlias);

          const membership = yield* makeWatchFiles({
            inputs: [{ path: dir, kind: "executable", directory: true, recursive: true }],
            exclusions: [ownOutput],
            maxFileBytes: 64,
          });

          yield* observe(membership);
          yield* fs.makeDirectory(ownOutput);
          yield* fs.writeFileString(ownContract, "generated".repeat(64));
          assert.deepStrictEqual((yield* observe(membership)).changedPaths, []);
          assert.deepStrictEqual(yield* membership.takeChanges, {
            dirty: false,
            executableDirty: false,
          });

          for (const input of [
            { path: fileAlias, kind: "executable" as const },
            { path: directoryAlias, kind: "executable" as const, directory: true, recursive: true },
          ]) {
            const selected = yield* makeWatchFiles({
              inputs: [input],
              exclusions: [ownOutput],
              maxFileBytes: 64,
            });

            const failure = yield* Effect.flip(selected.poll);
            assert.strictEqual(failure._tag, "WatchLimit");

            if (failure._tag === "WatchLimit") assert.strictEqual(failure.resource, "selection");
          }
        }),
      ),
  );

  it.effect(
    "deduplicates shared ancestors for exact missing probes under the unchanged default path budget",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const dependencyDirectory = path.join(dir, "node_modules", "effect", "dist");
          const consulted = path.join(dependencyDirectory, "consulted.d.ts");
          const unused = path.join(dependencyDirectory, "unused.js");

          const probes = Array.from({ length: 1000 }, (_, index) => ({
            path: path.join(dependencyDirectory, "Missing" + index + ".tsx"),
            kind: "source" as const,
          }));

          yield* fs.makeDirectory(dependencyDirectory, { recursive: true });
          yield* fs.writeFileString(consulted, "a");
          yield* fs.writeFileString(unused, "unobserved".repeat(128));

          const stats = new Map<string, number>();
          const links = new Map<string, number>();
          const physical = new Map<string, number>();
          let listings = 0;

          const controlled = {
            ...fs,
            stat: Effect.fnUntraced(function* (name: string) {
              stats.set(name, (stats.get(name) ?? 0) + 1);

              return yield* fs.stat(name);
            }),
            readLink: Effect.fnUntraced(function* (name: string) {
              links.set(name, (links.get(name) ?? 0) + 1);

              return yield* fs.readLink(name);
            }),
            realPath: Effect.fnUntraced(function* (name: string) {
              physical.set(name, (physical.get(name) ?? 0) + 1);

              return yield* fs.realPath(name);
            }),
            readDirectory: Effect.fnUntraced(function* (
              ...args: Parameters<typeof fs.readDirectory>
            ) {
              listings++;

              return yield* fs.readDirectory(...args);
            }),
          };

          const watch = yield* makeWatchFiles({
            inputs: [
              { path: dependencyDirectory, kind: "source" },
              { path: consulted, kind: "source" },
              ...probes,
            ],
            maxFileBytes: 16,
          }).pipe(Effect.provideService(FileSystem.FileSystem, controlled));

          const initial = yield* observe(watch);
          assert.strictEqual(initial.fingerprints.length, probes.length + 2);
          assert.strictEqual(stats.get(dependencyDirectory), 1);
          assert.strictEqual(links.get(dependencyDirectory), 1);
          assert.strictEqual(physical.get(dependencyDirectory), 1);
          assert.strictEqual(listings, 0);
          yield* fs.writeFileString(unused, "still-unobserved".repeat(128));
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, []);
          yield* fs.writeFileString(probes[0]!.path, "created");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [probes[0]!.path]);
          yield* watch.takeChanges;
          yield* fs.writeFileString(consulted, "b");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [consulted]);
          assert.strictEqual(listings, 0);
        }),
      ),
  );

  it.effect(
    "observes immediate membership metadata without hashing unconsulted sibling bytes",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const consulted = path.join(dir, "consulted.ts");
          const unused = path.join(dir, "unconsulted.js");
          const created = path.join(dir, "new.ts");
          yield* fs.writeFileString(consulted, "a");
          yield* fs.writeFileString(unused, "unused".repeat(1024));

          const watch = yield* makeWatchFiles({
            inputs: [
              { path: dir, kind: "source", directory: true },
              { path: consulted, kind: "source" },
            ],
            maxFileBytes: 4,
          });

          const initial = yield* observe(watch);
          assert.strictEqual(
            initial.fingerprints[0]?.entries.find((entry) => entry.path === unused)?.digest,
            "",
          );
          assert.isTrue(
            initial.fingerprints[1]?.entries.some(
              (entry) => entry.path === consulted && entry.digest.length > 0,
            ),
          );
          yield* fs.writeFileString(unused, "changed".repeat(1024));
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, []);
          yield* fs.writeFileString(consulted, "b");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [consulted]);
          yield* watch.takeChanges;
          yield* fs.writeFileString(created, "a");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [dir]);
          yield* fs.rename(created, path.join(dir, "renamed.ts"));
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [dir]);
          yield* fs.remove(path.join(dir, "renamed.ts"));
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [dir]);
        }),
      ),
  );

  it.effect(
    "reads a shared physical file once per pass while preserving its logical aliases and byte admission",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const file = path.join(dir, "dependency.ts");
          const alias = path.join(dir, "dependency-alias.ts");
          let opens = 0;
          yield* fs.writeFileString(file, "12345678");
          yield* fs.symlink(file, alias);

          const original = fs.open;

          const controlled = {
            ...fs,
            open: Effect.fnUntraced(function* (...args: Parameters<typeof original>) {
              opens++;

              return yield* original(...args);
            }),
          };

          const watch = yield* makeWatchFiles({
            inputs: [
              { path: file, kind: "source" },
              { path: alias, kind: "source" },
            ],
            maxBytes: 8,
            maxFileBytes: 8,
          }).pipe(Effect.provideService(FileSystem.FileSystem, controlled));

          const initial = yield* observe(watch);
          assert.strictEqual(initial.fingerprints.length, 2);
          assert.strictEqual(initial.fingerprints[0]?.input.path, file);
          assert.strictEqual(initial.fingerprints[1]?.input.path, alias);
          assert.strictEqual(opens, 1);
          yield* fs.writeFileString(file, "87654321");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [file, alias]);
          assert.strictEqual(opens, 2);
        }),
      ),
  );

  it.effect(
    "keeps existence and membership roles quiet and shares canonical directory enumeration",
    () =>
      fixture((fs, path, dir) =>
        Effect.gen(function* () {
          const root = path.join(dir, "members");
          const alias = path.join(dir, "members-alias");
          yield* fs.makeDirectory(root);
          yield* fs.writeFileString(path.join(root, "unconsulted.js"), "large".repeat(128));
          yield* fs.symlink(root, alias);

          let listings = 0;

          const controlled = {
            ...fs,
            readDirectory: Effect.fnUntraced(function* (
              ...args: Parameters<typeof fs.readDirectory>
            ) {
              listings++;

              return yield* fs.readDirectory(...args);
            }),
          };

          const watch = yield* makeWatchFiles({
            inputs: [
              { path: root, kind: "source" },
              { path: root, kind: "source", directory: true },
              { path: alias, kind: "source", directory: true },
            ],
            maxFileBytes: 1,
          }).pipe(Effect.provideService(FileSystem.FileSystem, controlled));

          const initial = yield* observe(watch);
          assert.strictEqual(initial.fingerprints.length, 3);
          assert.strictEqual(listings, 1);
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, []);
          assert.deepStrictEqual(yield* watch.takeChanges, {
            dirty: false,
            executableDirty: false,
          });
          assert.strictEqual(listings, 2);
          yield* fs.writeFileString(path.join(root, "new.ts"), "a");
          assert.deepStrictEqual((yield* observe(watch)).changedPaths, [root, alias]);
          assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: false });
        }),
      ),
  );
});
