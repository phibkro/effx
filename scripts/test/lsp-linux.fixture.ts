import { BunRuntime } from "@effect/platform-bun";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { writeSync, readFileSync, fstatSync } from "node:fs";
import * as process from "node:process";
import { acquireLinuxLspIO } from "../lsp-linux.ts";
import { LinuxFixtureReceipt } from "./lsp-linux.contract.ts";
import assert from "node:assert/strict";

const Mode = Schema.Literals([
  "read",
  "closed",
  "ownership",
  "probe",
  "callbacks",
  "blocked-write",
  "broken-write",
  "signal",
  "lazy",
]);

const decodeLaunch = Schema.decodeUnknownEffect(
  Schema.Struct({ mode: Mode, manifest: Schema.NonEmptyString }),
);

const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(LinuxFixtureReceipt));

const receipt = Effect.fnUntraced(function* (value: typeof LinuxFixtureReceipt.Type) {
  const text = yield* encodeReceipt(value);
  yield* Effect.sync(() => {
    writeSync(3, text + "\n");
  });
});

const program = Effect.gen(function* () {
  const launch = yield* decodeLaunch({ mode: process.argv[2], manifest: process.argv[3] });

  if (launch.mode === "lazy") {
    const discarded = acquireLinuxLspIO("/does-not-exist/lsp-readiness.json");
    void discarded;
    yield* receipt({ event: "result", checks: ["construction-is-lazy"] });

    return;
  }

  yield* Effect.scoped(
    Effect.gen(function* () {
      const io = yield* acquireLinuxLspIO(launch.manifest);
      yield* receipt({ event: "acquired" });
      const checks: Array<NonNullable<typeof LinuxFixtureReceipt.Type.checks>[number]> = [];

      if (launch.mode === "signal") return yield* Effect.never;

      if (launch.mode === "ownership") {
        const error = yield* acquireLinuxLspIO(launch.manifest).pipe(Effect.flip);

        if (error.reason !== "Ownership")
          return yield* Effect.die("exclusive owner was not refused");
        checks.push("exclusive-owner");
      } else if (launch.mode === "closed") {
        yield* io.close;
        yield* io.close;
        yield* Effect.sync(() => {
          assert.throws(() => fstatSync(0), { code: "EBADF" });
          assert.equal(
            readFileSync("/proc/self/maps", "utf8").includes("/lsp-readiness.so"),
            false,
          );
        });
        checks.push("fd0-closed", "library-unloaded");

        const readError = yield* io.read(65536).pipe(Effect.flip);
        const writeError = yield* io.write("forbidden").pipe(Effect.flip);

        if (readError.reason !== "Closed" || writeError.reason !== "Closed")
          return yield* Effect.die("operation admitted after close");

        yield* io.probePid(process.pid).pipe(Effect.flip);
        checks.push("idempotent-close", "no-admission-after-close");
      } else if (launch.mode === "probe") {
        yield* io.probePid(process.pid);
        const invalid = yield* io.probePid(-1).pipe(Effect.flip);

        if (invalid.reason !== "IO") return yield* Effect.die("invalid pid was not IO");
        const impossible = yield* io.probePid(2147483647).pipe(Effect.flip);

        if (impossible.reason !== "Gone") return yield* Effect.die("absent pid was not Gone");
        checks.push("alive-pid", "invalid-pid", "gone-pid");
      } else if (launch.mode === "callbacks") {
        const runtime = yield* io.makeCallbackRuntime<never>();
        const started = yield* Deferred.make<void>();
        const finalized = yield* Deferred.make<void>();

        const fiber = runtime.fork(
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);

            return yield* Effect.never;
          }).pipe(Effect.ensuring(Deferred.succeed(finalized, undefined))),
        );

        yield* Deferred.await(started);
        yield* runtime.clear;
        yield* Deferred.await(finalized);
        const exit = yield* Fiber.await(fiber);

        if (exit._tag !== "Failure") return yield* Effect.die("callback was not interrupted");
        const value = yield* Effect.promise(() => runtime.run(Effect.succeed(17)));

        if (value !== 17) return yield* Effect.die("callback success channel changed");
        checks.push("callback-cancellation", "callback-finalizer-once", "promise-channel");
      } else if (launch.mode === "blocked-write") {
        const error = yield* io.write(new Uint8Array(8 * 1024 * 1024)).pipe(Effect.flip);

        if (error.reason !== "IO") return yield* Effect.die("blocked writer did not fail IO");
        yield* io.close;
        checks.push("writer-deadline", "release-deadline");
      } else if (launch.mode === "broken-write") {
        const error = yield* io.write("synthetic").pipe(Effect.flip);

        if (error.reason !== "IO" && error.reason !== "Closed")
          return yield* Effect.die("broken pipe was not classified");
        checks.push("broken-pipe");
      } else {
        let bytes = 0;
        let maximumRead = 0;
        let maximumBacking = 0;
        let retained: Uint8Array | undefined;
        let retainedDigest: string | undefined;
        const invalid = yield* io.read(65537).pipe(Effect.flip);

        if (invalid.reason !== "Capacity") return yield* Effect.die("raw bound was ignored");

        while (true) {
          yield* io.turn;
          const data = yield* io.read(65536);

          if (data === null) break;

          if (data.byteLength > 0 && retained === undefined) {
            retained = data;
            retainedDigest = new Bun.CryptoHasher("sha256").update(data).digest("hex");
          }

          bytes += data.byteLength;
          maximumRead = Math.max(maximumRead, data.byteLength);
          maximumBacking = Math.max(maximumBacking, data.buffer.byteLength);

          if (data.byteLength > 65536 || data.buffer.byteLength > 65536)
            return yield* Effect.die("native read bound exceeded");
        }

        if (
          retained !== undefined &&
          new Bun.CryptoHasher("sha256").update(retained).digest("hex") !== retainedDigest
        )
          return yield* Effect.die("retained read backing was reused");
        yield* receipt({
          event: "result",
          bytes,
          maximumRead,
          maximumBacking,
          checks: ["read-bound", "retained-buffer", "eof"],
        });

        return;
      }

      yield* receipt({ event: "result", checks });
    }),
  ).pipe(Effect.ensuring(receipt({ event: "released" }).pipe(Effect.orDie)));
}).pipe(
  Effect.catchTag("LinuxLspError", (error) => receipt({ event: "failure", reason: error.reason })),
);

BunRuntime.runMain(program, { disableErrorReporting: true });
