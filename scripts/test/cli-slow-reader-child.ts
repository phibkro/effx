#!/usr/bin/env bun
/*
 * Real child of the CLI output regression (spec 0019 §4.2): it runs the `scripts/effx.ts` process root with
 * a piped stdout and reads that pipe only after a delay, the way a slow consumer does. The fixture is public
 * and non-secret. It prints one JSON line: the CLI's exit code, the byte count it delivered, and whether the
 * delivered stdout is exactly one complete JSON document.
 */

import process from "node:process";

const [effx, delay, ...args] = process.argv.slice(2);

const child = Bun.spawn([process.execPath, effx ?? "", ...args], {
  cwd: process.cwd(),
  stdin: "ignore",
  stdout: "pipe",
  stderr: "ignore",
  env: {},
});

await Bun.sleep(Number(delay));

const text = await new Response(child.stdout).text();

const code = await child.exited;

const complete = (() => {
  try {
    JSON.parse(text);

    return text.endsWith("\n") && text.indexOf("\n") === text.length - 1;
  } catch {
    return false;
  }
})();

const bytes = new TextEncoder().encode(text).byteLength;

process.stdout.write(`${JSON.stringify({ code, bytes, complete })}\n`);
