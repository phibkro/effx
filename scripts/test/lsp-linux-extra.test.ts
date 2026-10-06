/** @effect-diagnostics unstableApiUsage:off -- EX-0023: scoped actual-host extra-law subprocess custody. */
import { assert, describe, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import { BunServices } from "@effect/platform-bun";
import { Effect, Schema, Stream, type Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { constants } from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { type LspIO, type TransportError, type ClientProbeError } from "@effx/cli";
import { acquireLinuxLspIO, defaultLinuxLspManifestPath, LinuxLspError } from "../lsp-linux.ts";
import {
  ExtraForm,
  ExtraMode,
  ExtraPeerResult,
  ExtraReceipt,
  extraPrefixBytes,
  extraBodyForPrefill,
  extraMaximumBodyBytes,
  makeExtraHeader,
} from "./lsp-linux-extra.contract.ts";

const peer = fileURLToPath(new URL("./lsp-linux-extra.peer.ts", import.meta.url));

const decodeResult = Schema.decodeEffect(Schema.fromJsonString(ExtraPeerResult), {
  onExcessProperty: "error",
});

const runExtra = Effect.fnUntraced(function* (
  mode: typeof ExtraMode.Type,
  form: typeof ExtraForm.Type,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make(
          "node",
          [peer, process.execPath, defaultLinuxLspManifestPath, mode, form],
          { stdin: "ignore", stdout: "pipe", stderr: "ignore", forceKillAfter: "1 second" },
        ),
      );

      const text = yield* child.stdout.pipe(Stream.decodeText(), Stream.mkString);
      const code = Number(yield* child.exitCode);
      const result = text.trim() === "" ? undefined : yield* decodeResult(text.trim());
      const fixtureFailure = result?.receipts.find((receipt) => receipt.event === "failure");

      if (result !== undefined && (code !== 0 || result.code !== 0 || result.fault !== undefined))
        yield* Effect.logInfo("Safe native-law failure result", result);
      assert.strictEqual(
        code,
        0,
        `extra peer exit=${code}; mode=${mode}; form=${form}; reason=${result?.fault?.reason ?? "unobserved"}; stage=${result?.fault?.stage ?? "unobserved"}`,
        `extra peer exit=${code}; mode=${mode}; form=${form}; reason=${result?.fault?.reason ?? "unobserved"}; stage=${result?.fault?.stage ?? "unobserved"}; fixtureExit=${result?.code ?? "unobserved"}; fixtureTag=${fixtureFailure?.failureTag ?? "unobserved"}; fixtureStage=${fixtureFailure?.stage ?? "unobserved"}; prefill=${fixtureFailure?.prefillFailure ?? "unobserved"}; command=${fixtureFailure?.commandFailure ?? "unobserved"}; errno=${fixtureFailure?.fixtureErrno ?? "unobserved"}`,
      );
      assert.isDefined(result, "extra peer produced no safe result");

      return result!;
    }),
  ).pipe(Effect.timeout("15 seconds"));
});

const requireReceipt = (
  receipts: ReadonlyArray<ExtraReceipt>,
  event: ExtraReceipt["event"],
): ExtraReceipt => {
  const selected = receipts.filter((receipt) => receipt.event === event);
  assert.strictEqual(selected.length, 1, `expected one ${event} receipt`);

  return selected[0]!;
};

// All twelve cases use the production Root, its shipped shared-symbol C asset,
// actual descriptors and kernel acceptance. No mock SDK/IO/readiness backend,
// trial retries, timeout increases, or presumed OS buffer capacity are involved.
// Parent adds this file to the existing native config and runs it only after all
// sources land. These tests are not packed/full/Ubuntu/runtime qualification.
describe("Linux native extra ownership laws", () => {
  it("keeps construction lazy and the original success/error/Scope channels", () => {
    const discarded = acquireLinuxLspIO("/does-not-exist/lsp-readiness.json");
    expectTypeOf(discarded).toEqualTypeOf<Effect.Effect<LspIO, LinuxLspError, Scope.Scope>>();
    expectTypeOf(discarded).not.toMatchTypeOf<Effect.Effect<LspIO, LinuxLspError>>();
    expectTypeOf<LspIO["close"]>().toEqualTypeOf<Effect.Effect<void>>();
    expectTypeOf<LspIO["write"]>().returns.toEqualTypeOf<Effect.Effect<void, TransportError>>();
    expectTypeOf<LspIO["read"]>().returns.toEqualTypeOf<
      Effect.Effect<Uint8Array | null, TransportError>
    >();
    expectTypeOf<LspIO["probePid"]>().returns.toEqualTypeOf<
      Effect.Effect<void, ClientProbeError>
    >();
  });

  for (const mode of ExtraMode.literals) {
    it.live.each(ExtraForm.literals)(`${mode}: real %s identity, progress and release`, (form) =>
      Effect.gen(function* () {
        const result = yield* runExtra(mode, form);
        const failure = result.receipts.find((receipt) => receipt.event === "failure");
        assert.strictEqual(
          result.code,
          0,
          `fixture exit=${result.code}; tag=${failure?.failureTag ?? "unobserved"}; reason=${failure?.reason ?? "unobserved"}; stage=${failure?.stage ?? "unobserved"}; identity=${failure?.identityFailure ?? "unobserved"}`,
        );
        assert.strictEqual(result.signal, null);
        assert.isUndefined(
          result.fault,
          `peer reason=${result.fault?.reason ?? "none"}; stage=${result.fault?.stage ?? "none"}`,
        );
        assert.isUndefined(failure);
        assert.deepStrictEqual(
          result.receipts.map((receipt) => receipt.event),
          [
            "started",
            "acquired",
            "identity",
            "saturated",
            "writer-waiting",
            "backpressure",
            ...(mode === "closing" || mode === "release-fault" ? ["closing"] : []),
            "released",
            "scope-outcome",
          ],
        );

        // Falsifier: mutating shared O_NONBLOCK, dup/replacing either original,
        // or forgetting the separately opened FIFO/PTY output descriptor.
        const identity = requireReceipt(result.receipts, "identity");

        for (const [before, after] of [
          [identity.fd0Before, identity.fd0After],
          [identity.fd1Before, identity.fd1After],
        ]) {
          assert.isDefined(before);
          assert.isDefined(after);
          assert.strictEqual(after?.kind, before?.kind);
          assert.strictEqual(after?.device, before?.device);
          assert.strictEqual(after?.inode, before?.inode);
          assert.strictEqual(after?.flags, before?.flags);
        }

        assert.strictEqual(identity.fd1Before?.kind, form);
        assert.strictEqual(identity.fd0Before?.kind, form === "pty" ? "pty" : "socket");
        assert.isDefined(identity.fd0Before?.flags);
        assert.isDefined(identity.fd1Before?.flags);

        if (form === "socket") {
          assert.isUndefined(identity.reopenedFd);
          assert.isUndefined(identity.reopenedIdentity);
        } else {
          assert.isTrue((identity.reopenedFd ?? -1) > 4);
          assert.strictEqual(identity.reopenedIdentity?.device, identity.fd1Before?.device);
          assert.strictEqual(identity.reopenedIdentity?.inode, identity.fd1Before?.inode);
          assert.notStrictEqual((identity.reopenedIdentity?.flags ?? 0) & constants.O_NONBLOCK, 0);

          if (form === "fifo")
            assert.strictEqual(
              (identity.fd1Before?.flags ?? constants.O_NONBLOCK) & constants.O_NONBLOCK,
              0,
            );
        }

        // Falsifier: treating a large frame as saturation evidence, accepting a
        // second writer, retaining caller storage, or finishing without bytes.
        const saturated = requireReceipt(result.receipts, "saturated");
        assert.strictEqual(saturated.wouldBlock, true); // actual one-byte EAGAIN
        assert.isTrue((saturated.prefillBytes ?? 0) > 0);
        assert.isTrue((saturated.partialWrites ?? 0) > 0);
        assert.isTrue((saturated.minimumPartialBytes ?? 0) > 0);
        assert.isTrue((saturated.minimumPartialBytes ?? Infinity) < 65536);
        const bodyBytes = extraBodyForPrefill(saturated.prefillBytes ?? 0);
        assert.isTrue(bodyBytes <= extraMaximumBodyBytes);
        assert.strictEqual(saturated.bodyBytes, bodyBytes);
        const frameBytes = makeExtraHeader(bodyBytes).byteLength + bodyBytes;
        assert.strictEqual(saturated.frameBytes, frameBytes);
        assert.strictEqual(result.prefillBytesRead, saturated.prefillBytes);
        const blocked = requireReceipt(result.receipts, "backpressure");
        assert.strictEqual(blocked.writerPending, true);
        assert.strictEqual(blocked.observedPrefixBytes, extraPrefixBytes);
        assert.strictEqual(blocked.pollMask, 0); // actual no-POLLOUT, no error/hup
        assert.strictEqual(blocked.callerMutated, true);
        assert.strictEqual(blocked.refusalReason, "Capacity");
        assert.strictEqual(result.prefixVerified, true);
        assert.strictEqual(result.frameVerified, true); // original pattern, not mutation/sentinel

        if (mode === "progress") assert.strictEqual(result.frameBytesRead, frameBytes);
        else {
          assert.isTrue(result.frameBytesRead >= extraPrefixBytes);
          assert.isTrue(result.frameBytesRead < frameBytes);
        }

        // Falsifier: recovering cancellation, submitting another chunk after
        // Closing/Closed, successful receipt-only cleanup, or unloading while
        // the writer still owns a native pointer/cursor.
        const released = requireReceipt(result.receipts, "released");
        assert.strictEqual(released.fd0Closed, true); // fstat(0) really EBADF
        assert.strictEqual(released.fd1Closed, true); // fstat(1) really EBADF
        assert.strictEqual(released.reopenedClosed, true); // actual numeric reopen EBADF
        assert.strictEqual(released.libraryUnmapped, true); // no extra dlopen reference remains
        assert.strictEqual(released.postCloseRefused, true);
        assert.strictEqual(
          released.writerExit,
          mode === "progress" ? "Success" : mode === "cancel" ? "Interrupted" : "Closed",
        );
        assert.strictEqual(released.closeExit, mode === "release-fault" ? "ReleaseIO" : "Success");

        if (mode === "closing" || mode === "release-fault") {
          const closing = requireReceipt(result.receipts, "closing");
          assert.strictEqual(closing.closePending, true);
          assert.strictEqual(closing.postCloseRefused, true);
          assert.strictEqual(released.closeJoined, true);

          if (mode === "release-fault") assert.strictEqual(released.sameCloseCause, true);
        }

        assert.strictEqual(
          requireReceipt(result.receipts, "scope-outcome").expectedReleaseFault,
          mode === "release-fault",
        );

        // Falsifier: killing/joining only script while its actual Bun child lives.
        assert.strictEqual(result.fixtureGone, true);
        assert.strictEqual(result.ptyChildJoined, true);
      }).pipe(Effect.provide(BunServices.layer)),
    );
  }
});
