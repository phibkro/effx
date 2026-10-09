// EX-0035: standalone Node host owns real socket/FIFO/util-linux PTY topology.
import { spawn, execFileSync } from "node:child_process";
import { constants, closeSync, mkdtempSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
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

// Selected observations survive scope failure; an absent exit stays null, never 0.
const observed: { -readonly [K in keyof ExtraPeerResult]: ExtraPeerResult[K] } & {
  receipts: Array<ExtraReceipt>;
} = {
  code: null,
  signal: null,
  receipts: [],
  frameBytesRead: 0,
  prefillBytesRead: 0,
  prefixVerified: false,
  frameVerified: false,
  fixtureGone: false,
  ptyChildJoined: false,
};

let outerFailed = false;

let observedFixturePid: number | undefined;

let observedForm: typeof ExtraForm.Type | undefined;

let observedControllerClosed = false;

const projectFailure = (fault: ExtraPeerFault): ExtraPeerResult => {
  outerFailed = true;
  let fixtureGone = false;

  if (observedFixturePid !== undefined) {
    try {
      process.kill(observedFixturePid, 0);
    } catch (cause) {
      fixtureGone = goneProcess(cause);
    }
  }

  return {
    ...observed,
    fixtureGone,
    ptyChildJoined:
      observedControllerClosed &&
      (observedForm !== "pty" || (observed.signal === null && fixtureGone)),
    fault: observed.fault ?? { reason: fault.reason, stage: fault.stage },
  };
};

const main = Effect.scoped(
  Effect.gen(function* () {
    const launch = yield* decodeLaunch({
      bun: process.argv[2],
      manifest: process.argv[3],
      mode: process.argv[4],
      form: process.argv[5],
    }).pipe(Effect.mapError(() => new ExtraPeerError({ reason: "Setup", stage: "launch" })));

    observedForm = launch.form;

    const directory = yield* Effect.acquireRelease(
      Effect.try({
        try: () => mkdtempSync(join(tmpdir(), "effx-lsp-extra-")),
        catch: () => new ExtraPeerError({ reason: "Setup", stage: "setup" }),
      }),
      (owned) => Effect.sync(() => rmSync(owned, { recursive: true, force: true })),
    );

    const sinkPath = join(directory, "output.fifo");
    const controlPath = join(directory, "control.fifo");

    yield* Effect.try({
      try: () =>
        execFileSync("mkfifo", launch.form === "fifo" ? [controlPath, sinkPath] : [controlPath]),
      catch: () => new ExtraPeerError({ reason: "Setup", stage: "setup" }),
    });

    // EX-0035: Node v24.21.0 maps every extra pipe to child-writable /
    // parent-readable native authority, even when the JS stream is Writable.
    // https://github.com/nodejs/node/blob/v24.21.0/lib/internal/child_process.js#L1056-L1065
    // https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/unix/process.c#L253-L259
    // FD4 instead inherits this real FIFO reader; the peer owns an independent
    // nonblocking writer, at most two single-byte ACKs and no waiting queue.
    // Both descriptors belong to this scope and release after the child joins.
    let controlReader: number | undefined;

    const inheritedControlReader = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          controlReader = openSync(controlPath, constants.O_RDONLY | constants.O_NONBLOCK);

          return controlReader;
        },
        catch: () => new ExtraPeerError({ reason: "Setup", stage: "control-stream" }),
      }),
      () =>
        Effect.sync(() => {
          if (controlReader !== undefined) {
            closeSync(controlReader);
            controlReader = undefined;
          }
        }),
    );

    const controlWriter = yield* Effect.acquireRelease(
      Effect.try({
        try: () => openSync(controlPath, constants.O_WRONLY | constants.O_NONBLOCK),
        catch: () => new ExtraPeerError({ reason: "Setup", stage: "control-stream" }),
      }),
      (fd) => Effect.sync(() => closeSync(fd)),
    );

    const reader = yield* Effect.acquireRelease(
      Effect.try({
        try: () =>
          launch.form === "fifo"
            ? openSync(sinkPath, constants.O_RDONLY | constants.O_NONBLOCK)
            : undefined,
        catch: () => new ExtraPeerError({ reason: "Setup", stage: "output-stream" }),
      }),
      (fd) =>
        Effect.sync(() => {
          if (fd !== undefined) closeSync(fd);
        }),
    );

    let parentWriter: number | undefined;
    yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          if (reader !== undefined) parentWriter = openSync(sinkPath, constants.O_WRONLY);
        },
        catch: () => new ExtraPeerError({ reason: "Setup", stage: "output-stream" }),
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
            // libuv dup2 clears CLOEXEC for numeric stdio; script init_slave
            // only replaces 0/1/2 and closes its own PTY/signal descriptors.
            // https://github.com/nodejs/node/blob/v24.21.0/deps/uv/src/unix/process.c#L342-L379
            // https://github.com/util-linux/util-linux/blob/v2.42.3/lib/pty-session.c#L287-L309
            stdio: ["pipe", parentWriter ?? "pipe", "pipe", "pipe", inheritedControlReader],
          });

          owned.once("close", (code, signal) => {
            controllerClosed = true;
            observedControllerClosed = true;
            observed.code = code;
            observed.signal = knownSignal(signal) ? signal : "Other";
          });
          // A spawn error can arrive after an early topology failure has unwound
          // its callback. Keep this classified listener until the real close.
          owned.on("error", () => {
            observed.fault ??= { reason: "Spawn", stage: "spawn" };
          });
          owned.once("exit", (code, signal) => {
            observed.code = code;
            observed.signal = knownSignal(signal) ? signal : "Other";
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

    // The fixture owns the inherited output writer now; our copy would hide EOF.
    yield* Effect.try({
      try: () => {
        if (parentWriter !== undefined) {
          closeSync(parentWriter);
          parentWriter = undefined;
        }
      },
      catch: () => new ExtraPeerError({ reason: "Setup", stage: "output-stream" }),
    });

    const receipts = observed.receipts;
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
      // Public stream roles, not private handles or a JS-class claim of kernel kind.
      // Node v24.21.0 doc/api/child_process.md: stdio[fd] is a pipe stream;
      // stdout is Readable. Native kinds are checked by the fixture's FD receipts.
      const receiptStream = child.stdio[3] instanceof Readable ? child.stdio[3] : undefined;
      const output = child.stdout;

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
      let frameVerified = false;
      let prefixVerified = false;
      let prefixAck = false;
      let fullAck = false;
      let released = false;
      let producerExited = child.exitCode !== null || child.signalCode !== null;
      let fixtureFailed = false;
      let drainBudget = producerExited ? Infinity : 0;
      let outputEnded = false;
      let receiptsEnded = receiptStream?.readableEnded ?? false;
      let childExit: { code: number | null; signal: string | null } | undefined;
      let fault: ExtraPeerFault | undefined = observed.fault;
      const backing = new Uint8Array(65536);

      const recordFault = (reason: ExtraPeerFault["reason"], stage: ExtraPeerFault["stage"]) => {
        if (active) {
          fault ??= observed.fault ?? { reason, stage };
          observed.fault = fault;
        }
      };

      const acknowledge = (byte: number) => {
        if (
          !active ||
          producerExited ||
          fixtureFailed ||
          child.exitCode !== null ||
          child.signalCode !== null
        )
          return;

        try {
          if (writeSync(controlWriter, new Uint8Array([byte])) !== 1)
            recordFault("Control", "prefix");
        } catch {
          recordFault("Control", "prefix");
        }
      };

      const consume = (bytes: Uint8Array) => {
        // Terminal output can arrive before its FD3 metadata/failure receipt.
        // Without metadata, discard it only to join; it proves no frame law.
        if (
          fixtureFailed ||
          prefillBytes === undefined ||
          frameBytes === undefined ||
          header === undefined
        )
          return;

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
          !producerExited &&
          !fixtureFailed &&
          prefillBytesRead === prefillBytes &&
          frameBytesRead === extraPrefixBytes
        ) {
          prefixAck = true;
          prefixVerified = frameVerified;
          acknowledge(112);
        }

        if (
          !producerExited &&
          !fixtureFailed &&
          launch.mode === "progress" &&
          frameBytesRead === frameBytes &&
          !fullAck
        ) {
          fullAck = true;
          acknowledge(100);
        }

        observed.prefillBytesRead = prefillBytesRead;
        observed.frameBytesRead = frameBytesRead;
        observed.prefixVerified = prefixVerified;
        observed.frameVerified = frameVerified;
      };

      const cleanup = () => {
        active = false;
        finished = true;
        fifoDrain = undefined;

        if (controllerClosed) detachReceipts?.();
        output?.off("readable", drain);
        output?.off("end", end);

        // On peer interruption, discard controller output while its owned
        // finalizer stops/joins the actual fixture. A blocked script copy must
        // not prevent the normal controller waitpid path from completing.
        if (!controllerClosed) output?.resume();
        child.off("close", close);
        child.off("exit", exited);
        child.off("error", spawnError);
        // Keep error handlers through stream destruction; late events are inert.
        child.stdin?.destroy();
      };

      const finish = () => {
        if (!active || childExit === undefined || !outputEnded || !receiptsEnded) return;

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

        // Preserve an observed fixture failure and every genuine earlier peer
        // fault separately. A failed producer cannot establish the normal laws;
        // do not relabel missing metadata/release as an incidental drain fault.
        if (!fixtureFailed && childExit.code === 0 && childExit.signal === null) {
          if (!released || prefillBytesRead !== prefillBytes || !prefixVerified)
            recordFault("Drain", "drain");

          if (
            frameBytes === undefined ||
            (launch.mode === "progress"
              ? frameBytesRead !== frameBytes
              : frameBytesRead >= frameBytes)
          )
            recordFault("Drain", "drain");
        }

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
              if (!output) break;

              if (output.readableLength === 0) {
                // A paused Readable still needs read(0) to observe EOF. A readable
                // listener prevents Node flushStdio.resume from flowing.
                // v24.21.0 lib/internal/streams/readable.js:680-700,1243-1260.
                output.read(0);
                break;
              }

              const chunk: unknown = output.read(
                Math.min(65536, output.readableLength, drainBudget),
              );

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
          if (!wouldBlock(cause)) recordFault("Drain", "drain");
        }
      };

      const end = () => {
        outputEnded = true;
        finish();
      };

      const receiptEnd = () => {
        receiptsEnded = true;
        finish();
      };

      const receiptError = () => recordFault("Receipt", "receipt");
      const spawnError = () => recordFault("Spawn", "spawn");
      const streamError = () => recordFault("Control", "receipt");
      const outputError = () => recordFault("Drain", "output-stream");

      const close = (code: number | null, signal: string | null) => {
        childExit = { code, signal };
        producerExited = true;

        if (signal !== null && !knownSignal(signal)) recordFault("Join", "join");
        drainBudget = Infinity;
        drain();
        finish();
      };

      const exited = () => {
        // Exit is the producer milestone; close also waits for stdio. Granting
        // the terminal drain only on close makes stdout and close wait on each other.
        // v24.21.0 lib/internal/child_process.js:318-333,1137-1143.
        producerExited = true;
        drainBudget = Infinity;
        drain();
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
            observedFixturePid = fixturePid;

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

          if (event.event === "failure") {
            fixtureFailed = true;
            frameVerified = false;
            observed.frameVerified = false;
            drainBudget = Infinity;
            drain();
          } else if (event.event === "saturated") {
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
              else
                frameVerified =
                  prefillBytes !== undefined &&
                  event.bodyBytes === extraBodyForPrefill(prefillBytes) &&
                  event.wouldBlock === true;
            }
          } else if (event.event === "writer-waiting") {
            if (prefillBytes === undefined) recordFault("Receipt", "prefix");
            else if (!producerExited && !fixtureFailed) {
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
        receiptStream?.off("data", receive);
        receiptStream?.off("error", receiptError);
        receiptStream?.off("end", receiptEnd);
      };

      receiptStream?.on("data", receive);
      receiptStream?.on("error", receiptError);
      receiptStream?.on("end", receiptEnd);
      child.stdin?.on("error", streamError);
      child.stderr?.on("data", () => {}); // raw foreign stderr is never acquired into a receipt
      child.on("error", spawnError);
      child.once("close", close);
      child.once("exit", exited);
      output?.on("readable", drain);
      output?.on("error", outputError);
      output?.on("end", end);
      // readable-listening mode stays nonflowing even when flushStdio resumes:
      // https://github.com/nodejs/node/blob/v24.21.0/lib/internal/streams/readable.js#L1243-L1260
      output?.pause();
      fifoDrain = drain;
      drain();

      if (receiptStream === undefined) recordFault("Topology", "receipt-stream");
      else if (reader === undefined && !(output instanceof Readable))
        recordFault("Topology", "output-stream");

      if (fault?.reason === "Topology") {
        // Keep FD3 observation through the scope's real fixture/controller join,
        // including PTY PID discovery. Typed failure cannot manufacture code 0.
        resume(Effect.fail(new ExtraPeerError(fault)));
        cleanup();
      }

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

const projected = main.pipe(
  Effect.catchTags({
    ExtraPeerError: (fault) => Effect.sync(() => projectFailure(fault)),
    TimeoutError: () => Effect.sync(() => projectFailure({ reason: "Timeout", stage: "scope" })),
  }),
  Effect.flatMap((result) =>
    encodeResult(result).pipe(
      Effect.catchTag("SchemaError", () =>
        encodeResult(projectFailure({ reason: "Projection", stage: "projection" })),
      ),
    ),
  ),
);

void Effect.runPromiseExit(projected, { signal: abort.signal }).then((exit) => {
  process.off("SIGINT", interrupt);
  process.off("SIGTERM", interrupt);

  if (exit._tag === "Failure") {
    process.exitCode = 1;

    return;
  }

  if (
    outerFailed ||
    observed.fault !== undefined ||
    observed.code !== 0 ||
    observed.signal !== null ||
    observed.receipts.some((receipt) => receipt.event === "failure")
  )
    process.exitCode = 1;
  process.stdout.write(exit.value + "\n", (error) => {
    if (error) process.exitCode = 1;
  });
});
