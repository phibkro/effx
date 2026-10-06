// EX-0035: isolated public Bun FFI test boundary; no package/native policy changes.
import { dlopen, JSCallback, ptr } from "bun:ffi";
import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { Effect, Schema } from "effect";
import { nativeSymbols, NativeAssetManifest } from "../lsp-native-manifest.ts";
import {
  SigpipeAssetManifest,
  sigpipeSymbols,
  SignalLaw,
  SigpipeReceipt,
} from "./sigpipe.contract.ts";

class SignalFixtureFault extends Schema.TaggedError<SignalFixtureFault>()("SignalFixtureFault", {
  stage: Schema.Literals(["target", "integrity", "condition", "write", "restore", "release"]),
}) {}

const closed = { onExcessProperty: "error" } as const;

const integer = Schema.decodeUnknownSync(Schema.Int.check(Schema.isInt32()));

const bit = Schema.decodeUnknownSync(Schema.Literals([0, 1]));

const positive = Schema.decodeUnknownSync(Schema.Int.check(Schema.isGreaterThan(0)));

const requireZero = (value: number, stage: SignalFixtureFault["stage"]) => {
  if (integer(value) !== 0) throw new SignalFixtureFault({ stage });
};

const checkedBytes = (path: string, size: number, digest: string) => {
  if (size > 16 * 1024 * 1024 || statSync(path).size !== size)
    throw new SignalFixtureFault({ stage: "integrity" });
  const bytes = readFileSync(path);

  if (
    bytes.length !== size ||
    new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== digest
  )
    throw new SignalFixtureFault({ stage: "integrity" });
};

// One synchronous kernel-condition scope. There is no suspension between mask
// observations and the direct production FFI call, and no pointer retained by C.
// All six descriptors, both libraries and the callback belong to Effect Scope.
const program = Effect.gen(function* () {
  if (Bun.version !== "1.3.13" || process.platform !== "linux" || process.arch !== "x64")
    return yield* new SignalFixtureFault({ stage: "target" });

  const helperPath = fileURLToPath(
    new URL("../../tools/native/test-assets/lsp-sigpipe-test.json", import.meta.url),
  );

  const productionPath = fileURLToPath(
    new URL("../../packages/cli/native/lsp-readiness.json", import.meta.url),
  );

  const helperManifest = yield* Schema.decodeEffect(
    Schema.fromJsonString(SigpipeAssetManifest),
    closed,
  )(readFileSync(helperPath, "utf8"));

  const productionManifest = yield* Schema.decodeEffect(
    Schema.fromJsonString(NativeAssetManifest),
    closed,
  )(readFileSync(productionPath, "utf8"));

  checkedBytes(
    join(dirname(helperPath), helperManifest.library),
    helperManifest.byteLength,
    helperManifest.sha256,
  );
  checkedBytes(
    join(dirname(productionPath), productionManifest.library),
    productionManifest.byteLength,
    productionManifest.sha256,
  );
  checkedBytes(
    fileURLToPath(new URL("../../tools/native/lsp-sigpipe-test.c", import.meta.url)),
    helperManifest.source.byteLength,
    helperManifest.source.sha256,
  );
  let librariesClosed = 0;
  let callbacksClosed = 0;
  let descriptorsClosed = 0;
  const laws: Array<typeof SignalLaw.Type> = [];
  let scopeRestored = false;
  yield* Effect.scoped(
    Effect.gen(function* () {
      const helper = yield* Effect.acquireRelease(
        Effect.sync(() =>
          dlopen(join(dirname(helperPath), helperManifest.library), sigpipeSymbols),
        ),
        (library) =>
          Effect.sync(() => {
            library.close();
            librariesClosed++;
          }),
      );

      const production = yield* Effect.acquireRelease(
        Effect.sync(() =>
          dlopen(join(dirname(productionPath), productionManifest.library), nativeSymbols),
        ),
        (library) =>
          Effect.sync(() => {
            library.close();
            librariesClosed++;
          }),
      );

      const h = helper.symbols;

      const bound = yield* Schema.decodeEffect(
        Schema.Int.check(Schema.isBetween({ minimum: 2, maximum: 128 })),
      )(h.test_signal_bound());

      // Full mask comparison uses public sigismember, not raw sigset_t bytes or
      // guessed layout. Membership arrays remain transient; only equality exits.
      const mask = () =>
        Array.from({ length: bound - 1 }, (_, index) => bit(h.test_mask_member(index + 1)));

      const equalMask = (before: ReadonlyArray<number>) => {
        const after = mask();

        return before.every((member, index) => member === after[index]);
      };

      const originalMask = mask();
      const originalDisposition = bit(h.test_disposition());
      const originalPending = bit(h.test_pending());

      if (originalPending !== 0) return yield* new SignalFixtureFault({ stage: "condition" });
      const descriptors: Array<number> = [];

      for (const form of [0, 0, 0, 1, 1, 1]) {
        descriptors.push(
          yield* Effect.acquireRelease(
            Effect.sync(() => h.test_broken_fd(form)).pipe(
              Effect.flatMap(
                Schema.decodeEffect(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
              ),
            ),
            (fd) =>
              Effect.sync(() => {
                requireZero(h.test_close(fd), "release");
                descriptorsClosed++;
              }),
          ),
        );
      }

      let callbackFault = false;

      const callback = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new JSCallback(
              () => {
                // Never unwind a JS exception through C: record only the closed failure
                // indicator, then let C restore the exact saved action and mask.
                try {
                  requireZero(h.test_set_blocked(1, 1), "condition");
                  const epipe = positive(h.test_epipe());
                  const buffer = new Uint8Array([1]);

                  for (let index = 0; index < descriptors.length; index++) {
                    const preset = index % 3;
                    requireZero(h.test_set_blocked(0, preset === 0 ? 0 : 1), "condition");

                    if (preset === 2) requireZero(h.test_raise_pending(), "condition");
                    const before = mask();
                    const pendingBefore = bit(h.test_pending());
                    const blockedBefore = bit(h.test_selected_member(0));
                    const dispositionBefore = bit(h.test_disposition());
                    const fd = descriptors[index];

                    if (fd === undefined) throw new SignalFixtureFault({ stage: "condition" });

                    const result = integer(
                      index < 3
                        ? production.symbols.fd_write_now(fd, ptr(buffer), buffer.byteLength)
                        : production.symbols.socket_write_now(fd, ptr(buffer), buffer.byteLength),
                    );

                    laws.push(
                      Schema.decodeUnknownSync(
                        SignalLaw,
                        closed,
                      )({
                        form: index < 3 ? "pipe" : "socket",
                        blockedBefore,
                        blockedAfter: bit(h.test_selected_member(0)),
                        pendingBefore,
                        pendingAfter: bit(h.test_pending()),
                        result,
                        epipe,
                        maskRestored: equalMask(before),
                        dispositionBefore,
                        dispositionAfter: bit(h.test_disposition()),
                      }),
                    );
                    requireZero(h.test_set_blocked(0, 1), "condition");
                    const consumed = bit(h.test_consume_pending());

                    if (consumed !== (preset === 2 ? 1 : 0))
                      throw new SignalFixtureFault({ stage: "write" });
                  }

                  return 0;
                } catch {
                  callbackFault = true;

                  return -1;
                }
              },
              { args: [], returns: "i32", threadsafe: false },
            ),
        ),
        (owned) =>
          Effect.sync(() => {
            owned.close();
            callbacksClosed++;
          }),
      );

      const status = integer(h.test_scope(callback.ptr));
      scopeRestored =
        equalMask(originalMask) &&
        bit(h.test_disposition()) === originalDisposition &&
        bit(h.test_pending()) === originalPending;

      if (status !== 0 || callbackFault || !scopeRestored)
        return yield* new SignalFixtureFault({ stage: "restore" });
    }),
  );

  const receipt = yield* Schema.decodeUnknownEffect(
    SigpipeReceipt,
    closed,
  )({
    laws,
    scopeRestored,
    descriptorsClosed,
    callbacksClosed,
    librariesClosed,
    processAlive: true,
  });

  const projection = yield* Schema.encodeEffect(SigpipeReceipt, closed)(receipt);
  yield* Effect.sync(() => {
    process.stdout.write(`${JSON.stringify(projection)}\n`);
  });
});

if (import.meta.main) {
  Effect.runPromise(program.pipe(Effect.scoped)).catch(() => {
    process.exitCode = 1;
  });
}
