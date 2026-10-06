import { Schema } from "effect";

export const LinuxDescriptorIdentity = Schema.Struct({
  kind: Schema.Literals(["socket", "fifo", "file", "pty", "other"]),
  device: Schema.String.check(Schema.isPattern(/^\d+$/)),
  inode: Schema.String.check(Schema.isPattern(/^\d+$/)),
  flags: Schema.optionalKey(Schema.Int),
});

export const LinuxFixtureReceipt = Schema.Struct({
  event: Schema.Literals(["acquired", "released", "result", "failure"]),
  fixturePid: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
  sinkKind: Schema.optionalKey(Schema.Literal("fifo")),
  finiteAcceptedBytes: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  wouldBlock: Schema.optionalKey(Schema.Boolean),
  fd0Before: Schema.optionalKey(LinuxDescriptorIdentity),
  fd0After: Schema.optionalKey(Schema.NullOr(LinuxDescriptorIdentity)),
  fd0AfterStatus: Schema.optionalKey(Schema.Literals(["EBADF", "present", "other-error"])),
  failureCategory: Schema.optionalKey(
    Schema.Literals([
      "fd0-not-closed",
      "library-still-mapped",
      "write-unexpected-success",
      "write-unexpected-failure",
      "write-unexpected-interrupt",
      "write-defect",
      "fixture-defect",
      "sink-not-saturated",
    ]),
  ),
  stage: Schema.optionalKey(
    Schema.Literals([
      "fd0-close",
      "library-close",
      "blocked-write",
      "broken-write",
      "fixture",
      "sink-prefill",
    ]),
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
        "sink-saturated",
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
      "StdoutForm",
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
  ptyChildJoined: Schema.optionalKey(Schema.Boolean),
  regularOutputUnchanged: Schema.optionalKey(Schema.Boolean),
});

export type LinuxPeerResult = typeof LinuxPeerResult.Type;
