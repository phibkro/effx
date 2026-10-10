#!/usr/bin/env bun
/*
 * Real child of the CLI output regressions (spec 0019 §4.2 and every printing command). It runs the
 * `scripts/effx.ts` process root and reports what the command's stdout delivered: the exit code, the byte
 * count and SHA-256, and whether it is exactly one complete JSON document, as one JSON line. The fixture is
 * public and non-secret.
 *
 * argv: `<effx.ts> <sink> <stall> <delayMs> <plain|dev> <command...>`
 *
 * - sink `file` points the CLI's stdout at a regular file: no pipe, so nothing can refuse a write. It is the
 *   oracle of what the command prints.
 * - sink `pipe` reads a pipe slower than the CLI prints. Stall `before-first-read` reads nothing for the
 *   delay; `after-first-chunk` reads the first chunk and then stalls. The two interleave the CLI's writes
 *   with a full pipe differently, and a console that drops what a full pipe refuses loses bytes unevenly.
 * - mode `dev` keeps stdin open, because `effx dev` ends at stdin EOF: the child waits for the first cycle's
 *   summary line (at most 60 s), closes stdin and reads on to EOF.
 */

import { rmSync } from "node:fs";
import process from "node:process";

const [effx, sink, stall, delay, mode, ...args] = process.argv.slice(2);

const holdsStdin = mode === "dev";

const oracle = `${process.cwd()}/.cli-output-oracle`;

const summary = /\d+ error\(s\), \d+ warning\(s\), \d+ info\n/;

const argv = [process.execPath, effx ?? "", ...args];

const waitMs = 60_000;

const report = async (code: number, parts: Array<Uint8Array<ArrayBuffer>>) => {
  const hasher = new Bun.CryptoHasher("sha256");

  let bytes = 0;

  for (const part of parts) {
    hasher.update(part);
    bytes += part.byteLength;
  }

  const complete = await new Blob(parts).text().then((text) => {
    try {
      JSON.parse(text);

      return text.endsWith("\n") && text.indexOf("\n") === text.length - 1;
    } catch {
      return false;
    }
  });

  process.stdout.write(
    `${JSON.stringify({ code, bytes, sha256: hasher.digest("hex"), complete })}\n`,
  );
};

if (sink === "file") {
  const child = Bun.spawn(argv, {
    cwd: process.cwd(),
    stdin: holdsStdin ? "pipe" : "ignore",
    stdout: Bun.file(oracle),
    stderr: "ignore",
    env: {},
  });

  if (holdsStdin) {
    const until = Date.now() + waitMs;

    while (Date.now() < until && !summary.test((await Bun.file(oracle).text()).slice(-512)))
      await Bun.sleep(100);

    void child.stdin?.end();
  }

  const code = await child.exited;

  const bytes = new Uint8Array(await Bun.file(oracle).arrayBuffer());

  rmSync(oracle);

  await report(code, [bytes]);
} else {
  const child = Bun.spawn(argv, {
    cwd: process.cwd(),
    stdin: holdsStdin ? "pipe" : "ignore",
    stdout: "pipe",
    stderr: "ignore",
    env: {},
  });

  const chunks: Array<Uint8Array<ArrayBuffer>> = [];

  const decoder = new TextDecoder();

  let closed = !holdsStdin;

  let tail = "";

  const closeStdin = () => {
    if (closed) return;

    closed = true;
    void child.stdin?.end();
  };

  const deadline = setTimeout(closeStdin, waitMs);

  const take = (chunk: Uint8Array<ArrayBuffer>) => {
    chunks.push(chunk);
    tail = (tail + decoder.decode(chunk, { stream: true })).slice(-512);

    if (summary.test(tail)) closeStdin();
  };

  const reader = child.stdout.getReader();

  if (stall === "after-first-chunk") {
    const first = await reader.read();

    if (!first.done) take(first.value);
  }

  await Bun.sleep(Number(delay));

  for (let next = await reader.read(); !next.done; next = await reader.read()) take(next.value);

  clearTimeout(deadline);

  await report(await child.exited, chunks);
}
