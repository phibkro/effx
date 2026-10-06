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

const hasPublicErrno = Schema.is(Schema.Struct({ errno: Schema.Int }));

// Root emits these local static details, not a foreign/raw diagnostic payload.
// Validate the reason/detail pair before mapping it into the closed receipt.
const isRootWriterFailure = Schema.is(
  Schema.Union([
    Schema.Struct({ reason: Schema.Literal("Closed"), cause: Schema.Literal("closed stdout") }),
    Schema.Struct({
      reason: Schema.Literal("Capacity"),
      cause: Schema.Literals(["one native writer", "native frame bound", "native output span"]),
    }),
    Schema.Struct({
      reason: Schema.Literal("IO"),
      cause: Schema.Literals([
        "stdout frame",
        "stdout write deadline",
        "invalid output poll result",
        "output poll",
        "output poll error",
        "invalid native write result",
        "stdout native write",
        "native write progress",
        "invalid errno classification",
      ]),
    }),
  ]),
);

const rootWriterFailures = {
  "closed stdout": "closed",
  "one native writer": "writer-capacity",
  "native frame bound": "frame-capacity",
  "native output span": "span-capacity",
  "stdout frame": "frame-construction",
  "stdout write deadline": "deadline",
  "invalid output poll result": "invalid-output-poll",
  "output poll": "output-poll",
  "output poll error": "output-terminal",
  "invalid native write result": "invalid-native-result",
  "stdout native write": "native-write",
  "native write progress": "invalid-progress",
  "invalid errno classification": "errno-classification",
} as const satisfies Record<string, NonNullable<ExtraReceipt["writerFailure"]>>;

let stage: typeof ExtraStage.Type = "setup";

let identityFailure: ExtraReceipt["identityFailure"];

let identityObservations: Pick<
  ExtraReceipt,
  "fd0Before" | "fd0After" | "fd1Before" | "fd1After" | "reopenedFd" | "reopenedIdentity"
> = {};

// Retain only the registered projection before an assertion replaces the cause.
// This state is failure evidence, never an early saturation receipt.
type FixtureObservations = Pick<
  ExtraReceipt,
  | "prefillFailure"
  | "commandFailure"
  | "fixtureErrno"
  | "fixtureScopeCleanupFailed"
  | "prefillBytes"
  | "partialWrites"
  | "minimumPartialBytes"
  | "wouldBlock"
  | "pollMask"
  | "writerPending"
  | "writerOutcome"
  | "writerReason"
  | "writerFailure"
  | "outputPressureFailure"
  | "outputPressurePollMask"
  | "outputPressureErrno"
>;

const fixtureObservations: {
  -readonly [K in keyof FixtureObservations]: FixtureObservations[K];
} = {};

// Snapshot at the law phase, never in onExit: scope cleanup must not replace a
// pending writer observation with the interruption caused by a failed assertion.
const observeWriter = (exit: Exit.Exit<void, TransportError> | undefined) => {
  fixtureObservations.writerPending = exit === undefined;
  fixtureObservations.writerOutcome =
    exit === undefined
      ? "Pending"
      : Exit.isSuccess(exit)
        ? "Success"
        : Exit.hasInterrupts(exit)
          ? "Interrupted"
          : Exit.hasDies(exit)
            ? "Defect"
            : "Failure";

  if (exit === undefined || Exit.isSuccess(exit)) return;
  const error = Cause.findError(exit.cause);

  if (error._tag === "Success" && isRootWriterFailure(error.success)) {
    fixtureObservations.writerReason = error.success.reason;
    fixtureObservations.writerFailure = rootWriterFailures[error.success.cause];
  }
  // Root intentionally replaces native errno with its static detail; no errno
  // is inferred here. Only a direct negative output poll can supply one below.
};

const identityEqual = <A>(
  actual: A,
  expected: A,
  category: NonNullable<ExtraReceipt["identityFailure"]>,
) => {
  if (actual !== expected) identityFailure = category;
  assert.equal(actual, expected);
};

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

const readCommandByte = (buffer: Uint8Array): number => {
  try {
    return readSync(4, buffer, 0, 1, null);
  } catch (cause) {
    fixtureObservations.commandFailure = "read";

    if (hasPublicErrno(cause)) fixtureObservations.fixtureErrno = Math.abs(cause.errno);
    throw cause;
  }
};

// FD4 is the fixed inherited test control reader, never the adopted fd0. A
// kernel poll receipt, not elapsed time, admits each synchronous one-byte read.
const command = Effect.fnUntraced(function* (observer: Observer, expected: number) {
  const buffer = new Uint8Array(1);

  while (true) {
    const ready = yield* Effect.sync(() => observer.symbols.ready_now(4));

    if (ready < 0) {
      fixtureObservations.commandFailure = "poll";
      fixtureObservations.fixtureErrno = -ready;
    } else fixtureObservations.pollMask = ready;
    assert.ok(ready >= 0);

    if ((ready & observer.symbols.poll_in()) !== 0) {
      yield* Effect.sync(() => {
        const bytes = readCommandByte(buffer);

        if (bytes !== 1) fixtureObservations.commandFailure = "short-read";
        assert.equal(bytes, 1);

        if (buffer[0] !== expected) fixtureObservations.commandFailure = "unexpected-byte";
        assert.equal(buffer[0], expected);
      });

      return;
    }

    const terminal =
      ready &
      (observer.symbols.poll_err() | observer.symbols.poll_hup() | observer.symbols.poll_invalid());

    if (terminal !== 0) fixtureObservations.commandFailure = "terminal";
    assert.equal(terminal, 0);

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
  fixtureObservations.prefillBytes = accepted;
  fixtureObservations.partialWrites = partialWrites;
  fixtureObservations.minimumPartialBytes = minimumPartialBytes;
  fixtureObservations.wouldBlock = false;

  for (let calls = 0; calls < 8192 && accepted < 8 * 1024 * 1024; calls++) {
    const written = socket
      ? observer.symbols.socket_write_now(fd, pointer, count)
      : observer.symbols.fd_write_now(fd, pointer, count);

    if (written === -osConstants.errno.EAGAIN || written === -osConstants.errno.EWOULDBLOCK) {
      if (count === 1) {
        fixtureObservations.wouldBlock = true;

        return { prefillBytes: accepted, partialWrites, minimumPartialBytes };
      }

      count = 1;
    } else {
      if (written < 0) {
        fixtureObservations.prefillFailure = "native-write";
        fixtureObservations.fixtureErrno = -written;
      } else if (written === 0 || written > count)
        fixtureObservations.prefillFailure = "invalid-write";
      assert.ok(written > 0 && written <= count);
      accepted += written;

      if (written < count) {
        partialWrites++;
        minimumPartialBytes = Math.min(minimumPartialBytes, written);
      }

      fixtureObservations.prefillBytes = accepted;
      fixtureObservations.partialWrites = partialWrites;
      fixtureObservations.minimumPartialBytes = minimumPartialBytes;

      // A successful one-byte probe is progress, not saturation. Resume large
      // requests so the call bound never becomes a one-byte capacity guess.
      // Only a real short write and a real one-byte EAGAIN establish the laws.
      count = backing.byteLength;
    }
  }

  fixtureObservations.prefillFailure = "bound";
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
          }).pipe(
            Effect.onExit((exit) =>
              Effect.sync(() => {
                // This observes only this fixture-owned observer finalizer.
                // It is not the Root close Exit or native release evidence.
                if (Exit.isFailure(exit)) fixtureObservations.fixtureScopeCleanupFailed = true;
              }),
            ),
          ),
      );

      const closeObserver = Effect.sync(() => {
        assert.equal(observerClosed, false);
        observerClosed = true;
        observer.close();
      });

      // Bun v1.3.13 readdirInner opens the directory and closes it before
      // returning (node_fs.zig L4946–4958). Its listed fd can be reused by Root.
      // Only descriptors still valid AFTER enumeration belong to the baseline.
      // https://github.com/oven-sh/bun/blob/bun-v1.3.13/src/bun.js/node/node_fs.zig#L4946-L4958
      const beforeFds = yield* Effect.sync(() =>
        readdirSync("/proc/self/fd")
          .map(Number)
          .filter(Number.isSafeInteger)
          .filter((fd) => !isClosed(fd)),
      );

      const fd0Before = yield* Effect.sync(() => snapshot(observer, 0));
      const fd1Before = yield* Effect.sync(() => snapshot(observer, 1));
      identityObservations = { fd0Before, fd1Before };
      identityEqual(fd1Before.kind, launch.form, "stdout-kind");
      stage = "acquire";
      const io = yield* acquireLinuxLspIO(launch.manifest);
      yield* receipt({ event: "acquired", stage, fixturePid: process.pid });
      stage = "identity";
      const fd0After = yield* Effect.sync(() => snapshot(observer, 0));
      const fd1After = yield* Effect.sync(() => snapshot(observer, 1));
      identityObservations = { fd0Before, fd0After, fd1Before, fd1After };
      // These are the identity/status laws, not equality of incidental stat data.
      identityEqual(fd0After.kind, fd0Before.kind, "fd0-kind");
      identityEqual(fd0After.device, fd0Before.device, "fd0-device");
      identityEqual(fd0After.inode, fd0Before.inode, "fd0-inode");
      identityEqual(fd0After.flags, fd0Before.flags, "fd0-flags");
      identityEqual(fd1After.kind, fd1Before.kind, "fd1-kind");
      identityEqual(fd1After.device, fd1Before.device, "fd1-device");
      identityEqual(fd1After.inode, fd1Before.inode, "fd1-inode");
      identityEqual(fd1After.flags, fd1Before.flags, "fd1-flags");

      const reopened = yield* Effect.sync(() =>
        readdirSync("/proc/self/fd")
          .map(Number)
          .filter(Number.isSafeInteger)
          .filter((fd) => {
            if (fd <= 4 || beforeFds.includes(fd)) return false;

            try {
              const identity = snapshot(observer, fd);

              return (
                identity.kind === fd1Before.kind &&
                identity.device === fd1Before.device &&
                identity.inode === fd1Before.inode
              );
            } catch (cause) {
              if (badFd(cause)) return false;
              throw cause;
            }
          }),
      );

      identityEqual(reopened.length, launch.form === "socket" ? 0 : 1, "reopened-count");
      const outputFd = reopened[0] ?? 1;
      const reopenedIdentity = reopened[0] === undefined ? undefined : snapshot(observer, outputFd);

      const identityReceipt: Omit<ExtraReceipt, "reopenedFd" | "reopenedIdentity"> & {
        reopenedFd?: number;
        reopenedIdentity?: NonNullable<ExtraReceipt["reopenedIdentity"]>;
      } = { event: "identity", stage, fd0Before, fd0After, fd1Before, fd1After };

      if (reopenedIdentity !== undefined) {
        identityReceipt.reopenedFd = outputFd;
        identityReceipt.reopenedIdentity = reopenedIdentity;
        identityObservations = { ...identityObservations, reopenedFd: outputFd, reopenedIdentity };
        identityEqual(reopenedIdentity.kind, fd1Before.kind, "reopened-kind");
        identityEqual(reopenedIdentity.device, fd1Before.device, "reopened-device");
        identityEqual(reopenedIdentity.inode, fd1Before.inode, "reopened-inode");
        identityEqual(
          reopenedIdentity.flags & constants.O_NONBLOCK,
          constants.O_NONBLOCK,
          "reopened-flags",
        );

        // Original status flags are the caller's observed baseline, not a
        // blocking premise. Bun's conditional writer path can set NONBLOCK:
        // https://github.com/oven-sh/bun/blob/bun-v1.3.13/src/io/openForWriting.zig#L62-L119
        // Its invocation in the failed fixture was not observed.
        //
        // Independence comes from the qualified source construction: Root
        // calls open_output_now (scripts/lsp-linux.ts), whose open(procfd) at
        // tools/native/lsp-readiness.c:42-49 creates a new open description,
        // not dup's shared flags: https://man7.org/linux/man-pages/man2/open.2.html
        // This distinct descriptor check alone is NOT the independence proof.
        // Owned NONBLOCK above and original kind/device/inode/flags unchanged
        // at acquisition and backpressure remain the actual observation laws.
        identityEqual(outputFd === 1, false, "reopened-shared-flags");
      }

      yield* receipt(identityReceipt);

      stage = "prefill";

      const saturated = yield* Effect.sync(() =>
        prefill(observer, outputFd, launch.form === "socket"),
      );

      if (
        saturated.prefillBytes <= 0 ||
        saturated.partialWrites <= 0 ||
        saturated.minimumPartialBytes <= 0 ||
        saturated.minimumPartialBytes >= 65536
      )
        fixtureObservations.prefillFailure = "one-byte-blocked-without-partial";
      assert.ok(saturated.prefillBytes > 0 && saturated.partialWrites > 0);
      assert.ok(saturated.minimumPartialBytes > 0 && saturated.minimumPartialBytes < 65536);
      const bodyBytes = extraBodyForPrefill(saturated.prefillBytes);

      if (bodyBytes > extraMaximumBodyBytes) fixtureObservations.prefillFailure = "frame-bound";
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

      observeWriter(writerOutcome);

      if (writerOutcome !== undefined)
        fixtureObservations.outputPressureFailure = "writer-completed";
      assert.equal(writerOutcome, undefined);
      yield* receipt({ event: "writer-waiting", stage: "prefix", writerPending: true });
      stage = "prefix";
      yield* command(observer, 112); // peer verified/drained exactly a real frame prefix
      stage = "backpressure";
      let pollMask = 0;

      while (true) {
        // Poll and writer snapshot are one phase observation, before any guard
        // can replace their evidence. FD4 command masks remain separate.
        pollMask = yield* Effect.sync(() => {
          observeWriter(writerOutcome);
          const ready = observer.symbols.output_ready_now(outputFd);

          if (ready < 0) fixtureObservations.outputPressureErrno = -ready;
          else fixtureObservations.outputPressurePollMask = ready;

          if (writerOutcome !== undefined)
            fixtureObservations.outputPressureFailure = "writer-completed";
          else if (ready < 0) fixtureObservations.outputPressureFailure = "poll";
          else if (
            (ready &
              (observer.symbols.poll_err() |
                observer.symbols.poll_hup() |
                observer.symbols.poll_invalid())) !==
            0
          )
            fixtureObservations.outputPressureFailure = "terminal";

          assert.equal(writerOutcome, undefined, "writer completed before observed backpressure");
          assert.ok(ready >= 0);
          assert.equal(
            ready &
              (observer.symbols.poll_err() |
                observer.symbols.poll_hup() |
                observer.symbols.poll_invalid()),
            0,
          );

          return ready;
        });

        if ((pollMask & observer.symbols.poll_out()) === 0) break;
        yield* io.turn;
      }

      yield* Effect.sync(() => {
        const fd0Backpressure = snapshot(observer, 0);
        const fd1Backpressure = snapshot(observer, 1);
        identityObservations = {
          ...identityObservations,
          fd0After: fd0Backpressure,
          fd1After: fd1Backpressure,
        };
        identityEqual(fd0Backpressure.kind, fd0Before.kind, "fd0-kind");
        identityEqual(fd0Backpressure.device, fd0Before.device, "fd0-device");
        identityEqual(fd0Backpressure.inode, fd0Before.inode, "fd0-inode");
        identityEqual(fd0Backpressure.flags, fd0Before.flags, "fd0-flags");
        identityEqual(fd1Backpressure.kind, fd1Before.kind, "fd1-kind");
        identityEqual(fd1Backpressure.device, fd1Before.device, "fd1-device");
        identityEqual(fd1Backpressure.inode, fd1Before.inode, "fd1-inode");
        identityEqual(fd1Backpressure.flags, fd1Before.flags, "fd1-flags");
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
        ...fixtureObservations,
        ...identityObservations,
        failureTag: "LinuxLspError",
        reason: error.success.reason,
      }).pipe(Effect.orDie);

    const failureReceipt: ExtraReceipt = {
      event: "failure",
      stage,
      ...fixtureObservations,
      ...identityObservations,
      failureTag: Exit.hasInterrupts(exit)
        ? "Interrupted"
        : Exit.hasDies(exit)
          ? "FixtureDefect"
          : "Other",
    };

    if (identityFailure !== undefined)
      return receipt({ ...failureReceipt, identityFailure, ...identityObservations }).pipe(
        Effect.orDie,
      );

    return receipt(failureReceipt).pipe(Effect.orDie);
  }),
);

BunRuntime.runMain(main, { disableErrorReporting: true });
