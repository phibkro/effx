import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = new URL("../../../packages/cli/src/", import.meta.url).pathname;

/** A call that prints through the global console reference. */
const consolePrint = /\bConsole\.(?:log|error|info|warn|debug|table|dir|trace)\s*\(/u;

const sources = readdirSync(source, { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".ts"))
  .toSorted();

describe("CLI output ownership", () => {
  it("finds the CLI sources it guards", () => {
    expect(sources).toContain("output.ts");
    expect(sources).toContain("commands.ts");
    expect(sources.length).toBeGreaterThan(20);
  });

  // The console does not retry on a non-blocking descriptor: a report larger than the pipe buffer reached a
  // slow reader as a prefix (STATE.md, docs/research/0019-implementation-design.md "Output delivery"). Every
  // command prints through `printLines` in output.ts, which writes through the Stdio service. `main.ts` may
  // still provide a Console service to effect/cli's own help output; it never calls one.
  it("prints only through the Stdio sink in packages/cli/src/output.ts", () => {
    const offenders = sources.filter((file) =>
      consolePrint.test(readFileSync(join(source, file), "utf8")),
    );

    expect(offenders).toEqual([]);
  });
});
