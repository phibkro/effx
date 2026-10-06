// EX-0035: public Bun FFI / adopted fd0/fd1 boundary. No package owns native authority.
import { dlopen, ptr } from "bun:ffi";
import { Buffer } from "node:buffer";
import {
  closeSync,
  fstatSync,
  readFileSync,
  readlinkSync,
  readSync,
  statfsSync,
  statSync,
} from "node:fs";
import * as process from "node:process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isatty } from "node:tty";
import { RAL } from "vscode-languageserver-protocol/node";
import { Clock, Deferred, Effect, FiberSet, Predicate, Schema, type Scope } from "effect";
import { ClientProbeError, TransportError, type LspIO, type LspCallbackRuntime } from "@effx/cli";
import { NativeAssetManifest, compareVersions, nativeSymbols } from "./lsp-native-manifest.ts";

const positive = Schema.Int.check(Schema.isGreaterThan(0));

export class LinuxLspError extends Schema.TaggedError<LinuxLspError>()("LinuxLspError", {
  reason: Schema.Literals([
    "Target",
    "Libc",
    "Manifest",
    "Integrity",
    "NativeLoad",
    "Symbols",
    "Procfs",
    "StdinForm",
    "StdoutForm",
    "Ownership",
    "IO",
  ]),
}) {}

const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(NativeAssetManifest), {
  onExcessProperty: "error",
});

const gone = Schema.is(Schema.Struct({ code: Schema.Literal("ESRCH") }));

const denied = Schema.is(Schema.Struct({ code: Schema.Literal("EPERM") }));

const transientRead = Schema.is(
  Schema.Struct({ code: Schema.Literals(["EAGAIN", "EWOULDBLOCK", "EINTR"]) }),
);

const int32 = Schema.is(Schema.Int.check(Schema.isInt32()));

const readBound = Schema.is(positive.check(Schema.isLessThanOrEqualTo(65536)));

const empty = new Uint8Array(0);

// Spec 0018: one body (8 MiB) plus the bounded framing header (8 KiB).
const frameBound = 8 * 1024 * 1024 + 8 * 1024;

const writeAllowanceNanos = 2_000_000_000n;

let fd0Owned = false;

const failure = (reason: LinuxLspError["reason"]) => new LinuxLspError({ reason });

const ioFailure = (reason: TransportError["reason"], detail: string) =>
  new TransportError({ reason, cause: detail });

const symbols = {
  ...nativeSymbols,
  // GNU public gnu/libc-version.h: const char *gnu_get_libc_version(void).
  // bun-v1.3.13 dlopen resolves dependencies via public dlsym; GNU returns an
  // immutable NUL-terminated version, copied by Bun CString before library close.
  gnu_get_libc_version: { args: [], returns: "cstring" },
} as const;

export const defaultLinuxLspManifestPath = fileURLToPath(
  new URL("../packages/cli/native/lsp-readiness.json", import.meta.url),
);

/** Lazy acquisition at the external Bun root. The session exclusively owns the
 * original fd0/fd1 (no stdin/stdout stream is obtained), the loaded library and one
 * callback FiberSet. Trusted config must not read fd0; this is not a sandbox.
 * Standard sockets/FIFOs, ordinary regular files and Linux PTYs are qualified.
 * Procfs, non-PTY devices and unavailable procfs fail before poll/raw read.
 * Poll is timeout-zero; read allocates at most 65536 bytes only after readiness.
 * Regular-file storage latency remains possible; accepted bytes cannot be undone.
 * One immutable owned frame/cursor is admitted; concurrent writers are refused.
 * Socket sends use MSG_DONTWAIT|MSG_NOSIGNAL; FIFO/PTY writes use an independently
 * opened O_NONBLOCK description, never shared flag mutation. C owns per-call
 * SIGPIPE thread masking/consumption/restoration for write(2). Kernel acceptance
 * completes each chunk; there is no FileSink queue or late write callback.
 * One monotonic Effect Clock deadline covers progress and release waiting.
 * Regular output remains real IO, but Linux ignores O_NONBLOCK for storage:
 * neither write(2) nor close(2) is made interruptible by the two-second wait.
 * The regular WRITE/release latency premise still needs explicit approval;
 * EX-0035 is not full-backend acceptance and no hard wall-clock bound is claimed.
 * Closing refuses new progress before fd/library release. Every close joins
 * the same actual release Exit; failed release is a
 * classified defect, not successful cleanup. State is transient; no retry,
 * durable queue or runtime compiler.
 * EOF/PID death/SIGINT termination is owned by the portable session/root Scope.
 */
export const acquireLinuxLspIO = Effect.fnUntraced(function* (
  manifestPath: string = defaultLinuxLspManifestPath,
): Effect.fn.Return<LspIO, LinuxLspError, Scope.Scope> {
  if (process.platform !== "linux" || process.arch !== "x64" || Bun.version !== "1.3.13") {
    return yield* failure("Target");
  }

  const manifestText = yield* Effect.try({
    try: () => {
      if (statSync(manifestPath).size > 65536) throw failure("Manifest");

      return readFileSync(manifestPath, "utf8");
    },
    catch: () => failure("Manifest"),
  });

  const manifest = yield* decodeManifest(manifestText).pipe(
    Effect.mapError(() => failure("Manifest")),
  );

  if (
    manifest.byteLength > 16 * 1024 * 1024 ||
    manifest.glibcVersions.length === 0 ||
    manifest.neededLibraries.length !== 1 ||
    manifest.glibcVersions.some((v) => compareVersions(manifest.minimumGlibc, v) < 0)
  )
    return yield* failure("Manifest");

  const libraryPath = join(dirname(manifestPath), manifest.library);
  yield* Effect.try({
    try: () => {
      const size = statSync(libraryPath).size;

      if (size !== manifest.byteLength) throw failure("Integrity");
      const bytes = readFileSync(libraryPath);

      if (
        bytes.byteLength !== size ||
        new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== manifest.sha256
      )
        throw failure("Integrity");
    },
    catch: () => failure("Integrity"),
  });

  // Load the artifact before adopting a descriptor: unsupported GNU link/version
  // requirements are a typed startup fault, never a raw-IO compatibility guess.
  let libraryReleased = false;

  const lib = yield* Effect.acquireRelease(
    Effect.try({ try: () => dlopen(libraryPath, symbols), catch: () => failure("NativeLoad") }),
    (library) =>
      Effect.suspend(() => {
        if (libraryReleased) return Effect.void;
        libraryReleased = true;

        return Effect.try({ try: () => library.close(), catch: () => failure("IO") }).pipe(
          Effect.orDie,
        );
      }),
  );
  // Bun1.3.13 getReport ignores excludeEnv and captures environmentVariables
  // (BunProcess.cpp:2149,2202-2203); never acquire it, even if config changes flags.
  // Missing GNU symbol / link version is NativeLoad, malformed version is Libc.

  const runtimeVersion = yield* Effect.try({
    try: () => String(lib.symbols.gnu_get_libc_version()),
    catch: () => failure("Libc"),
  }).pipe(
    Effect.flatMap((value) =>
      Schema.decodeEffect(NativeAssetManifest.fields.minimumGlibc.check(Schema.isMaxLength(64)))(
        value,
      ),
    ),
    Effect.mapError(() => failure("Libc")),
  );

  if (compareVersions(runtimeVersion, manifest.minimumGlibc) < 0) return yield* failure("Libc");

  let phase: "Open" | "Closing" | "Closed" = "Open";
  const clock = yield* Clock.Clock;
  let outputFd: number | undefined;
  let fd1Owned = false;

  let writer:
    | {
        frame: Uint8Array;
        cursor: number;
        readonly deadline: bigint;
        readonly stopped: Deferred.Deferred<void>;
      }
    | undefined;

  const released = yield* Deferred.make<void>();

  const close = Effect.suspend(() => {
    if (phase !== "Open") return Deferred.await(released);
    phase = "Closing";
    const active = writer;

    // Fence progress first. The active writer observes Closing on its next turn
    // and acknowledges cursor disposal before output/library release. Its
    // original allowance is reused, never extended by another two-second wait.
    const stopWriter = Effect.suspend(() => {
      if (!active) return Effect.void;
      const remaining = active.deadline - clock.monotonicTimeNanosUnsafe();

      return Deferred.await(active.stopped).pipe(
        Effect.interruptible,
        Effect.timeoutOrElse({
          duration: Math.max(0, Number(remaining) / 1_000_000),
          orElse: () => Effect.fail(ioFailure("IO", "stdout release deadline")),
        }),
        Effect.orDie,
      );
    });

    const releaseOutput = Effect.suspend(() => {
      const fd = outputFd;
      outputFd = undefined;

      const releaseOriginal = Effect.suspend(() => {
        if (!fd1Owned) return Effect.void;
        fd1Owned = false;

        return Effect.try({ try: () => closeSync(1), catch: () => failure("IO") }).pipe(
          Effect.orDie,
        );
      });

      // Do not retry close(2): Linux may already have released the descriptor
      // even on failure. Every reachable release is attempted, once.
      if (fd === undefined || fd === 1) return releaseOriginal;

      return Effect.try({ try: () => closeSync(fd), catch: () => failure("IO") }).pipe(
        Effect.orDie,
        Effect.ensuring(releaseOriginal),
      );
    });

    const releaseLibrary = Effect.suspend(() => {
      if (libraryReleased) return Effect.void;
      libraryReleased = true;

      return Effect.try({ try: () => lib.close(), catch: () => failure("IO") }).pipe(Effect.orDie);
    });

    // Finalizer failures are defects in the never-E close contract. Ensuring
    // attempts every reachable release and retains all classified failures.
    // A deadline bounds Effect waiting, not an uninterruptible storage syscall.
    return Effect.try({ try: () => closeSync(0), catch: () => failure("IO") }).pipe(
      Effect.orDie,
      Effect.ensuring(stopWriter),
      Effect.ensuring(releaseOutput),
      Effect.ensuring(releaseLibrary),
      Effect.onExit((exit) =>
        Effect.sync(() => {
          phase = "Closed";
        }).pipe(Effect.andThen(Deferred.done(released, exit))),
      ),
    );
  }).pipe(Effect.uninterruptible);

  // Adoption and its real release are registered atomically, before validation.
  yield* Effect.acquireRelease(
    Effect.suspend(() => {
      if (fd0Owned) return Effect.fail(failure("Ownership"));

      return Effect.sync(() => {
        fd0Owned = true;
        fd1Owned = true;
      });
    }),
    () =>
      close.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            fd0Owned = false;
          }),
        ),
      ),
  );
  yield* Effect.try({
    try: () => {
      // Read-only procfs inspection, never reopen fd0 or mutate its shared flags.
      if (readlinkSync("/proc/self") !== String(process.pid)) throw failure("Procfs");
      const target = readlinkSync("/proc/self/fd/0");
      const info = fstatSync(0);

      if (info.isSocket() || info.isFIFO()) return;

      if (info.isFile()) {
        if (statfsSync("/proc/self/fd/0").type === statfsSync("/proc").type)
          throw failure("StdinForm");

        return;
      }

      if (info.isCharacterDevice() && isatty(0) && /^\/dev\/pts\/\d+$/.test(target)) return;
      throw failure("StdinForm");
    },
    catch: (cause) => (Schema.is(LinuxLspError)(cause) ? cause : failure("Procfs")),
  });

  const flags = yield* Effect.try({
    try: () => ({
      input: lib.symbols.poll_in(),
      output: lib.symbols.poll_out(),
      hup: lib.symbols.poll_hup(),
      error: lib.symbols.poll_err(),
      invalid: lib.symbols.poll_invalid(),
      size: lib.symbols.pollfd_size(),
      initial: lib.symbols.fd_flags(0),
    }),
    catch: () => failure("Symbols"),
  });

  const masks = [flags.input, flags.output, flags.hup, flags.error, flags.invalid];

  if (
    !int32(flags.size) ||
    flags.size <= 0 ||
    flags.size > 65536 ||
    !int32(flags.initial) ||
    flags.initial < 0 ||
    masks.some((v) => !int32(v) || v <= 0 || (v & (v - 1)) !== 0) ||
    new Set(masks).size !== masks.length
  )
    return yield* failure("Symbols");
  const knownMask = flags.input | flags.hup | flags.error | flags.invalid;
  const outputMask = flags.output | flags.hup | flags.error | flags.invalid;

  const outputForm = yield* Effect.try({
    try: () => {
      const info = fstatSync(1);

      if (info.isSocket()) {
        outputFd = 1;

        return "Socket" as const;
      }

      if (info.isFile()) {
        if (statfsSync("/proc/self/fd/1").type === statfsSync("/proc").type)
          throw failure("StdoutForm");
        // Keep the inherited file cursor/O_APPEND. A procfd reopen would start
        // a new nonappend description at offset zero. Real storage writes and
        // their close remain uninterruptible; no regular-file deadline claim.
        outputFd = 1;

        return "File" as const;
      }

      const pty =
        info.isCharacterDevice() &&
        isatty(1) &&
        /^\/dev\/pts\/\d+$/.test(readlinkSync("/proc/self/fd/1"));

      if (!info.isFIFO() && !pty) throw failure("StdoutForm");
      const fd = lib.symbols.open_output_now();

      if (!int32(fd) || fd <= 1) throw failure("IO");
      // Store immediately: the already-registered owner releases it even if
      // metadata validation below fails. C never mutates fd1 shared flags.
      outputFd = fd;
      const opened = fstatSync(fd);

      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.mode !== info.mode)
        throw failure("IO");

      return "Nonblocking" as const;
    },
    catch: (cause) => (Schema.is(LinuxLspError)(cause) ? cause : failure("IO")),
  });

  const encoder = new TextEncoder();

  const wouldBlock = (result: number): boolean => {
    const retry = lib.symbols.io_would_block(result);

    if (retry !== 0 && retry !== 1) throw ioFailure("IO", "invalid errno classification");

    return retry === 1;
  };

  const read = Effect.fnUntraced(function* (maxBytes: number) {
    if (phase !== "Open") return yield* ioFailure("Closed", "closed fd0");

    if (!readBound(maxBytes)) return yield* ioFailure("Capacity", "raw read bound 1..65536");

    return yield* Effect.try({
      try: () => {
        // The scheduler can yield between Effects. Fence and perform readiness
        // plus read in one synchronous boundary, not separate Effect operations.
        if (phase !== "Open") throw ioFailure("Closed", "closed fd0");
        const ready = lib.symbols.ready_now(0);

        if (
          !int32(ready) ||
          ready < 0 ||
          (ready & ~knownMask) !== 0 ||
          (ready & flags.invalid) !== 0
        )
          throw ioFailure("IO", "invalid poll result");

        if (ready === 0) return empty;

        if ((ready & (flags.input | flags.hup)) === 0) throw ioFailure("IO", "poll error");

        // Each returned view owns fresh backing storage; parser retention never
        // aliases storage that a later native read can mutate.
        const buffer = new Uint8Array(maxBytes);
        const length = readSync(0, buffer, 0, maxBytes, null);

        return length === 0 ? null : buffer.subarray(0, length);
      },
      catch: (cause) =>
        Schema.is(TransportError)(cause)
          ? cause
          : transientRead(cause)
            ? ioFailure("IO", "retryable raw read")
            : ioFailure("IO", "raw read"),
    }).pipe(
      Effect.catchIf(
        (fault) => fault.cause === "retryable raw read",
        () => Effect.succeed(empty),
      ),
    );
  });

  const write = Effect.fnUntraced(function* (data: Uint8Array | string) {
    const stopped = yield* Deferred.make<void>();

    // Admission and finalizer installation cannot be interrupted between
    // retaining the sole frame and giving it an owner. No waiting producers.
    return yield* Effect.uninterruptibleMask((restore) =>
      Effect.suspend(() => {
        if (phase !== "Open") return Effect.fail(ioFailure("Closed", "closed stdout"));

        if (writer) return Effect.fail(ioFailure("Capacity", "one native writer"));

        return Effect.try({
          try: () => {
            const deadline = clock.monotonicTimeNanosUnsafe() + writeAllowanceNanos;

            if (Predicate.isString(data) && data.length > frameBound)
              throw ioFailure("Capacity", "native frame bound");

            const length = Predicate.isString(data)
              ? Buffer.byteLength(data, "utf8")
              : data.byteLength;

            if (length > frameBound) throw ioFailure("Capacity", "native frame bound");
            // This necessary copy isolates mutable caller bytes while we wait
            // for readiness; C receives a const pointer to private storage.
            const frame = Predicate.isString(data) ? encoder.encode(data) : new Uint8Array(data);
            const active = { frame, cursor: 0, deadline, stopped };
            writer = active;

            return active;
          },
          catch: (cause) =>
            Schema.is(TransportError)(cause) ? cause : ioFailure("IO", "stdout frame"),
        }).pipe(
          Effect.flatMap((active) =>
            restore(
              Effect.gen(function* () {
                while (active.cursor < active.frame.byteLength) {
                  yield* Effect.try({
                    try: () => {
                      // Fence, readiness, pointer construction and syscall are
                      // one synchronous boundary. There is no scheduler gap
                      // in which Closing can release the FD/library beneath us.
                      if (phase !== "Open" || outputFd === undefined)
                        throw ioFailure("Closed", "closed stdout");

                      if (clock.monotonicTimeNanosUnsafe() >= active.deadline)
                        throw ioFailure("IO", "stdout write deadline");
                      const ready = lib.symbols.output_ready_now(outputFd);

                      if (!int32(ready)) throw ioFailure("IO", "invalid output poll result");

                      if (ready < 0) {
                        if (wouldBlock(ready)) return;
                        throw ioFailure("IO", "output poll");
                      }

                      if (
                        (ready & ~outputMask) !== 0 ||
                        (ready & (flags.hup | flags.error | flags.invalid)) !== 0
                      )
                        throw ioFailure("IO", "output poll error");

                      if ((ready & flags.output) === 0) return;
                      const count = Math.min(65536, active.frame.byteLength - active.cursor);

                      // Validate the entire public ptr(view, byteOffset) span
                      // before forming a pointer. Keep backing storage alive
                      // until this synchronous native call has returned.
                      if (
                        !Number.isSafeInteger(active.cursor) ||
                        active.cursor < 0 ||
                        !readBound(count) ||
                        active.cursor + count > active.frame.byteLength
                      )
                        throw ioFailure("Capacity", "native output span");
                      const pointer = ptr(active.frame, active.cursor);

                      const accepted =
                        outputForm === "Socket"
                          ? lib.symbols.socket_write_now(outputFd, pointer, count)
                          : lib.symbols.fd_write_now(outputFd, pointer, count);

                      if (!int32(accepted)) throw ioFailure("IO", "invalid native write result");

                      if (accepted < 0) {
                        if (wouldBlock(accepted)) return;
                        throw ioFailure("IO", "stdout native write");
                      }

                      if (accepted === 0 || accepted > count)
                        throw ioFailure("IO", "native write progress");
                      active.cursor += accepted;

                      if (clock.monotonicTimeNanosUnsafe() >= active.deadline)
                        throw ioFailure("IO", "stdout write deadline");
                    },
                    catch: (cause) =>
                      Schema.is(TransportError)(cause)
                        ? cause
                        : ioFailure("IO", "stdout native write"),
                  });

                  if (active.cursor < active.frame.byteLength) yield* turn;
                }
              }),
            ).pipe(
              Effect.timeoutOrElse({
                duration: Math.max(
                  0,
                  Number(active.deadline - clock.monotonicTimeNanosUnsafe()) / 1_000_000,
                ),
                orElse: () => Effect.fail(ioFailure("IO", "stdout write deadline")),
              }),
              Effect.ensuring(
                Effect.sync(() => {
                  active.frame = empty;
                  active.cursor = 0;

                  if (writer === active) writer = undefined;
                }).pipe(Effect.andThen(Deferred.succeed(stopped, undefined))),
              ),
              // Dispose the cursor before joining close: waiting on our own
              // stopped receipt during interruption would deadlock. Accepted
              // kernel bytes remain accepted; no later chunk is submitted.
              Effect.onError(() => close),
            ),
          ),
        );
      }),
    );
  });

  const probePid = Effect.fnUntraced(function* (pid: number) {
    if (phase !== "Open")
      return yield* new ClientProbeError({ reason: "IO", cause: "closed native capability" });

    if (!Number.isSafeInteger(pid) || pid <= 0 || pid > 2147483647)
      return yield* new ClientProbeError({ reason: "IO", cause: "invalid PID" });
    yield* Effect.try({
      try: () => {
        if (phase !== "Open")
          throw new ClientProbeError({ reason: "IO", cause: "closed native capability" });
        process.kill(pid, 0);
      },
      catch: (cause) =>
        new ClientProbeError({
          reason: gone(cause) ? "Gone" : denied(cause) ? "Denied" : "IO",
          cause: "public kill-zero probe",
        }),
    });
  });

  const turn = Effect.suspend(() => {
    if (phase !== "Open") return Effect.void;

    return Effect.callback<void>((resume) => {
      if (phase !== "Open") {
        resume(Effect.void);

        return;
      }

      const handle = RAL().timer.setImmediate(() => resume(Effect.void));

      return Effect.sync(() => handle.dispose());
    }).pipe(Effect.andThen(Effect.sleep("1 millis")));
  });

  const callbacks = yield* FiberSet.make();

  const makeCallbackRuntime = Effect.fnUntraced(function* <R>(): Effect.fn.Return<
    LspCallbackRuntime<R>,
    never,
    R | Scope.Scope
  > {
    const fork = yield* FiberSet.runtime(callbacks)<R>();
    const run = yield* FiberSet.runtimePromise(callbacks)<R>();

    return { run, fork, clear: FiberSet.clear(callbacks) };
  });

  return { read, write, close, probePid, turn, makeCallbackRuntime, ral: RAL() };
});
