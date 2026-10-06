// EX-0035: actual qualified C/library/kernel observations at an owned Bun root.
import { BunRuntime } from "@effect/platform-bun";
import { Cause, Effect, Exit, Fiber, Schema } from "effect";
import { dlopen, ptr, type Library } from "bun:ffi";
import { execFileSync } from "node:child_process";
import { constants, fstatSync, readdirSync, readFileSync, readSync, writeSync } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import assert from "node:assert/strict";
import { acquireLinuxLspIO, LinuxLspError } from "../lsp-linux.ts";
import { nativeSymbols } from "../lsp-native-manifest.ts";
import { type TransportError, type LspIO } from "@effx/cli";
import {
  ExtraMode,
  ExtraForm,
  ExtraReceipt,
  ExtraStage,
  extraPrefixBytes,
  extraBodyForPrefill,
  extraMaximumBodyBytes,
  makeExtraFrame,
  prefillByte,
} from "./lsp-linux-extra.contract.ts";

const decodeLaunch = Schema.decodeUnknownEffect(
  Schema.Struct({
    mode: ExtraMode,
    form: ExtraForm,
    manifest: Schema.NonEmptyString,
  }),
  { onExcessProperty: "error" },
);

const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(ExtraReceipt));

const badFd = Schema.is(Schema.Struct({ code: Schema.Literal("EBADF") }));

const isLinuxError = Schema.is(LinuxLspError);

let stage: typeof ExtraStage.Type = "setup";

const receipt = Effect.fnUntraced(function* (value: ExtraReceipt) {
  const text = yield* encodeReceipt(value);
  yield* Effect.sync(() => {
    writeSync(3, text + "\n");
  });
});

const observerSymbols = {
  ...nativeSymbols,
  // Public GNU unistd.h, exactly the release ABI the actual Root uses. Bun's
  // closeSync on fd0/fd1 is deliberately NOT used (bun-v1.3.13 fd.zig245–251).
  close: { args: ["i32"], returns: "i32" },
} as const;

type Observer = Library<typeof observerSymbols>;

const snapshot = (observer: Observer, fd: number) => {
  const stat = fstatSync(fd, { bigint: true });

  const kind = stat.isSocket()
    ? ("socket" as const)
    : stat.isFIFO()
      ? ("fifo" as const)
      : stat.isCharacterDevice()
        ? ("pty" as const)
        : stat.isFile()
          ? ("file" as const)
          : ("other" as const);

  const flags = observer.symbols.fd_flags(fd);
  assert.ok(flags >= 0);

  return { kind, device: String(stat.dev), inode: String(stat.ino), flags };
};

const isClosed = (fd: number): boolean => {
  try {
    fstatSync(fd);

    return false;
  } catch (cause) {
    if (badFd(cause)) return true;
    throw cause;
  }
};

const releaseIO = <A, E>(exit: Exit.Exit<A, E>): boolean => {
  if (!Exit.isFailure(exit) || Exit.hasInterrupts(exit)) return false;
  const defect = Cause.findDefect(exit.cause);

  return (
    defect._tag === "Success" && isLinuxError(defect.success) && defect.success.reason === "IO"
  );
};

const closedError = <A>(exit: Exit.Exit<A, TransportError>): boolean => {
  if (!Exit.isFailure(exit) || Exit.hasDies(exit) || Exit.hasInterrupts(exit)) return false;
  const error = Cause.findError(exit.cause);

  return error._tag === "Success" && error.success.reason === "Closed";
};

// FD4 is the fixed test control socket, never the adopted fd0. A kernel poll
// receipt, not elapsed time, admits each synchronous one-byte read.
const command = Effect.fnUntraced(function* (observer: Observer, expected: number) {
  const buffer = new Uint8Array(1);

  while (true) {
    const ready = yield* Effect.sync(() => observer.symbols.ready_now(4));
    assert.ok(ready >= 0);

    if ((ready & observer.symbols.poll_in()) !== 0) {
      yield* Effect.sync(() => {
        assert.equal(readSync(4, buffer, 0, 1, null), 1);
        assert.equal(buffer[0], expected);
      });

      return;
    }

    yield* Effect.sleep("1 millis");
  }
});

const prefill = (observer: Observer, fd: number, socket: boolean) => {
  const backing = new Uint8Array(65536).fill(prefillByte);
  const pointer = ptr(backing);
  let accepted = 0;
  let partialWrites = 0;
  let minimumPartialBytes = 65536;
  let count = 1;
  let initial = true;

  for (let calls = 0; calls < 8192 && accepted < 8 * 1024 * 1024; calls++) {
    const written = socket
      ? observer.symbols.socket_write_now(fd, pointer, count)
      : observer.symbols.fd_write_now(fd, pointer, count);

    if (written === -osConstants.errno.EAGAIN || written === -osConstants.errno.EWOULDBLOCK) {
      if (count === 1) return { prefillBytes: accepted, partialWrites, minimumPartialBytes };
      count = 1;
    } else {
      assert.ok(written > 0 && written <= count);
      accepted += written;

      if (written < count) {
        partialWrites++;
        minimumPartialBytes = Math.min(minimumPartialBytes, written);
      }

      // Offset capacity by one byte before large requests; a real short result
      // must still be observed, never inferred from that arithmetic.
      if (initial) {
        initial = false;
        count = backing.byteLength;
      }
    }
  }

  assert.fail("prefill bound reached without observed one-byte EAGAIN");
};

const refuseAfterClose = Effect.fnUntraced(function* (io: LspIO) {
  const read = yield* io.read(1).pipe(Effect.exit);
  const write = yield* io.write("forbidden-after-close").pipe(Effect.exit);
  const probe = yield* io.probePid(process.pid).pipe(Effect.exit);
  assert.ok(closedError(read));
  assert.ok(closedError(write));
  assert.ok(Exit.isFailure(probe) && !Exit.hasDies(probe) && !Exit.hasInterrupts(probe));

  if (Exit.isFailure(probe)) {
    const error = Cause.findError(probe.cause);
    assert.ok(error._tag === "Success" && error.success.reason === "IO");
  }

  yield* io.turn;
});

const main = Effect.gen(function* () {
  const launch = yield* decodeLaunch({
    mode: process.argv[2],
    form: process.argv[3],
    manifest: process.argv[4],
  });

  yield* receipt({ event: "started", stage: "setup", fixturePid: process.pid });
  let releasedReceipt = false;

  const outcome = yield* Effect.scoped(
    Effect.gen(function* () {
      if (launch.form === "pty") {
        // util-linux script owns this real slave. Disable echo and output newline
        // transformation before framing; keep all terminal control outside Root.
        yield* Effect.sync(() =>
          execFileSync("stty", ["raw", "-echo", "-opost"], { stdio: [0, "ignore", "ignore"] }),
        );
      }

      let observerClosed = false;

      const observer = yield* Effect.acquireRelease(
        Effect.sync(() =>
          dlopen(join(dirname(launch.manifest), "lsp-readiness.so"), observerSymbols),
        ),
        (owned) =>
          Effect.sync(() => {
            if (!observerClosed) {
              observerClosed = true;
              owned.close();
            }
          }),
      );

      const closeObserver = Effect.sync(() => {
        assert.equal(observerClosed, false);
        observerClosed = true;
        observer.close();
      });

      const beforeFds = yield* Effect.sync(() =>
        readdirSync("/proc/self/fd").map(Number).filter(Number.isSafeInteger),
      );

      const fd0Before = yield* Effect.sync(() => snapshot(observer, 0));
      const fd1Before = yield* Effect.sync(() => snapshot(observer, 1));
      assert.equal(fd1Before.kind, launch.form);
      stage = "acquire";
      const io = yield* acquireLinuxLspIO(launch.manifest);
      yield* receipt({ event: "acquired", stage, fixturePid: process.pid });
      stage = "identity";
      const fd0After = yield* Effect.sync(() => snapshot(observer, 0));
      const fd1After = yield* Effect.sync(() => snapshot(observer, 1));
      assert.deepEqual(fd0After, fd0Before);
      assert.deepEqual(fd1After, fd1Before);

      const reopened = yield* Effect.sync(() =>
        readdirSync("/proc/self/fd")
          .map(Number)
          .filter(Number.isSafeInteger)
          .filter((fd) => {
            if (fd <= 4 || beforeFds.includes(fd)) return false;

            try {
              const identity = snapshot(observer, fd);

              return identity.device === fd1Before.device && identity.inode === fd1Before.inode;
            } catch (cause) {
              if (badFd(cause)) return false;
              throw cause;
            }
          }),
      );

      assert.equal(reopened.length, launch.form === "socket" ? 0 : 1);
      const outputFd = reopened[0] ?? 1;
      const reopenedIdentity = reopened[0] === undefined ? undefined : snapshot(observer, outputFd);

      if (reopenedIdentity) assert.notEqual(reopenedIdentity.flags & constants.O_NONBLOCK, 0);

      const identityReceipt: Omit<ExtraReceipt, "reopenedFd" | "reopenedIdentity"> & {
        reopenedFd?: number;
        reopenedIdentity?: NonNullable<ExtraReceipt["reopenedIdentity"]>;
      } = { event: "identity", stage, fd0Before, fd0After, fd1Before, fd1After };

      if (reopenedIdentity !== undefined) {
        identityReceipt.reopenedFd = outputFd;
        identityReceipt.reopenedIdentity = reopenedIdentity;
      }

      yield* receipt(identityReceipt);

      stage = "prefill";

      const saturated = yield* Effect.sync(() =>
        prefill(observer, outputFd, launch.form === "socket"),
      );

      assert.ok(saturated.prefillBytes > 0 && saturated.partialWrites > 0);
      assert.ok(saturated.minimumPartialBytes > 0 && saturated.minimumPartialBytes < 65536);
      const bodyBytes = extraBodyForPrefill(saturated.prefillBytes);
      assert.ok(
        bodyBytes <= extraMaximumBodyBytes,
        "observed capacity cannot fit a bounded backpressure frame",
      );
      const caller = makeExtraFrame(bodyBytes);
      yield* receipt({
        event: "saturated",
        stage,
        ...saturated,
        bodyBytes,
        frameBytes: caller.byteLength,
        wouldBlock: true,
      });
      let writerOutcome: Exit.Exit<void, TransportError> | undefined;

      const writer = yield* Effect.forkScoped(
        io.write(caller).pipe(
          Effect.onExit((exit) =>
            Effect.sync(() => {
              writerOutcome = exit;
            }),
          ),
        ),
        { startImmediately: true },
      );

      assert.equal(writerOutcome, undefined);
      yield* receipt({ event: "writer-waiting", stage: "prefix", writerPending: true });
      stage = "prefix";
      yield* command(observer, 112); // peer verified/drained exactly a real frame prefix
      stage = "backpressure";
      let pollMask = 0;

      while (true) {
        assert.equal(writerOutcome, undefined, "writer completed before observed backpressure");
        pollMask = yield* Effect.sync(() => observer.symbols.output_ready_now(outputFd));
        assert.ok(pollMask >= 0);
        assert.equal(
          pollMask &
            (observer.symbols.poll_err() |
              observer.symbols.poll_hup() |
              observer.symbols.poll_invalid()),
          0,
        );

        if ((pollMask & observer.symbols.poll_out()) === 0) break;
        yield* io.turn;
      }

      yield* Effect.sync(() => {
        assert.deepEqual(snapshot(observer, 0), fd0Before);
        assert.deepEqual(snapshot(observer, 1), fd1Before);
        caller.fill(33);
      });
      const refusal = yield* io.write("forbidden-concurrent-writer").pipe(Effect.exit);
      assert.ok(Exit.isFailure(refusal) && !Exit.hasDies(refusal) && !Exit.hasInterrupts(refusal));

      if (Exit.isFailure(refusal)) {
        const error = Cause.findError(refusal.cause);
        assert.ok(error._tag === "Success" && error.success.reason === "Capacity");
      }

      yield* receipt({
        event: "backpressure",
        stage,
        observedPrefixBytes: extraPrefixBytes,
        pollMask,
        writerPending: true,
        callerMutated: true,
        refusalReason: "Capacity",
      });

      let closeExit: "Success" | "ReleaseIO" = "Success";
      let sameCloseCause: boolean | undefined;
      let closeJoined: boolean | undefined;
      let writerExit: "Success" | "Interrupted" | "Closed" = "Success";

      if (launch.mode === "progress") {
        const exit = yield* Fiber.await(writer);
        assert.ok(Exit.isSuccess(exit));
        yield* command(observer, 100); // peer verified all framed bytes before release
        yield* closeObserver;
        stage = "release";
        yield* io.close;
      } else {
        if (launch.mode === "release-fault") {
          // Controlled real EBADF at Root's next close(0). No descriptor is opened
          // or reused between this syscall and the release/join observations.
          yield* Effect.sync(() => {
            assert.equal(observer.symbols.close(0), 0);
            assert.ok(isClosed(0));
          });
        }

        yield* closeObserver; // this dlopen reference cannot conceal Root's release

        if (launch.mode === "cancel") {
          stage = "release";
          yield* Fiber.interrupt(writer);
          const exit = yield* Fiber.await(writer);
          assert.ok(Exit.hasInterrupts(exit));
          writerExit = "Interrupted";
          yield* io.close;
        } else {
          stage = "closing";
          let firstOutcome: Exit.Exit<void> | undefined;

          const first = yield* Effect.forkScoped(
            io.close.pipe(
              Effect.onExit((exit) =>
                Effect.sync(() => {
                  firstOutcome = exit;
                }),
              ),
            ),
            { startImmediately: true },
          );

          assert.equal(
            firstOutcome,
            undefined,
            "close must join the active writer's acknowledgement",
          );
          yield* refuseAfterClose(io);
          const second = yield* Effect.forkScoped(io.close, { startImmediately: true });
          yield* receipt({
            event: "closing",
            stage,
            closePending: firstOutcome === undefined,
            postCloseRefused: true,
          });
          const a = yield* Fiber.await(first);
          const b = yield* Fiber.await(second);
          stage = "release";

          if (launch.mode === "release-fault") {
            assert.ok(releaseIO(a));
            assert.ok(releaseIO(b));
            assert.ok(Exit.isFailure(a) && Exit.isFailure(b));

            if (Exit.isFailure(a) && Exit.isFailure(b)) {
              assert.equal(a.cause, b.cause, "all close callers retain the actual release Cause");
              sameCloseCause = a.cause === b.cause;
            }

            const again = yield* io.close.pipe(Effect.exit);
            assert.ok(releaseIO(again));

            if (Exit.isFailure(a) && Exit.isFailure(again)) assert.equal(a.cause, again.cause);
            closeExit = "ReleaseIO";
          } else {
            assert.ok(Exit.isSuccess(a));
            assert.ok(Exit.isSuccess(b));
          }

          closeJoined = true;
          const exit = yield* Fiber.await(writer);

          if (launch.mode === "release-fault") {
            assert.ok(Exit.isFailure(exit) && releaseIO(exit));

            if (Exit.isFailure(exit)) {
              const error = Cause.findError(exit.cause);
              assert.ok(error._tag === "Success" && error.success.reason === "Closed");
            }
          } else assert.ok(closedError(exit));
          writerExit = "Closed";
        }
      }

      stage = "release";
      yield* refuseAfterClose(io);

      const observations = yield* Effect.sync(() => ({
        fd0Closed: isClosed(0),
        fd1Closed: isClosed(1),
        reopenedClosed: reopened.every(isClosed),
        libraryUnmapped: !readFileSync("/proc/self/maps", "utf8").includes("/lsp-readiness.so"),
      }));

      assert.ok(
        observations.fd0Closed &&
          observations.fd1Closed &&
          observations.reopenedClosed &&
          observations.libraryUnmapped,
      );

      const releaseReceipt: Omit<ExtraReceipt, "sameCloseCause" | "closeJoined"> & {
        sameCloseCause?: boolean;
        closeJoined?: boolean;
      } = {
        event: "released",
        stage,
        ...observations,
        postCloseRefused: true,
        closeExit,
        writerExit,
      };

      if (sameCloseCause !== undefined) releaseReceipt.sameCloseCause = sameCloseCause;

      if (closeJoined !== undefined) releaseReceipt.closeJoined = closeJoined;
      yield* receipt(releaseReceipt);
      releasedReceipt = true;
    }),
  ).pipe(Effect.exit);

  if (
    Exit.isFailure(outcome) &&
    !(launch.mode === "release-fault" && releasedReceipt && releaseIO(outcome))
  )
    return yield* Effect.failCause(outcome.cause);
  stage = "scope";

  if (launch.mode === "release-fault") assert.ok(releasedReceipt && releaseIO(outcome));
  yield* receipt({
    event: "scope-outcome",
    stage,
    expectedReleaseFault: launch.mode === "release-fault",
  });
}).pipe(
  Effect.onExit((exit) => {
    if (Exit.isSuccess(exit)) return Effect.void;
    const error = Cause.findError(exit.cause);

    if (error._tag === "Success" && isLinuxError(error.success))
      return receipt({
        event: "failure",
        stage,
        failureTag: "LinuxLspError",
        reason: error.success.reason,
      }).pipe(Effect.orDie);

    return receipt({
      event: "failure",
      stage,
      failureTag: Exit.hasInterrupts(exit)
        ? "Interrupted"
        : Exit.hasDies(exit)
          ? "FixtureDefect"
          : "Other",
    }).pipe(Effect.orDie);
  }),
);

BunRuntime.runMain(main, { disableErrorReporting: true });
