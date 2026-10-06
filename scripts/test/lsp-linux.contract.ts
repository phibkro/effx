import { Schema } from "effect";

export const LinuxFixtureReceipt = Schema.Struct({
  event: Schema.Literals(["acquired", "released", "result", "failure"]),
  bytes: Schema.optionalKey(Schema.Int),
  maximumRead: Schema.optionalKey(Schema.Int),
  maximumBacking: Schema.optionalKey(Schema.Int),
  checks: Schema.optionalKey(
    Schema.Array(
      Schema.Literals([
        "construction-is-lazy",
        "exclusive-owner",
        "idempotent-close",
        "no-admission-after-close",
        "alive-pid",
        "invalid-pid",
        "gone-pid",
        "callback-cancellation",
        "callback-finalizer-once",
        "promise-channel",
        "writer-deadline",
        "release-deadline",
        "broken-pipe",
        "read-bound",
        "retained-buffer",
        "fd0-closed",
        "library-unloaded",
        "eof",
      ]),
    ),
  ),
  reason: Schema.optionalKey(
    Schema.Literals([
      "Target",
      "Libc",
      "Manifest",
      "Integrity",
      "NativeLoad",
      "Symbols",
      "Procfs",
      "StdinForm",
      "Ownership",
      "IO",
    ]),
  ),
});

export const LinuxPeerResult = Schema.Struct({
  code: Schema.NullOr(Schema.Int),
  signal: Schema.NullOr(Schema.String.check(Schema.isPattern(/^SIG[A-Z]+$/))),
  receipts: Schema.Array(LinuxFixtureReceipt),
  stdoutBytes: Schema.Int,
});
