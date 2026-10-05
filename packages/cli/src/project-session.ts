import { CompilerFault, type CompileResult } from "@effx/compiler";
import { Cause, Effect, Exit, Fiber, Option, Queue, Schema, type Scope } from "effect";
import {
  makeDocuments,
  type DocumentError,
  type OpenDocument,
  type TextChange,
} from "./documents.ts";

export interface ProjectSnapshot {
  readonly revision: number;
  readonly epoch: number;
  readonly documents: ReadonlyMap<string, OpenDocument>;
  readonly sources: ReadonlyMap<string, string | undefined>;
}

export type SessionEvent =
  | {
      readonly _tag: "Completed";
      readonly snapshot: ProjectSnapshot;
      readonly result: CompileResult;
    }
  | { readonly _tag: "Faulted"; readonly snapshot: ProjectSnapshot; readonly fault: CompilerFault }
  | { readonly _tag: "Cleared"; readonly document: OpenDocument }
  | {
      readonly _tag: "RestartRequired";
      readonly reason: string;
      readonly documents: ReadonlyMap<string, OpenDocument>;
    };

export class SessionClosed extends Schema.TaggedError<SessionClosed>()("SessionClosed", {}) {}

export interface ProjectSession {
  readonly open: (
    document: Omit<OpenDocument, "instance">,
  ) => Effect.Effect<OpenDocument, DocumentError>;
  readonly change: (
    uri: string,
    version: number,
    changes: ReadonlyArray<TextChange>,
  ) => Effect.Effect<OpenDocument, DocumentError>;
  readonly closeDocument: (uri: string) => Effect.Effect<void, DocumentError | CompilerFault>;
  readonly getDocument: (uri: string) => Effect.Effect<Option.Option<OpenDocument>>;
  readonly snapshotDocuments: Effect.Effect<ReadonlyMap<string, OpenDocument>>;
  readonly invalidate: Effect.Effect<number, SessionClosed>;
  readonly restartRequired: (reason: string) => Effect.Effect<void, CompilerFault | SessionClosed>;
  readonly start: Effect.Effect<void, SessionClosed>;
  readonly close: Effect.Effect<void>;
  /** The actual Exit preserves failure, defect and interruption evidence. */
  readonly awaitExit: Effect.Effect<Exit.Exit<void, CompilerFault>>;
  readonly isCurrent: (snapshot: ProjectSnapshot) => Effect.Effect<boolean>;
}

export interface SessionOptions<R> {
  readonly analyze: (snapshot: ProjectSnapshot) => Effect.Effect<CompileResult, CompilerFault, R>;
  readonly publish: (event: SessionEvent) => Effect.Effect<void, CompilerFault, R>;
  /** Admit already-readable input before the revision guard; never called by a notification handler. */
  readonly beforePublish?: Effect.Effect<void, CompilerFault, R>;
  readonly isSourceDocument?: (document: OpenDocument) => boolean;
}

/** One coordinator, one current analysis/publication, one coalesced dirty token. No worker family. */
export const makeProjectSession = Effect.fnUntraced(function* <R>(
  options: SessionOptions<R>,
): Effect.fn.Return<ProjectSession, never, R | Scope.Scope> {
  const services = yield* Effect.context<R>();
  const publish = (event: SessionEvent) => options.publish(event).pipe(Effect.provide(services));
  const wake = yield* Queue.dropping<void>(1);
  let revision = 0;
  let epoch = 0;
  let started = false;
  let closed = false;
  let restartReason: string | undefined;
  let active: Fiber.Fiber<void, CompilerFault> | undefined;

  const documents = yield* makeDocuments({
    onMutation: () => {
      revision++;

      if (started && !closed && restartReason === undefined) Queue.offerUnsafe(wake, undefined);
    },
  });

  const current = (snapshot: ProjectSnapshot): boolean =>
    !closed &&
    restartReason === undefined &&
    snapshot.revision === revision &&
    snapshot.epoch === epoch;

  const analyzeAndPublish = Effect.fnUntraced(function* (snapshot: ProjectSnapshot) {
    const event: SessionEvent = yield* options.analyze(snapshot).pipe(
      Effect.match({
        onSuccess: (result): SessionEvent => ({ _tag: "Completed", snapshot, result }),
        onFailure: (fault): SessionEvent => ({ _tag: "Faulted", snapshot, fault }),
      }),
    );

    if (options.beforePublish !== undefined) yield* options.beforePublish;

    if (current(snapshot)) yield* publish(event);
  });

  const coordinator = yield* Effect.forkScoped(
    Effect.gen(function* () {
      let requested = false;

      while (!closed) {
        if (!requested) yield* Queue.take(wake);
        requested = false;

        if (closed || !started || restartReason !== undefined) continue;
        yield* Queue.poll(wake);
        const capturedRevision = revision;
        const capturedEpoch = epoch;
        const capturedDocuments = yield* documents.snapshot;

        if (capturedRevision !== revision || capturedEpoch !== epoch) {
          requested = true;
          continue;
        }

        const sources = new Map<string, string | undefined>();

        for (const document of capturedDocuments.values()) {
          if (options.isSourceDocument === undefined || options.isSourceDocument(document)) {
            sources.set(document.file, document.text);
          }
        }

        const snapshot: ProjectSnapshot = {
          revision: capturedRevision,
          epoch: capturedEpoch,
          documents: capturedDocuments,
          sources,
        };

        active = yield* Effect.forkChild(analyzeAndPublish(snapshot));

        const completed = yield* Effect.raceFirst(
          Fiber.await(active).pipe(Effect.map((exit) => ({ _tag: "Completed" as const, exit }))),
          Queue.take(wake).pipe(Effect.as({ _tag: "Dirty" as const })),
        );

        if (completed._tag === "Dirty") {
          yield* Fiber.interrupt(active);
          active = undefined;
          requested = !closed && restartReason === undefined;
          continue;
        }

        active = undefined;

        if (Exit.isFailure(completed.exit)) {
          // Only our supersession/close permits a child interrupt to end this analysis.
          if (!(Cause.hasInterruptsOnly(completed.exit.cause) && !current(snapshot))) {
            return yield* Effect.failCause(completed.exit.cause);
          }
        }

        // A simultaneous completion can consume a queue token: the revision is the authority.
        requested = !closed && restartReason === undefined && !current(snapshot);
      }
    }),
  );

  const invalidate = Effect.suspend(() => {
    if (closed) return Effect.fail(new SessionClosed());
    revision++;

    if (started && restartReason === undefined) Queue.offerUnsafe(wake, undefined);

    return Effect.succeed(revision);
  });

  const close = Effect.gen(function* () {
    if (closed) {
      yield* Fiber.await(coordinator);

      return;
    }

    closed = true;
    revision++;
    yield* documents.shutdown;
    yield* Fiber.interrupt(coordinator);
    active = undefined;
    yield* Queue.shutdown(wake);
  });

  yield* Effect.addFinalizer(() => close);

  const restartRequired = Effect.fnUntraced(function* (reason: string) {
    if (closed) return yield* new SessionClosed();

    if (restartReason !== undefined) return;
    restartReason = reason;
    epoch++;
    revision++;
    Queue.offerUnsafe(wake, undefined);

    if (active !== undefined) yield* Fiber.interrupt(active);
    const snapshot = yield* documents.snapshot;
    yield* publish({ _tag: "RestartRequired", reason, documents: snapshot });
  });

  return {
    open: documents.open,
    change: documents.change,
    closeDocument: Effect.fnUntraced(function* (uri: string) {
      const removed = yield* documents.close(uri);

      if (Option.isSome(removed)) yield* publish({ _tag: "Cleared", document: removed.value });
    }),
    getDocument: documents.get,
    snapshotDocuments: documents.snapshot,
    invalidate,
    restartRequired,
    start: Effect.suspend(() => {
      if (closed) return Effect.fail(new SessionClosed());

      if (!started) {
        started = true;
        Queue.offerUnsafe(wake, undefined);
      }

      return Effect.void;
    }),
    close,
    awaitExit: Fiber.await(coordinator),
    isCurrent: (snapshot) => Effect.sync(() => current(snapshot)),
  };
});
