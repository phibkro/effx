import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, FileSystem, Option, Path } from "effect";
import { awaitCoverageBaseline } from "../src/lsp.ts";
import { makeWatchFiles } from "../src/watch-files.ts";

// Defended bug: analyze called watch.poll after replaceInputs and ignored its None
// (a pass already held the gate). That pass is discarded, so the analysis published
// with no baseline for the new coverage and the next pass took its baseline AFTER
// the editor's next write, losing that change. The gate is held by a latch, never
// by time; the awaiting fiber is forked eagerly so its first suspension is observed.
describe("LSP coverage baseline before publication", () => {
  it.effect("waits for a completed pass over new coverage and then observes later edits", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "effx-lsp-baseline-" });
      const selected = path.join(dir, "tsconfig.json");
      const reference = path.join(dir, "reference.json");
      yield* fs.writeFileString(selected, "{}");
      yield* fs.writeFileString(reference, '{"files":[]}');

      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let block = false;
      const open = fs.open;

      const controlled = {
        ...fs,
        open: Effect.fnUntraced(function* (...args: Parameters<typeof open>) {
          if (block) {
            yield* Deferred.succeed(entered, undefined);
            yield* Deferred.await(release);
          }

          return yield* open(...args);
        }),
      };

      const watch = yield* makeWatchFiles({ inputs: [{ path: selected, kind: "source" }] }).pipe(
        Effect.provideService(FileSystem.FileSystem, controlled),
      );

      const first = yield* watch.poll;
      assert.isTrue(Option.isSome(first));

      // A pass over the OLD coverage holds the gate...
      block = true;
      const holder = yield* Effect.forkChild(watch.poll);
      yield* Deferred.await(entered);
      block = false;

      // ...while analysis installs the newly observed reference.
      yield* watch.replaceInputs([
        { path: selected, kind: "source" },
        { path: reference, kind: "source" },
      ]);

      const baseline = yield* Effect.forkChild(awaitCoverageBaseline(watch), {
        startImmediately: true,
      });

      // The gate is busy: publication must be suspended, not already free to proceed.
      assert.isUndefined(baseline.pollUnsafe());

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      // The stale pass is discarded; it is not a baseline for the reference.
      assert.isUndefined(baseline.pollUnsafe());
      assert.isFalse(
        (yield* watch.current).fingerprints.some((entry) => entry.input.path === reference),
      );

      const observed = yield* watch.poll;
      assert.isTrue(Option.isSome(observed));
      yield* Fiber.join(baseline);
      assert.isTrue(
        (yield* watch.current).fingerprints.some((entry) => entry.input.path === reference),
      );
      yield* watch.takeChanges;

      // An edit after publication is now compared with a real baseline.
      yield* fs.writeFileString(reference, "{");
      const changed = yield* watch.poll;
      assert.deepStrictEqual(Option.getOrThrow(changed).changedPaths, [reference]);
      assert.deepStrictEqual(yield* watch.takeChanges, { dirty: true, executableDirty: false });
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
});
