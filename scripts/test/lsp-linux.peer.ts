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
import { LinuxFixtureReceipt, LinuxPeerResult } from "./lsp-linux.contract.ts";

class PeerFault extends Schema.TaggedError<PeerFault>()("PeerFault", {
  reason: Schema.Literals(["Spawn", "Receipt", "Write", "Exit"]),
}) {}

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

  const descriptor =
    launch.form === "file"
      ? openSync(file, "r")
      : launch.form === "device"
        ? openSync("/dev/null", "r")
        : launch.form === "procfs"
          ? openSync("/proc/version", "r")
          : undefined;

  if (descriptor !== undefined)
    yield* Effect.addFinalizer(() => Effect.sync(() => closeSync(descriptor)));
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
    childArgs = ["-qefc", [launch.bun, ...args].map(quote).join(" "), "/dev/null"];
  }

  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () =>
        spawn(command, childArgs, { stdio: [descriptor ?? "pipe", "pipe", "pipe", "pipe"] }),
      catch: () => new PeerFault({ reason: "Spawn" }),
    }),
    (owned) =>
      Effect.callback<void>((resume) => {
        if (owned.exitCode !== null || owned.signalCode !== null) {
          resume(Effect.void);

          return;
        }

        const done = () => resume(Effect.void);
        owned.once("close", done);
        owned.kill("SIGKILL");

        return Effect.sync(() => owned.off("close", done));
      }),
  );

  const receipts: Array<typeof LinuxFixtureReceipt.Type> = [];
  let stdoutBytes = 0;

  const result = yield* Effect.callback<typeof LinuxPeerResult.Type, PeerFault>((resume) => {
    let pending = "";
    let received = 0;
    let active = true;
    let sent = false;
    const receiptStream = child.stdio[3];

    if (!receiptStream || !("on" in receiptStream)) {
      resume(Effect.fail(new PeerFault({ reason: "Receipt" })));

      return;
    }

    const receive = (chunk: Uint8Array) => {
      if (!active) return;
      received += chunk.byteLength;

      if (received > 65536) {
        resume(Effect.fail(new PeerFault({ reason: "Receipt" })));

        return;
      }

      pending += new TextDecoder().decode(chunk);
      let newline: number;

      while ((newline = pending.indexOf("\n")) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);

        try {
          const event = parseReceipt(line);
          receipts.push(event);

          if (event.event === "acquired" && launch.mode === "signal") child.kill("SIGINT");
        } catch {
          resume(Effect.fail(new PeerFault({ reason: "Receipt" })));
        }
      }
    };

    const out = (chunk: Uint8Array) => {
      stdoutBytes += chunk.byteLength;
    };

    const discardError = () => {};

    const fail = () => resume(Effect.fail(new PeerFault({ reason: "Spawn" })));

    const done = (code: number | null, signal: string | null) => {
      if (active) resume(Effect.succeed({ code, signal, receipts, stdoutBytes }));
    };

    receiptStream.on("data", receive);
    child.once("error", fail);
    child.once("close", done);
    child.stderr?.on("data", discardError);
    // A stalled reader deliberately never consumes stdout; the fixture's real
    // callback writer and release must terminate without the peer draining it.

    if (launch.mode !== "blocked-write") child.stdout?.on("data", out);

    if (launch.mode === "broken-write") child.stdout?.destroy();
    const input = child.stdin;

    if (launch.mode === "read" && input && launch.form === "socket") {
      const writer = new StreamMessageWriter(input);
      let chain = Promise.resolve();

      for (let i = 0; i < 16; i++) {
        chain = chain.then(() =>
          writer.write({
            jsonrpc: "2.0",
            method: "synthetic",
            params: { text: "x".repeat(65400) },
          }),
        );
      }

      chain.then(
        () => {
          sent = true;
          input.end();
        },
        () => {
          if (active) resume(Effect.fail(new PeerFault({ reason: "Write" })));
        },
      );
    } else if (launch.mode === "read" && launch.form === "fifo") {
      const fifo = createWriteStream(file + ".fifo");
      fifo.on("error", () => {
        if (active) resume(Effect.fail(new PeerFault({ reason: "Write" })));
      });
      fifo.end(readFileSync(file));
    } else if (launch.mode === "read" && launch.form === "pty" && input) {
      input.write("abc\n\u0004");
    } else if (launch.mode !== "signal" && input) input.end();

    return Effect.sync(() => {
      active = false;
      receiptStream.off("data", receive);
      child.off("error", fail);
      child.off("close", done);
      child.stdout?.off("data", out);
      child.stderr?.off("data", discardError);

      if (!sent) child.stdin?.destroy();
    });
  }).pipe(Effect.timeout("10 seconds"));

  const safe = yield* encodeResult(result);
  yield* Effect.sync(() => {
    writeSync(1, safe + "\n");
  });
}).pipe(Effect.scoped);

// One process entry, not one runtime per callback; only a schema projection exits.
Effect.runPromise(main).catch(() => {
  process.exitCode = 1;
});
