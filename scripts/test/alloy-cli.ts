/** @effect-diagnostics unstableApiUsage:off -- EX-0037: scoped real-process acceptance for Alloy models. */
import { AlloyExecutionError } from "@effx/cli";
import { Duration, Effect, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import process from "node:process";

const cli = new URL("../effx.ts", import.meta.url).pathname;

const runOwned = Effect.fnUntraced(function* (
  binary: string,
  cwd: string,
  args: ReadonlyArray<string>,
  env: Record<string, string>,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(binary, args, {
          cwd,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
          env,
          extendEnv: false,
          // The CLI must finish its own one-second Alloy escalation before this parent escalates.
          forceKillAfter: Duration.seconds(5),
        }),
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [
          child.stdout.pipe(Stream.decodeText(), Stream.mkString),
          child.stderr.pipe(Stream.decodeText(), Stream.mkString),
          child.exitCode,
        ],
        { concurrency: 3 },
      );

      return { code, stdout, stderr };
    }),
  );
});

/** Test Scope owns the real CLI child and its descendant Alloy process. */
export const alloyCli = Effect.fnUntraced(function* (
  cwd: string,
  args: ReadonlyArray<string>,
  binaryDirectory?: string,
) {
  const path = yield* Path.Path;
  const binary = yield* Effect.sync(() => Bun.which("alloy6"));

  if (binaryDirectory === undefined && binary === null) {
    return yield* new AlloyExecutionError({
      reason: "Unavailable",
      detail: "test requires Alloy 6.2.0 on PATH",
    });
  }

  const executablePath = binaryDirectory ?? path.dirname(binary!);

  return yield* runOwned(process.execPath, cwd, [cli, ...args], { PATH: executablePath });
});

/** Execute a generated witness with the same real Alloy binary. */
export const alloyTool = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>) {
  const binary = yield* testToolPath("alloy6");

  return yield* runOwned(binary, cwd, args, {});
});

/** Emergency test cleanup only for the PID reported by the owned fake child. */
export const killOwnedGroup = Effect.fnUntraced(function* (pid: number) {
  yield* Effect.try({
    try: () => process.kill(-pid, "SIGKILL"),
    catch: (cause) =>
      new AlloyExecutionError({
        reason: "Execution",
        detail: "cannot stop test child group",
        cause,
      }),
  });
});

/** Resolve test-fixture utilities outside portable packages. */
export const testToolPath = Effect.fnUntraced(function* (name: string) {
  const binary = yield* Effect.sync(() => Bun.which(name));

  if (binary === null)
    return yield* new AlloyExecutionError({
      reason: "Unavailable",
      detail: `test utility ${name} was not found`,
    });

  return binary;
});
