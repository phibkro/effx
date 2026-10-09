#!/usr/bin/env bun
/*
 * Real child probe used by the native lift-check custody tests. Every fixture is public/non-secret and
 * communicates only the child behavior it proves: separate pipes and framed bytes, stdout+stderr
 * diagnostics, process-local bytes written before a trapped stop, and a ready pid for post-stop liveness.
 */

import { existsSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { Duration, Effect, Predicate, Schema } from "effect";
import process from "node:process";

const [mode, ...args] = process.argv.slice(2);

const descendantReady = Schema.fromJsonString(
  Schema.Struct({ pid: Schema.Finite, ready: Schema.Literal(true) }),
);

const writeFully = (fd: number, text: string): number => {
  const bytes = new TextEncoder().encode(text);

  for (let written = 0; written < bytes.byteLength;) {
    let count: number;

    try {
      count = writeSync(fd, bytes, written, bytes.byteLength - written);
    } catch (cause) {
      if (Predicate.hasProperty(cause, "code") && cause.code === "EAGAIN") {
        Bun.sleepSync(1);
        continue;
      }

      throw cause;
    }

    if (count === 0) {
      Bun.sleepSync(1);
      continue;
    }

    written += count;
  }

  return bytes.byteLength;
};

const stdoutChunk = (index: number, chunkBytes: number): string =>
  `stdout-${String(index).padStart(6, "0")} ${"o".repeat(Math.max(0, chunkBytes - 18))}\n`;

const stderrChunk = (index: number, chunkBytes: number): string =>
  `stderr-${String(index).padStart(6, "0")} ${"e".repeat(Math.max(0, chunkBytes - 18))}\n`;

const waitForFile = (file: string): void => {
  for (let attempt = 0; attempt < 5_000; attempt++) {
    if (existsSync(file)) return;
    Bun.sleepSync(1);
  }

  throw new Error(`child readiness marker was not written: ${file}`);
};

if (mode === "flood") {
  const [pairsRaw, bytesRaw] = args;
  const pairs = Number(pairsRaw);
  const chunkBytes = Number(bytesRaw);

  for (let index = 0; index < pairs; index++) {
    writeFully(1, stdoutChunk(index, chunkBytes));
    writeFully(2, stderrChunk(index, chunkBytes));
  }

  process.exitCode = 0;
} else if (mode === "stderr-flood") {
  const [targetRaw] = args;
  const targetBytes = Number(targetRaw);
  writeFully(1, "stdout-start\n");

  for (let written = 0, index = 0; written < targetBytes; index++)
    written += writeFully(2, stderrChunk(index, 65_536));

  writeFully(1, "stdout-end\n");
  process.exitCode = 0;
} else if (mode === "frame") {
  writeFully(1, "frame-out-1\nframe-out-2\nframe-out-3\n");
  writeFully(2, "frame-err-1\nframe-err-2\n");
  process.exitCode = 0;
} else if (mode === "diag") {
  writeFully(1, "stdout-diagnostic-1\nstdout-diagnostic-2\nstdout-diagnostic-3\n");
  writeFully(2, "stderr-diagnostic-1\nstderr-diagnostic-2\n");
  process.exitCode = 2;
} else if (mode === "hang") {
  const [readyPath] = args;

  if (readyPath === undefined) {
    process.exitCode = 2;
  } else {
    writeFully(1, "ready\n");
    writeFileSync(readyPath, JSON.stringify({ pid: process.pid, ready: true }));
    process.on("SIGTERM", () => {
      // A real signal handler deliberately leaves this child alive for the adapter's SIGKILL escalation.
    });
    void Effect.runPromise(Effect.sleep(Duration.seconds(60))).then(() =>
      writeFileSync(
        readyPath,
        JSON.stringify({ pid: process.pid, ready: true, ended: "deadline" }),
      ),
    );
  }
} else if (mode === "descendant") {
  const [readyPath, descendantPath] = args;
  const script = process.argv[1];

  if (readyPath === undefined || descendantPath === undefined || script === undefined) {
    process.exitCode = 2;
  } else {
    Bun.spawn([process.execPath, script, "hang", descendantPath], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      env: {},
      detached: false,
    });

    waitForFile(descendantPath);
    const descendant = Schema.decodeSync(descendantReady)(readFileSync(descendantPath, "utf8"));
    writeFileSync(
      readyPath,
      JSON.stringify({ pid: process.pid, descendantPid: descendant.pid, ready: true }),
    );
    process.on("SIGTERM", () => {
      // The process group must be force-killed even though both members ignore SIGTERM.
    });
    void Effect.runPromise(Effect.sleep(Duration.seconds(60)));
  }
} else if (mode === "daemon") {
  const script = process.argv[1];

  if (script === undefined) {
    process.exitCode = 2;
  } else {
    // The descendant starts its own session, so the group kill cannot reach it, and it inherits both pipes.
    const daemon = Bun.spawn([process.execPath, script, "linger"], {
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      env: {},
      detached: true,
    });

    daemon.unref();
    writeFully(2, `daemon-pid ${daemon.pid}\n`);
    process.exitCode = 0;
  }
} else if (mode === "linger") {
  // Holds the inherited pipes open and ends by itself, so an aborted test cannot leak it.
  void Effect.runPromise(Effect.sleep(Duration.seconds(30)));
} else {
  writeFully(2, `unknown mode: ${mode}`);
  process.exitCode = 2;
}
