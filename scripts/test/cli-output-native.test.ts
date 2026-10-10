import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { liftCheckExecutionLayer } from "../lift-execution.ts";
import { explanationConfig, manyOperations } from "./cli-output-sources.ts";
import { runReader, writeProject, type Delivery } from "./lift-fixtures.ts";
import { manyEndpointsApi, support } from "./lift-sources.ts";

/*
 * Every printing command delivers its whole stdout to a reader that is slower than the CLI. The real
 * `scripts/effx.ts` root runs in a real Bun child four times per case. Once with stdout pointed at a regular
 * file, which no write can refuse: that is what the command prints. Then three times into a pipe that a child
 * reads slowly (`cli-slow-reader-child.ts`): the reader reads nothing for 1.5 s, or reads the first chunk and
 * then stalls 1.5 s, or the first again. Each slow run must receive the same exit code and the same bytes.
 * The output must be larger than any pipe or socket buffer holds. Before the commands printed through the
 * process root's Stdio sink, the console dropped what a full non-blocking descriptor refused
 * (`write(1, ...) = -1 EAGAIN`): a single large write was cut deterministically, and many small writes lost
 * bytes on some runs and not on others, which is why a family is read slowly three times.
 */

const services = liftCheckExecutionLayer.pipe(Layer.provideMerge(BunServices.layer));

/** More than the 256 KiB a socket holds and the 214 KiB the pipe held before the console gave up. */
const larger = 300_000;

const stall = 1_500;

/** About 380 KB from `check`, more from `graph`: 2 warnings of about 590 bytes each per operation. */
const project = { count: 320, nameLength: 500 };

/** The part of a delivery that must be identical between the oracle and a slow reader. */
const received = ({ code, bytes, sha256 }: Delivery) => ({ code, bytes, sha256 });

interface Family {
  readonly name: string;
  readonly args: ReadonlyArray<string>;
  /** The exit code of the command on its project. */
  readonly exit: number;
  readonly files: Readonly<Record<string, string>>;
  /** `effx dev` ends at stdin EOF: the readers close stdin once the first cycle's summary has arrived. */
  readonly dev?: boolean;
  /** The files `tsconfig.json` includes; the operations project by default. */
  readonly include?: ReadonlyArray<string>;
  /** The command prints exactly one JSON document. */
  readonly json?: boolean;
}

const operations = manyOperations(project);

const families: ReadonlyArray<Family> = [
  // The pipeline report (`compileAndReport`) is what check, build, cedar and surface check print first.
  {
    name: "check",
    args: ["check"],
    exit: 1,
    files: manyOperations({ ...project, duplicate: true }),
  },
  { name: "build", args: ["build"], exit: 0, files: operations },
  { name: "cedar", args: ["cedar"], exit: 0, files: operations },
  {
    name: "surface check",
    args: ["surface", "check", "--against", "src/worker.ts"],
    exit: 1,
    files: operations,
  },
  // One document each: the whole graph, one operation whose exposure line is longer than a buffer, and
  // one explanation of a diagnostic whose text is longer than a buffer.
  { name: "graph", args: ["graph"], exit: 0, files: operations },
  {
    name: "inspect",
    args: ["inspect", "Big.long"],
    exit: 0,
    files: manyOperations({ count: 10, nameLength: 10, longPath: 350_000 }),
  },
  {
    name: "explain",
    args: ["explain", "EFFX[@fixture/big]/0001", "--config", "selected.ts"],
    exit: 0,
    files: { "selected.ts": explanationConfig("EFFX[@fixture/big]/0001", 350_000) },
  },
  // The long-running command: its first cycle is the banner and the pipeline report.
  { name: "dev", args: ["dev"], exit: 0, files: operations, dev: true },
  // The report of `effx lift --json` is one JSON line of about 300 KB; the computed path is an error.
  {
    name: "lift --json",
    args: ["lift", "--group", "big", "--module", "src/big.effx.ts", "--json"],
    exit: 1,
    files: { "src/support.ts": support, "src/api.ts": manyEndpointsApi(100) },
    include: ["src/api.ts"],
    json: true,
  },
];

describe("every printing command delivers its whole output to a slow reader", () => {
  it.live.each(families)(
    "$name",
    (family) =>
      Effect.gen(function* () {
        const fixture = yield* writeProject(family.files, family.include ?? ["src/ops.ts"]);
        const dev = family.dev === true;

        const oracle = yield* runReader({
          cwd: fixture.directory,
          args: family.args,
          sink: "file",
          dev,
        });

        assert.strictEqual(oracle.code, family.exit, JSON.stringify(oracle));
        assert.isAbove(oracle.bytes, larger, JSON.stringify(oracle));

        // A command that prints one JSON document prints exactly one, complete, to the file.
        if (family.json === true) assert.isTrue(oracle.complete, JSON.stringify(oracle));

        for (const when of [
          "before-first-read",
          "after-first-chunk",
          "before-first-read",
        ] as const) {
          const slow = yield* runReader({
            cwd: fixture.directory,
            args: family.args,
            sink: "pipe",
            stall: when,
            delayMs: stall,
            dev,
          });

          assert.deepStrictEqual(received(slow), received(oracle), `${family.name} read ${when}`);
        }
      }).pipe(Effect.scoped, Effect.provide(services)),
    900_000,
  );
});
