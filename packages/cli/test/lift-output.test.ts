import { assert, it } from "@effect/vitest";
import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Path } from "effect";
import { refuseWriteTarget, writeSuggestion } from "../src/lift.ts";

it.live(
  "preserves existing bytes and exclusively creates a new suggestion file",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "lift-output-" });
      const existing = path.join(directory, "existing.effx.ts");
      const original = 'export const Original = "kept";\r\n';

      yield* fs.writeFileString(existing, original);

      const refusal = yield* Effect.flip(refuseWriteTarget(existing));

      assert.strictEqual(refusal._tag, "LiftUsageError");
      assert.strictEqual(yield* fs.readFileString(existing), original);

      const created = path.join(directory, "new.effx.ts");
      const suggestion = 'export const Lifted = "exact bytes";\r\n';
      const resolved = yield* refuseWriteTarget(created);

      assert.strictEqual(resolved, path.resolve(created));
      yield* writeSuggestion(resolved, suggestion);
      assert.strictEqual(yield* fs.readFileString(created), suggestion);

      const racedRefusal = yield* Effect.flip(writeSuggestion(resolved, "overwrite forbidden"));

      assert.strictEqual(racedRefusal._tag, "LiftUsageError");
      assert.strictEqual(yield* fs.readFileString(created), suggestion);
    }).pipe(Effect.provide(BunServices.layer)),
  10_000,
);
