/** @effect-diagnostics unstableApiUsage:off -- EX-0023: native child-process custody at the persistence acceptance boundary. */
import { Cause, Effect, Exit, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

/**
 * The calling test owns one child process group and its output stream. Closing the scope on
 * success, failure, timeout or interruption terminates descendants before temporary files go away.
 * Output is consumed serially with backpressure and logged as it arrives, not only after exit.
 * The existing 180-second deadline is unchanged; cancellation is a failure, never a fake report.
 * Retire EX-0023's unstable-API directive when Effect stabilizes the child-process modules.
 */
export const subprocess = Effect.fnUntraced(function* (
  command: readonly [string, ...Array<string>],
  cwd: string,
  onOutput?: (line: string) => Effect.Effect<void>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const [executable, ...args] = command;
  yield* Effect.log("spec 0022 subprocess starting", command.join(" "), cwd);

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(executable, args, {
          cwd,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          forceKillAfter: "1 second",
        }),
      );

      yield* Effect.log("spec 0022 subprocess acquired", { pid: handle.pid });

      const text = yield* handle.all.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.tap((line) =>
          Effect.log("spec 0022 subprocess output", line).pipe(
            Effect.andThen(onOutput === undefined ? Effect.void : onOutput(line)),
          ),
        ),
        Stream.map((line) => line + "\n"),
        Stream.mkString,
      );

      const code = yield* handle.exitCode;

      return { code, text };
    }),
  ).pipe(
    Effect.timeout(180_000),
    Effect.onExit((exit) =>
      Exit.isSuccess(exit)
        ? Effect.log("spec 0022 subprocess evidence", { exitCode: exit.value.code })
        : Effect.logError("spec 0022 subprocess failure evidence", Cause.pretty(exit.cause)),
    ),
  );
});
