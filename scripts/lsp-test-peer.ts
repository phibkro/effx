// EX-0030: real subprocess/client composition root; no vendor or native handles
// escape into the behavior suite. Microsoft maintained client is the wire oracle.
// EX-0030: the real subprocess/client composition root is outside packages.
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import process from "node:process";
import { Cause, Deferred, Effect, Exit, Fiber, Predicate, Schema } from "effect";
import { BunRuntime } from "@effect/platform-bun";
import { acquireLinuxLspIO } from "./lsp-linux.js";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  CancellationTokenSource,
  RAL,
  AbstractMessageBuffer,
  WriteableStreamMessageWriter,
  ResponseError,
  type Message,
} from "vscode-languageserver-protocol/node";
import { acquireLspTransport, RpcFailure, TransportError, type LspTransport } from "@effx/cli";

export class PeerError extends Schema.TaggedError<PeerError>()("PeerError", {
  cause: Schema.Defect(),
}) {}

const decodeJson = Schema.decodeUnknownEffect(Schema.Json);

const isJson = Schema.is(Schema.Json);

const ResponseFailure = Schema.Struct({
  code: Schema.Int,
  message: Schema.String,
  data: Schema.optionalKey(Schema.Json),
});

const isNullProtocolError = Schema.is(
  Schema.Struct({ jsonrpc: Schema.Literal("2.0"), id: Schema.Null, error: ResponseFailure }),
);

const WireResponse = Schema.Union([
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Union([Schema.String, Schema.Int, Schema.Null]),
    result: Schema.Json,
  }),
  Schema.Struct({
    jsonrpc: Schema.Literal("2.0"),
    id: Schema.Union([Schema.String, Schema.Int, Schema.Null]),
    error: ResponseFailure,
  }),
]);

const isWireResponse = Schema.is(WireResponse);

const decodeResponseFailure = Schema.decodeUnknownEffect(ResponseFailure);

const decodeClient = Schema.decodeUnknownEffect(
  Schema.Struct({ processId: Schema.Union([Schema.Int, Schema.Null]) }),
);

const decodeBurst = Schema.decodeUnknownEffect(
  Schema.Struct({ mode: Schema.Union([Schema.Null, Schema.Literal("count")]) }),
);

export interface PeerLaunch {
  readonly cwd: string;
  readonly main?: string;
  /** Full actual CLI arguments, including the lsp subcommand. */
  readonly args: ReadonlyArray<string>;
}

export const maintainedBufferLaw = Effect.sync(() => {
  const buffer = RAL().messageBuffer.create("utf-8");

  if (!(buffer instanceof AbstractMessageBuffer)) return false;
  // The native RAL requires Buffer for its prefix slice ABI. Two coalesced
  // bodies catch a header read that accidentally includes the remaining chunk.
  const second = 'Content-Length: 4\r\n\r\n"é"';
  buffer.append(Buffer.from(`Content-Length: 2\r\n\r\n{}${second}`, "utf8"));
  const before = buffer.numberOfBytes;
  const headers = buffer.tryReadHeaders(true);
  const body = buffer.tryReadBody(2);
  const remaining = buffer.numberOfBytes;
  const nextHeaders = buffer.tryReadHeaders(true);
  const nextBody = buffer.tryReadBody(4);

  return (
    before > remaining &&
    headers?.get("content-length") === "2" &&
    body?.byteLength === 2 &&
    new TextDecoder().decode(body) === "{}" &&
    remaining === Buffer.byteLength(second, "utf8") &&
    nextHeaders?.get("content-length") === "4" &&
    nextBody?.byteLength === 4 &&
    new TextDecoder().decode(nextBody) === '"é"' &&
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

export const acquirePeer = Effect.fnUntraced(function* (readOutput = true, launch?: PeerLaunch) {
  const child = yield* Effect.acquireRelease(
    Effect.sync(() =>
      spawn(
        process.execPath,
        launch
          ? [launch.main ?? new URL("./effx.ts", import.meta.url).pathname, ...launch.args]
          : [new URL(import.meta.url).pathname, "serve"],
        {
          stdio: ["pipe", "pipe", "pipe"],
          cwd: launch?.cwd,
        },
      ),
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
  const stderrWaiters = new Set<() => void>();

  const stderrListener = (chunk: Uint8Array) => {
    stderr += new TextDecoder().decode(chunk);

    for (const waiter of stderrWaiters) waiter();
  };

  child.stderr.on("data", stderrListener);

  const reader = new StreamMessageReader(child.stdout);
  let protocolErrors = 0;
  let observingProtocol = true;

  const countProtocolError = () => {
    if (observingProtocol && protocolErrors < Number.MAX_SAFE_INTEGER) protocolErrors++;
  };

  const readerError = reader.onError(countProtocolError);

  const protocolResponses: Array<typeof ResponseFailure.Type> = [];
  const protocolResponseWaiters = new Set<() => void>();
  const responseWaiters = new Set<(response: typeof WireResponse.Type) => void>();

  const connection = createMessageConnection(
    reader,
    new StreamMessageWriter(child.stdin),
    undefined,
    {
      messageStrategy: {
        handleMessage: (message, next) => {
          if (isWireResponse(message)) {
            for (const waiter of responseWaiters) waiter(message);
          }

          if (isNullProtocolError(message)) {
            protocolResponses.push(message.error);

            for (const waiter of protocolResponseWaiters) waiter();
          }

          return next(message);
        },
      },
    },
  );

  const connectionError = connection.onError(countProtocolError);

  const childClosed = () => {
    connection.dispose();
  };

  child.on("close", childClosed);

  const notifications: Array<{ method: string; params: Schema.Json }> = [];
  const waiters = new Set<() => void>();
  connection.onNotification((method, params) => {
    const body: unknown = params ?? null;

    if (!isJson(body)) throw new PeerError({ cause: "Invalid peer notification JSON" });
    notifications.push({ method, params: body });

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
      observingProtocol = false;
      readerError.dispose();
      connectionError.dispose();
      connection.dispose();
      child.off("close", childClosed);
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

  const waitNotification = Effect.fnUntraced(function* (
    method: string,
    predicate?: (params: Schema.Json) => boolean,
  ) {
    return yield* Effect.callback<Schema.Json>((resume) => {
      const check = () => {
        const index = notifications.findIndex(
          (message) =>
            message.method === method && (predicate === undefined || predicate(message.params)),
        );

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
    pid: Effect.fromNullishOr(child.pid).pipe(Effect.mapError((cause) => new PeerError({ cause }))),
    // Omitted params use the maintained zero-argument ABI. Explicit JSON values
    // retain its by-name object / by-position scalar and array semantics.
    request: Effect.fnUntraced(function* (method: string, params?: Schema.Json) {
      const value: unknown = yield* Effect.tryPromise({
        try: () =>
          params === undefined
            ? connection.sendRequest(method)
            : connection.sendRequest(method, params),
        catch: (cause) => new PeerError({ cause }),
      });

      return yield* decodeJson(value);
    }),
    requestError: Effect.fnUntraced(function* (method: string, params?: Schema.Json) {
      const exit = yield* Effect.exit(
        Effect.tryPromise({
          try: () =>
            params === undefined
              ? connection.sendRequest<unknown>(method)
              : connection.sendRequest<unknown>(method, params),
          catch: (cause) => new PeerError({ cause }),
        }),
      );

      if (Exit.isSuccess(exit))
        return yield* new PeerError({ cause: "Expected a rejected RPC request" });

      const failure = exit.cause.reasons.find(Cause.isFailReason);

      if (failure) {
        const cause = failure.error.cause;

        // The maintained serializer omits data when its optional native slot is
        // undefined. Preserve that wire contract before the strict Schema decode.
        return yield* decodeResponseFailure(
          cause instanceof ResponseError ? cause.toJson() : cause,
        );
      }

      return yield* Effect.failCause(exit.cause);
    }),
    notification: Effect.fnUntraced(function* (method: string, params?: Schema.Json) {
      yield* Effect.tryPromise({
        try: () =>
          params === undefined
            ? connection.sendNotification(method)
            : connection.sendNotification(method, params),
        catch: (cause) => new PeerError({ cause }),
      });
    }),
    cancelledRequest: Effect.fnUntraced(function* (
      method: string,
      waitStarted = true,
      beforeCancel: Effect.Effect<void> = Effect.void,
    ) {
      const source = new CancellationTokenSource();
      const promise = connection.sendRequest(method, source.token);

      const observed = promise.then(
        () => ({ code: 0 }),
        (cause: unknown) => ({ cause }),
      );

      if (waitStarted) yield* waitNotification("started");
      yield* beforeCancel;
      source.cancel();
      const result = yield* Effect.promise(() => observed);
      source.dispose();

      return "cause" in result
        ? yield* Schema.decodeUnknownEffect(Schema.Struct({ code: Schema.Int }))(result.cause)
        : { code: 0 };
    }),
    write,
    waitNotification,
    waitResponse: Effect.fnUntraced(function* (id: string | number) {
      return yield* Effect.callback<typeof WireResponse.Type>((resume) => {
        const observe = (response: typeof WireResponse.Type) => {
          if (response.id === id) resume(Effect.succeed(response));
        };

        responseWaiters.add(observe);

        return Effect.sync(() => {
          responseWaiters.delete(observe);
        });
      });
    }),
    waitProtocolError: Effect.fnUntraced(function* (code: number) {
      return yield* Effect.callback<typeof ResponseFailure.Type>((resume) => {
        const check = () => {
          const index = protocolResponses.findIndex((response) => response.code === code);

          if (index !== -1) resume(Effect.succeed(protocolResponses.splice(index, 1)[0]!));
        };

        protocolResponseWaiters.add(check);
        check();

        return Effect.sync(() => {
          protocolResponseWaiters.delete(check);
        });
      });
    }),
    receivedMethods: Effect.sync(() => notifications.map((message) => message.method)),
    notifications: Effect.sync(() => notifications.map((message) => ({ ...message }))),
    waitStderr: Effect.fnUntraced(function* (receipt: string) {
      yield* Effect.callback<void>((resume) => {
        const check = () => {
          if (stderr.includes(receipt)) resume(Effect.void);
        };

        stderrWaiters.add(check);
        check();

        return Effect.sync(() => {
          stderrWaiters.delete(check);
        });
      });
    }),
    stderr: Effect.sync(() => stderr),
    /** Bounded reader/connection error-event emissions, without retaining causes. */
    protocolErrorCount: Effect.sync(() => protocolErrors),
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

      const native = yield* acquireLinuxLspIO(
        new URL("../packages/cli/native/lsp-readiness.json", import.meta.url).pathname,
      );

      let maxRequested = 0;
      let maxReturned = 0;
      let maxBacking = 0;
      let runtimeAcquisitions = 0;
      let ioReleases = 0;
      let readCalls = 0;
      let writeCalls = 0;
      let probeCalls = 0;
      let demandFiberId: number | undefined;
      let failCheckpointRead = false;
      const nativeBodyStarted = yield* Deferred.make<void>();
      let nativeBodyInFlight = false;

      const read = Effect.fnUntraced(function* (max: number) {
        const caller = yield* Effect.withFiber((fiber) => Effect.succeed(fiber.id));

        if (demandFiberId === undefined) demandFiberId = caller;

        // Substitute only the checkpoint failure channel; native demand stays real.
        if (failCheckpointRead && caller !== demandFiberId)
          return yield* new TransportError({ reason: "Framing", cause: "Checkpoint law" });

        readCalls++;
        maxRequested = Math.max(maxRequested, max);

        const bytes = yield* native.read(max);

        if (bytes !== null) {
          maxReturned = Math.max(maxReturned, bytes.byteLength);
          maxBacking = Math.max(maxBacking, bytes.buffer.byteLength);
        }

        return bytes;
      });

      const acquireIO = Effect.succeed({
        ...native,
        read,
        write: Effect.fnUntraced(function* (data: Uint8Array | string) {
          writeCalls++;
          const body = data instanceof Uint8Array && data.byteLength > 1024 * 1024;

          if (body) {
            nativeBodyInFlight = true;
            yield* Deferred.succeed(nativeBodyStarted, undefined);
          }

          yield* native.write(data).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                if (body) nativeBodyInFlight = false;
              }),
            ),
          );
        }),
        probePid: Effect.fnUntraced(function* (pid: number) {
          probeCalls++;
          yield* native.probePid(pid);
        }),
        makeCallbackRuntime: Effect.fnUntraced(function* <R>() {
          runtimeAcquisitions++;

          return yield* native.makeCallbackRuntime<R>();
        }),
        close: Effect.gen(function* () {
          ioReleases++;
          yield* native.close;

          if (ioReleases === 1) process.stderr.write("native-io-released-once\n");
          else process.stderr.write("native-io-release-duplicated\n");
        }),
      });

      const gate = yield* Deferred.make<void>();

      transport = yield* acquireLspTransport(acquireIO, {
        request: Effect.fnUntraced(function* (message) {
          if (message.method === "identify") return { receivedId: message.id };

          if (message.method === "io-inspect")
            return { maxRequested, maxReturned, maxBacking, runtimeAcquisitions, ioReleases };

          if (message.method === "checkpoint-read-failure") {
            failCheckpointRead = true;
            yield* transport.admitPending.pipe(Effect.orDie);

            return null;
          }

          if (message.method === "watch-client") {
            const { processId } = yield* decodeClient(message.params).pipe(
              Effect.mapError(
                () => new RpcFailure({ code: -32602, message: "Invalid client process ID" }),
              ),
            );

            yield* transport
              .watchClient(processId)
              .pipe(
                Effect.mapError(
                  () => new RpcFailure({ code: -32603, message: "Client observation failed" }),
                ),
              );

            return null;
          }

          if (message.method === "cancel-publication-scenario") {
            const activeFrame = yield* Effect.forkChild(
              transport
                .sendNotification("active-frame", { text: "x".repeat(2 * 1024 * 1024) })
                .pipe(Effect.orDie),
            );

            // Observe the actual native body writer, not the unused Node stdout
            // stream. A real IO turn leaves this 2 MiB frame pending on the unread pipe.
            yield* Deferred.await(nativeBodyStarted);
            yield* native.turn;

            if (!nativeBodyInFlight)
              return yield* new RpcFailure({ code: -32603, message: "Native frame did not block" });

            const publication = yield* Effect.forkChild(
              transport.sendNotification("cancelled-publication", { revision: 1 }),
            );

            // The maintained encoder settles before this owned native turn,
            // while the active frame remains blocked on the unread real pipe.
            yield* Effect.callback<void>((resume) => {
              const turn = RAL().timer.setImmediate(() => resume(Effect.void));

              return Effect.sync(() => turn.dispose());
            });

            yield* Fiber.interrupt(publication);
            const cancelled = yield* Fiber.await(publication);
            process.stderr.write("publication-cancelled\n");
            yield* Fiber.join(activeFrame);
            yield* transport.sendNotification("after-cancel", null).pipe(Effect.orDie);

            return {
              interrupted: Exit.isFailure(cancelled) && Cause.hasInterrupts(cancelled.cause),
            };
          }

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
            const { mode } = yield* decodeBurst(message.params).pipe(
              Effect.mapError(
                () => new RpcFailure({ code: -32602, message: "Invalid burst mode" }),
              ),
            );

            yield* Effect.forEach(
              Array.from({ length: 33 }, (_, index) => index),
              (index) =>
                transport.sendNotification("large-output", {
                  index,
                  text: "x".repeat(mode === "count" ? 16 : 1024 * 1024),
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

          if (message.method === "edit") {
            edits.push(message.params ?? null);
            yield* transport
              .sendNotification("edited", { index: edits.length, value: message.params ?? null })
              .pipe(Effect.orDie);
          }
        }),
      });

      if (process.argv[3] === "watch-parent")
        yield* Effect.scoped(transport.watchClient(process.ppid));
      yield* transport.sendNotification("ready", null);
      yield* transport.awaitClosed.pipe(
        Effect.catchTag("TransportError", (error) =>
          Effect.sync(() => {
            process.stderr.write(`terminal:${error.reason}\n`);
          }),
        ),
      );
      yield* transport.close;
      yield* transport.close;
      const before = readCalls + writeCalls + probeCalls;
      const sent = yield* Effect.exit(transport.sendNotification("must-not-write", null));
      const admitted = yield* Effect.exit(transport.admitPending);
      const watched = yield* Effect.exit(transport.watchClient(1));

      if (
        Exit.isFailure(sent) &&
        Exit.isFailure(admitted) &&
        Exit.isFailure(watched) &&
        before === readCalls + writeCalls + probeCalls
      )
        process.stderr.write("native-io-closed-fence\n");
      else process.stderr.write("native-io-closed-fence-failed\n");
    }),
  );

  BunRuntime.runMain(
    program.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          process.stderr.write("root-released\n");
        }),
      ),
    ),
    {
      // This test root reports only classified receipts, never private causes.
      disableErrorReporting: true,
      teardown: (exit, done) => {
        if (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) {
          process.stderr.write("root-failed\n");
          done(1);
        } else done(0);
      },
    },
  );
}

// The controlled parent does not read stdin: its server inherits the still-open
// grandparent-owned pipe. Abrupt parent death therefore cannot masquerade as EOF.
if (process.argv[2] === "parent-client") {
  const parent = Effect.scoped(
    Effect.gen(function* () {
      const child = yield* Effect.acquireRelease(
        Effect.sync(() =>
          spawn(process.execPath, [new URL(import.meta.url).pathname, "serve", "watch-parent"], {
            stdio: "inherit",
          }),
        ),
        (owned) =>
          Effect.callback<void>((resume) => {
            if (owned.exitCode !== null || owned.signalCode !== null) {
              resume(Effect.void);

              return;
            }

            const closed = () => resume(Effect.void);

            owned.once("close", closed);
            owned.kill("SIGKILL");

            return Effect.sync(() => {
              owned.off("close", closed);
            });
          }),
      );

      yield* Effect.callback<void>((resume) => {
        const closed = () => resume(Effect.void);

        child.once("close", closed);

        return Effect.sync(() => {
          child.off("close", closed);
        });
      });
    }),
  );

  Effect.runPromise(parent).then(
    () => {},
    () => {
      process.stderr.write("parent-client-failed\n");
      process.exitCode = 1;
    },
  );
}
