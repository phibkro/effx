import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path } from "effect";
import { beforeAll } from "vitest";

export const requireStableV4FixtureDependencies = (fixtureRoot: string) => {
  beforeAll(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const effectPackage = path.join(fixtureRoot, "node_modules/effect/package.json");

        return yield* fs.exists(effectPackage);
      }).pipe(Effect.provide(BunServices.layer)),
    ).then((exists) => {
      if (!exists) {
        throw new Error(
          "stable Effect 4 fixture dependencies are missing; run `bun install --frozen-lockfile --cwd packages/frontend-ts/test/fixtures/stable-v4` before running the tests.",
        );
      }
    }),
  );
};
