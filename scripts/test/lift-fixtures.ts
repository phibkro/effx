import { assert } from "@effect/vitest";
import { Effect, FileSystem, Option, Path, Predicate, Schema } from "effect";
import type { LiftRunParams } from "@effx/cli";
import { LiftCheckExecution, type CheckChildResult } from "@effx/cli/lift-boundaries";
import type { AnnotationArg } from "@effx/compiler";
import process from "node:process";
import { testDirectory } from "../../tools/testing/projects.ts";
import { api, projection, support } from "./lift-sources.ts";

/*
 * Authored real projects for the native lift-check suites (EX-0034 scope): a small stable-Effect
 * `HttpApiGroup` with an application root, written into a scoped test directory. No stub stands in for any
 * stage: the frontend, compiler, generator, witness child and binding typecheck all run on these bytes.
 */

const repo = new URL("../../", import.meta.url).pathname;

export { api, projection, support };

export interface Fixture {
  readonly directory: string;
  readonly tsconfigPath: string;
}

/** One authored real project, owned by the test scope; `files` are project-relative paths. */
export const writeProject = Effect.fnUntraced(function* (
  files: Readonly<Record<string, string>>,
  include: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* testDirectory("lift-check-native-");

  yield* fs.makeDirectory(path.join(directory, "src"));

  for (const [name, text] of Object.entries(files))
    yield* fs.writeFileString(path.join(directory, name), text);

  yield* fs.writeFileString(
    path.join(directory, "tsconfig.json"),
    `{ "extends": "${repo}tsconfig.json", "include": ${JSON.stringify(include)}, "exclude": [], "effx": { "projectRoot": "." } }`,
  );

  return { directory, tsconfigPath: path.join(directory, "tsconfig.json") } satisfies Fixture;
});

export const miniFiles = { "src/support.ts": support, "src/api.ts": api };

export const miniProject = writeProject(miniFiles, ["src/api.ts"]);

/** A plain annotation option bag: pure data the real printer, frontend and compiler process. */
export type Options = { readonly [key: string]: AnnotationArg };

export const isOptions = (arg: AnnotationArg | undefined): arg is Options =>
  Predicate.isObject(arg) && !Predicate.hasProperty(arg, "_tag");

/** The `metadata` bag of an `Http.Contract` option bag, or an empty one. */
export const metadataOf = (options: Options): Options => {
  const metadata = options["metadata"];

  return isOptions(metadata) ? metadata : {};
};

/**
 * The same lift with every option bag of one annotation rewritten before the REAL printer, frontend,
 * compiler, generator and witness process it. Dense is dropped because the verbose bytes are mutated.
 */
export const withAnnotation = (
  run: LiftRunParams,
  name: string,
  rewrite: (options: Options) => Options,
): LiftRunParams => ({
  ...run,
  form: "verbose",
  dense: Option.none(),
  result: {
    ...run.result,
    collected: {
      ...run.result.collected,
      declarations: run.result.collected.declarations.map((declaration) => ({
        ...declaration,
        annotations: declaration.annotations.map((annotation) => {
          const options = annotation.args[0];

          return annotation.name === name && isOptions(options)
            ? { ...annotation, args: [rewrite(options), ...annotation.args.slice(1)] }
            : annotation;
        }),
      })),
    },
  },
});

/** The same lift without any `name` annotation: the declarations stay, the annotation is gone. */
export const withoutAnnotation = (run: LiftRunParams, name: string): LiftRunParams => ({
  ...run,
  form: "verbose",
  dense: Option.none(),
  result: {
    ...run.result,
    collected: {
      ...run.result.collected,
      declarations: run.result.collected.declarations.map((declaration) => ({
        ...declaration,
        annotations: declaration.annotations.filter((annotation) => annotation.name !== name),
      })),
    },
  },
});

export interface CliRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const outcome = (receipt: CheckChildResult): CliRun => {
  assert.strictEqual(
    receipt.exit._tag,
    "Exit",
    `the CLI was stopped: ${JSON.stringify(receipt.exit)}`,
  );
  assert.isFalse(receipt.stdoutTruncated);
  assert.isFalse(receipt.stderrTruncated);

  return {
    code: receipt.exit._tag === "Exit" ? receipt.exit.code : -1,
    stdout: receipt.stdout,
    stderr: receipt.stderr,
  };
};

const effx = new URL("../effx.ts", import.meta.url).pathname;

/** The real `scripts/effx.ts` process root in a fresh native child: explicit cwd and arguments, empty env. */
export const runCli = (cwd: string, args: ReadonlyArray<string>) =>
  Effect.flatMap(LiftCheckExecution, (execution) =>
    execution.runChild({
      binary: process.execPath,
      cwd,
      args: [effx, ...args],
      captureBytes: 32 * 1024 * 1024,
      forcedStopMs: 540_000,
    }),
  ).pipe(Effect.map(outcome));

const readerChild = new URL("./cli-slow-reader-child.ts", import.meta.url).pathname;

/** What a reader received: the CLI's exit code, the stdout byte count and digest, and JSON completeness. */
export const Delivery = Schema.Struct({
  code: Schema.Int,
  bytes: Schema.Int,
  sha256: Schema.String,
  complete: Schema.Boolean,
});

export type Delivery = typeof Delivery.Type;

const decodeDelivery = Schema.decodeUnknownEffect(Schema.fromJsonString(Delivery));

/**
 * How the real child reads the CLI's stdout. Sink `file` points stdout at a regular file, which no write can
 * refuse: it is the oracle of what the command prints. Sink `pipe` reads a pipe slower than the CLI prints:
 * stall `before-first-read` reads nothing for `delayMs`, `after-first-chunk` reads the first chunk and then
 * stalls for `delayMs`. `dev` keeps stdin open until the first cycle has been read, because `effx dev` ends
 * at stdin EOF.
 */
export type Reader =
  | {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly sink: "file";
      readonly dev?: boolean;
    }
  | {
      readonly cwd: string;
      readonly args: ReadonlyArray<string>;
      readonly sink: "pipe";
      readonly stall: "before-first-read" | "after-first-chunk";
      readonly delayMs: number;
      readonly dev?: boolean;
    };

/**
 * The same process root behind a real Bun child that reads its stdout as the request says. The child's one
 * JSON line says what arrived; the child itself must have exited cleanly.
 */
export const runReader = Effect.fnUntraced(function* (request: Reader) {
  const stall = request.sink === "pipe" ? request.stall : "before-first-read";
  const delayMs = request.sink === "pipe" ? request.delayMs : 0;

  const receipt = yield* Effect.flatMap(LiftCheckExecution, (execution) =>
    execution.runChild({
      binary: process.execPath,
      cwd: request.cwd,
      args: [
        readerChild,
        effx,
        request.sink,
        stall,
        String(delayMs),
        request.dev === true ? "dev" : "plain",
        ...request.args,
      ],
      captureBytes: 64 * 1024,
      forcedStopMs: 540_000,
    }),
  ).pipe(Effect.map(outcome));

  assert.strictEqual(receipt.code, 0, `${receipt.stdout}\n${receipt.stderr}`);

  return yield* decodeDelivery(receipt.stdout.trimEnd());
});
