import { assert, describe, it } from "@effect/vitest";
import { Context, Effect, Fiber, Schema, Scope } from "effect";
import { expectTypeOf } from "vitest";
import {
  acquireLspTransport,
  type LspIO,
  type LspTransport,
  TransportError,
} from "../src/lsp-transport.js";
import { acquirePeer, frames, maintainedBufferLaw } from "./lsp-transport-peer.js";

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

  it.effect("an IO handle cannot forge native authority", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.scoped(
          acquireLspTransport(Effect.succeed({ _tag: "LspIO" } satisfies LspIO), {
            request: () => Effect.succeed(null),
            notification: () => Effect.void,
          }),
        ),
      );

      assert.strictEqual(error._tag, "TransportError");
      assert.strictEqual(error.reason, "IO");
    }),
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
        yield* peer.eof;
        assert.deepStrictEqual(yield* peer.exit, { code: 0, signal: null });
        assert.include(yield* peer.stderr, "root-released");
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
    ["malformed JSON", "Content-Length: 1\r\n\r\n{", "Decode"],
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
  ])("Schema rejects invalid envelope %#", (message) =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.write(yield* frames([message]));
        assert.strictEqual((yield* peer.exit).code, 0);
        assert.include(yield* peer.stderr, "terminal:Decode");
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

  it.live("the 33rd outstanding request closes without an unbounded error queue", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer();
        yield* peer.waitNotification("ready");
        yield* peer.write(
          yield* frames(
            Array.from({ length: 33 }, (_, id) => ({
              jsonrpc: "2.0",
              id,
              method: "hold",
              params: null,
            })),
          ),
        );
        assert.strictEqual((yield* peer.exit).code, 0);
        assert.include(yield* peer.stderr, "terminal:Capacity");
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

  it.live.each([null, "count"] as const)(
    "slow output reader cannot retain unlimited mandatory writes (%s) or a child",
    (variant) =>
      Effect.scoped(
        Effect.gen(function* () {
          const peer = yield* acquirePeer(false);
          yield* peer.write(
            yield* frames([{ jsonrpc: "2.0", id: 0, method: "burst", params: variant }]),
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
