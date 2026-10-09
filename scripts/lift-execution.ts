#!/usr/bin/env bun
/** @effect-diagnostics unstableApiUsage:off -- EX-0034: native ChildProcess custody at the 0019 lift-check root. */
import {
  DateTime,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Path,
  PlatformError,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  LiftCheckExecution,
  LiftToolchain,
  type CheckChildExit,
  type CheckChildResult,
  type CheckChildSpec,
  type OverlayTypecheckResult,
} from "@effx/cli/lift-boundaries";
import { CompilerFault } from "@effx/compiler";
import process from "node:process";

/*
 * The single native process adapter for spec 0019 §2.4. Two independent pipe readers and the real process
 * exit run with explicit concurrency three; each reader retains only a bounded byte prefix while continuing
 * to drain beyond its cap. A deadline requests process-group termination, escalates to SIGKILL through the
 * installed spawner, then joins the real reader/exit fiber before returning any stopped receipt. The child
 * options use a fresh root-owned empty environment with `extendEnv: false`: no caller or application env is
 * inherited. No stdout/stderr/source payload is logged here.
 */

type Spawner = ChildProcessSpawner.ChildProcessSpawner["Service"];

interface PipeCapture {
  readonly chunks: Array<Uint8Array>;
  bytes: number;
  truncated: boolean;
}

interface ObservedWork {
  readonly termination: Exit.Exit<ChildProcessSpawner.ExitCode, PlatformError.PlatformError>;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutTruncated: boolean;
  readonly stderrTruncated: boolean;
}

const forcedKillGrace = Duration.millis(250);

const reviewedChildEnvironment: Readonly<Record<string, string>> = Object.freeze({});

const emptyCapture = (): PipeCapture => ({ chunks: [], bytes: 0, truncated: false });

/** Stores the observed prefix; the single owning stream fiber drains and discards bytes beyond the cap. */
const appendCapture = (capture: PipeCapture, chunk: Uint8Array, limit: number): void => {
  const available = Math.max(0, limit - capture.bytes);

  if (available === 0) {
    if (chunk.byteLength > 0) capture.truncated = true;

    return;
  }

  const length = Math.min(available, chunk.byteLength);

  if (length > 0) capture.chunks.push(chunk.slice(0, length));

  capture.bytes += length;

  if (length < chunk.byteLength) capture.truncated = true;
};

/** One final contiguous decoding copy, after bounded capture and after the stream's owner has completed. */
const textOf = (capture: PipeCapture): string => {
  const bytes = new Uint8Array(capture.bytes);
  let offset = 0;

  for (const chunk of capture.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
};

const linesOf = (text: string): ReadonlyArray<string> => {
  if (text.length === 0) return [];

  const lines = text.replaceAll("\r\n", "\n").split("\n");

  if (text.endsWith("\n")) lines.pop();

  return lines;
};

const drain = (
  pipe: Stream.Stream<Uint8Array, PlatformError.PlatformError>,
  capture: PipeCapture,
  limit: number,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Stream.runForEach(pipe, (chunk) => Effect.sync(() => appendCapture(capture, chunk, limit)));

const observedExit = (
  termination: ObservedWork["termination"],
  timedOut: boolean,
): CheckChildExit => {
  if (timedOut) {
    return Exit.isSuccess(termination)
      ? {
          _tag: "Stopped",
          reason: "deadline",
          signal: "unknown",
          exitCode: termination.value,
        }
      : { _tag: "Stopped", reason: "deadline", signal: "unknown" };
  }

  return Exit.isSuccess(termination)
    ? { _tag: "Exit", code: termination.value }
    : { _tag: "Stopped", reason: "signal", signal: "unknown" };
};

const receiptOf = (
  work: ObservedWork,
  startedAt: DateTime.DateTime,
  endedAt: DateTime.DateTime,
  timedOut: boolean,
): CheckChildResult => ({
  exit: observedExit(work.termination, timedOut),
  stdout: work.stdout,
  stderr: work.stderr,
  stderrLines: linesOf(work.stderr),
  stdoutTruncated: work.stdoutTruncated,
  stderrTruncated: work.stderrTruncated,
  durationMs: Duration.toMillis(DateTime.distance(startedAt, endedAt)),
  timedOut,
});

const completeOwned = Effect.fnUntraced(function* (
  spawner: Spawner,
  spec: CheckChildSpec,
): Effect.fn.Return<CheckChildResult, PlatformError.PlatformError> {
  return yield* Effect.scoped(
    Effect.gen(function* () {
      const startedAt = yield* DateTime.now;
      const stdoutCapture = emptyCapture();
      const stderrCapture = emptyCapture();

      // The command scope owns the process group. Its finalizer escalates and observes exit even if this
      // caller is interrupted before the explicit check deadline.
      const handle = yield* spawner.spawn(
        ChildProcess.make(spec.binary, spec.args, {
          cwd: spec.cwd,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          env: { ...reviewedChildEnvironment },
          extendEnv: false,
          forceKillAfter: forcedKillGrace,
        }),
      );

      const completion = Effect.all(
        [
          drain(handle.stdout, stdoutCapture, spec.captureBytes),
          drain(handle.stderr, stderrCapture, spec.captureBytes),
          Effect.exit(handle.exitCode),
        ],
        { concurrency: 3 },
      ).pipe(
        Effect.map((results): ObservedWork => ({
          termination: results[2],
          stdout: textOf(stdoutCapture),
          stderr: textOf(stderrCapture),
          stdoutTruncated: stdoutCapture.truncated,
          stderrTruncated: stderrCapture.truncated,
        })),
      );

      const completionFiber = yield* Effect.forkScoped(completion);

      const deadlineFiber = yield* Effect.forkScoped(
        Effect.sleep(Duration.millis(spec.forcedStopMs)),
      );

      const winner = yield* Effect.raceFirst(
        Fiber.await(completionFiber).pipe(
          Effect.map((exit) => ({ _tag: "Completed" as const, exit })),
        ),
        Fiber.await(deadlineFiber).pipe(Effect.as({ _tag: "Deadline" as const })),
      );

      if (winner._tag === "Completed") {
        const work = yield* Fiber.join(completionFiber);
        const endedAt = yield* DateTime.now;

        return receiptOf(work, startedAt, endedAt, false);
      }

      // The forced-stop path is uninterruptible until the process-group kill, escalation, and actual exit
      // plus pipe-drain completion have all been observed. This is not a fabricated fallback receipt.
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          yield* handle.kill({ killSignal: "SIGTERM", forceKillAfter: forcedKillGrace });
          const work = yield* Fiber.join(completionFiber);
          const endedAt = yield* DateTime.now;

          return receiptOf(work, startedAt, endedAt, true);
        }),
      );
    }),
  );
});

const typecheckReceiptOf = (receipt: CheckChildResult): OverlayTypecheckResult => {
  const stdoutLines = linesOf(receipt.stdout);
  const stderrLines = linesOf(receipt.stderr);

  return {
    exit: receipt.exit,
    stdout: receipt.stdout,
    stderr: receipt.stderr,
    stdoutLines,
    stderrLines,
    output: [...stdoutLines, ...stderrLines],
    stdoutTruncated: receipt.stdoutTruncated,
    stderrTruncated: receipt.stderrTruncated,
    durationMs: receipt.durationMs,
    timedOut: receipt.timedOut,
  };
};

const childFault = (message: string, cause: PlatformError.PlatformError): CompilerFault =>
  new CompilerFault({ stage: "lift", message: `${message}: ${cause._tag}`, cause });

/** The root's actual LiftCheckExecution adapter: one spawner, one process-group owner, one receipt path. */
export const liftCheckExecutionLayer: Layer.Layer<
  LiftCheckExecution,
  never,
  ChildProcessSpawner.ChildProcessSpawner
> = Layer.effect(
  LiftCheckExecution,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const runOwned = (spec: CheckChildSpec) => completeOwned(spawner, spec);

    return LiftCheckExecution.of({
      runChild: (spec) =>
        runOwned(spec).pipe(
          Effect.mapError((cause) => childFault("lift-check child failed", cause)),
        ),
      runTypecheck: (spec) =>
        runOwned(spec).pipe(
          Effect.map(typecheckReceiptOf),
          Effect.mapError((cause) => childFault("binding overlay typecheck failed", cause)),
        ),
    });
  }),
);

/**
 * The root's reviewed toolchain: the one running Bun executable and the TypeScript 6 compiler entry the
 * packed CLI depends on. Both are absolute files; nothing is searched on a `PATH`.
 */
export const liftToolchainLayer: Layer.Layer<LiftToolchain, never, Path.Path> = Layer.effect(
  LiftToolchain,
  Effect.gen(function* () {
    const path = yield* Path.Path;

    // A malformed URL for this package's own fixed dependency export is an installation defect.
    const typescript = yield* path
      .fromFileUrl(new URL(import.meta.resolve("@typescript/typescript6/lib/tsc.js")))
      .pipe(Effect.orDie);

    return LiftToolchain.of({ runtime: process.execPath, typescript });
  }),
);
