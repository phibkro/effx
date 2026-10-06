import { Schema } from "effect";

export const LinuxFixtureReceipt = Schema.Struct({
  event: Schema.Literals(["acquired", "released", "result", "failure"]),
  failureCategory: Schema.optionalKey(
    Schema.Literals([
      "fd0-not-closed",
      "library-still-mapped",
      "write-unexpected-success",
      "write-unexpected-failure",
      "write-unexpected-interrupt",
      "write-defect",
      "fixture-defect",
    ]),
  ),
  stage: Schema.optionalKey(
    Schema.Literals(["fd0-close", "library-close", "blocked-write", "broken-write", "fixture"]),
  ),
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

export const LinuxPeerFault = Schema.Struct({
  reason: Schema.Literals(["Spawn", "Receipt", "Write", "Exit"]),
  stage: Schema.Literals([
    "spawn",
    "receipt",
    "socket-write",
    "fifo-open",
    "fifo-write",
    "pty-write",
    "child-exit",
  ]),
});

export type LinuxPeerFault = typeof LinuxPeerFault.Type;

export const LinuxPeerResult = Schema.Struct({
  code: Schema.NullOr(Schema.Int),
  signal: Schema.NullOr(Schema.String.check(Schema.isPattern(/^SIG[A-Z]+$/))),
  receipts: Schema.Array(LinuxFixtureReceipt),
  stdoutBytes: Schema.Int,
  peerFault: Schema.optionalKey(LinuxPeerFault),
});
