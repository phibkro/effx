/** @effect-diagnostics unstableApiUsage:off -- EX-0023: native process custody for the packed watch/editor acceptance consumer. */
import { Deferred, Effect, Fiber, Queue, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { PlatformError } from "effect/PlatformError";
import type { Scope } from "effect/Scope";

export interface PackedCommand {
  readonly next: (
    predicate: (line: string) => boolean,
  ) => Effect.Effect<string, PlatformError | PackedCommandError>;
  readonly output: Effect.Effect<string>;
  readonly finish: Effect.Effect<
    { readonly code: number; readonly text: string },
    PlatformError | PackedCommandError,
    Scope
  >;
  readonly eof: Effect.Effect<boolean>;
  readonly interrupt: Effect.Effect<void, PlatformError>;
}

export class PackedCommandError extends Schema.TaggedError<PackedCommandError>()(
  "PackedCommandError",
  { message: Schema.String },
) {}

/**
 * The caller's scope owns the process, stdin, and serial output reader. One reader
 * backpressures at 128 lines; one workflow waits for receipts. Scope closure kills
 * and joins the child before consumer files disappear. No output payload is logged.
 */
export const acquireCommand = Effect.fnUntraced(function* (
  cwd: string,
  executable: string,
  args: ReadonlyArray<string>,
): Effect.fn.Return<PackedCommand, PlatformError, ChildProcessSpawner.ChildProcessSpawner | Scope> {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const eof = yield* Deferred.make<void>();
  const lines = yield* Queue.bounded<string>(128);
  yield* Effect.addFinalizer(() => Queue.shutdown(lines));

  const child = yield* spawner.spawn(
    ChildProcess.make(executable, args, {
      cwd,
      stdin: Stream.fromEffect(Deferred.await(eof)).pipe(Stream.drain),
      stdout: "pipe",
      stderr: "pipe",
      forceKillAfter: "1 second",
    }),
  );

  let text = "";

  const reader = yield* child.all.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) =>
      Effect.gen(function* () {
        if (text.length + line.length > 1_048_576)
          return yield* new PackedCommandError({ message: "Acceptance output exceeds 1 MiB" });
        text += line + "\n";
        yield* Queue.offer(lines, line);
      }),
    ),
    Effect.forkScoped,
  );

  return {
    next: Effect.fnUntraced(
      function* (predicate: (line: string) => boolean) {
        while (true) {
          const line = yield* Queue.take(lines);

          if (predicate(line)) return line;
        }
      },
      Effect.raceFirst(
        Fiber.join(reader).pipe(
          Effect.andThen(
            Effect.fail(
              new PackedCommandError({ message: "Child output ended before acceptance receipt" }),
            ),
          ),
        ),
      ),
    ),
    finish: Effect.gen(function* () {
      // Drain queued receipts while the bounded reader completes; no missed EOF
      // can masquerade as a successful exit.
      const drainer = yield* Stream.fromQueue(lines).pipe(Stream.runDrain, Effect.forkScoped);
      yield* Fiber.join(reader);
      const code = yield* child.exitCode;
      yield* Fiber.interrupt(drainer);

      return { code, text };
    }),
    eof: Deferred.succeed(eof, undefined),
    interrupt: child.kill({ killSignal: "SIGINT", forceKillAfter: "1 second" }),
    output: Effect.sync(() => text),
  };
});
