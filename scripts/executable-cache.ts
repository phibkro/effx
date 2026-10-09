// EX-0033: Bun's public createRequire.cache is supplemental physical inventory only.
import { createRequire } from "node:module";
import { CompilerFault } from "@effx/compiler";
import { ExecutableInventory } from "@effx/cli";
import { Effect, Layer } from "effect";

/**
 * Selected once by the outside-packages process root. Acquisition is lazy and
 * observes no cache values. Each keys execution takes a fresh, read-only snapshot.
 * No eviction, exports inspection, resolver hooks, evaluation or fallback occurs.
 * This borrows the process-owned cache, acquiring no resource to release; synchronous
 * enumeration finishes atomically and leaves no background work on interruption.
 * Retire EX-0033 when a maintained native evaluated-module inventory is available.
 */
export const executableInventoryLayer = Layer.effect(
  ExecutableInventory,
  Effect.gen(function* () {
    const runtimeRequire = yield* Effect.try({
      try: () => createRequire(import.meta.url),
      catch: () =>
        new CompilerFault({
          stage: "collect",
          message: "Cannot observe evaluated executable files",
        }),
    });

    const keys = Effect.try({
      try: () => Object.keys(runtimeRequire.cache),
      catch: () =>
        new CompilerFault({
          stage: "collect",
          message: "Cannot observe evaluated executable files",
        }),
    });

    return ExecutableInventory.of({ keys });
  }),
);
