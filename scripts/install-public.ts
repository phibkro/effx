import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Effect, Path, Schema, Stdio } from "effect";
import { acquireCommand } from "../packages/cli/test/packed-watch-peer.ts";

class PublicInstallFailure extends Schema.TaggedError<PublicInstallFailure>()(
  "PublicInstallFailure",
  { exitCode: Schema.Int },
) {
  override get message() {
    return `public install exited ${this.exitCode}`;
  }
}

/**
 * EX-0023: one calling Scope owns the child. Construction performs no IO. The only resolver
 * custody boundary is `scripts/install-public.sh`, which replaces the child environment; this
 * adapter supplies PATH alone, closes stdin and never reads, returns or logs resolver output.
 * A non-zero exit is the typed failure; interruption stays interruption.
 */
export const publicInstall = Effect.fnUntraced(function* (
  cwd: string,
  frozen: boolean,
  ignoreScripts: boolean,
) {
  const path = yield* Path.Path;
  const searchPath = yield* Config.String("PATH");
  const script = path.join(import.meta.dirname, "install-public.sh");

  const child = yield* acquireCommand(
    path.dirname(script),
    "bash",
    [
      script,
      cwd,
      ...(frozen ? ["--frozen-lockfile"] : []),
      ...(ignoreScripts ? ["--ignore-scripts"] : []),
    ],
    { PATH: searchPath },
  );

  yield* child.eof;
  const installed = yield* child.finish;

  if (installed.code !== 0) return yield* new PublicInstallFailure({ exitCode: installed.code });
});

if (import.meta.main) {
  BunRuntime.runMain(
    Effect.gen(function* () {
      const stdio = yield* Stdio.Stdio;
      const path = yield* Path.Path;
      const [cwd, ...flags] = yield* stdio.args;

      if (cwd === undefined) return yield* new PublicInstallFailure({ exitCode: 2 });

      yield* publicInstall(
        path.resolve(cwd),
        flags.includes("--frozen-lockfile"),
        flags.includes("--ignore-scripts"),
      );
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  );
}
