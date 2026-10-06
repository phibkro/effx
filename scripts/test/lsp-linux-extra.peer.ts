// EX-0035: standalone Node host owns real socket/FIFO/util-linux PTY topology.
import { spawn, execFileSync } from "node:child_process";
import { constants, closeSync, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Socket } from "node:net";
import { Effect, Schema } from "effect";
import {
  ExtraMode,
  ExtraForm,
  ExtraReceipt,
  ExtraPeerFault,
  ExtraPeerResult,
  extraFrameByte,
  extraPrefixBytes,
  prefillByte,
  makeExtraHeader,
  extraBodyForPrefill,
} from "./lsp-linux-extra.contract.ts";

class ExtraPeerError extends Schema.TaggedError<ExtraPeerError>()(
  "ExtraPeerError",
  ExtraPeerFault.fields,
) {}

const decodeLaunch = Schema.decodeUnknownEffect(
  Schema.Struct({
    bun: Schema.NonEmptyString,
    manifest: Schema.NonEmptyString,
    mode: ExtraMode,
    form: ExtraForm,
  }),
  { onExcessProperty: "error" },
);

const decodeReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(ExtraReceipt), {
  onExcessProperty: "error",
});

const encodeResult = Schema.encodeEffect(Schema.fromJsonString(ExtraPeerResult));

const goneProcess = Schema.is(Schema.Struct({ code: Schema.Literal("ESRCH") }));

const wouldBlock = Schema.is(Schema.Struct({ code: Schema.Literals(["EAGAIN", "EWOULDBLOCK"]) }));

const knownSignal = Schema.is(ExtraPeerResult.fields.signal);

const main = Effect.scoped(
  Effect.gen(function* () {
    const launch = yield* decodeLaunch({
      bun: process.argv[2],
      manifest: process.argv[3],
      mode: process.argv[4],
      form: process.argv[5],
    });

    const directory = yield* Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), "effx-lsp-extra-"))),
      (owned) => Effect.sync(() => rmSync(owned, { recursive: true, force: true })),
    );

    const sinkPath = join(directory, "output.fifo");

    if (launch.form === "fifo") yield* Effect.sync(() => execFileSync("mkfifo", [sinkPath]));

    const reader = yield* Effect.acquireRelease(
      Effect.sync(() =>
        launch.form === "fifo"
          ? openSync(sinkPath, constants.O_RDONLY | constants.O_NONBLOCK)
          : undefined,
      ),
      (fd) =>
        Effect.sync(() => {
          if (fd !== undefined) closeSync(fd);
        }),
    );

    let parentWriter: number | undefined;
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        if (reader !== undefined) parentWriter = openSync(sinkPath, constants.O_WRONLY);
      }),
      () =>
        Effect.sync(() => {
          if (parentWriter !== undefined) {
            closeSync(parentWriter);
            parentWriter = undefined;
          }
        }),
    );
    const fixture = fileURLToPath(new URL("./lsp-linux-extra.fixture.ts", import.meta.url));
    const args = [fixture, launch.mode, launch.form, launch.manifest];
    const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
    const command = launch.form === "pty" ? "script" : launch.bun;

    const childArgs =
      launch.form === "pty"
        ? ["-qefc", "exec " + [launch.bun, ...args].map(quote).join(" "), "/dev/null"]
        : args;

    let fixturePid: number | undefined;
    let controllerClosed = false;
    let stopRequested = false;
    let stopSent = false;
    let detachReceipts: (() => void) | undefined;

    const child = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const owned = spawn(command, childArgs, {
            stdio: ["pipe", parentWriter ?? "pipe", "pipe", "pipe", "pipe"],
          });

          owned.once("close", () => {
            controllerClosed = true;
          });

          return owned;
        },
        catch: () => new ExtraPeerError({ reason: "Spawn", stage: "spawn" }),
      }),
      (owned) =>
        Effect.callback<void>((resume) => {
          if (controllerClosed) {
            resume(Effect.void);

            return;
          }

          const joined = () => {
            detachReceipts?.();
            resume(Effect.void);
          };

          owned.once("close", joined);

          if (owned.exitCode === null && owned.signalCode === null) {
            if (launch.form === "pty") {
              // Installed executable: util-linux2.42.3. Primary normal wait path:
              // https://github.com/util-linux/util-linux/blob/v2.42.3/term-utils/script.c#L1089-L1097
              // https://github.com/util-linux/util-linux/blob/v2.42.3/lib/pty-session.c#L496-L534
              // Terminate the actual Bun PID, never only script. If interruption
              // precedes started, retain FD3 observation until that PID arrives.
              stopRequested = true;

              if (fixturePid !== undefined && !stopSent) {
                stopSent = true;

                try {
                  process.kill(fixturePid, "SIGTERM");
                } catch (cause) {
                  if (!goneProcess(cause)) throw cause;
                }
              }
            } else owned.kill("SIGTERM");
          }

          return Effect.sync(() => {
            owned.off("close", joined);
          });
        }),
    );

    // The fixture owns the inherited original writer now; our copy would hide EOF.
    yield* Effect.sync(() => {
      if (parentWriter !== undefined) {
        closeSync(parentWriter);
        parentWriter = undefined;
      }
    });
    const receipts: Array<ExtraReceipt> = [];
    let fifoDrain: (() => void) | undefined;
    let finished = false;

    if (reader !== undefined)
      yield* Effect.forkScoped(
        Effect.gen(function* () {
          while (!finished) {
            yield* Effect.sync(() => fifoDrain?.());
            yield* Effect.sleep("1 millis");
          }
        }),
      );

    return yield* Effect.callback<ExtraPeerResult, ExtraPeerError>((resume) => {
      const receiptStream = child.stdio[3];
      const control = child.stdio[4];
      const output = child.stdout;

      if (
        !(receiptStream instanceof Socket) ||
        !(control instanceof Socket) ||
        (reader === undefined && !(output instanceof Socket))
      ) {
        resume(Effect.fail(new ExtraPeerError({ reason: "Topology", stage: "setup" })));

        return;
      }

      // No flowing reader until the writer-waiting receipt. Raw FIFO reads have
      // no hidden libuv read registration; socket/PTY readable mode is budgeted.
      output?.pause();
      let active = true;
      let pending = "";
      let receiptBytes = 0;
      const decoder = new TextDecoder();
      let prefillBytes: number | undefined;
      let frameBytes: number | undefined;
      let header: Uint8Array | undefined;
      let prefillBytesRead = 0;
      let frameBytesRead = 0;
      let frameVerified = true;
      let prefixVerified = false;
      let prefixAck = false;
      let fullAck = false;
      let released = false;
      let drainBudget = 0;
      let reading = false;
      let outputEnded = false;
      let childExit: { code: number | null; signal: string | null } | undefined;
      let fault: ExtraPeerFault | undefined;
      const backing = new Uint8Array(65536);

      const recordFault = (reason: ExtraPeerFault["reason"], stage: ExtraPeerFault["stage"]) => {
        if (active) fault ??= { reason, stage };
      };

      const acknowledge = (byte: number) => {
        control.write(new Uint8Array([byte]), (error) => {
          if (error) recordFault("Control", "prefix");
        });
      };

      const consume = (bytes: Uint8Array) => {
        if (prefillBytes === undefined || frameBytes === undefined || header === undefined) {
          recordFault("Receipt", "prefill");

          return;
        }

        for (const byte of bytes) {
          if (prefillBytesRead < prefillBytes) {
            if (byte !== prefillByte) {
              frameVerified = false;
              recordFault("Bytes", "prefill");
            }

            prefillBytesRead++;
          } else {
            if (frameBytesRead >= frameBytes || byte !== extraFrameByte(frameBytesRead, header)) {
              frameVerified = false;
              recordFault("Bytes", "drain");
            }

            frameBytesRead++;
          }
        }

        if (
          !prefixAck &&
          prefillBytesRead === prefillBytes &&
          frameBytesRead === extraPrefixBytes
        ) {
          prefixAck = true;
          prefixVerified = frameVerified;
          acknowledge(112);
        }

        if (launch.mode === "progress" && frameBytesRead === frameBytes && !fullAck) {
          fullAck = true;
          acknowledge(100);
        }
      };

      const cleanup = () => {
        active = false;
        finished = true;
        fifoDrain = undefined;

        if (controllerClosed) detachReceipts?.();
        output?.off("readable", drain);
        output?.off("end", end);
        output?.off("data", consumeOnExit);

        // On peer interruption, discard controller output while its owned
        // finalizer stops/joins the actual fixture. A blocked script copy must
        // not prevent the normal controller waitpid path from completing.
        if (!controllerClosed) output?.resume();
        child.off("close", close);
        child.off("error", spawnError);
        // Keep error handlers through stream destruction; late writes are inert.
        child.stdin?.destroy();
        control.destroy();
      };

      const finish = () => {
        if (!active || childExit === undefined || !outputEnded) return;

        if (pending.length > 0) recordFault("Receipt", "receipt");
        let fixtureGone = false;

        if (fixturePid !== undefined) {
          try {
            process.kill(fixturePid, 0);
          } catch (cause) {
            fixtureGone = goneProcess(cause);
          }
        }

        const ptyChildJoined = launch.form !== "pty" || (childExit.signal === null && fixtureGone);

        if (!fixtureGone || !ptyChildJoined) recordFault("Join", "join");

        if (!released || prefillBytesRead !== prefillBytes || !prefixVerified)
          recordFault("Drain", "drain");

        if (
          frameBytes === undefined ||
          (launch.mode === "progress"
            ? frameBytesRead !== frameBytes
            : frameBytesRead >= frameBytes)
        )
          recordFault("Drain", "drain");

        const result: Omit<ExtraPeerResult, "fault"> & { fault?: ExtraPeerFault } = {
          code: childExit.code,
          signal: knownSignal(childExit.signal) ? childExit.signal : "Other",
          receipts,
          frameBytesRead,
          prefillBytesRead,
          prefixVerified,
          frameVerified,
          fixtureGone,
          ptyChildJoined,
        };

        if (fault !== undefined) result.fault = fault;
        cleanup();
        resume(Effect.succeed(result));
      };

      const drain = () => {
        if (!active || drainBudget === 0) return;

        try {
          while (drainBudget > 0) {
            let bytes: Uint8Array;

            if (reader !== undefined) {
              const count = readSync(
                reader,
                backing,
                0,
                Math.min(backing.byteLength, drainBudget),
                null,
              );

              if (count === 0) {
                outputEnded = true;
                finish();
                break;
              }

              bytes = backing.subarray(0, count);
            } else {
              if (!output || output.readableLength === 0) break;
              reading = true;

              const chunk: unknown = output.read(
                Math.min(65536, output.readableLength, drainBudget),
              );

              reading = false;

              if (!(chunk instanceof Uint8Array)) {
                recordFault("Drain", "drain");
                break;
              }

              bytes = chunk;
            }

            drainBudget -= bytes.byteLength;
            consume(bytes);
          }
        } catch (cause) {
          reading = false;

          if (!wouldBlock(cause)) recordFault("Drain", "drain");
        }
      };

      const consumeOnExit = (bytes: Uint8Array) => {
        // read() itself emits data, so count it only in drain. Node flushStdio
        // can also resume after process exit; count that real buffered drain
        // once, without assuming cross-FD receipt delivery order.
        if (active && !reading) consume(bytes);
      };

      const end = () => {
        outputEnded = true;
        finish();
      };

      const receiptError = () => recordFault("Receipt", "receipt");
      const spawnError = () => recordFault("Spawn", "spawn");
      const streamError = () => recordFault("Control", "receipt");

      const close = (code: number | null, signal: string | null) => {
        childExit = { code, signal };

        if (signal !== null && !knownSignal(signal)) recordFault("Join", "join");
        drainBudget = Infinity;
        drain();
        finish();
      };

      const receive = (chunk: Uint8Array) => {
        // FD3 remains owned after interruption until actual PID discovery/join.
        receiptBytes += chunk.byteLength;

        if (receiptBytes > 65536) {
          recordFault("Receipt", "receipt");

          return;
        }

        pending += decoder.decode(chunk);
        let newline: number;

        while ((newline = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          let event: ExtraReceipt;

          try {
            event = decodeReceipt(line);
          } catch {
            recordFault("Receipt", "receipt");
            continue;
          }

          receipts.push(event);

          if (event.fixturePid !== undefined) {
            fixturePid = event.fixturePid;

            if (stopRequested && !stopSent) {
              stopSent = true;

              try {
                process.kill(fixturePid, "SIGTERM");
              } catch (cause) {
                if (!goneProcess(cause)) throw cause;
              }
            }
          }

          if (!active) continue;

          if (event.event === "saturated") {
            prefillBytes = event.prefillBytes;
            frameBytes = event.frameBytes;

            if (
              prefillBytes === undefined ||
              frameBytes === undefined ||
              event.bodyBytes !== extraBodyForPrefill(prefillBytes) ||
              !event.wouldBlock
            )
              recordFault("Receipt", "prefill");

            if (event.bodyBytes !== undefined) {
              header = makeExtraHeader(event.bodyBytes);

              if (frameBytes !== header.byteLength + event.bodyBytes)
                recordFault("Receipt", "prefill");
            }
          } else if (event.event === "writer-waiting") {
            if (prefillBytes === undefined) recordFault("Receipt", "prefix");
            else {
              drainBudget = prefillBytes + extraPrefixBytes;
              drain();
            }
          } else if (event.event === "backpressure" && launch.mode === "progress") {
            drainBudget = Infinity;
            drain();
          } else if (event.event === "released") {
            released = true;
            drainBudget = Infinity;
            drain();
          }
        }
      };

      detachReceipts = () => {
        receiptStream.off("data", receive);
        receiptStream.off("error", receiptError);
      };

      receiptStream.on("data", receive);
      receiptStream.on("error", receiptError);
      control.on("error", streamError);
      child.stdin?.on("error", streamError);
      child.stderr?.on("data", () => {}); // raw foreign stderr is never acquired into a receipt
      child.on("error", spawnError);
      child.once("close", close);
      output?.on("readable", drain);
      output?.on("end", end);
      output?.on("data", consumeOnExit);
      output?.pause();
      fifoDrain = drain;

      return Effect.sync(cleanup);
    }).pipe(Effect.timeout("10 seconds"));
  }),
);

// One real process-entry bridge. Host signals interrupt the same owned graph,
// whose child finalizer waits for the real fixture/controller close.
const abort = new AbortController();

const interrupt = () => abort.abort();

process.once("SIGINT", interrupt);

process.once("SIGTERM", interrupt);

void Effect.runPromiseExit(main.pipe(Effect.flatMap(encodeResult)), { signal: abort.signal }).then(
  (exit) => {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);

    if (exit._tag === "Failure") {
      process.exitCode = 1;

      return;
    }

    process.stdout.write(exit.value + "\n");
  },
);
