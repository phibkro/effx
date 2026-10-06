import { CompilerFault } from "@effx/compiler";
import { Context, Effect, Path } from "effect";

/**
 * Read-only evaluated executable physical-key inventory (EX-0033).
 * The process root selects the implementation; there is no default inventory.
 * Each execution observes current keys without evaluating or inspecting exports.
 * Caller-declared complete logical coverage remains authoritative: these keys
 * are supplemental data, not a resolution ledger or a sandbox. The capability
 * owns no modules, hooks, fibers or durable state and performs no retries.
 */
export class ExecutableInventory extends Context.Service<
  ExecutableInventory,
  { readonly keys: Effect.Effect<ReadonlyArray<string>, CompilerFault> }
>()("@effx/cli/config-runtime/ExecutableInventory") {}

/** No exports inspection, module eviction, loader hook or application/config evaluation. */
export const loadedExecutableFiles = Effect.fnUntraced(function* () {
  const path = yield* Path.Path;

  const inventory = yield* ExecutableInventory;
  const keys = yield* inventory.keys;

  const files = new Set<string>();

  for (const key of keys) {
    if (key.startsWith("file:")) {
      const url = yield* Effect.try({
        try: () => new URL(key),
        catch: (cause) =>
          new CompilerFault({
            stage: "collect",
            message: "Invalid evaluated executable file URL",
            cause,
          }),
      });

      const file = yield* path.fromFileUrl(url).pipe(
        Effect.mapError(
          (cause) =>
            new CompilerFault({
              stage: "collect",
              message: "Cannot resolve evaluated executable file URL",
              cause,
            }),
        ),
      );

      files.add(path.resolve(file));
    } else if (path.isAbsolute(key)) {
      files.add(path.resolve(key));
    }
  }

  return Array.from(files);
});
