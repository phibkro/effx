import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { compileCollected, Extensions } from "@effx/compiler";
import { Deferred, Effect, FileSystem, Path, type PlatformError, Semaphore } from "effect";
import { applyWatchChanges, installCoverage, observeAnalysis } from "../src/lsp.ts";
import { makeProjectSession, type ProjectSession } from "../src/project-session.ts";
import { makeWatchFiles } from "../src/watch-files.ts";

// A real compiler result; these laws isolate the coverage protocol, not language semantics.
const compilation = compileCollected({ declarations: [], diagnostics: [] }, Extensions.builtin);

// The analysis owns one coverage change. Its own watch signal must neither supersede it
// nor request a second compile, yet an edit that lands between the compile's read and
// the new baseline must still republish: the baseline pass would adopt that text silently.
const harness = Effect.fnUntraced(function* (
  compile: (
    count: number,
    fs: FileSystem.FileSystem,
    file: string,
  ) => Effect.Effect<void, PlatformError.PlatformError>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "effx-lsp-coverage-" });
  const config = path.join(dir, "tsconfig.json");
  const file = path.join(dir, "a.ts");
  yield* fs.writeFileString(config, "{}");
  yield* fs.writeFileString(file, "v1");

  const watch = yield* makeWatchFiles({ inputs: [{ path: config, kind: "source" }] });
  yield* watch.poll;

  const gate = yield* Semaphore.make(1);
  const completed = yield* Deferred.make<{ readonly compiles: number }>();
  const iterated = yield* Deferred.make<void>();
  const seen: Array<string> = [];
  let compiles = 0;
  let invalidations = 0;
  let session!: ProjectSession;

  const observed = {
    invalidate: Effect.suspend(() => {
      invalidations++;

      return session.invalidate;
    }),
    restartRequired: (reason: string) => session.restartRequired(reason),
  };

  session = yield* makeProjectSession({
    analyze: () =>
      Effect.gen(function* () {
        const count = ++compiles;
        const text = yield* fs.readFileString(file);
        seen.push(text);
        yield* compile(count, fs, file);
        const { previous, previousChanges } = yield* observeAnalysis(watch);

        yield* installCoverage({
          watch,
          session: observed,
          gate,
          inputs: [
            { path: config, kind: "source" },
            { path: file, kind: "source" },
          ],
          exclusions: [],
          previous,
          previousChanges,
          read: new Map([[file, text]]),
          overlaid: new Set(),
        });

        return yield* compilation;
      }).pipe(Effect.orDie),
    publish: (event) =>
      event._tag === "Completed"
        ? Deferred.succeed(completed, { compiles }).pipe(Effect.asVoid)
        : Effect.void,
  });

  // startImmediately: the loop is already waiting on the watch when the analysis starts.
  yield* Effect.forkScoped(
    Effect.forever(
      applyWatchChanges(watch, observed, gate).pipe(
        Effect.tap(() => Deferred.succeed(iterated, undefined)),
      ),
    ),
    { startImmediately: true },
  );

  return {
    session,
    completed,
    iterated,
    seen,
    compiles: () => compiles,
    invalidations: () => invalidations,
  };
});

describe("LSP coverage protocol", () => {
  it.effect(
    "an analysis's own coverage change neither supersedes it nor requests a second compile",
    () =>
      Effect.gen(function* () {
        const h = yield* harness(() => Effect.void);
        yield* h.session.start;
        // The watch loop wakes on the analysis's own signal; it must find it consumed.
        yield* Deferred.await(h.iterated);
        assert.strictEqual(h.invalidations(), 0);
        const done = yield* Deferred.await(h.completed);

        assert.strictEqual(done.compiles, 1);
        assert.strictEqual(h.compiles(), 1);
      }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );

  it.effect("an edit between the compile's read and the new baseline still republishes", () =>
    Effect.gen(function* () {
      const h = yield* harness((count, fs, file) =>
        // After the first compile read v1, before its coverage baseline exists.
        count === 1 ? fs.writeFileString(file, "v2") : Effect.void,
      );

      yield* h.session.start;
      const done = yield* Deferred.await(h.completed);

      // The first analysis is superseded; the published one compiled the edited text.
      assert.strictEqual(done.compiles, 2);
      assert.deepStrictEqual(h.seen, ["v1", "v2"]);
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
});
