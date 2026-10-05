// EX-0030: the published JSON-RPC ABI and Node-compatible stdio live only here.
// oxlint-disable-next-line effecttsgo/node-builtin-import -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
import type { Readable, Writable } from "node:stream";
import * as process from "node:process";
import { Cause, Effect, Exit, Fiber, FiberSet, Schema } from "effect";
import {
  AbstractMessageBuffer,
  AbstractMessageReader,
  AbstractMessageWriter,
  createMessageConnection,
  RAL,
  ResponseError,
  WriteableStreamMessageWriter,
  type DataCallback,
  type Disposable,
  type Message,
  type MessageConnection,
} from "vscode-jsonrpc/node";

export const RequestEnvelope = Schema.Struct({
  jsonrpc: Schema.Literal("2.0"),
  id: Schema.Union([Schema.String, Schema.Int]),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Json),
});

export type RequestEnvelope = typeof RequestEnvelope.Type;

export const NotificationEnvelope = Schema.Struct({
  id: Schema.optionalKey(Schema.Never),
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.String,
  params: Schema.optionalKey(Schema.Json),
});

export type NotificationEnvelope = typeof NotificationEnvelope.Type;

const ResponseEnvelope = Schema.Union([
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Union([Schema.String, Schema.Int, Schema.Null]),
    result: Schema.Json,
  }),
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Union([Schema.String, Schema.Int, Schema.Null]),
    error: Schema.Struct({
      code: Schema.Int,
      message: Schema.String,
      data: Schema.optionalKey(Schema.Json),
    }),
  }),
]);

const Envelope = Schema.Union([RequestEnvelope, NotificationEnvelope, ResponseEnvelope]);

const decodeEnvelope = Schema.decodeUnknownEffect(Envelope);

const decodeCancel = Schema.decodeUnknownEffect(
  Schema.Struct({ id: Schema.Union([Schema.String, Schema.Int]) }),
);

export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  reason: Schema.Literals(["Closed", "Framing", "Decode", "Capacity", "IO", "Handler"]),
  cause: Schema.Defect(),
}) {}

export class RpcFailure extends Schema.TaggedError<RpcFailure>()("RpcFailure", {
  code: Schema.Int,
  message: Schema.String,
  data: Schema.optionalKey(Schema.Json),
}) {}

const fault = (reason: TransportError["reason"], cause: unknown = reason) =>
  new TransportError({ reason, cause });

const BODY = 8 * 1024 * 1024;

const HEADER = 8 * 1024;

const isGone = Schema.is(Schema.Struct({ code: Schema.Literal("ESRCH") }));

const isDenied = Schema.is(Schema.Struct({ code: Schema.Literal("EPERM") }));

class ClientProbeError extends Schema.TaggedError<ClientProbeError>()("ClientProbeError", {
  reason: Schema.Literals(["Gone", "Denied", "IO"]),
  cause: Schema.Defect(),
}) {}

// Opaque outside this module: the factory owns the underlying streams and close receipt.
export interface LspIO {
  readonly _tag: "LspIO";
}

interface NativeLspIO {
  readonly input: Readable;
  readonly output: Writable;
  readonly close: Effect.Effect<void>;
}

const bindings = new WeakMap<LspIO, NativeLspIO>();

export const stdioLspIO = Effect.sync((): LspIO => {
  const handle: LspIO = { _tag: "LspIO" };
  bindings.set(handle, {
    input: process.stdin,
    output: process.stdout,
    close: Effect.callback<void>((resume) => {
      process.stdin.destroy();

      if (process.stdout.closed || process.stdout.writableFinished) {
        resume(Effect.void);

        return;
      }

      const done = () => resume(Effect.void);
      process.stdout.once("finish", done);
      process.stdout.once("close", done);

      if (!process.stdout.destroyed) process.stdout.end();

      return Effect.sync(() => {
        process.stdout.off("finish", done);
        process.stdout.off("close", done);
      });
    }),
  });

  return handle;
});

export interface LspHandlers<R> {
  readonly request: (message: RequestEnvelope) => Effect.Effect<Schema.Json, RpcFailure, R>;
  readonly notification: (message: NotificationEnvelope) => Effect.Effect<void, never, R>;
}

export interface LspTransport {
  /** Interruption removes an unsent queued publication and its output credits.
   * Once the single stock writer starts a frame, its header/body complete atomically. */
  readonly sendNotification: (
    method: string,
    params: Schema.Json,
  ) => Effect.Effect<void, TransportError>;
  readonly awaitClosed: Effect.Effect<void, TransportError>;
  /** Native IO turn + demand drain + ordered notification completion. Call before
   * comparing publication revisions, not inside a notification handler. Partial
   * frames are retained; this does not speculate about bytes a peer has not sent. */
  readonly admitPending: Effect.Effect<void, TransportError>;
  /** Registers one scope-owned 250 ms liveness observation loop and returns.
   * Null skips registration; disappearance closes the adapter. EPERM means alive,
   * while invalid IDs and unknown probe faults fail with structural errors. */
  readonly watchClient: (processId: number | null) => Effect.Effect<void, TransportError>;
  readonly close: Effect.Effect<void>;
}

/** Lazy scoped acquisition. Transient FIFO input credits include queued/running work
 * and response writes (64 frames/8 MiB, 32 requests). Saturation is terminal: edits
 * are never dropped. One decoder and one stock writer run at a time. No retries.
 * The supplied factory owns IO; this scope owns registrations and handler fibers.
 * Non-cancellable foreign promises are observed, and closed guards fence late work.
 */
export const acquireLspTransport = Effect.fnUntraced(function* <E, R, RH>(
  acquireIO: Effect.Effect<LspIO, E, R>,
  handlers: LspHandlers<RH>,
): Effect.fn.Return<LspTransport, E | TransportError, R | RH | import("effect").Scope.Scope> {
  let ioClosed = false;

  const releaseIO = (owned: LspIO) =>
    Effect.suspend(() => {
      const binding = bindings.get(owned);

      if (ioClosed || !binding) return Effect.void;
      ioClosed = true;
      bindings.delete(owned);

      return binding.close;
    });

  const handle = yield* Effect.acquireRelease(acquireIO, releaseIO);
  const io = bindings.get(handle);

  if (!io) return yield* fault("IO", "IO handle was not acquired by this boundary");
  const ownerScope = yield* Effect.scope;
  let clientMonitor: Fiber.Fiber<void, TransportError> | undefined;
  const fibers = yield* FiberSet.make<unknown, unknown>();
  const run = yield* FiberSet.runtimePromise(fibers)<RH>();
  const fork = yield* FiberSet.runtime(fibers)<RH>();
  let state: "Open" | "Closing" | "Closed" = "Open";
  let terminal: TransportError | undefined;
  let connection: MessageConnection;
  let dispatch: Message | undefined;
  const listeners: Disposable[] = [];
  const closedWaiters = new Set<(error: TransportError | undefined) => void>();
  // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
  let notificationTail = Promise.resolve();
  const credits = new Map<Message, { bytes: number; request: boolean; end: number }>();
  const checkpoints = new Set<() => void>();
  const notificationFiberIds = new Set<number>();
  let totalRead = 0;
  let decodingEnd = 0;
  const requests = new Map<string, RequestEnvelope>();
  const notifications = new Map<Message, NotificationEnvelope>();
  const bypass = new Map<string, Message>();
  let inputBytes = 0;
  let outputBytes = 0;
  let outputCount = 0;
  let notificationAdmission: AbortSignal | undefined;
  let activeWrite: Promise<void> | undefined;

  const pending: Array<{
    message: Message;
    bytes: Uint8Array;
    started: boolean;
    detach: () => void;
    resolve: () => void;
    reject: (cause: unknown) => void;
  }> = [];

  const encoded = new WeakMap<Message, Uint8Array>();
  const key = (id: string | number) => String(id); // maintained connection uses string keys too

  const release = (message: Message) => {
    const credit = credits.get(message);

    if (!credit) return;
    credits.delete(message);
    notifications.delete(message);
    inputBytes -= credit.bytes;

    if (credit.request && "id" in message) requests.delete(String(message.id));

    for (const check of checkpoints) check();
  };

  const stop = (error?: TransportError) => {
    if (state !== "Open") return;
    terminal = error;
    state = "Closing";
    io.input.pause();

    if (error) process.stderr.write(`effx lsp transport: ${error.reason}\n`);

    clientMonitor?.interruptUnsafe();

    for (const fiber of fibers.state._tag === "Open" ? fibers.state.backing : [])
      fiber.interruptUnsafe();

    for (const item of pending.splice(0)) {
      item.detach();
      item.reject(error ?? fault("Closed"));
    }

    for (const waiter of closedWaiters) waiter(terminal);
    closedWaiters.clear();

    for (const check of checkpoints) check();
  };

  const on = (
    stream: Readable | Writable,
    event: string,
    listener: (...args: unknown[]) => void,
  ): Disposable => {
    stream.on(event, listener);

    const disposable = {
      dispose: () => {
        stream.off(event, listener);
      },
    };

    listeners.push(disposable);

    return disposable;
  };

  const facade: RAL.WritableStream = {
    onClose: (listener) => on(io.output, "close", listener),
    onError: (listener) => on(io.output, "error", listener),
    onEnd: (listener) => on(io.output, "finish", listener),
    write: (data: Uint8Array | string) =>
      // oxlint-disable-next-line effect/no-native-promise-control-flow, effecttsgo/new-promise -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
      new Promise<void>((resolve, reject) => {
        if (state === "Closed" || io.output.destroyed) {
          reject(fault("Closed"));

          return;
        }
        // Closing may finish only the already active frame, never start another.

        io.output.write(data, (error) => (error ? reject(error) : resolve()));
      }),
    end: () => {}, // the root closes IO after bounded active-frame drain
  };

  const stock = new WriteableStreamMessageWriter(facade, {
    charset: "utf-8",
    contentTypeEncoder: {
      name: "application/json",
      encode: (message) => {
        const bytes = encoded.get(message);

        // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
        return bytes ? Promise.resolve(bytes) : Promise.reject(fault("Closed"));
      },
    },
  });

  const drain = () => {
    if (activeWrite || state !== "Open") return;
    const item = pending.shift();

    if (!item) return;
    item.started = true;
    item.detach();
    encoded.set(item.message, item.bytes);
    activeWrite = stock.write(item.message).then(
      () => {
        if (state === "Closed") {
          item.reject(fault("Closed"));

          return;
        }

        encoded.delete(item.message);
        outputCount--;
        outputBytes -= item.bytes.byteLength;

        if (state !== "Closed") {
          if ("id" in item.message) {
            const original = bypass.get(String(item.message.id));

            if (original) {
              bypass.delete(String(item.message.id));
              release(original);
            }
          }

          item.resolve();
        } else item.reject(fault("Closed"));
        activeWrite = undefined;
        drain();
      },
      (cause) => {
        if (state === "Closed") {
          item.reject(fault("Closed"));

          return;
        }

        item.reject(fault("IO", cause));
        activeWrite = undefined;
        stop(fault("IO", cause));
      },
    );
  };

  class Writer extends AbstractMessageWriter {
    write(message: Message): Promise<void> {
      // Maintained sendNotification invokes this writer synchronously. Capture
      // only that call's signal; mandatory response writes have no admission signal.
      const signal = notificationAdmission;

      // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
      if (state !== "Open") return Promise.reject(fault("Closed"));

      if (outputCount >= 32) {
        stop(fault("Capacity"));

        // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
        return Promise.reject(fault("Capacity"));
      }

      outputCount++;

      if (signal?.aborted) {
        outputCount--;

        // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: interrupted publication admits no frame.
        return Promise.resolve();
      }

      return RAL()
        .applicationJson.encoder.encode(message, { charset: "utf-8" })
        .then(
          (bytes) => {
            if (state !== "Open") throw fault("Closed");

            if (signal?.aborted) {
              outputCount--;

              return;
            }

            if (bytes.byteLength > BODY || outputBytes + bytes.byteLength > BODY) {
              stop(fault("Capacity"));
              throw fault("Capacity");
            }

            outputBytes += bytes.byteLength;

            // oxlint-disable-next-line effect/no-native-promise-control-flow, effecttsgo/new-promise -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
            return new Promise<void>((resolve, reject) => {
              const cancel = () => {
                if (item.started || state === "Closed") return;

                const index = pending.indexOf(item);

                if (index === -1) return;

                pending.splice(index, 1);
                outputCount--;
                outputBytes -= bytes.byteLength;
                item.detach();
                // The calling Effect is interrupted. Fulfill the native ABI so
                // its logger does not turn intentional cancellation into a fault.
                resolve();
              };

              const item = {
                message,
                bytes,
                resolve,
                reject,
                started: false,
                detach: () => {
                  signal?.removeEventListener("abort", cancel);
                },
              };

              signal?.addEventListener("abort", cancel, { once: true });
              pending.push(item);
              drain();
            });
          },
          (cause) => {
            stop(fault("Decode", cause));
            throw fault("Decode", cause);
          },
        );
    }
    end(): void {
      stop();
    }
  }

  const writer = new Writer();
  const buffer = RAL().messageBuffer.create("utf-8");

  if (!(buffer instanceof AbstractMessageBuffer))
    return yield* fault("Framing", "Unsupported maintained message buffer");
  let length: number | undefined;
  let decoding = false;
  let eof = false;
  let callback: DataCallback | undefined;

  const accept = (message: typeof Envelope.Type, bytes: number, end: number) => {
    if (state !== "Open" || !callback) return;
    const request = "method" in message && "id" in message && message.id !== undefined;

    if (request && (requests.size >= 32 || requests.has(key(message.id)))) {
      stop(fault("Capacity"));

      return;
    }

    if (credits.size >= 64 || inputBytes + bytes > BODY) {
      stop(fault("Capacity"));

      return;
    }

    credits.set(message, { bytes, request, end });
    inputBytes += bytes;

    if (request) requests.set(key(message.id), message);
    else if ("method" in message) notifications.set(message, message);

    if ("method" in message && message.method === "$/cancelRequest") {
      run(decodeCancel(message.params)).then(
        (cancel) => {
          if (state !== "Open") return;

          if (requests.has(key(cancel.id))) callback?.(message);
          release(message); // cancellation callback bypasses ordinary MessageStrategy
        },
        (cause) => stop(fault("Decode", cause)),
      );

      return;
    }

    callback(message);

    if (!("method" in message)) release(message); // limited-parallelism response fast path
  };

  const pump = () => {
    if (decoding || state !== "Open" || !callback) return;

    try {
      while (state === "Open") {
        if (length === undefined) {
          const before = buffer.numberOfBytes;
          const headers = buffer.tryReadHeaders(true);

          if (headers) {
            if (before - buffer.numberOfBytes > HEADER) {
              stop(fault("Framing"));

              return;
            }

            const raw = headers.get("content-length");
            const contentType = headers.get("content-type");

            if (
              !raw ||
              !/^(0|[1-9][0-9]*)$/.test(raw) ||
              raw.length > 8 ||
              (contentType !== undefined &&
                !/^application\/(?:vscode-jsonrpc|json)(?:\s*;\s*charset=(?:utf-8|utf8))?$/i.test(
                  contentType,
                ))
            ) {
              stop(fault("Framing"));

              return;
            }

            length = Number(raw);

            if (length > BODY) {
              stop(fault("Framing"));

              return;
            }
          } else if (buffer.numberOfBytes >= HEADER) {
            stop(fault("Framing"));

            return;
          }
        }

        if (length !== undefined) {
          const body = buffer.tryReadBody(length);

          if (body) {
            const bytes = length;
            length = undefined;
            decoding = true;
            decodingEnd = totalRead - buffer.numberOfBytes;
            RAL()
              .applicationJson.decoder.decode(body, { charset: "utf-8" })
              .then((value) =>
                run(decodeEnvelope(value)).then((message) => {
                  if (state === "Open") accept(message, bytes, decodingEnd);
                }),
              )
              .then(
                () => {
                  decoding = false;
                  pump();

                  for (const check of checkpoints) check();
                },
                (cause) => stop(fault("Decode", cause)),
              );

            return;
          }
        }

        const need = (length ?? HEADER) - buffer.numberOfBytes;
        const available = io.input.readableLength;

        if (available === 0) {
          if (eof)
            stop(buffer.numberOfBytes !== 0 || length !== undefined ? fault("Framing") : undefined);

          return;
        }

        const chunk: unknown = io.input.read(Math.min(64 * 1024, need, available));

        if (!(chunk instanceof Uint8Array)) {
          stop(fault("IO"));

          return;
        }

        buffer.append(chunk);
        totalRead += chunk.byteLength;
      }
    } catch (cause) {
      stop(fault("Framing", cause));
    }
  };

  class Reader extends AbstractMessageReader {
    listen(next: DataCallback): Disposable {
      callback = next;
      pump();

      return {
        dispose: () => {
          callback = undefined;
        },
      };
    }
  }

  const reader = new Reader();
  connection = createMessageConnection(
    reader,
    writer,
    {
      error: () => stop(fault("Handler")),
      warn: () => {},
      info: () => {},
      log: () => {},
    },
    {
      maxParallelism: 32,
      connectionStrategy: {
        cancelUndispatched: (message) => {
          if (message.id === null) {
            stop(fault("Decode"));

            return undefined;
          }

          bypass.set(key(message.id), message);

          return {
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32800, message: "Request cancelled" },
          };
        },
      },
      messageStrategy: {
        handleMessage: (message, next) => {
          // Invocation itself must be inside the observed promise, not outside finally.
          // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
          return Promise.resolve()
            .then(() => {
              dispatch = message;

              return next(message);
            })
            .then(
              () => {
                if (state !== "Closed") release(message);
              },
              (cause) => {
                stop(fault("Handler", cause));
              },
            );
        },
      },
    },
  );
  connection.onRequest((_method, _params, token) => {
    // The strategy dispatches one request synchronously before invoking this ABI.
    const message = dispatch && "id" in dispatch ? requests.get(String(dispatch.id)) : undefined;

    if (!message || state !== "Open")
      // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
      return Promise.resolve(new ResponseError(-32800, "Request cancelled"));
    const fiber = fork(Effect.suspend(() => handlers.request(message)));
    const disposable = token.onCancellationRequested(() => fiber.interruptUnsafe());

    if (token.isCancellationRequested) fiber.interruptUnsafe();

    // oxlint-disable-next-line effect/no-native-promise-control-flow, effecttsgo/new-promise -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
    return new Promise<Schema.Json | ResponseError<Schema.Json>>((resolve) => {
      fiber.addObserver((exit) => {
        disposable.dispose();

        if (Exit.isSuccess(exit)) resolve(exit.value);
        else {
          const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");

          if (failure && failure._tag === "Fail")
            resolve(
              new ResponseError(failure.error.code, failure.error.message, failure.error.data),
            );
          else {
            if (exit.cause.reasons.some((reason) => reason._tag === "Die")) stop(fault("Handler"));
            resolve(new ResponseError(-32800, "Request cancelled"));
          }
        }
      });
    });
  });
  connection.onNotification(() => {
    const message = dispatch ? notifications.get(dispatch) : undefined;

    // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
    if (!message || state !== "Open") return Promise.resolve();
    notificationTail = notificationTail
      .then(() => {
        if (state !== "Open") return;

        return run(
          Effect.withFiber((fiber) => {
            notificationFiberIds.add(fiber.id);

            return handlers.notification(message).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  notificationFiberIds.delete(fiber.id);
                }),
              ),
            );
          }),
        );
      })
      .catch((cause) => {
        stop(fault("Handler", cause));
      });

    return notificationTail;
  });
  io.input.pause();
  on(io.input, "readable", pump);
  on(io.input, "end", () => {
    eof = true;
    pump();
  });
  on(io.input, "close", () => stop());
  on(io.input, "error", (cause) => stop(fault("IO", cause)));
  on(io.output, "error", (cause) => stop(fault("IO", cause)));
  on(io.output, "close", () => stop());
  const interrupt = () => stop();
  process.on("SIGINT", interrupt);
  listeners.push({
    dispose: () => {
      process.off("SIGINT", interrupt);
    },
  });
  connection.listen();

  const close = Effect.gen(function* () {
    if (state === "Closed") return;
    stop();

    if (clientMonitor) {
      yield* Fiber.interrupt(clientMonitor);
      clientMonitor = undefined;
    }

    yield* FiberSet.clear(fibers);

    if (activeWrite) {
      const frame = activeWrite;
      const drained = yield* Effect.promise(() => frame).pipe(Effect.timeoutOption("2 seconds"));

      if (drained._tag === "None") {
        state = "Closed";
        io.output.destroy();
      }
    }

    state = "Closed";
    connection.dispose();
    stock.dispose();
    reader.dispose();
    writer.dispose();

    for (const disposable of listeners.splice(0)) disposable.dispose();
    credits.clear();
    requests.clear();
    notifications.clear();
    bypass.clear();
    yield* releaseIO(handle);
  });

  yield* Effect.addFinalizer(() => close);

  const awaitClosed = Effect.callback<void, TransportError>((resume) => {
    const done = (error: TransportError | undefined) =>
      resume(error ? Effect.fail(error) : Effect.void);

    if (state !== "Open") done(terminal);
    else closedWaiters.add(done);

    return Effect.sync(() => {
      closedWaiters.delete(done);
    });
  });

  const admitPending = Effect.withFiber((fiber) => {
    if (notificationFiberIds.has(fiber.id))
      return Effect.fail(fault("Handler", "Notification checkpoint would await itself"));

    return Effect.callback<void, TransportError>((resume) => {
      let scheduled: Disposable | undefined;
      let watermark: number | undefined;
      let disposed = false;

      const check = () => {
        if (disposed) return;

        if (state !== "Open") {
          resume(Effect.fail(terminal ?? fault("Closed")));

          return;
        }

        if (watermark === undefined) return;

        const preceding = [...credits.values()].some(
          (credit) => !credit.request && credit.end <= watermark!,
        );

        if (!(decoding && decodingEnd <= watermark) && !preceding) resume(Effect.void);
      };

      checkpoints.add(check);
      // EX-0030: owned native turn, not an Effect scheduler yield. The byte
      // watermark includes only currently readable ingress and retained bytes.
      scheduled = RAL().timer.setImmediate(() => {
        if (disposed || state !== "Open") {
          check();

          return;
        }

        watermark = totalRead + Math.min(io.input.readableLength, BODY + HEADER);
        pump();
        check();
      });

      return Effect.sync(() => {
        disposed = true;
        scheduled?.dispose();
        checkpoints.delete(check);
      });
    });
  });

  let watchedClient: number | undefined;

  const watchClient = Effect.fnUntraced(function* (processId: number | null) {
    if (processId === null) return;

    if (state !== "Open") return yield* fault("Closed");

    if (
      !Number.isSafeInteger(processId) ||
      processId <= 0 ||
      (watchedClient !== undefined && watchedClient !== processId)
    ) {
      const error = fault("IO", "Invalid or changed client process ID");
      stop(error);

      return yield* error;
    }

    if (watchedClient === processId) return;

    const probe = Effect.try({
      try: () => process.kill(processId, 0),
      catch: (cause) =>
        new ClientProbeError({
          reason: isGone(cause) ? "Gone" : isDenied(cause) ? "Denied" : "IO",
          cause,
        }),
    }).pipe(
      Effect.catchTag("ClientProbeError", (error) =>
        error.reason === "Denied"
          ? Effect.succeed(true)
          : Effect.fail(fault(error.reason === "Gone" ? "Closed" : "IO", error.cause)),
      ),
    );

    const initial = yield* Effect.exit(probe);

    if (Exit.isFailure(initial)) {
      const failure = initial.cause.reasons.find(Cause.isFailReason);

      if (failure) stop(failure.error);

      return yield* Effect.failCause(initial.cause);
    }

    watchedClient = processId;
    clientMonitor = yield* Effect.forkIn(
      Effect.gen(function* () {
        while (state === "Open") {
          yield* Effect.sleep("250 millis");

          if (state !== "Open") return;
          const observed = yield* Effect.exit(probe);

          if (Exit.isFailure(observed)) {
            const failure = observed.cause.reasons.find(Cause.isFailReason);

            if (!failure) return yield* Effect.failCause(observed.cause);
            stop(failure.error.reason === "Closed" ? undefined : failure.error);

            return;
          }
        }
      }).pipe(Effect.interruptible),
      ownerScope,
    );
  }, Effect.uninterruptible);

  return {
    close,
    awaitClosed,
    admitPending,
    watchClient,
    sendNotification: Effect.fnUntraced(function* (method: string, params: Schema.Json) {
      yield* Effect.tryPromise({
        try: (signal) => {
          notificationAdmission = signal;

          try {
            return connection.sendNotification(method, params);
          } finally {
            notificationAdmission = undefined;
          }
        },
        catch: (cause) => fault("IO", cause),
      });
    }),
  } satisfies LspTransport;
});
