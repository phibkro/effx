// EX-0030: maintained JSON-RPC ABI; native authority is injected by the root.
import { Cause, Context, Effect, Exit, Fiber, Predicate, Result, Schema, Semaphore } from "effect";
import {
  AbstractMessageBuffer,
  AbstractMessageReader,
  AbstractMessageWriter,
  createMessageConnection,
  RAL,
  ResponseError,
  WriteableStreamMessageWriter,
  ErrorCodes,
  type DataCallback,
  type Disposable,
  Message,
  type MessageConnection,
  type ResponseMessage,
} from "vscode-jsonrpc";

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

export class ClientProbeError extends Schema.TaggedError<ClientProbeError>()("ClientProbeError", {
  reason: Schema.Literals(["Gone", "Denied", "IO"]),
  cause: Schema.Defect(),
}) {}

/** One root-owned scoped FiberSet bridges the maintained callback ABI.
 * clear interrupts and joins every callback fiber before its owner releases. */
export interface LspCallbackRuntime<R> {
  readonly run: <A, E>(effect: Effect.Effect<A, E, R>) => Promise<A>;
  readonly fork: <A, E>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>;
  readonly clear: Effect.Effect<void>;
}

/** Root-acquired exclusive IO; no native handle crosses this boundary.
 * read immediately checks readiness and reads at most maxBytes (1..65536): empty
 * bytes mean not ready, null means EOF. Backing storage is bounded and remains
 * valid until consumed. turn awaits an interruptible native IO turn, not future
 * input. The root installs this maintained RAL for stock internals. close is
 * total and idempotent, terminates outstanding IO and owns its bounded drain.
 * Methods are lazy. No retry, durable state or implicit runtime is introduced. */
export interface LspIO {
  readonly ral: ReturnType<typeof RAL>;
  readonly read: (maxBytes: number) => Effect.Effect<Uint8Array | null, TransportError>;
  readonly write: (data: Uint8Array | string) => Effect.Effect<void, TransportError>;
  readonly close: Effect.Effect<void>;
  readonly probePid: (pid: number) => Effect.Effect<void, ClientProbeError>;
  readonly turn: Effect.Effect<void>;
  readonly makeCallbackRuntime: <R>() => Effect.Effect<
    LspCallbackRuntime<R>,
    never,
    R | import("effect").Scope.Scope
  >;
}

/** The process root selects and provides the real native backend. */
export class LspPlatform extends Context.Service<
  LspPlatform,
  {
    readonly acquireIO: Effect.Effect<LspIO, TransportError, import("effect").Scope.Scope>;
  }
>()("@effx/cli/lsp-transport/LspPlatform") {}

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
 * and response writes (64 frames/8 MiB, 32 requests). Excess requests get correlated
 * -32000 replies without dispatch; duplicate identities get -32600/id:null. Complete
 * JSON/envelope errors get -32700/-32600 through the bounded writer and decoding
 * waits for its native completion. Unsafe byte/message/output saturation is terminal:
 * edits are never dropped. One decoder and one stock writer run at a time. No retries.
 * The supplied factory owns IO; this scope owns one demand fiber, the client
 * monitor and handler lifetimes. The root owns the one callback runtime.
 * Non-cancellable foreign promises are observed, and closed guards fence late work.
 */
export const acquireLspTransport = Effect.fnUntraced(function* <E, R, RH>(
  acquireIO: Effect.Effect<LspIO, E, R>,
  handlers: LspHandlers<RH>,
): Effect.fn.Return<LspTransport, E | TransportError, R | RH | import("effect").Scope.Scope> {
  let ioClosed = false;

  const releaseIO = (owned: LspIO) =>
    Effect.suspend(() => {
      if (ioClosed) return Effect.void;
      ioClosed = true;

      return owned.close;
    });

  const io = yield* Effect.acquireRelease(acquireIO, releaseIO);
  const ownerScope = yield* Effect.scope;
  let clientMonitor: Fiber.Fiber<void, TransportError> | undefined;
  let inputFiber: Fiber.Fiber<void> | undefined;
  const runtime = yield* io.makeCallbackRuntime<RH>();
  const { run, fork } = runtime;
  const ingress = yield* Semaphore.make(1);
  let state: "Open" | "Closing" | "Closed" = "Open";

  // Foreign callbacks can change lifecycle after an earlier check. Every use
  // reads current state; no async continuation inherits a stale open guarantee.
  const isClosed = () => state === "Closed";

  let terminal: TransportError | undefined;
  let connection: MessageConnection;
  let dispatch: Message | undefined;
  const closedWaiters = new Set<(error: TransportError | undefined) => void>();
  const handlerFibers = new Set<Fiber.Fiber<unknown, unknown>>();
  // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
  let notificationTail = Promise.resolve();

  // Request evidence is retained from the single ingress Schema decode. Public
  // maintained Message callbacks need not expose an id to correlate this credit.
  const credits = new Map<
    Message,
    { bytes: number; request: RequestEnvelope | undefined; end: number }
  >();

  const checkpoints = new Set<() => void>();
  const notificationFiberIds = new Set<number>();
  let totalRead = 0;
  let decodingEnd = 0;
  const requests = new Map<string | number, RequestEnvelope>();
  const notifications = new Map<Message, NotificationEnvelope>();
  const bypass = new Map<string | number, Message>();
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
  // EX-0030: stock 9.0.3 queue keys stringify IDs (connection.js:352-356).
  // Injective internal prefixes retain distinct numeric/string identities; wire
  // and domain IDs are restored from the existing decoded credit, not parsed.
  const nativeRequestId = (id: string | number) => `${Predicate.isNumber(id) ? "n" : "s"}:${id}`;

  const release = (message: Message) => {
    const credit = credits.get(message);

    if (!credit) return;
    credits.delete(message);
    notifications.delete(message);
    inputBytes -= credit.bytes;

    if (credit.request) requests.delete(credit.request.id);

    for (const check of checkpoints) check();
  };

  const stop = (error?: TransportError) => {
    if (state !== "Open") return;
    terminal = error;
    state = "Closing";
    clientMonitor?.interruptUnsafe();
    inputFiber?.interruptUnsafe();
    // Keep the active stock frame alive; only handlers are cancelled here.

    for (const fiber of handlerFibers) fiber.interruptUnsafe();

    for (const item of pending.splice(0)) {
      item.detach();
      item.reject(error ?? fault("Closed"));
    }

    for (const waiter of closedWaiters) waiter(terminal);
    closedWaiters.clear();

    for (const check of checkpoints) check();
  };

  const facade: RAL.WritableStream = {
    // Effect write completion is the sole IO failure/completion witness.
    onClose: () => ({ dispose: () => {} }),
    onError: () => ({ dispose: () => {} }),
    onEnd: () => ({ dispose: () => {} }),
    write: (data: Uint8Array | string) =>
      run(Effect.suspend(() => (isClosed() ? Effect.fail(fault("Closed")) : io.write(data)))),
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
        if (isClosed()) {
          item.reject(fault("Closed"));

          return;
        }

        encoded.delete(item.message);
        outputCount--;
        outputBytes -= item.bytes.byteLength;

        if (!isClosed()) {
          if (Message.isResponse(item.message) && item.message.id !== null) {
            const original = bypass.get(item.message.id);

            if (original) {
              bypass.delete(item.message.id);
              release(original);
            }
          }

          item.resolve();
        } else item.reject(fault("Closed"));
        activeWrite = undefined;
        drain();
      },
      (cause) => {
        if (isClosed()) {
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
    write(message: Message, restoreRequestId = true): Promise<void> {
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

      let outgoing = message;

      if (restoreRequestId && Message.isResponse(message)) {
        for (const credit of credits.values()) {
          if (credit.request && nativeRequestId(credit.request.id) === message.id) {
            const restored: ResponseMessage = { ...message, id: credit.request.id };
            outgoing = restored;

            break;
          }
        }
      }

      return io.ral.applicationJson.encoder.encode(outgoing, { charset: "utf-8" }).then(
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
              if (item.started || isClosed()) return;

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
              message: outgoing,
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

  // Recovery and overload replies share the existing finite mandatory writer.
  // The decoder waits for their native write completion, admitting no extra jobs.
  const protocolError = (id: string | number | null, code: number, message: string) => {
    const response: ResponseMessage = {
      jsonrpc: "2.0",
      id,
      error: new ResponseError(code, message).toJson(),
    };

    return writer.write(response, false);
  };

  const buffer = io.ral.messageBuffer.create("utf-8");

  if (!(buffer instanceof AbstractMessageBuffer))
    return yield* fault("Framing", "Unsupported maintained message buffer");
  let length: number | undefined;
  let decoding = false;
  let callback: DataCallback | undefined;

  const accept = (message: typeof Envelope.Type, bytes: number, end: number) => {
    if (state !== "Open" || !callback) return;
    const request = "method" in message && "id" in message && message.id !== undefined;

    const duplicate = request && requests.has(message.id);
    const excess = request && requests.size >= 32;

    if (credits.size >= 64 || inputBytes + bytes > BODY) {
      stop(fault("Capacity"));

      return;
    }

    const incoming =
      request && !duplicate && !excess ? { ...message, id: nativeRequestId(message.id) } : message;

    credits.set(incoming, {
      bytes,
      request: request && !duplicate && !excess ? message : undefined,
      end,
    });
    inputBytes += bytes;

    if (duplicate)
      return protocolError(
        null,
        ErrorCodes.InvalidRequest,
        "Duplicate outstanding request ID",
      ).then(() => release(incoming));

    if (excess)
      return protocolError(message.id, -32000, "Outstanding request capacity exceeded").then(() =>
        release(incoming),
      );

    if (request) requests.set(message.id, message);
    else if ("method" in message) notifications.set(incoming, message);

    if ("method" in message && message.method === "$/cancelRequest") {
      run(decodeCancel(message.params)).then(
        (cancel) => {
          if (state !== "Open") return;

          if (requests.has(cancel.id)) {
            const cancellation = { ...message, params: { id: nativeRequestId(cancel.id) } };
            callback?.(cancellation);
          }

          release(incoming); // cancellation callback bypasses ordinary MessageStrategy
        },
        (cause) => stop(fault("Decode", cause)),
      );

      return;
    }

    callback(incoming);

    if (!("method" in message)) release(incoming); // limited-parallelism response fast path
  };

  // One demand owner and at most 32 request checkpoints share this permit.
  // Each turn consumes at most BODY+HEADER bytes, even under continuous input.
  const pump = Effect.fnUntraced(function* () {
    if (state !== "Open" || !callback) return;
    const start = totalRead;

    while (state === "Open") {
      if (length === undefined) {
        const before = buffer.numberOfBytes;

        const headers = yield* Effect.try({
          try: () => buffer.tryReadHeaders(true),
          catch: (cause) => fault("Framing", cause),
        });

        if (headers) {
          if (before - buffer.numberOfBytes > HEADER) return yield* fault("Framing");
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
          )
            return yield* fault("Framing");

          length = Number(raw);

          if (length > BODY) return yield* fault("Framing");
        } else if (buffer.numberOfBytes >= HEADER) return yield* fault("Framing");
      }

      if (length !== undefined) {
        const body = buffer.tryReadBody(length);

        if (body) {
          const bytes = length;
          length = undefined;
          decoding = true;
          decodingEnd = totalRead - buffer.numberOfBytes;

          const json = yield* Effect.result(
            Effect.tryPromise({
              try: () => io.ral.applicationJson.decoder.decode(body, { charset: "utf-8" }),
              catch: (cause) => fault("Decode", cause),
            }),
          );

          if (state !== "Open") return;

          if (Result.isFailure(json)) {
            yield* Effect.tryPromise({
              try: () => protocolError(null, ErrorCodes.ParseError, "Parse error"),
              catch: (cause) => fault("IO", cause),
            });
          } else {
            const decoded = yield* Effect.result(decodeEnvelope(json.success));
            yield* Effect.tryPromise({
              try: () => {
                if (Result.isSuccess(decoded)) {
                  return Promise.resolve(accept(decoded.success, bytes, decodingEnd));
                }

                return protocolError(null, ErrorCodes.InvalidRequest, "Invalid request envelope");
              },
              catch: (cause) => fault("IO", cause),
            });
          }

          decoding = false;

          for (const check of checkpoints) check();

          continue;
        }
      }

      const remaining = BODY + HEADER - (totalRead - start);

      if (remaining === 0) return;

      const need = (length ?? HEADER) - buffer.numberOfBytes;
      const max = Math.min(65536, need, remaining);
      const chunk = yield* io.read(max);

      if (state !== "Open") return;

      if (chunk === null) {
        stop(buffer.numberOfBytes !== 0 || length !== undefined ? fault("Framing") : undefined);

        return;
      }

      if (
        !(chunk instanceof Uint8Array) ||
        chunk.byteLength > max ||
        chunk.buffer.byteLength > 65536
      )
        return yield* fault("IO", "Read capability exceeded its bound");

      if (chunk.byteLength === 0) return;

      buffer.append(chunk);
      totalRead += chunk.byteLength;
    }
  });

  class Reader extends AbstractMessageReader {
    listen(next: DataCallback): Disposable {
      callback = next;

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
          const request = credits.get(message)?.request;

          if (!request) {
            stop(fault("Decode"));

            return undefined;
          }

          bypass.set(request.id, message);

          return {
            jsonrpc: "2.0",
            id: request.id,
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
                if (!isClosed()) release(message);
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
    const message = dispatch ? credits.get(dispatch)?.request : undefined;

    if (!message || state !== "Open")
      // oxlint-disable-next-line effect/no-native-promise-control-flow -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
      return Promise.resolve(new ResponseError(-32800, "Request cancelled"));
    const fiber = fork(Effect.suspend(() => handlers.request(message)));
    handlerFibers.add(fiber);
    const disposable = token.onCancellationRequested(() => fiber.interruptUnsafe());

    if (token.isCancellationRequested) fiber.interruptUnsafe();

    // oxlint-disable-next-line effect/no-native-promise-control-flow, effecttsgo/new-promise -- EX-0030: maintained stdio Promise ABI has one scoped owner and guarded late settlements.
    return new Promise<Schema.Json | ResponseError<Schema.Json>>((resolve) => {
      fiber.addObserver((exit) => {
        handlerFibers.delete(fiber);
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
            handlerFibers.add(fiber);

            return handlers.notification(message).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  notificationFiberIds.delete(fiber.id);
                  handlerFibers.delete(fiber);
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
  connection.listen();
  inputFiber = yield* Effect.forkIn(
    Effect.gen(function* () {
      while (state === "Open") {
        yield* ingress.withPermit(pump());

        if (state === "Open") yield* io.turn;
      }
    }).pipe(
      Effect.catchTag("TransportError", (error) => Effect.sync(() => stop(error))),
      Effect.interruptible,
    ),
    ownerScope,
  );

  const close = Effect.gen(function* () {
    if (isClosed()) return;
    stop();

    if (clientMonitor) {
      yield* Fiber.interrupt(clientMonitor);
      clientMonitor = undefined;
    }

    if (inputFiber) {
      yield* Fiber.interrupt(inputFiber);
      inputFiber = undefined;
    }
    // Join cancelled domain finalizers without interrupting native frame writes.

    yield* Effect.forEach(handlerFibers, (fiber) => Fiber.interrupt(fiber), { concurrency: 32 });

    if (activeWrite) {
      const frame = activeWrite;
      const drained = yield* Effect.promise(() => frame).pipe(Effect.timeoutOption("2 seconds"));

      if (drained._tag === "None") {
        state = "Closed";
        yield* releaseIO(io);
      }
    }

    state = "Closed";
    connection.dispose();
    stock.dispose();
    reader.dispose();
    writer.dispose();

    credits.clear();
    requests.clear();
    notifications.clear();
    bypass.clear();
    yield* releaseIO(io);
    yield* runtime.clear;
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

    return Effect.gen(function* () {
      if (state !== "Open") return yield* terminal ?? fault("Closed");

      yield* io.turn;
      // Exclusive demand captures ready bytes, never waits for future bytes.

      const watermark = yield* ingress.withPermit(
        Effect.gen(function* () {
          yield* Effect.uninterruptible(pump());

          return totalRead;
        }),
      );

      yield* Effect.callback<void, TransportError>((resume) => {
        const check = () => {
          if (state !== "Open") {
            resume(Effect.fail(terminal ?? fault("Closed")));

            return;
          }

          const preceding = [...credits.values()].some(
            (credit) => !credit.request && credit.end <= watermark,
          );

          if (!(decoding && decodingEnd <= watermark) && !preceding) resume(Effect.void);
        };

        checkpoints.add(check);
        check();

        return Effect.sync(() => {
          checkpoints.delete(check);
        });
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

    const probe = io
      .probePid(processId)
      .pipe(
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
