import { BunRuntime } from "@effect/platform-bun";
import { Cause, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import { writeSync, readFileSync, fstatSync, constants as fsConstants } from "node:fs";
import { constants as osConstants } from "node:os";
import { dirname, join } from "node:path";
import { dlopen, ptr } from "bun:ffi";
import * as process from "node:process";
import { acquireLinuxLspIO } from "../lsp-linux.ts";
import { LinuxFixtureReceipt } from "./lsp-linux.contract.ts";
import assert from "node:assert/strict";
import type { TransportError } from "@effx/cli";
import { nativeSymbols } from "../lsp-native-manifest.ts";

const Mode = Schema.Literals([
  "read",
  "closed",
  "ownership",
  "probe",
  "callbacks",
  "blocked-write",
  "broken-write",
  "signal",
  "lazy",
]);

const decodeLaunch = Schema.decodeUnknownEffect(
  Schema.Struct({ mode: Mode, manifest: Schema.NonEmptyString }),
);

const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(LinuxFixtureReceipt));

const receipt = Effect.fnUntraced(function* (value: typeof LinuxFixtureReceipt.Type) {
  const text = yield* encodeReceipt(value);
  yield* Effect.sync(() => {
    writeSync(3, text + "\n");
  });
});

const badDescriptor = Schema.is(Schema.Struct({ code: Schema.Literal("EBADF") }));

// Descriptor identity is safe observation data, not an open-file-description claim.
const snapshotFd0 = () => {
  const stat = fstatSync(0, { bigint: true });

  const kind: "socket" | "fifo" | "file" | "other" = stat.isSocket()
    ? "socket"
    : stat.isFIFO()
      ? "fifo"
      : stat.isFile()
        ? "file"
        : "other";

  return { kind, device: String(stat.dev), inode: String(stat.ino) };
};

// EX-0035: test-only real FIFO saturation, using the already qualified asset.
// One 64 KiB backing is live; at most 8192 real syscalls and 8 MiB accepted
// bytes are admitted. These caps are refusals, never evidence of saturation.
const saturateSink = Effect.fnUntraced(function* (manifest: string) {
  let finiteAcceptedBytes = 0;
  yield* Effect.scoped(
    Effect.gen(function* () {
      const library = yield* Effect.acquireRelease(
        Effect.sync(() =>
          dlopen(join(dirname(manifest), "lsp-readiness.so"), {
            fd_write_now: nativeSymbols.fd_write_now,
            fd_flags: nativeSymbols.fd_flags,
          }),
        ),
        (owned) => Effect.sync(() => owned.close()),
      );

      return yield* Effect.sync(() => {
        assert.equal(fstatSync(1).isFIFO(), true);
        assert.notEqual(library.symbols.fd_flags(1) & fsConstants.O_NONBLOCK, 0);
        const backing = new Uint8Array(65536);
        const pointer = ptr(backing);
        let count = backing.byteLength;

        for (let calls = 0; calls < 8192 && finiteAcceptedBytes < 8 * 1024 * 1024; calls++) {
          const written = library.symbols.fd_write_now(1, pointer, count);

          if (written === -osConstants.errno.EAGAIN || written === -osConstants.errno.EWOULDBLOCK) {
            // A large nonblocking write can refuse while a smaller write fits.
            // Require one-byte refusal, not EINTR or a guessed capacity.
            if (count === 1) return;
            count = 1;
          } else {
            assert.ok(written > 0 && written <= count);
            finiteAcceptedBytes += written;
          }
        }

        assert.fail("FIFO did not reach observed one-byte would-block within prefill bound");
      });
    }),
  ).pipe(
    Effect.onExit((exit) =>
      Exit.hasDies(exit)
        ? receipt({
            event: "failure",
            stage: "sink-prefill",
            failureCategory: "sink-not-saturated",
            sinkKind: "fifo",
            finiteAcceptedBytes,
            wouldBlock: false,
          }).pipe(Effect.orDie)
        : Effect.void,
    ),
  );

  // The extra dlopen reference is gone before any Root writer/close law starts.
  yield* receipt({
    event: "result",
    stage: "sink-prefill",
    sinkKind: "fifo",
    finiteAcceptedBytes,
    wouldBlock: true,
    checks: ["sink-saturated"],
  });
});

const observeWrite = Effect.fnUntraced(function* (
  stage: "blocked-write" | "broken-write",
  exit: Exit.Exit<void, TransportError>,
) {
  let failureCategory: NonNullable<typeof LinuxFixtureReceipt.Type.failureCategory> | undefined;

  if (Exit.isSuccess(exit)) failureCategory = "write-unexpected-success";
  else if (Exit.hasInterrupts(exit)) failureCategory = "write-unexpected-interrupt";
  else if (Exit.hasDies(exit)) failureCategory = "write-defect";
  else {
    const error = Cause.findError(exit.cause);

    if (
      error._tag !== "Success" ||
      (error.success.reason !== "IO" &&
        !(stage === "broken-write" && error.success.reason === "Closed"))
    )
      failureCategory = "write-unexpected-failure";
  }

  if (failureCategory !== undefined)
    yield* receipt({ event: "failure", stage, failureCategory }).pipe(Effect.orDie);
});

const program = Effect.gen(function* () {
  const launch = yield* decodeLaunch({ mode: process.argv[2], manifest: process.argv[3] });

  if (launch.mode === "lazy") {
    const discarded = acquireLinuxLspIO("/does-not-exist/lsp-readiness.json");
    void discarded;
    yield* receipt({ event: "result", checks: ["construction-is-lazy"] });

    return;
  }

  yield* Effect.scoped(
    Effect.gen(function* () {
      const io = yield* acquireLinuxLspIO(launch.manifest);
      yield* receipt({ event: "acquired", fixturePid: process.pid });
      const checks: Array<NonNullable<typeof LinuxFixtureReceipt.Type.checks>[number]> = [];

      if (launch.mode === "signal") return yield* Effect.never;

      if (launch.mode === "ownership") {
        const error = yield* acquireLinuxLspIO(launch.manifest).pipe(Effect.flip);

        if (error.reason !== "Ownership")
          return yield* Effect.die("exclusive owner was not refused");
        checks.push("exclusive-owner");
      } else if (launch.mode === "closed") {
        const fd0Before = yield* Effect.sync(snapshotFd0);
        yield* io.close;
        yield* io.close;

        const after = yield* Effect.sync(() => {
          try {
            return { fd0After: snapshotFd0(), fd0AfterStatus: "present" as const };
          } catch (cause) {
            return {
              fd0After: null,
              fd0AfterStatus: badDescriptor(cause) ? ("EBADF" as const) : ("other-error" as const),
            };
          }
        });

        yield* receipt({ event: "result", stage: "fd0-close", fd0Before, ...after });
        yield* Effect.sync(() => {
          assert.throws(() => fstatSync(0), { code: "EBADF" });
        }).pipe(
          Effect.onExit((exit) =>
            Exit.hasDies(exit)
              ? receipt({
                  event: "failure",
                  stage: "fd0-close",
                  failureCategory: "fd0-not-closed",
                }).pipe(Effect.orDie)
              : Effect.void,
          ),
        );
        yield* Effect.sync(() => {
          assert.equal(
            readFileSync("/proc/self/maps", "utf8").includes("/lsp-readiness.so"),
            false,
          );
        }).pipe(
          Effect.onExit((exit) =>
            Exit.hasDies(exit)
              ? receipt({
                  event: "failure",
                  stage: "library-close",
                  failureCategory: "library-still-mapped",
                }).pipe(Effect.orDie)
              : Effect.void,
          ),
        );
        checks.push("fd0-closed", "library-unloaded");

        const readError = yield* io.read(65536).pipe(Effect.flip);
        const writeError = yield* io.write("forbidden").pipe(Effect.flip);

        if (readError.reason !== "Closed" || writeError.reason !== "Closed")
          return yield* Effect.die("operation admitted after close");

        yield* io.probePid(process.pid).pipe(Effect.flip);
        checks.push("idempotent-close", "no-admission-after-close");
      } else if (launch.mode === "probe") {
        yield* io.probePid(process.pid);
        const invalid = yield* io.probePid(-1).pipe(Effect.flip);

        if (invalid.reason !== "IO") return yield* Effect.die("invalid pid was not IO");
        const impossible = yield* io.probePid(2147483647).pipe(Effect.flip);

        if (impossible.reason !== "Gone") return yield* Effect.die("absent pid was not Gone");
        checks.push("alive-pid", "invalid-pid", "gone-pid");
      } else if (launch.mode === "callbacks") {
        const runtime = yield* io.makeCallbackRuntime<never>();
        const started = yield* Deferred.make<void>();
        const finalized = yield* Deferred.make<void>();

        const fiber = runtime.fork(
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);

            return yield* Effect.never;
          }).pipe(Effect.ensuring(Deferred.succeed(finalized, undefined))),
        );

        yield* Deferred.await(started);
        yield* runtime.clear;
        yield* Deferred.await(finalized);
        const exit = yield* Fiber.await(fiber);

        if (exit._tag !== "Failure") return yield* Effect.die("callback was not interrupted");
        const value = yield* Effect.promise(() => runtime.run(Effect.succeed(17)));

        if (value !== 17) return yield* Effect.die("callback success channel changed");
        checks.push("callback-cancellation", "callback-finalizer-once", "promise-channel");
      } else if (launch.mode === "blocked-write") {
        yield* saturateSink(launch.manifest);

        const error = yield* io.write(new Uint8Array(1)).pipe(
          Effect.onExit((exit) => observeWrite("blocked-write", exit)),
          Effect.flip,
        );

        if (error.reason !== "IO") return yield* Effect.die("blocked writer did not fail IO");
        yield* io.close;
        checks.push("writer-deadline", "release-deadline");
      } else if (launch.mode === "broken-write") {
        const error = yield* io.write("synthetic").pipe(
          Effect.onExit((exit) => observeWrite("broken-write", exit)),
          Effect.flip,
        );

        if (error.reason !== "IO" && error.reason !== "Closed")
          return yield* Effect.die("broken pipe was not classified");
        checks.push("broken-pipe");
      } else {
        let bytes = 0;
        let maximumRead = 0;
        let maximumBacking = 0;
        let retained: Uint8Array | undefined;
        let retainedDigest: string | undefined;
        const invalid = yield* io.read(65537).pipe(Effect.flip);

        if (invalid.reason !== "Capacity") return yield* Effect.die("raw bound was ignored");

        while (true) {
          yield* io.turn;
          const data = yield* io.read(65536);

          if (data === null) break;

          if (data.byteLength > 0 && retained === undefined) {
            retained = data;
            retainedDigest = new Bun.CryptoHasher("sha256").update(data).digest("hex");
          }

          bytes += data.byteLength;
          maximumRead = Math.max(maximumRead, data.byteLength);
          maximumBacking = Math.max(maximumBacking, data.buffer.byteLength);

          if (data.byteLength > 65536 || data.buffer.byteLength > 65536)
            return yield* Effect.die("native read bound exceeded");
        }

        if (
          retained !== undefined &&
          new Bun.CryptoHasher("sha256").update(retained).digest("hex") !== retainedDigest
        )
          return yield* Effect.die("retained read backing was reused");
        yield* receipt({
          event: "result",
          bytes,
          maximumRead,
          maximumBacking,
          checks: ["read-bound", "retained-buffer", "eof"],
        });

        return;
      }

      yield* receipt({ event: "result", checks });
    }),
  ).pipe(Effect.ensuring(receipt({ event: "fixture-scope-exited" }).pipe(Effect.orDie)));
}).pipe(
  Effect.catchTag("LinuxLspError", (error) => receipt({ event: "failure", reason: error.reason })),
  Effect.onExit((exit) =>
    Exit.hasDies(exit)
      ? receipt({ event: "failure", stage: "fixture", failureCategory: "fixture-defect" }).pipe(
          Effect.orDie,
        )
      : Effect.void,
  ),
);

BunRuntime.runMain(program, { disableErrorReporting: true });
