// EX-0033: Bun's evaluated CJS/ESM physical keys, not a logical resolution ledger.
import { createRequire } from "node:module";
import { CompilerFault } from "@effx/compiler";
import { Effect, Path } from "effect";

const runtimeRequire = createRequire(import.meta.url);

/** No exports inspection, module eviction, loader hook or application/config evaluation. */
export const loadedExecutableFiles = Effect.fnUntraced(function* () {
  const path = yield* Path.Path;

  const keys = yield* Effect.try({
    try: () => Object.keys(runtimeRequire.cache),
    catch: (cause) =>
      new CompilerFault({
        stage: "collect",
        message: "Cannot observe evaluated executable files",
        cause,
      }),
  });

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
