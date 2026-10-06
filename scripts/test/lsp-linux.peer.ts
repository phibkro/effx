// EX-0035: actual Node-created stdin socket / FIFO / file / PTY test topology.
import { spawn, execFileSync } from "node:child_process";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
  createWriteStream,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { StreamMessageWriter } from "vscode-languageserver-protocol/node";
import { Effect, Schema } from "effect";
import { LinuxFixtureReceipt, LinuxPeerFault, LinuxPeerResult } from "./lsp-linux.contract.ts";

class PeerFault extends Schema.TaggedError<PeerFault>()("PeerFault", LinuxPeerFault.fields) {}

const decodeLaunch = Schema.decodeUnknownEffect(
  Schema.Struct({
    bun: Schema.NonEmptyString,
    manifest: Schema.NonEmptyString,
    mode: Schema.Literals([
      "read",
      "closed",
      "ownership",
      "probe",
      "callbacks",
      "blocked-write",
      "broken-write",
      "signal",
      "lazy",
    ]),
    form: Schema.Literals(["socket", "fifo", "file", "pty", "device", "procfs"]),
  }),
);

const parseReceipt = Schema.decodeUnknownSync(Schema.fromJsonString(LinuxFixtureReceipt));

const encodeResult = Schema.encodeEffect(Schema.fromJsonString(LinuxPeerResult));

const main = Effect.gen(function* () {
  const launch = yield* decodeLaunch({
    bun: process.argv[2],
    manifest: process.argv[3],
    mode: process.argv[4],
    form: process.argv[5],
  });

  const directory = yield* Effect.acquireRelease(
    Effect.sync(() => mkdtempSync(join(tmpdir(), "effx-lsp-linux-"))),
    (path) => Effect.sync(() => rmSync(path, { recursive: true, force: true })),
  );

  const fixture = fileURLToPath(new URL("./lsp-linux.fixture.ts", import.meta.url));
  const file = join(directory, "input");
  writeFileSync(file, new Uint8Array(131072).fill(65));

  const descriptor = yield* Effect.acquireRelease(
    Effect.sync(() =>
      launch.form === "file"
        ? openSync(file, "r")
        : launch.form === "device"
          ? openSync("/dev/null", "r")
          : launch.form === "procfs"
            ? openSync("/proc/version", "r")
            : undefined,
    ),
    (owned) =>
      Effect.sync(() => {
        if (owned !== undefined) closeSync(owned);
      }),
  );

  const args = [fixture, launch.mode, launch.manifest];
  let command = launch.bun;
  let childArgs = args;

  if (launch.form === "fifo") {
    execFileSync("mkfifo", [file + ".fifo"]);
    command = "sh";
    childArgs = [
      "-c",
      'exec "$2" "$3" "$4" "$5" < "$1"',
      "effx-fifo",
      file + ".fifo",
      launch.bun,
      fixture,
      launch.mode,
      launch.manifest,
    ];
  } else if (launch.form === "pty") {
    command = "script";
    // Test-controlled paths are quoted, never arbitrary configuration or shell code.
    const quote = (text: string) => "'" + text.replaceAll("'", "'\\''") + "'";
    childArgs = ["-qefc", "exec " + [launch.bun, ...args].map(quote).join(" "), "/dev/null"];
  }

  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        spawn(command, childArgs, { stdio: [descriptor ?? "pipe", "pipe", "pipe", "pipe"] }),
      catch: () => new PeerFault({ reason: "Spawn", stage: "spawn" }),
    }),
    (owned) =>
      Effect.callback<void>((resume) => {
        if (owned.exitCode !== null || owned.signalCode !== null) {
          resume(Effect.void);

          return;
        }

        const done = () => resume(Effect.void);
        owned.once("close", done);
        // script owns the PTY child session; SIGKILL would bypass forwarding.
        owned.kill(launch.form === "pty" ? "SIGTERM" : "SIGKILL");

        return Effect.sync(() => owned.off("close", done));
      }),
  );

  const receipts: Array<typeof LinuxFixtureReceipt.Type> = [];
  let stdoutBytes = 0;

  const result = yield* Effect.callback<typeof LinuxPeerResult.Type, PeerFault>((resume) => {
    let pending = "";
    let received = 0;
    let active = true;
    let acquired = false;
    let offering = false;
    let peerFault: LinuxPeerFault | undefined;
    let writer: StreamMessageWriter | undefined;
    let fifo: ReturnType<typeof createWriteStream> | undefined;
    let fifoOpened = false;
    const input = child.stdin;
    const receiptStream = child.stdio[3];

    if (!receiptStream || !("on" in receiptStream)) {
      resume(Effect.fail(new PeerFault({ reason: "Receipt", stage: "receipt" })));

      return;
    }

    // A write fault remains a fault, but must not discard the fixture's FD3
    // release/failure receipts or replace the child's actual close status.
    const fault = (reason: LinuxPeerFault["reason"], stage: LinuxPeerFault["stage"]) => {
      if (!active) return;
      peerFault ??= { reason, stage };

      if (launch.mode === "read") {
        input?.destroy();
        fifo?.destroy();
      }
    };

    const socketError = () => fault("Write", "socket-write");
    const fifoError = () => fault("Write", fifoOpened ? "fifo-write" : "fifo-open");
    const ptyError = () => fault("Write", "pty-write");
    const receiptError = () => fault("Receipt", "receipt");
    const fail = () => fault("Spawn", "spawn");
    const discardError = () => {};

    const out = (chunk: Uint8Array) => {
      stdoutBytes += chunk.byteLength;
    };

    const offer = () => {
      if (!active || !acquired || offering || peerFault || launch.mode !== "read") return;

      if (launch.form === "socket" && input) {
        offering = true;
        const socketWriter = new StreamMessageWriter(input);
        writer = socketWriter;
        let chain = Promise.resolve();

        for (let i = 0; i < 16; i++) {
          chain = chain.then(() => {
            if (!active || peerFault) return;

            return socketWriter.write({
              jsonrpc: "2.0",
              method: "synthetic",
              params: { text: "x".repeat(65400) },
            });
          });
        }

        chain.then(() => {
          if (active && !peerFault) input.end();
        }, socketError);
      } else if (launch.form === "fifo" && fifo && fifoOpened) {
        offering = true;
        // Opening participates in the FIFO handshake; only acquired admits bytes.
        fifo.end(readFileSync(file));
      } else if (launch.form === "pty" && input) {
        offering = true;
        // Preserve the terminal's canonical input and explicit VEOF semantics.
        input.write("abc\n\u0004", (error) => {
          if (error) ptyError();
        });
      }
    };

    const receive = (chunk: Uint8Array) => {
      if (!active) return;
      received += chunk.byteLength;

      if (received > 65536) {
        pending = "";
        receiptError();

        return;
      }

      pending += new TextDecoder().decode(chunk);
      let newline: number;

      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        let event: typeof LinuxFixtureReceipt.Type;

        try {
          event = parseReceipt(line);
        } catch {
          receiptError();
          continue;
        }

        receipts.push(event);

        if (event.event === "acquired") {
          if (acquired) {
            receiptError();
            continue;
          }

          acquired = true;

          if (launch.mode === "signal") child.kill("SIGINT");
          else offer();
        }
      }
    };

    const cleanup = () => {
      active = false;
      receiptStream.off("data", receive);
      receiptStream.off("error", receiptError);
      child.off("error", fail);
      child.off("close", done);
      child.stdout?.off("data", out);
      child.stderr?.off("data", discardError);
      writer?.dispose();
      fifo?.destroy();
      input?.destroy();
      // Keep stream error listeners through destroy/close: outstanding foreign
      // writes may still settle, but cancellation prevents further admission.
    };

    const done = (code: number | null, signal: string | null) => {
      if (!active) return;

      if (pending.length > 0) receiptError();

      const result: Omit<typeof LinuxPeerResult.Type, "peerFault"> & {
        peerFault?: LinuxPeerFault;
      } = {
        code,
        signal,
        receipts,
        stdoutBytes,
      };

      if (peerFault !== undefined) result.peerFault = peerFault;

      cleanup();
      resume(Effect.succeed(result));
    };

    receiptStream.on("data", receive);
    receiptStream.on("error", receiptError);
    child.once("error", fail);
    child.once("close", done);
    child.stderr?.on("data", discardError);
    // A stalled reader deliberately never consumes stdout; the fixture's real
    // callback writer and release must terminate without the peer draining it.

    if (launch.mode !== "blocked-write") child.stdout?.on("data", out);

    if (launch.mode === "broken-write") child.stdout?.destroy();

    if (launch.form === "socket") input?.on("error", socketError);
    else if (launch.form === "pty") input?.on("error", ptyError);

    if (launch.form === "fifo") {
      // The shell cannot exec the fixture until its read-open meets this
      // write-open. Holding the writer open sends neither payload nor EOF.
      fifo = createWriteStream(file + ".fifo");
      fifo.on("error", fifoError);
      fifo.once("open", () => {
        fifoOpened = true;
        offer();
      });
    }

    // Non-read laws own their termination. In particular Closed/broken-write
    // must not receive a premature peer EOF that changes the law under test.
    return Effect.sync(cleanup);
  }).pipe(Effect.timeout("10 seconds"));

  const safe = yield* encodeResult(result);
  yield* Effect.sync(() => {
    writeSync(1, safe + "\n");

    if (result.peerFault !== undefined) process.exitCode = 1;
  });
}).pipe(Effect.scoped);

// One process entry, not one runtime per callback; only a schema projection exits.
Effect.runPromise(main).catch(() => {
  process.exitCode = 1;
});
