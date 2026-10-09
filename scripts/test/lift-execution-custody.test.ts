// @effect-diagnostics unstableApiUsage:off -- EX-0034: real native child custody test boundary.
import { assert, describe, it } from "@effect/vitest";
import { BunServices } from "@effect/platform-bun";
import { Cause, Duration, Effect, Exit, FileSystem, Fiber, Layer, Path, Schema } from "effect";
import {
  LiftCheckExecution,
  type CheckChildExit,
  type CheckChildSpec,
} from "@effx/cli/lift-boundaries";
import { liftCheckExecutionLayer } from "../lift-execution.ts";
import process from "node:process";

class ProbeMarkerMissing extends Schema.TaggedError<ProbeMarkerMissing>()("ProbeMarkerMissing", {
  path: Schema.String,
}) {}

const peer = new URL("./custody-probe-child.ts", import.meta.url).pathname;

const cwd = new URL(".", import.meta.url).pathname;

const ReadyMarker = Schema.fromJsonString(
  Schema.Struct({ pid: Schema.Finite, ready: Schema.Literal(true) }),
);

const DescendantMarker = Schema.fromJsonString(
  Schema.Struct({
    pid: Schema.Finite,
    descendantPid: Schema.Finite,
    ready: Schema.Literal(true),
  }),
);

/** One probe child: absolute executable/cwd, explicit arguments, byte cap and forced-stop deadline. */
const probeSpec = (
  mode: string,
  args: ReadonlyArray<string>,
  forcedStopMs: number,
  captureBytes: number,
): CheckChildSpec => ({
  binary: process.execPath,
  cwd,
  args: [peer, mode, ...args],
  captureBytes,
  forcedStopMs,
});

/** Assert the observed exit variant before reading its code. */
const assertExitCodeOf = (exit: CheckChildExit, expected: number): void => {
  if (exit._tag === "Exit") assert.strictEqual(exit.code, expected);
  else assert.fail(`expected an observed exit code ${expected}, got a stopped child`);
};

const waitForMarker = Effect.fnUntraced(function* (fs: FileSystem.FileSystem, marker: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (yield* fs.exists(marker)) return yield* fs.readFileString(marker);
    yield* Effect.sleep(Duration.millis(10));
  }

  return yield* new ProbeMarkerMissing({ path: marker });
});

const pidIsAlive = (pid: number) =>
  Effect.map(Effect.exit(Effect.sync(() => process.kill(pid, 0))), (exit) => Exit.isSuccess(exit));

/** The real Bun platform backend plus the one native lift-check adapter. */
const testLayer = liftCheckExecutionLayer.pipe(Layer.provideMerge(BunServices.layer));

/** Every probe is a real Bun child launched by the installed Effect process adapter. */
const runProbe = (spec: CheckChildSpec) =>
  Effect.flatMap(LiftCheckExecution, (execution) => execution.runChild(spec));

describe("lift check native child custody (spec 0019 §2.4 step 5)", () => {
  it.live(
    "drains a large stderr flood while stdout remains open with bounded capture",
    () =>
      Effect.map(
        runProbe(probeSpec("stderr-flood", [String(128 * 1024 * 1024)], 5_000, 8_192)),
        (receipt) => {
          assertExitCodeOf(receipt.exit, 0);
          assert.strictEqual(receipt.timedOut, false);
          assert.strictEqual(receipt.stdout, "stdout-start\nstdout-end\n");
          assert.strictEqual(receipt.stdoutTruncated, false);
          assert.strictEqual(receipt.stderrTruncated, true);
          assert.ok(receipt.stderr.startsWith("stderr-000000"));
          assert.ok(new TextEncoder().encode(receipt.stderr).byteLength <= 8_192);
          assert.ok(receipt.durationMs >= 0);
        },
      ).pipe(Effect.provide(testLayer)),
    15_000,
  );

  it.live("preserves exact framing on both successful output pipes", () =>
    Effect.map(runProbe(probeSpec("frame", [], 20_000, 1_024)), (receipt) => {
      assertExitCodeOf(receipt.exit, 0);
      assert.strictEqual(receipt.stdout, "frame-out-1\nframe-out-2\nframe-out-3\n");
      assert.strictEqual(receipt.stderr, "frame-err-1\nframe-err-2\n");
    }).pipe(Effect.provide(testLayer)),
  );

  it.live("retains stdout and stderr diagnostics in the typecheck receipt", () =>
    Effect.flatMap(LiftCheckExecution, (execution) =>
      execution.runTypecheck({
        tscPath: process.execPath,
        cwd,
        args: [peer, "diag"],
        captureBytes: 1_048_576,
        forcedStopMs: 20_000,
      }),
    ).pipe(
      Effect.provide(testLayer),
      Effect.map((receipt) => {
        assertExitCodeOf(receipt.exit, 2);
        assert.ok(receipt.stdoutLines.some((line) => line.startsWith("stdout-diagnostic")));
        assert.ok(receipt.stderrLines.some((line) => line.startsWith("stderr-diagnostic")));
        assert.ok(receipt.output.some((line) => line.startsWith("stdout-diagnostic")));
        assert.ok(receipt.output.some((line) => line.startsWith("stderr-diagnostic")));
      }),
    ),
  );

  it.live("returns a typed child failure when the executable cannot spawn", () =>
    Effect.flip(
      runProbe({
        binary: `${cwd}does-not-exist`,
        cwd,
        args: [],
        captureBytes: 8_192,
        forcedStopMs: 1_000,
      }),
    ).pipe(
      Effect.provide(testLayer),
      Effect.map((failure) => assert.strictEqual(failure._tag, "CompilerFault")),
    ),
  );

  it.live(
    "forced-stop receipt preserves partial output, elapsed time, and the observed dead child",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const readyDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "lift-custody-stop-" });
        const readyPath = path.join(readyDirectory, "ready.json");
        const receipt = yield* runProbe(probeSpec("hang", [readyPath], 500, 64 * 1024));
        const ready = yield* Schema.decodeEffect(ReadyMarker)(yield* fs.readFileString(readyPath));
        const childStillRunning = yield* pidIsAlive(ready.pid);

        if (childStillRunning) yield* Effect.sync(() => process.kill(ready.pid, "SIGKILL"));

        assert.deepEqual(
          {
            forcedStop: receipt.timedOut,
            partialStdoutObserved: receipt.stdout.includes("ready\n"),
            elapsedAtLeastDeadline: receipt.durationMs >= 200,
            childStillRunning,
            exitTag: receipt.exit._tag,
          },
          {
            forcedStop: true,
            partialStdoutObserved: true,
            elapsedAtLeastDeadline: true,
            childStillRunning: false,
            exitTag: "Stopped",
          },
        );
      }).pipe(Effect.provide(testLayer)),
    20_000,
  );

  it.live(
    "interrupts an acquired child and joins its scope cleanup",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const path = yield* Path.Path;

        const readyDirectory = yield* fs.makeTempDirectoryScoped({
          prefix: "lift-custody-interrupt-",
        });

        const readyPath = path.join(readyDirectory, "ready.json");

        const fiber = yield* Effect.forkScoped(
          runProbe(probeSpec("hang", [readyPath], 20_000, 64 * 1024)),
        );

        const ready = yield* Schema.decodeEffect(ReadyMarker)(yield* waitForMarker(fs, readyPath));

        yield* Fiber.interrupt(fiber);
        const interrupted = yield* Fiber.await(fiber);
        const childStillRunning = yield* pidIsAlive(ready.pid);

        if (childStillRunning) yield* Effect.sync(() => process.kill(ready.pid, "SIGKILL"));

        assert.isTrue(Exit.isFailure(interrupted) && Cause.hasInterrupts(interrupted.cause));
        assert.isFalse(childStillRunning);
      }).pipe(Effect.provide(testLayer)),
    20_000,
  );

  it.live(
    "forced-stop cleanup kills an owned descendant as well as the group leader",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;

        const path = yield* Path.Path;

        const readyDirectory = yield* fs.makeTempDirectoryScoped({
          prefix: "lift-custody-descendant-",
        });

        const readyPath = path.join(readyDirectory, "parent.json");

        const descendantPath = path.join(readyDirectory, "descendant.json");

        const receipt = yield* runProbe(
          probeSpec("descendant", [readyPath, descendantPath], 500, 64 * 1024),
        );

        const ready = yield* Schema.decodeEffect(DescendantMarker)(
          yield* fs.readFileString(readyPath),
        );

        const parentAlive = yield* pidIsAlive(ready.pid);

        const descendantAlive = yield* pidIsAlive(ready.descendantPid);

        if (parentAlive) yield* Effect.sync(() => process.kill(ready.pid, "SIGKILL"));

        if (descendantAlive) yield* Effect.sync(() => process.kill(ready.descendantPid, "SIGKILL"));

        assert.strictEqual(receipt.timedOut, true);
        assert.isFalse(parentAlive);
        assert.isFalse(descendantAlive);
      }).pipe(Effect.provide(testLayer)),
    20_000,
  );
});
