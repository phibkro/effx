import { assert, describe, it } from "@effect/vitest";
import { CompilerFault, Extensions, compileCollected } from "@effx/compiler";
import { Cause, Deferred, Effect, Exit, Option, Queue } from "effect";
import {
  makeProjectSession,
  type ProjectSession,
  type SessionEvent,
} from "../src/project-session.ts";

const document = {
  uri: "file:///project/a.ts",
  file: "/project/a.ts",
  identity: "/project/a.ts",
  version: 1,
  text: "first",
};

// A real compiler pipeline result; these tests isolate ownership/publication, not language semantics.
const compilation = compileCollected({ declarations: [], diagnostics: [] }, Extensions.builtin);

describe("bounded project session", () => {
  it.effect(
    "serializes burst updates, cancels old work and publishes only latest text/version",
    () =>
      Effect.gen(function* () {
        const first = yield* Deferred.make<void>();
        const held = yield* Deferred.make<void>();
        const latest = yield* Deferred.make<number | undefined>();
        const events: Array<SessionEvent> = [];
        let active = 0;
        let maximum = 0;
        let released = 0;

        const session = yield* makeProjectSession({
          analyze: (snapshot) =>
            Effect.gen(function* () {
              yield* Effect.sync(() => {
                active++;
                maximum = Math.max(maximum, active);
              });

              if (snapshot.documents.get(document.uri)?.version === 1) {
                yield* Deferred.succeed(first, undefined);
                yield* Deferred.await(held);
              }

              return yield* compilation;
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  active--;
                  released++;
                }),
              ),
            ),
          publish: (event) =>
            Effect.gen(function* () {
              events.push(event);

              if (event._tag === "Completed") {
                yield* Deferred.succeed(
                  latest,
                  event.snapshot.documents.get(document.uri)?.version,
                );
              }
            }),
        });

        yield* session.open(document);
        yield* session.start;
        yield* Deferred.await(first);

        for (let version = 2; version <= 40; version++) {
          yield* session.change(document.uri, version, [{ text: `version ${version}` }]);
        }

        assert.strictEqual(yield* Deferred.await(latest), 40);
        assert.strictEqual(maximum, 1);
        assert.isAtLeast(released, 1);
        assert.isFalse(
          events.some(
            (event) =>
              event._tag === "Completed" &&
              event.snapshot.documents.get(document.uri)?.version === 1,
          ),
        );
        assert.strictEqual(
          Option.getOrThrow(yield* session.getDocument(document.uri)).text,
          "version 40",
        );
        yield* session.close;
        assert.strictEqual(active, 0);
        assert.strictEqual((yield* session.snapshotDocuments).size, 0);
      }),
  );

  it.effect("a pre-publication input checkpoint cannot publish a superseded analysis", () =>
    Effect.gen(function* () {
      const checkpoint = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const completed = yield* Deferred.make<number | undefined>();
      const versions: Array<number | undefined> = [];

      const session = yield* makeProjectSession({
        analyze: () => compilation,
        beforePublish: Effect.gen(function* () {
          yield* Deferred.succeed(checkpoint, undefined);
          yield* Deferred.await(release);
        }),
        publish: (event) =>
          Effect.gen(function* () {
            if (event._tag === "Completed") {
              const version = event.snapshot.documents.get(document.uri)?.version;
              versions.push(version);
              yield* Deferred.succeed(completed, version);
            }
          }),
      });

      yield* session.open(document);
      yield* session.start;
      yield* Deferred.await(checkpoint);
      yield* session.change(document.uri, 7, [{ text: "new unsaved text" }]);
      yield* Deferred.succeed(release, undefined);
      assert.strictEqual(yield* Deferred.await(completed), 7);
      assert.deepStrictEqual(versions, [7]);
      yield* session.close;
    }),
  );

  it.effect("clears a closed instance and handles a compiler fault as repairable data", () =>
    Effect.gen(function* () {
      const events = yield* Queue.bounded<SessionEvent>(8);
      let broken = true;

      const session = yield* makeProjectSession({
        analyze: () =>
          broken
            ? Effect.fail(
                new CompilerFault({ stage: "collect", message: "Selected project is unavailable" }),
              )
            : compilation,
        publish: (event) => Queue.offer(events, event).pipe(Effect.asVoid),
      });

      yield* session.open(document);
      yield* session.start;
      const failed = yield* Queue.take(events);
      assert.strictEqual(failed._tag, "Faulted");
      broken = false;
      yield* session.invalidate;
      const repaired = yield* Queue.take(events);
      assert.strictEqual(repaired._tag, "Completed");
      yield* session.closeDocument(document.uri);
      const cleared = yield* Queue.take(events);
      assert.strictEqual(cleared._tag, "Cleared");
      assert.isTrue(Option.isNone(yield* session.getDocument(document.uri)));
      yield* session.close;
    }),
  );

  it.effect("restart from the active analyzer does not interrupt or await itself", () =>
    Effect.gen(function* () {
      const status = yield* Deferred.make<SessionEvent>();
      const analyzed = yield* Deferred.make<void>();
      let session: ProjectSession | undefined;
      let passes = 0;

      const acquired = yield* makeProjectSession({
        analyze: () =>
          Effect.gen(function* () {
            passes++;

            if (session !== undefined)
              yield* session.restartRequired("Covered executable route changed").pipe(
                Effect.catchTag("SessionClosed", (cause) =>
                  Effect.fail(
                    new CompilerFault({
                      stage: "collect",
                      message: "Analyzer restart owner is closed",
                      cause,
                    }),
                  ),
                ),
              );
            yield* Deferred.succeed(analyzed, undefined);

            return yield* compilation;
          }),
        publish: (event) => Deferred.succeed(status, event).pipe(Effect.asVoid),
      });

      session = acquired;
      yield* acquired.open(document);
      yield* acquired.start;
      assert.strictEqual((yield* Deferred.await(status))._tag, "RestartRequired");
      yield* Deferred.await(analyzed);
      yield* acquired.restartRequired("Repeated observation");
      yield* acquired.change(document.uri, 2, [{ text: "editable while restart is required" }]);
      yield* acquired.invalidate;
      yield* acquired.close;
      assert.strictEqual(passes, 1);
      const exit = yield* acquired.awaitExit;
      assert.isTrue(Exit.isFailure(exit));

      if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
    }),
  );
});
