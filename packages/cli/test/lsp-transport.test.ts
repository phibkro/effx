import { assert, describe, it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Schema, Scope } from "effect";
import { expectTypeOf } from "vitest";
import {
  acquireLspTransport,
  LspPlatform,
  type LspCallbackRuntime,
  type LspIO,
  type LspTransport,
  TransportError,
} from "../src/lsp-transport.js";
import { acquirePeer, frames, maintainedBufferLaw } from "../../../scripts/lsp-test-peer.js";

const Inspect = Schema.Struct({
  edits: Schema.Array(Schema.Json),
  active: Schema.Int,
  released: Schema.Int,
});

const decodeInspect = Schema.decodeUnknownEffect(Inspect);

// Real pipes need the live clock; no sleep/timer is a success witness. Every case
// waits for maintained client responses, protocol receipts, or native child close.
describe("maintained scoped LSP transport (EX-0030)", () => {
  it.effect("constructing and discarding acquisition performs no IO", () =>
    Effect.sync(() => {
      let acquired = 0;

      const io = Effect.sync((): LspIO => {
        acquired++;
        throw new Error("must stay lazy");
      });

      const discarded = acquireLspTransport(io, {
        request: () => Effect.succeed(null),
        notification: () => Effect.void,
      });

      assert.isTrue(Effect.isEffect(discarded));
      assert.strictEqual(acquired, 0);
    }),
  );

  it.effect("published RAL factory exposes the maintained byte-accounting buffer", () =>
    Effect.gen(function* () {
      assert.isTrue(yield* maintainedBufferLaw);
    }),
  );

  it.live("injected native demand keeps exact byte bounds, one bridge and one release", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.notification("edit", { text: "é".repeat(96 * 1024) });
        yield* peer.request("inspect");

        const stats = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            maxRequested: Schema.Int,
            maxReturned: Schema.Int,
            maxBacking: Schema.Int,
            runtimeAcquisitions: Schema.Int,
            ioReleases: Schema.Int,
          }),
        )(yield* peer.request("io-inspect"));

        assert.isAbove(stats.maxRequested, 0);
        assert.isAtMost(stats.maxRequested, 65536);
        assert.isAbove(stats.maxReturned, 0);
        assert.isAtMost(stats.maxReturned, 65536);
        assert.isAtMost(stats.maxBacking, 65536);
        assert.strictEqual(stats.runtimeAcquisitions, 1);
        assert.strictEqual(stats.ioReleases, 0);
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
        const log = yield* peer.stderr;
        assert.strictEqual(log.split("native-io-released-once").length - 1, 1);
        assert.notInclude(log, "native-io-release-duplicated");
        assert.include(log, "native-io-closed-fence\n");
        assert.notInclude(log, "native-io-closed-fence-failed");
      }),
    ),
  );

  it.live("framing failure releases the injected native owner exactly once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.write(new TextEncoder().encode("Content-Length: -1\r\n\r\n"));
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
        const log = yield* peer.stderr;
        assert.include(log, "terminal:Framing");
        assert.strictEqual(log.split("native-io-released-once").length - 1, 1);
        assert.notInclude(log, "native-io-release-duplicated");
        assert.include(log, "native-io-closed-fence\n");
      }),
    ),
  );

  it.live("checkpoint input failure closes with its original structural reason", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        // Without terminal checkpoint handling this becomes Handler, not Framing.
        yield* peer.request("checkpoint-read-failure").pipe(Effect.exit);
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
        const log = yield* peer.stderr;
        assert.include(log, "terminal:Framing");
        assert.notInclude(log, "terminal:Handler");
        assert.strictEqual(log.split("native-io-released-once").length - 1, 1);
      }),
    ),
  );

  it.live("host interruption joins the injected IO release and handler finalizer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        const held = yield* Effect.forkChild(peer.request("hold").pipe(Effect.exit));
        yield* peer.waitNotification("started");
        yield* peer.interrupt;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
        yield* Fiber.join(held);
        const log = yield* peer.stderr;
        assert.strictEqual(log.split("handler-released").length - 1, 1);
        assert.strictEqual(log.split("native-io-released-once").length - 1, 1);
        assert.notInclude(log, "native-io-release-duplicated");
      }),
    ),
  );

  it.live("stateful maintained client applies UTF-8 chunked and coalesced edits in order", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");

        const bytes = yield* frames([
          { jsonrpc: "2.0", method: "edit", params: "é😀" },
          { jsonrpc: "2.0", method: "edit", params: { version: 2, text: "修理" } },
        ]);

        for (let index = 0; index < 25; index++)
          yield* peer.write(bytes.subarray(index, index + 1));
        yield* peer.write(bytes.subarray(25));
        const state = yield* decodeInspect(yield* peer.request("inspect"));
        assert.deepStrictEqual(state.edits, ["é😀", { version: 2, text: "修理" }]);
        assert.strictEqual(yield* peer.protocolErrorCount, 0);
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
        assert.include(yield* peer.stderr, "root-released");
      }),
    ),
  );

  it.live("maintained client keeps absent, named and positional parameters distinct", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        // A default null or transport-level unwrap would change these wire values.
        yield* peer.notification("edit");
        yield* peer.notification("edit", null);
        yield* peer.notification("edit", 7);
        yield* peer.notification("edit", [1, 2]);
        yield* peer.notification("edit", { named: true });
        const state = yield* decodeInspect(yield* peer.request("inspect"));
        assert.deepStrictEqual(state.edits, [null, [null], [7], [[1, 2]], { named: true }]);
        assert.strictEqual(yield* peer.protocolErrorCount, 0);
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
      }),
    ),
  );

  it.live("typed request failure survives the maintained response writer", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        const error = yield* Effect.flip(peer.request("fail"));
        assert.strictEqual(error._tag, "PeerError");

        if (error._tag === "PeerError") {
          const decoded = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ code: Schema.Int, message: Schema.String, data: Schema.Json }),
          )(error.cause);

          assert.deepStrictEqual(decoded, {
            code: -32602,
            message: "Rejected parameters",
            data: { safe: true },
          });
        }

        yield* peer.eof;
        assert.strictEqual((yield* peer.exit).code, 0);
      }),
    ),
  );
  it.live("maintained request errors omit absent optional data at the strict boundary", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");

        const failure = yield* peer.requestError("unknown-method");

        assert.deepStrictEqual(failure, { code: -32601, message: "Unknown method" });
        assert.notProperty(failure, "data");
        assert.strictEqual(yield* peer.protocolErrorCount, 0);
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
      }),
    ),
  );

  it.live("running cancellation interrupts the scoped handler and returns credits once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");

        for (let index = 0; index < 40; index++) {
          assert.strictEqual((yield* peer.cancelledRequest("hold")).code, -32800);
        }

        const state = yield* decodeInspect(yield* peer.request("inspect"));
        assert.strictEqual(state.active, 0);
        assert.strictEqual(state.released, 40);
        yield* peer.eof;
        assert.strictEqual((yield* peer.exit).code, 0);
      }),
    ),
  );

  it.live("undispatched cancellation bypass releases request credits after response writes", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");

        const queued = yield* frames(
          Array.from({ length: 32 }, () => ({ jsonrpc: "2.0", method: "block", params: null })),
        );

        yield* peer.write(queued);
        yield* peer.waitNotification("blocked");

        for (let index = 0; index < 40; index++)
          assert.strictEqual((yield* peer.cancelledRequest("hold", false)).code, -32800);
        yield* peer.interrupt;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
      }),
    ),
  );

  it.live("unknown cancellations are not retained or admitted as domain notifications", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");

        for (let batch = 0; batch < 20; batch++) {
          yield* peer.write(
            yield* frames(
              Array.from({ length: 20 }, (_, id) => ({
                jsonrpc: "2.0",
                method: "$/cancelRequest",
                params: { id: `unknown-${batch}-${id}` },
              })),
            ),
          );
          const state = yield* decodeInspect(yield* peer.request("inspect"));
          assert.strictEqual(state.active, 0);
        }

        yield* peer.eof;
        assert.strictEqual((yield* peer.exit).code, 0);
      }),
    ),
  );

  it.live.each([
    ["suffix", "Content-Length: 2junk\r\n\r\n{}", "Framing"],
    ["negative", "Content-Length: -1\r\n\r\n", "Framing"],
    ["fraction", "Content-Length: 2.0\r\n\r\n{}", "Framing"],
    ["unsafe", "Content-Length: 9007199254740992\r\n\r\n", "Framing"],
    ["body cap", "Content-Length: 8388609\r\n\r\n", "Framing"],
    [
      "charset",
      "Content-Length: 2\r\nContent-Type: application/vscode-jsonrpc; charset=latin1\r\n\r\n{}",
      "Framing",
    ],
    ["malformed header", "not-a-header\r\n\r\n", "Framing"],
    ["header cap", "X: " + "x".repeat(8192), "Framing"],
  ] as const)("rejects %s before domain work", ([_name, frame, reason]) =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.write(new TextEncoder().encode(frame));
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
        const log = yield* peer.stderr;
        assert.include(log, `terminal:${reason}`);
        assert.include(log, "root-released");
        assert.notInclude(log, frame);
      }),
    ),
  );

  it.live("a safely framed JSON parse error gets id:null and keeps the session usable", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.write(new TextEncoder().encode("Content-Length: 1\r\n\r\n{"));

        assert.strictEqual((yield* peer.waitProtocolError(-32700)).code, -32700);

        const state = yield* decodeInspect(yield* peer.request("inspect"));

        assert.deepStrictEqual(state.edits, []);
        assert.strictEqual(yield* peer.protocolErrorCount, 0);
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
      }),
    ),
  );

  it.live("native checkpoint does not wait for controlled later ingress", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.notification("gate");
        yield* peer.waitNotification("gated");
        const checkpoint = yield* Effect.forkChild(peer.request("checkpoint"));
        yield* peer.waitNotification("checkpoint-captured");
        yield* peer.notification("block");
        yield* peer.request("release");
        const result = yield* decodeInspect(yield* Fiber.join(checkpoint));
        assert.deepStrictEqual(result.edits, []);
        yield* peer.waitNotification("blocked");
        yield* peer.interrupt;
        assert.strictEqual((yield* peer.exit).code, 0);
      }),
    ),
  );
  it.live.each([
    { jsonrpc: "1.0", method: "edit" },
    { jsonrpc: "2.0", id: null, method: "edit" },
    { jsonrpc: "2.0", id: {}, method: "edit" },
    { jsonrpc: "2.0", method: 3 },
  ])("invalid envelope %# gets id:null and keeps the session usable", (message) =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.write(yield* frames([message]));
        assert.strictEqual((yield* peer.waitProtocolError(-32600)).code, -32600);

        const state = yield* decodeInspect(yield* peer.request("inspect"));

        assert.deepStrictEqual(state.edits, []);
        assert.strictEqual(yield* peer.protocolErrorCount, 0);
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
      }),
    ),
  );

  it.live("notification saturation closes rather than dropping edits", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.notification("block");
        yield* peer.waitNotification("blocked");
        yield* peer.write(
          yield* frames(
            Array.from({ length: 64 }, (_, index) => ({
              jsonrpc: "2.0",
              method: "edit",
              params: index,
            })),
          ),
        );
        assert.strictEqual((yield* peer.exit).code, 0);
        assert.include(yield* peer.stderr, "terminal:Capacity");
      }),
    ),
  );

  it.live("aggregate input bytes remain charged while a handler is running", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.notification("block");
        yield* peer.waitNotification("blocked");

        const bytes = yield* frames(
          Array.from({ length: 9 }, () => ({
            jsonrpc: "2.0",
            method: "edit",
            params: "x".repeat(1024 * 1024),
          })),
        );

        yield* peer.write(bytes).pipe(Effect.exit);
        assert.strictEqual((yield* peer.exit).code, 0);
        assert.include(yield* peer.stderr, "terminal:Capacity");
      }),
    ),
  );

  it.live("request 33 is explicitly refused while all original request correlations survive", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");

        const allStarted = yield* Deferred.make<void>();

        const gates = yield* Effect.forEach(Array.from({ length: 32 }), () =>
          Deferred.make<void>(),
        );

        let started = 0;

        const originals = yield* Effect.forEach(gates, (gate) =>
          Effect.forkChild(
            peer.cancelledRequest(
              "hold",
              true,
              Effect.gen(function* () {
                started++;

                if (started === 32) yield* Deferred.succeed(allStarted, undefined);

                yield* Deferred.await(gate);
              }),
            ),
          ),
        );

        yield* Deferred.await(allStarted);

        assert.strictEqual((yield* peer.requestError("hold")).code, -32000);

        for (const [index, gate] of gates.entries()) {
          yield* Deferred.succeed(gate, undefined);
          assert.strictEqual((yield* Fiber.join(originals[index]!)).code, -32800);
        }

        const state = yield* decodeInspect(yield* peer.request("inspect"));

        assert.strictEqual(state.active, 0);
        assert.strictEqual(state.released, 32);
        assert.isFalse((yield* peer.notifications).some((message) => message.method === "started"));
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
      }),
    ),
  );

  it.live("queued numeric and string IDs retain distinct original wire and domain identities", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");

        const ids = [1, "1", "n:1"] as const;

        const replies = yield* Effect.forEach(ids, (id) =>
          Effect.forkChild(peer.waitResponse(id), { startImmediately: true }),
        );

        yield* peer.write(
          yield* frames(
            ids.map((id) => ({ jsonrpc: "2.0", id, method: "identify", params: null })),
          ),
        );

        for (const [index, id] of ids.entries()) {
          const response = yield* Fiber.join(replies[index]!);

          assert.strictEqual(response.id, id);
          assert.isTrue("result" in response);

          if ("result" in response) assert.deepStrictEqual(response.result, { receivedId: id });
        }

        yield* peer.request("inspect");
        assert.strictEqual(yield* peer.protocolErrorCount, 0);
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
      }),
    ),
  );

  it.live(
    "an exact duplicate ID receives null error without stealing the original cancellation response",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const peer = yield* acquirePeer();
          yield* peer.waitNotification("ready");

          const original = yield* Effect.forkChild(peer.waitResponse("same"), {
            startImmediately: true,
          });

          yield* peer.write(
            yield* frames([{ jsonrpc: "2.0", id: "same", method: "hold", params: null }]),
          );
          yield* peer.waitNotification("started");
          yield* peer.write(
            yield* frames([{ jsonrpc: "2.0", id: "same", method: "identify", params: null }]),
          );
          assert.strictEqual((yield* peer.waitProtocolError(-32600)).code, -32600);
          yield* peer.notification("$/cancelRequest", { id: "same" });

          const response = yield* Fiber.join(original);

          assert.strictEqual(response.id, "same");
          assert.isTrue("error" in response);

          if ("error" in response) assert.strictEqual(response.error.code, -32800);

          const state = yield* decodeInspect(yield* peer.request("inspect"));

          assert.strictEqual(state.active, 0);
          assert.strictEqual(state.released, 1);
          yield* peer.eof;
          assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
        }),
      ),
  );

  it.live("outbound non-ASCII body cap is byte-based", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.request("large").pipe(Effect.exit);
        assert.strictEqual((yield* peer.exit).code, 0);
        assert.include(yield* peer.stderr, "terminal:Capacity");
      }),
    ),
  );

  it.live("interrupted queued publication never emits after the active native frame drains", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer(false);
        const scenario = yield* Effect.forkChild(peer.request("cancel-publication-scenario"));

        yield* peer.waitStderr("publication-cancelled");
        yield* peer.resumeOutput;
        assert.deepStrictEqual(yield* Fiber.join(scenario), { interrupted: true });
        yield* peer.waitNotification("after-cancel");

        const methods = yield* peer.receivedMethods;

        assert.strictEqual(methods.filter((method) => method === "active-frame").length, 1);
        assert.notInclude(methods, "cancelled-publication");
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });

        const log = yield* peer.stderr;

        assert.strictEqual(log.split("root-released").length - 1, 1);
        assert.notInclude(log, "terminal:");
      }),
    ),
  );

  it.live("EOF closes an interrupted queued publication and blocked active frame once", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer(false);

        const scenario = yield* Effect.forkChild(
          peer.request("cancel-publication-scenario").pipe(Effect.exit),
        );

        yield* peer.waitStderr("publication-cancelled");
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });

        const log = yield* peer.stderr;

        assert.strictEqual(log.split("root-released").length - 1, 1);
        assert.notInclude(log, "root-failed");
        yield* Fiber.join(scenario);
      }),
    ),
  );

  it.live.each([null, "count"] as const)(
    "slow output reader cannot retain unlimited mandatory writes (%s) or a child",
    (variant) =>
      Effect.scoped(
        Effect.gen(function* () {
          const peer = yield* acquirePeer(false);
          yield* peer.write(
            yield* frames([{ jsonrpc: "2.0", id: 0, method: "burst", params: { mode: variant } }]),
          );
          assert.strictEqual((yield* peer.exit).code, 0);
          assert.include(yield* peer.stderr, "terminal:Capacity");
          assert.include(yield* peer.stderr, "root-released");
        }),
      ),
  );

  it.live.each(["eof", "interrupt"] as const)(
    "%s closes handler fibers and native pipe ownership",
    (ending) =>
      Effect.scoped(
        Effect.gen(function* () {
          const peer = yield* acquirePeer();
          yield* peer.waitNotification("ready");
          const pending = yield* Effect.forkChild(peer.request("hold").pipe(Effect.exit));
          yield* peer.waitNotification("started");
          yield* peer[ending];
          assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
          const log = yield* peer.stderr;
          assert.strictEqual(log.split("handler-released").length - 1, 1);
          assert.include(log, "root-released");
          yield* Fiber.join(pending);
        }),
      ),
  );

  it.live("truncated EOF fails framing instead of keeping a partial frame alive", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.write(new TextEncoder().encode("Content-Length: 20\r\n\r\n{"));
        yield* peer.eof;
        assert.strictEqual((yield* peer.exit).code, 0);
        assert.include(yield* peer.stderr, "terminal:Framing");
      }),
    ),
  );
  it.live("typed notification predicates preserve earlier queued receipts", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.notification("edit", { version: 1 });
        yield* peer.notification("edit", { version: 2 });
        const state = yield* decodeInspect(yield* peer.request("inspect"));

        assert.deepStrictEqual(state.edits, [{ version: 1 }, { version: 2 }]);

        const Receipt = Schema.Struct({ index: Schema.Int, value: Schema.Json });

        const second = yield* peer.waitNotification(
          "edited",
          (params) => Schema.is(Receipt)(params) && params.index === 2,
        );

        assert.deepStrictEqual(second, { index: 2, value: { version: 2 } });
        assert.deepStrictEqual(
          (yield* peer.notifications).find((message) => message.method === "edited")?.params,
          { index: 1, value: { version: 1 } },
        );
        assert.deepStrictEqual(yield* peer.requestError("fail"), {
          code: -32602,
          message: "Rejected parameters",
          data: { safe: true },
        });
        yield* peer.eof;
        assert.strictEqual((yield* peer.exit).code, 0);
      }),
    ),
  );

  it.live("null client ownership skips monitoring and one live PID registers idempotently", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        assert.strictEqual(yield* peer.request("watch-client", { processId: null }), null);

        const processId = yield* peer.pid;

        assert.strictEqual(yield* peer.request("watch-client", { processId }), null);
        assert.strictEqual(yield* peer.request("watch-client", { processId }), null);
        yield* peer.request("inspect");
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
        assert.strictEqual((yield* peer.stderr).split("root-released").length - 1, 1);
      }),
    ),
  );

  it.live("invalid client PID closes without probing a process group", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.request("watch-client", { processId: 0 }).pipe(Effect.exit);
        assert.strictEqual((yield* peer.exit).code, 0);
        assert.include(yield* peer.stderr, "terminal:IO");
      }),
    ),
  );

  it.live("actual owned-parent death closes transport even while inherited stdin stays open", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer(true, {
          cwd: new URL("../../../", import.meta.url).pathname,
          main: new URL("../../../scripts/lsp-test-peer.ts", import.meta.url).pathname,
          args: ["parent-client"],
        });

        yield* peer.waitNotification("ready");
        yield* peer.request("inspect");
        // Do not end stdin: server retains the inherited read end after its parent dies.
        yield* peer.interrupt;
        assert.deepStrictEqual(yield* peer.exit, { code: null, signal: "SIGINT" });

        const log = yield* peer.stderr;

        assert.strictEqual(log.split("root-released").length - 1, 1);
        assert.notInclude(log, "terminal:");
        assert.notInclude(log, "root-failed");
      }),
    ),
  );
});

class HandlerDependency extends Context.Service<
  HandlerDependency,
  { readonly value: Schema.Json }
>()("@effx/cli/test/HandlerDependency") {}

class AcquisitionFailure extends Schema.TaggedError<AcquisitionFailure>()(
  "AcquisitionFailure",
  {},
) {}

class AcquisitionDependency extends Context.Service<
  AcquisitionDependency,
  { readonly io: LspIO }
>()("@effx/cli/test/AcquisitionDependency") {}

it("preserves acquisition failures, handler requirements and scoped ownership in its channels", () => {
  const acquired = acquireLspTransport(
    Effect.map(AcquisitionDependency, (service) => service.io).pipe(
      Effect.andThen(Effect.fail(new AcquisitionFailure())),
    ),
    {
      request: () => Effect.map(HandlerDependency, (service) => service.value),
      notification: () => Effect.void,
    },
  );

  expectTypeOf(acquired).toEqualTypeOf<
    Effect.Effect<
      LspTransport,
      AcquisitionFailure | TransportError,
      Scope.Scope | AcquisitionDependency | HandlerDependency
    >
  >();
  expectTypeOf(acquired).not.toEqualTypeOf<
    Effect.Effect<LspTransport, AcquisitionFailure | TransportError, Scope.Scope>
  >();
});

it("platform and callback bridge keep their acquisition and handler channels", () => {
  const platform = Effect.andThen(LspPlatform, (service) => service.acquireIO);
  expectTypeOf(platform).toEqualTypeOf<
    Effect.Effect<LspIO, TransportError, LspPlatform | Scope.Scope>
  >();

  const bridge = Effect.andThen(AcquisitionDependency, (service) =>
    service.io.makeCallbackRuntime<HandlerDependency>(),
  );

  expectTypeOf(bridge).toEqualTypeOf<
    Effect.Effect<
      LspCallbackRuntime<HandlerDependency>,
      never,
      AcquisitionDependency | HandlerDependency | Scope.Scope
    >
  >();
  expectTypeOf(bridge).not.toEqualTypeOf<
    Effect.Effect<LspCallbackRuntime<HandlerDependency>, never, Scope.Scope>
  >();
});
