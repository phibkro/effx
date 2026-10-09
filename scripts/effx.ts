#!/usr/bin/env bun
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { LspPlatform, main, Services, TransportError } from "@effx/cli";
import { Effect, Layer, Path } from "effect";
import { executableInventoryLayer } from "./executable-cache.ts";
import { acquireLinuxLspIO } from "./lsp-linux.ts";

// EX-0033 / EX-0035: only this process root selects native inventory and descriptor IO.
// Acquisition stays suspended until a command asks for it; the LSP session Scope owns IO.
const Platform = Layer.mergeAll(
  executableInventoryLayer,
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

BunRuntime.runMain(main.pipe(Effect.provide(Application)));
