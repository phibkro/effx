#!/usr/bin/env bun
/** @effect-diagnostics unstableApiUsage:off -- EX-0037: Alloy's scoped native child process at the process root. */
import {
  AlloyExecution,
  AlloyExecutionError,
  type AlloyRunReceipt,
  type AlloyRunRequest,
} from "@effx/cli";
import { Duration, Effect, Layer, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import type { PlatformError } from "effect/PlatformError";

const captureLimit = 8192;

interface Capture {
  readonly chunks: Array<Uint8Array>;
  bytes: number;
  truncated: boolean;
}

const capture = (): Capture => ({ chunks: [], bytes: 0, truncated: false });

const drain = (stream: Stream.Stream<Uint8Array, PlatformError>, output: Capture) =>
  Stream.runForEach(stream, (chunk) =>
    Effect.sync(() => {
      const length = Math.min(chunk.byteLength, Math.max(0, captureLimit - output.bytes));

      if (length > 0) output.chunks.push(chunk.slice(0, length));
      output.bytes += length;

      if (length < chunk.byteLength) output.truncated = true;
    }),
  );

const text = (capture: Capture): string => {
  const bytes = new Uint8Array(capture.bytes);
  let offset = 0;

  for (const chunk of capture.chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(bytes);
};

/** The calling Effect scope owns each process; its finalizer escalates if SIGTERM is ignored. */
export const alloyExecutionLayer = Layer.effect(
  AlloyExecution,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const resolveBinary = yield* Effect.cached(Effect.sync(() => Bun.which("alloy6")));

    const execute = Effect.fn("AlloyExecution.execute")(function* (
      args: ReadonlyArray<string>,
      cwd?: string,
    ): Effect.fn.Return<AlloyRunReceipt, AlloyExecutionError> {
      const binary = yield* resolveBinary;

      if (binary === null) {
        return yield* new AlloyExecutionError({
          reason: "Unavailable",
          detail: "alloy6 was not found on PATH",
        });
      }

      const result = yield* Effect.scoped(
        Effect.gen(function* () {
          const stdout = capture();
          const stderr = capture();

          const child = yield* spawner.spawn(
            ChildProcess.make(binary, args, {
              cwd,
              stdin: "ignore",
              stdout: "pipe",
              stderr: "pipe",
              env: {},
              extendEnv: false,
              forceKillAfter: Duration.seconds(1),
            }),
          );

          const [, , code] = yield* Effect.all(
            [drain(child.stdout, stdout), drain(child.stderr, stderr), child.exitCode],
            { concurrency: 3 },
          );

          return {
            code,
            stdout: text(stdout),
            stderr: text(stderr),
            truncated: stdout.truncated || stderr.truncated,
          };
        }),
      ).pipe(
        Effect.mapError(
          (cause) =>
            new AlloyExecutionError({ reason: "Execution", detail: "could not run Alloy", cause }),
        ),
      );

      return result;
    });

    const run = (request: AlloyRunRequest) =>
      execute(
        [
          "exec",
          "--quiet",
          "--command",
          request.kind === "assertions"
            ? "A*"
            : request.kind === "reachability"
              ? "Reach*"
              : "Vectors",
          "--output",
          request.outputDirectory,
          "--type",
          "json",
          "--repeat",
          request.kind === "vectors" ? "0" : "1",
          "-y",
          "0",
          request.model,
        ],
        request.workingDirectory,
      );

    return AlloyExecution.of({ version: execute(["version"]), run });
  }),
);
