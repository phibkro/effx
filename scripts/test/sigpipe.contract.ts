import { Record, Schema } from "effect";
import { NativeAssetManifest } from "../lsp-native-manifest.ts";

export const sigpipeSymbols = {
  test_signal_bound: { args: [], returns: "i32" },
  test_mask_member: { args: ["i32"], returns: "i32" },
  test_selected_member: { args: ["i32"], returns: "i32" },
  test_set_blocked: { args: ["i32", "i32"], returns: "i32" },
  test_pending: { args: [], returns: "i32" },
  test_disposition: { args: [], returns: "i32" },
  test_set_disposition: { args: ["i32"], returns: "i32" },
  test_raise_pending: { args: [], returns: "i32" },
  test_consume_pending: { args: [], returns: "i32" },
  test_epipe: { args: [], returns: "i32" },
  test_broken_fd: { args: ["i32"], returns: "i32" },
  test_close: { args: ["i32"], returns: "i32" },
  test_scope: { args: ["ptr"], returns: "i32" },
} as const;

export const sigpipeAssetSymbols = Object.keys(sigpipeSymbols).sort();

// Reuse the maintained ELF/build metadata contract, with this test-only ABI.
export const SigpipeAssetManifest = Schema.Struct({
  ...NativeAssetManifest.fields,
  abiVersion: Schema.Literal(1),
  abi: Schema.Struct(
    Record.map(sigpipeSymbols, (signature) =>
      Schema.Struct({
        args: Schema.Tuple(signature.args.map((argument) => Schema.Literal(argument))),
        returns: Schema.Literal(signature.returns),
      }),
    ),
  ),
  exportedFunctions: Schema.Tuple(sigpipeAssetSymbols.map((name) => Schema.Literal(name))),
  library: Schema.Literal("lsp-sigpipe-test.so"),
  source: Schema.Struct({
    ...NativeAssetManifest.fields.source.fields,
    file: Schema.Literal("tools/native/lsp-sigpipe-test.c"),
  }),
});

const bit = Schema.Literals([0, 1]);

export const SignalLaw = Schema.Struct({
  form: Schema.Literals(["pipe", "socket"]),
  blockedBefore: bit,
  blockedAfter: bit,
  pendingBefore: bit,
  pendingAfter: bit,
  result: Schema.Int.check(Schema.isInt32()),
  epipe: Schema.Int.check(Schema.isGreaterThan(0)),
  maskRestored: Schema.Boolean,
  dispositionBefore: Schema.Literal(0),
  dispositionAfter: Schema.Literal(0),
});

export const SigpipeReceipt = Schema.Struct({
  laws: Schema.Array(SignalLaw).check(Schema.isBetweenLength(6, 6)),
  scopeRestored: Schema.Literal(true),
  descriptorsClosed: Schema.Literal(6),
  callbacksClosed: Schema.Literal(1),
  librariesClosed: Schema.Literal(2),
  processAlive: Schema.Literal(true),
});
