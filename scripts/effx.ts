#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { LspPlatform, main, Services, TransportError } from "@effx/cli";
import { Cause, Effect, Layer, Logger, Path, Runtime } from "effect";
import { executableInventoryLayer } from "./executable-cache.ts";
import { acquireLinuxLspIO } from "./lsp-linux.ts";
import { liftCheckExecutionLayer, liftToolchainLayer } from "./lift-execution.ts";
import { alloyExecutionLayer } from "./alloy-execution.ts";

// EX-0033 / EX-0035 / EX-0034 / EX-0038: native capabilities are selected at the process root.
// Acquisition stays suspended until a command asks; each child belongs to its calling scope.
const Platform = Layer.mergeAll(
  executableInventoryLayer,
  liftCheckExecutionLayer,
  liftToolchainLayer,
  alloyExecutionLayer,
  Layer.effect(
    LspPlatform,
    Effect.gen(function* () {
      const path = yield* Path.Path;

      // A malformed URL for this package's own fixed export is an installation defect.
      const manifest = yield* path
        .fromFileUrl(
          new URL("./native/lsp-readiness.json", import.meta.resolve("@effx/cli/package.json")),
        )
        .pipe(Effect.orDie);

      return LspPlatform.of({
        acquireIO: acquireLinuxLspIO(manifest).pipe(
          Effect.mapError((cause) => new TransportError({ reason: "IO", cause })),
        ),
      });
    }),
  ),
);

const Application = Layer.mergeAll(Services, Platform).pipe(Layer.provideMerge(BunServices.layer));

// stdout is the LSP protocol channel. runMain reports failures from outside this effect, where
// the stderr logger reference is absent, so the root reports once inside it (same rule as
// runMain: no interrupt-only causes, no errors marked unreported) and disables the outer report.
const reportToStderr = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.tapCause(effect, (cause: Cause.Cause<E>) =>
    Cause.hasInterruptsOnly(cause) || !Runtime.getErrorReported(Cause.squash(cause))
      ? Effect.void
      : Effect.logError(cause),
  );

BunRuntime.runMain(
  main.pipe(
    Effect.provide(Application),
    reportToStderr,
    Effect.provideService(Logger.LogToStderr, true),
  ),
  { disableErrorReporting: true },
);
