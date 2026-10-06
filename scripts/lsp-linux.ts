// EX-0035: public Bun FFI / adopted fd0 boundary. No package owns native authority.
import { dlopen } from "bun:ffi";
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
import { Deferred, Effect, FiberSet, Schema, type Scope } from "effect";
import { ClientProbeError, TransportError, type LspIO, type LspCallbackRuntime } from "@effx/cli";
import { NativeAssetManifest, compareVersions } from "./lsp-native-manifest.ts";

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

let fd0Owned = false;

const failure = (reason: LinuxLspError["reason"]) => new LinuxLspError({ reason });

const ioFailure = (reason: TransportError["reason"], detail: string) =>
  new TransportError({ reason, cause: detail });

const symbols = {
  ready_now: { args: ["i32"], returns: "i32" },
  fd_flags: { args: ["i32"], returns: "i32" },
  poll_in: { args: [], returns: "i32" },
  poll_hup: { args: [], returns: "i32" },
  poll_err: { args: [], returns: "i32" },
  poll_invalid: { args: [], returns: "i32" },
  pollfd_size: { args: [], returns: "i32" },
  // GNU public gnu/libc-version.h: const char *gnu_get_libc_version(void).
  // bun-v1.3.13 dlopen resolves dependencies via public dlsym; GNU returns an
  // immutable NUL-terminated version, copied by Bun CString before library close.
  gnu_get_libc_version: { args: [], returns: "cstring" },
} as const;

export const defaultLinuxLspManifestPath = fileURLToPath(
  new URL("../packages/cli/native/lsp-readiness.json", import.meta.url),
);

/** Lazy acquisition at the external Bun root. The session exclusively owns the
 * original fd0 (no stdin stream is ever obtained), the loaded library and one
 * callback FiberSet. Trusted config must not read fd0; this is not a sandbox.
 * Standard sockets/FIFOs, ordinary regular files and Linux PTYs are qualified.
 * Procfs, non-PTY devices and unavailable procfs fail before poll/raw read.
 * Poll is timeout-zero; read allocates at most 65536 bytes only after readiness.
 * Regular-file storage latency remains possible; accepted bytes cannot be undone.
 * One write is admitted at a time. Completion requires callback AND drain when
 * backpressured. Both Effect waits have a two-second deadline, but Bun 1.3.13
 * forces stdout FileSink writes synchronous (BunProcess.cpp:2366–2374): a
 * blocked foreign write cannot be interrupted by that deadline. EX-0035 remains
 * unverified until a cancellable writer across the full stdout matrix exists.
 * Closing refuses all new operations before fd/library release; late callbacks
 * are inert. Every close joins the same release Exit; failed release is a
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
  let writeBusy = false;
  const released = yield* Deferred.make<void>();
  const output = yield* Effect.try({ try: () => process.stdout, catch: () => failure("IO") });

  const close = Effect.suspend(() => {
    if (phase !== "Open") return Deferred.await(released);
    phase = "Closing";

    const endOutput = Effect.callback<void, TransportError>((resume) => {
      if (output.closed || output.writableFinished || output.destroyed) {
        resume(Effect.void);

        return;
      }

      let active = true;

      const finish = () => {
        if (active) resume(Effect.void);
      };

      const error = () => {
        if (active) resume(Effect.fail(ioFailure("IO", "stdout release")));
      };

      output.once("finish", finish);
      output.once("close", finish);
      output.once("error", error);

      try {
        output.end();
      } catch {
        error();
      }

      return Effect.sync(() => {
        active = false;
        output.off("finish", finish);
        output.off("close", finish);
        output.off("error", error);
      });
    }).pipe(
      Effect.interruptible,
      Effect.timeoutOrElse({
        duration: "2 seconds",
        orElse: () => Effect.fail(ioFailure("IO", "stdout release deadline")),
      }),
      Effect.onError(() =>
        Effect.try({
          try: () => {
            output.destroy();
          },
          catch: () => ioFailure("IO", "stdout destroy"),
        }).pipe(Effect.orDie),
      ),
      Effect.orDie,
    );

    const releaseLibrary = Effect.suspend(() => {
      if (libraryReleased) return Effect.void;
      libraryReleased = true;

      return Effect.try({ try: () => lib.close(), catch: () => failure("IO") }).pipe(Effect.orDie);
    });

    // Finalizer failures are defects in the never-E close contract. Ensuring
    // attempts every reachable release and retains all classified failures.
    return Effect.try({ try: () => closeSync(0), catch: () => failure("IO") }).pipe(
      Effect.orDie,
      Effect.ensuring(endOutput),
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
      hup: lib.symbols.poll_hup(),
      error: lib.symbols.poll_err(),
      invalid: lib.symbols.poll_invalid(),
      size: lib.symbols.pollfd_size(),
      initial: lib.symbols.fd_flags(0),
    }),
    catch: () => failure("Symbols"),
  });

  const masks = [flags.input, flags.hup, flags.error, flags.invalid];

  if (
    !int32(flags.size) ||
    flags.size <= 0 ||
    flags.size > 65536 ||
    !int32(flags.initial) ||
    flags.initial < 0 ||
    masks.some((v) => !int32(v) || v <= 0 || (v & (v - 1)) !== 0) ||
    new Set(masks).size !== 4
  )
    return yield* failure("Symbols");
  const knownMask = masks.reduce((a, b) => a | b, 0);

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
    if (phase !== "Open") return yield* ioFailure("Closed", "closed stdout");

    if (writeBusy) return yield* ioFailure("Capacity", "one native writer");
    writeBusy = true;
    yield* Effect.callback<void, TransportError>((resume) => {
      if (phase !== "Open") {
        resume(Effect.fail(ioFailure("Closed", "closed stdout")));

        return;
      }

      let active = true;
      let callbackDone = false;
      let drainDone = false;
      let submitted = false;

      const finish = () => {
        if (active && submitted && callbackDone && drainDone) resume(Effect.void);
      };

      const error = () => {
        if (active) resume(Effect.fail(ioFailure("IO", "stdout write")));
      };

      const drain = () => {
        drainDone = true;
        finish();
      };

      const closed = () => {
        if (active) resume(Effect.fail(ioFailure("Closed", "stdout closed")));
      };

      output.once("error", error);
      output.once("close", closed);
      output.once("drain", drain);

      const cleanup = Effect.sync(() => {
        active = false;
        output.off("error", error);
        output.off("close", closed);
        output.off("drain", drain);
      });
      // The public stock writable callback ABI may complete after cancellation;
      // cleanup fences that completion. Accepted kernel bytes are not retracted.

      try {
        const accepted = output.write(data, (cause) => {
          if (!active) return;

          if (cause) {
            error();

            return;
          }

          callbackDone = true;
          finish();
        });

        drainDone = accepted || drainDone;
        submitted = true;
        finish();
      } catch {
        error();
      }

      return cleanup;
    }).pipe(
      Effect.timeoutOrElse({
        duration: "2 seconds",
        orElse: () =>
          Effect.try({
            try: () => {
              output.destroy();
            },
            catch: () => ioFailure("IO", "stdout destroy"),
          }).pipe(Effect.andThen(Effect.fail(ioFailure("IO", "stdout write deadline")))),
      }),
      Effect.onInterrupt(() =>
        Effect.try({
          try: () => {
            output.destroy();
          },
          catch: () => ioFailure("IO", "stdout destroy"),
        }).pipe(Effect.orDie, Effect.ensuring(close)),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          writeBusy = false;
        }),
      ),
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
