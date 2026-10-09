// EX-0035: test-only Node-created real fd1 regular file outside packages.
// Effect ChildProcess cannot pass an already-owned numeric standard descriptor.
import { spawn } from "node:child_process";
import { closeSync, fstatSync, openSync, readFileSync, writeSync } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Effect, Schema } from "effect";

export const regularStdoutSentinel = "unchanged-synthetic-protocol-target\n";

const Identity = Schema.Struct({
  device: Schema.String.check(Schema.isPattern(/^\d+$/)),
  inode: Schema.String.check(Schema.isPattern(/^\d+$/)),
});

/** Observable packed-consumer evidence, not a new CLI/native receipt protocol. */
export const PackedStdoutReceipt = Schema.Struct({
  outputCodeReason: Schema.Struct({
    code: Schema.Int.check(Schema.isGreaterThan(0)),
    reason: Schema.Literal("nonzero-normal-exit"),
  }),
  stage: Schema.Literal("packed-regular-stdout"),
  startupClassification: Schema.Literal("unobserved"),
  fd1Before: Identity,
  fd1After: Identity,
  fileUnchanged: Schema.Boolean,
  stdinHeldOpen: Schema.Literal(true),
  stdinBytesSent: Schema.Literal(0),
  childJoined: Schema.Literal(true),
  stderrBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

class PackedStdoutFault extends Schema.TaggedError<PackedStdoutFault>()("PackedStdoutFault", {
  reason: Schema.Literals(["Launch", "File", "Spawn", "Exit", "StderrBound"]),
}) {}

const decodeLaunch = Schema.decodeUnknownEffect(
  Schema.Struct({
    cli: Schema.NonEmptyString,
    cwd: Schema.NonEmptyString,
    file: Schema.NonEmptyString,
  }),
);

const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(PackedStdoutReceipt), {
  onExcessProperty: "error",
});

const identity = (descriptor: number) => {
  const stat = fstatSync(descriptor, { bigint: true });

  if (!stat.isFile()) throw new PackedStdoutFault({ reason: "File" });

  return { device: String(stat.dev), inode: String(stat.ino) };
};

// The scope owns the signal registrations, descriptor and child. A normal close
// joins the actual child/stdio, not just exitCode. Cancellation kills and joins
// before closing the parent's descriptor or removing the consumer directory.
const main = Effect.gen(function* () {
  const launch = yield* decodeLaunch({
    cli: process.argv[2],
    cwd: process.argv[3],
    file: process.argv[4],
  }).pipe(Effect.mapError(() => new PackedStdoutFault({ reason: "Launch" })));

  const output = yield* Effect.acquireRelease(
    Effect.try({
      try: () => openSync(launch.file, "r+"),
      catch: () => new PackedStdoutFault({ reason: "File" }),
    }),
    (descriptor) => Effect.sync(() => closeSync(descriptor)),
  );

  const fd1Before = yield* Effect.try({
    try: () => identity(output),
    catch: () => new PackedStdoutFault({ reason: "File" }),
  });

  let closed = false;
  let code: number | null = null;
  let signalled = false;
  let spawnFailed = false;
  let stderrBytes = 0;

  const child = yield* Effect.acquireRelease(
    Effect.try({
      try: () => {
        const owned = spawn(
          launch.cli,
          ["lsp", "--project", "tsconfig.json", "--config", "effx.config.ts"],
          {
            cwd: launch.cwd,
            stdio: ["pipe", output, "pipe"],
          },
        );

        owned.once("error", () => {
          spawnFailed = true;
        });
        owned.once("close", (exitCode, signal) => {
          closed = true;
          code = exitCode;
          signalled = signal !== null;
        });
        // Discard at acquisition: no stderr body, Cause, config or environment
        // enters a receipt. Bound the byte count, not a private error format.
        owned.stderr?.on("data", (chunk: Uint8Array) => {
          stderrBytes = Math.min(8193, stderrBytes + chunk.byteLength);
        });

        return owned;
      },
      catch: () => new PackedStdoutFault({ reason: "Spawn" }),
    }),
    (owned) =>
      Effect.callback<void>((resume) => {
        if (closed) {
          resume(Effect.void);

          return;
        }

        const joined = () => resume(Effect.void);
        owned.once("close", joined);
        owned.kill("SIGKILL");

        return Effect.sync(() => {
          owned.off("close", joined);
        });
      }),
  );

  // Send neither input nor EOF. A session that merely waits for initialize or
  // refuses only after EOF fails this law instead of receiving a fake stimulus.
  yield* Effect.callback<void>((resume) => {
    if (closed) {
      resume(Effect.void);

      return;
    }

    const joined = () => resume(Effect.void);
    child.once("close", joined);

    return Effect.sync(() => {
      child.off("close", joined);
    });
  }).pipe(Effect.timeout("10 seconds"));

  if (spawnFailed) return yield* new PackedStdoutFault({ reason: "Spawn" });

  if (signalled || code === null || code <= 0)
    return yield* new PackedStdoutFault({ reason: "Exit" });

  if (stderrBytes > 8192) return yield* new PackedStdoutFault({ reason: "StderrBound" });

  const fd1After = yield* Effect.try({
    try: () => identity(output),
    catch: () => new PackedStdoutFault({ reason: "File" }),
  });

  const fileUnchanged = yield* Effect.try({
    try: () =>
      fstatSync(output).size === regularStdoutSentinel.length &&
      readFileSync(launch.file, "utf8") === regularStdoutSentinel,
    catch: () => new PackedStdoutFault({ reason: "File" }),
  });

  return yield* encodeReceipt({
    outputCodeReason: { code, reason: "nonzero-normal-exit" },
    stage: "packed-regular-stdout",
    startupClassification: "unobserved",
    fd1Before,
    fd1After,
    fileUnchanged,
    stdinHeldOpen: true,
    stdinBytesSent: 0,
    childJoined: true,
    stderrBytes,
  });
});

const hostInterrupted = Effect.callback<never>((resume) => {
  const stop = () => resume(Effect.interrupt);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  return Effect.sync(() => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  });
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // One real Node process entry. No successful receipt exists until Scope close.
  Effect.runPromise(
    Effect.gen(function* () {
      const text = yield* main.pipe(Effect.raceFirst(hostInterrupted), Effect.scoped);
      yield* Effect.sync(() => {
        writeSync(1, text + "\n");
      });
    }),
  ).catch(() => {
    process.exitCode = 1;
  });
}
