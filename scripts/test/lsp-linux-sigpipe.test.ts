/** @effect-diagnostics unstableApiUsage:off -- EX-0023: scoped real-host signal fixture custody. */
import { assert, describe, it } from "@effect/vitest";
import { BunServices } from "@effect/platform-bun";
import { Effect, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as process from "node:process";
import { fileURLToPath } from "node:url";
import { SigpipeReceipt } from "./sigpipe.contract.ts";

const fixture = fileURLToPath(new URL("./sigpipe.fixture.ts", import.meta.url));

// Real default-disposition writes kill a faulty fixture, not the runner. A normal
// exit and post-call receipt prove survival; timeout bounds failure, never success.
// Defended bugs: missing block/consume, consuming a caller's pending SIGPIPE,
// restoring an empty/different-thread mask, or omitting MSG_NOSIGNAL on send.
describe("production Linux SIGPIPE semantics", () => {
  it.live("consumes only newly generated EPIPE signals and restores the calling thread", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

      const receipt = yield* Effect.scoped(
        Effect.gen(function* () {
          const child = yield* spawner.spawn(
            ChildProcess.make(process.execPath, [fixture], {
              stdin: "ignore",
              stdout: "pipe",
              stderr: "ignore",
              forceKillAfter: "1 second",
            }),
          );

          const [text, code] = yield* Effect.all(
            [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
            { concurrency: 2 },
          );

          assert.strictEqual(Number(code), 0, "real SIGPIPE fixture must survive and release");

          return yield* Schema.decodeEffect(Schema.fromJsonString(SigpipeReceipt), {
            onExcessProperty: "error",
          })(text.trim());
        }),
      ).pipe(Effect.timeout("15 seconds"));

      assert.strictEqual(receipt.laws.length, 6);

      for (let index = 0; index < receipt.laws.length; index++) {
        const law = receipt.laws[index];
        assert.isDefined(law);

        if (law === undefined) continue;
        const preset = index % 3;
        assert.strictEqual(law.form, index < 3 ? "pipe" : "socket");
        assert.strictEqual(law.blockedBefore, preset === 0 ? 0 : 1);
        assert.strictEqual(law.pendingBefore, preset === 2 ? 1 : 0);
        assert.strictEqual(
          law.result,
          -law.epipe,
          "actual kernel broken endpoint must return EPIPE",
        );
        assert.strictEqual(law.blockedAfter, law.blockedBefore);
        assert.strictEqual(law.pendingAfter, law.pendingBefore);
        assert.isTrue(law.maskRestored, "every public signal membership must be unchanged");
        assert.strictEqual(law.dispositionBefore, 0, "Bun's ignored SIGPIPE is not a test preset");
        assert.strictEqual(law.dispositionAfter, 0);
      }

      assert.isTrue(receipt.scopeRestored);
      assert.strictEqual(receipt.descriptorsClosed, 6);
      assert.strictEqual(receipt.callbacksClosed, 1);
      assert.strictEqual(receipt.librariesClosed, 2);
      assert.isTrue(receipt.processAlive);
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
