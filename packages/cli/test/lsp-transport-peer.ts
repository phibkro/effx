// EX-0030: real subprocess/client composition root; no vendor or native handles
// escape into the behavior suite. Microsoft maintained client is the wire oracle.
// oxlint-disable-next-line effecttsgo/node-builtin-import -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
import { spawn } from "node:child_process";
import process from "node:process";
import { Deferred, Effect, Fiber, Predicate, Schema } from "effect";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  CancellationTokenSource,
  RAL,
  AbstractMessageBuffer,
  WriteableStreamMessageWriter,
  type Message,
} from "vscode-languageserver-protocol/node";
import {
  acquireLspTransport,
  RpcFailure,
  stdioLspIO,
  type LspTransport,
} from "../src/lsp-transport.js";

export class PeerError extends Schema.TaggedError<PeerError>()("PeerError", {
  cause: Schema.Defect(),
}) {}

const decodeJson = Schema.decodeUnknownEffect(Schema.Json);

export const maintainedBufferLaw = Effect.sync(() => {
  const buffer = RAL().messageBuffer.create("utf-8");

  if (!(buffer instanceof AbstractMessageBuffer)) return false;
  buffer.append(new TextEncoder().encode("Content-Length: 2\r\n\r\n{}"));
  const before = buffer.numberOfBytes;
  const headers = buffer.tryReadHeaders(true);
  const body = buffer.tryReadBody(2);

  return (
    before > 2 &&
    headers?.get("content-length") === "2" &&
    body?.byteLength === 2 &&
    buffer.numberOfBytes === 0
  );
});

/** A test vector encoder, not a parser: framing is produced by the maintained writer. */
export const frames = Effect.fnUntraced(function* (messages: ReadonlyArray<Schema.Json>) {
  const chunks: Uint8Array[] = [];

  const writer = new WriteableStreamMessageWriter({
    onClose: () => ({ dispose: () => {} }),
    onError: () => ({ dispose: () => {} }),
    onEnd: () => ({ dispose: () => {} }),
    write: (data: string | Uint8Array) => {
      chunks.push(Predicate.isString(data) ? new TextEncoder().encode(data) : data);

      return Promise.resolve();
    },
    end: () => {},
  });

  for (const message of messages) {
    // SAFETY: the stock writer only encodes this JSON vector; deliberately malformed
    // envelopes are never consumed as trusted Message values by this helper.
    yield* Effect.tryPromise({
      try: () => writer.write(message as Message),
      catch: (cause) => new PeerError({ cause }),
    });
  }

  writer.dispose();
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return bytes;
});

export const acquirePeer = Effect.fnUntraced(function* (readOutput = true) {
  const child = yield* Effect.acquireRelease(
    Effect.sync(() =>
      spawn(process.execPath, [new URL(import.meta.url).pathname, "serve"], {
        stdio: ["pipe", "pipe", "pipe"],
      }),
    ),
    (child) =>
      Effect.callback<void>((resume) => {
        if (child.exitCode !== null || child.signalCode !== null) {
          resume(Effect.void);

          return;
        }

        const closed = () => resume(Effect.void);
        child.once("close", closed);
        child.kill("SIGKILL");

        return Effect.sync(() => {
          child.off("close", closed);
        });
      }),
  );

  let stderr = "";

  const stderrListener = (chunk: Uint8Array) => {
    stderr += new TextDecoder().decode(chunk);
  };

  child.stderr.on("data", stderrListener);

  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );

  const notifications: Array<{ method: string; params: unknown }> = [];
  const waiters = new Set<() => void>();
  connection.onNotification((method, params) => {
    notifications.push({ method, params });

    for (const waiter of waiters) waiter();
  });

  if (readOutput) connection.listen();
  else child.stdout.pause();

  const exit = Effect.callback<{ code: number | null; signal: string | null }>((resume) => {
    const done = (code: number | null, signal: string | null) =>
      resume(Effect.succeed({ code, signal }));

    if (child.exitCode !== null || child.signalCode !== null)
      done(child.exitCode, child.signalCode);
    else child.once("close", done);

    return Effect.sync(() => {
      child.off("close", done);
    });
  });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      connection.dispose();
      child.stderr.off("data", stderrListener);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }),
  );

  const write = Effect.fnUntraced(function* (bytes: Uint8Array) {
    yield* Effect.callback<void, PeerError>((resume) => {
      child.stdin.write(bytes, (cause) =>
        resume(cause ? Effect.fail(new PeerError({ cause })) : Effect.void),
      );
    });
  });

  const waitNotification = Effect.fnUntraced(function* (method: string) {
    return yield* Effect.callback<unknown>((resume) => {
      const check = () => {
        const index = notifications.findIndex((message) => message.method === method);

        if (index !== -1) resume(Effect.succeed(notifications.splice(index, 1)[0]!.params));
      };

      waiters.add(check);
      check();

      return Effect.sync(() => {
        waiters.delete(check);
      });
    });
  });

  return {
    exit,
    request: Effect.fnUntraced(function* (method: string, params: Schema.Json = null) {
      const value: unknown = yield* Effect.tryPromise({
        try: () => connection.sendRequest(method, params),
        catch: (cause) => new PeerError({ cause }),
      });

      return yield* decodeJson(value);
    }),
    notification: Effect.fnUntraced(function* (method: string, params: Schema.Json = null) {
      yield* Effect.tryPromise({
        try: () => connection.sendNotification(method, params),
        catch: (cause) => new PeerError({ cause }),
      });
    }),
    cancelledRequest: Effect.fnUntraced(function* (method: string, waitStarted = true) {
      const source = new CancellationTokenSource();
      const promise = connection.sendRequest(method, null, source.token);

      const observed = promise.then(
        () => ({ code: 0 }),
        (cause: unknown) => ({ cause }),
      );

      if (waitStarted) yield* waitNotification("started");
      source.cancel();
      const result = yield* Effect.promise(() => observed);
      source.dispose();

      return "cause" in result
        ? yield* Schema.decodeUnknownEffect(Schema.Struct({ code: Schema.Int }))(result.cause)
        : { code: 0 };
    }),
    write,
    waitNotification,
    stderr: Effect.sync(() => stderr),
    eof: Effect.sync(() => {
      child.stdin.end();
    }),
    interrupt: Effect.sync(() => {
      child.kill("SIGINT");
    }),
    resumeOutput: Effect.sync(() => {
      connection.listen();
      child.stdout.resume();
    }),
  };
});

// This peer implements stateful operations, admission receipts, cancellation and
// cleanup observations. It is deliberately not an echo/mock replacement transport.
if (process.argv[2] === "serve") {
  const program = Effect.scoped(
    Effect.gen(function* () {
      let transport: LspTransport;
      const edits: Schema.Json[] = [];
      let active = 0;
      let released = 0;
      const gate = yield* Deferred.make<void>();
      transport = yield* acquireLspTransport(stdioLspIO, {
        request: Effect.fnUntraced(function* (message) {
          if (message.method === "inspect") {
            yield* transport.admitPending.pipe(Effect.orDie);

            return { edits: [...edits], active, released };
          }

          if (message.method === "release") {
            yield* Deferred.succeed(gate, undefined);

            return null;
          }

          if (message.method === "checkpoint") {
            const checkpoint = yield* Effect.forkChild(transport.admitPending.pipe(Effect.orDie));
            yield* Effect.callback<void>((resume) => {
              const turn = RAL().timer.setImmediate(() => resume(Effect.void));

              return Effect.sync(() => turn.dispose());
            });
            yield* transport.sendNotification("checkpoint-captured", null).pipe(Effect.orDie);
            yield* Fiber.join(checkpoint);

            return { edits: [...edits], active, released };
          }

          if (message.method === "hold") {
            return yield* Effect.scoped(
              Effect.gen(function* () {
                yield* Effect.acquireRelease(
                  Effect.sync(() => {
                    active++;
                  }),
                  () =>
                    Effect.sync(() => {
                      active--;
                      released++;
                      process.stderr.write("handler-released\n");
                    }),
                );
                yield* transport.sendNotification("started", null).pipe(Effect.orDie);

                return yield* Effect.never;
              }),
            );
          }

          if (message.method === "large") return "é".repeat(5 * 1024 * 1024);

          if (message.method === "burst") {
            yield* Effect.forEach(
              Array.from({ length: 33 }, (_, index) => index),
              (index) =>
                transport.sendNotification("large-output", {
                  index,
                  text: "x".repeat(message.params === "count" ? 16 : 1024 * 1024),
                }),
              { concurrency: "unbounded" },
            ).pipe(Effect.orDie);

            return null;
          }

          if (message.method === "fail")
            return yield* new RpcFailure({
              code: -32602,
              message: "Rejected parameters",
              data: { safe: true },
            });

          return yield* new RpcFailure({ code: -32601, message: "Unknown method" });
        }),
        notification: Effect.fnUntraced(function* (message) {
          if (message.method === "gate") {
            yield* transport.sendNotification("gated", null).pipe(Effect.orDie);
            yield* Deferred.await(gate);
          }

          if (message.method === "block") {
            yield* transport.sendNotification("blocked", null).pipe(Effect.orDie);

            return yield* Effect.never;
          }

          if (message.method === "edit") edits.push(message.params ?? null);
        }),
      });
      yield* transport.sendNotification("ready", null);
      yield* transport.awaitClosed.pipe(
        Effect.catchTag("TransportError", (error) =>
          Effect.sync(() => {
            process.stderr.write(`terminal:${error.reason}\n`);
          }),
        ),
      );
    }),
  );

  Effect.runPromise(program).then(
    () => {
      process.stderr.write("root-released\n");
    },
    () => {
      process.stderr.write("root-failed\n");
      process.exitCode = 1;
    },
  );
}
