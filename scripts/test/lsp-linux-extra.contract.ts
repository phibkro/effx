import { Schema } from "effect";
import { LinuxDescriptorIdentity } from "./lsp-linux.contract.ts";

export const ExtraMode = Schema.Literals(["progress", "cancel", "closing", "release-fault"]);

export const ExtraForm = Schema.Literals(["socket", "fifo", "pty"]);

export const ExtraStage = Schema.Literals([
  "setup",
  "launch",
  "receipt-stream",
  "control-stream",
  "output-stream",
  "projection",
  "acquire",
  "identity",
  "prefill",
  "prefix",
  "backpressure",
  "closing",
  "release",
  "scope",
  "spawn",
  "receipt",
  "drain",
  "join",
]);

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const pid = Schema.Int.check(Schema.isGreaterThan(0));

// Only these selected public observations may cross FD3/stdout. Never encode a
// Cause, argv, environment, config, library handle, procfs text or frame payload.
export const ExtraReceipt = Schema.Struct({
  event: Schema.Literals([
    "started",
    "acquired",
    "identity",
    "saturated",
    "writer-waiting",
    "backpressure",
    "closing",
    "released",
    "scope-outcome",
    "failure",
  ]),
  stage: ExtraStage,
  fixturePid: Schema.optionalKey(pid),
  fd0Before: Schema.optionalKey(LinuxDescriptorIdentity),
  fd0After: Schema.optionalKey(LinuxDescriptorIdentity),
  fd1Before: Schema.optionalKey(LinuxDescriptorIdentity),
  fd1After: Schema.optionalKey(LinuxDescriptorIdentity),
  reopenedFd: Schema.optionalKey(count),
  reopenedIdentity: Schema.optionalKey(LinuxDescriptorIdentity),
  prefillBytes: Schema.optionalKey(count),
  partialWrites: Schema.optionalKey(count),
  minimumPartialBytes: Schema.optionalKey(count),
  frameBytes: Schema.optionalKey(count),
  bodyBytes: Schema.optionalKey(
    Schema.Int.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(8 * 1024 * 1024)),
  ),
  observedPrefixBytes: Schema.optionalKey(count),
  pollMask: Schema.optionalKey(count),
  wouldBlock: Schema.optionalKey(Schema.Boolean),
  writerPending: Schema.optionalKey(Schema.Boolean),
  callerMutated: Schema.optionalKey(Schema.Boolean),
  refusalReason: Schema.optionalKey(Schema.Literal("Capacity")),
  closePending: Schema.optionalKey(Schema.Boolean),
  closeExit: Schema.optionalKey(Schema.Literals(["Success", "ReleaseIO"])),
  sameCloseCause: Schema.optionalKey(Schema.Boolean),
  closeJoined: Schema.optionalKey(Schema.Boolean),
  writerExit: Schema.optionalKey(Schema.Literals(["Success", "Interrupted", "Closed"])),
  fd0Closed: Schema.optionalKey(Schema.Boolean),
  fd1Closed: Schema.optionalKey(Schema.Boolean),
  reopenedClosed: Schema.optionalKey(Schema.Boolean),
  libraryUnmapped: Schema.optionalKey(Schema.Boolean),
  postCloseRefused: Schema.optionalKey(Schema.Boolean),
  expectedReleaseFault: Schema.optionalKey(Schema.Boolean),
  identityFailure: Schema.optionalKey(
    Schema.Literals([
      "fd0-kind",
      "fd0-device",
      "fd0-inode",
      "fd0-flags",
      "fd1-kind",
      "fd1-device",
      "fd1-inode",
      "fd1-flags",
      "stdout-kind",
      "reopened-count",
      "reopened-kind",
      "reopened-device",
      "reopened-inode",
      "reopened-flags",
      "reopened-shared-flags",
    ]),
  ),
  failureTag: Schema.optionalKey(
    Schema.Literals(["LinuxLspError", "FixtureDefect", "Interrupted", "Other"]),
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

export type ExtraReceipt = typeof ExtraReceipt.Type;

export const ExtraPeerFault = Schema.Struct({
  reason: Schema.Literals([
    "Spawn",
    "Receipt",
    "Control",
    "Drain",
    "Bytes",
    "Join",
    "Topology",
    "Setup",
    "Projection",
    "Timeout",
  ]),
  stage: ExtraStage,
});

export type ExtraPeerFault = typeof ExtraPeerFault.Type;

export const ExtraPeerResult = Schema.Struct({
  code: Schema.NullOr(Schema.Int),
  signal: Schema.NullOr(
    Schema.Literals([
      "SIGINT",
      "SIGTERM",
      "SIGKILL",
      "SIGPIPE",
      "SIGABRT",
      "SIGSEGV",
      "SIGBUS",
      "SIGHUP",
      "Other",
    ]),
  ),
  receipts: Schema.Array(ExtraReceipt),
  frameBytesRead: count,
  prefillBytesRead: count,
  prefixVerified: Schema.Boolean,
  frameVerified: Schema.Boolean,
  fixtureGone: Schema.Boolean,
  ptyChildJoined: Schema.Boolean,
  fault: Schema.optionalKey(ExtraPeerFault),
});

export type ExtraPeerResult = typeof ExtraPeerResult.Type;

// Synthetic framed bytes are shared test data, not a second protocol parser.
// Capacity is established by real one-byte EAGAIN and pending/POLLOUT evidence,
// never by assuming this body cannot fit an OS buffer.
export const extraMaximumBodyBytes = 8 * 1024 * 1024;

export const extraPrefixBytes = 4096;

export const prefillByte = 120;

export const extraBodyForPrefill = (bytes: number): number =>
  Math.max(256 * 1024, 2 * bytes + 65536);

const encoder = new TextEncoder();

export const makeExtraHeader = (bodyBytes: number): Uint8Array =>
  encoder.encode(`Content-Length: ${bodyBytes}\r\n\r\n`);

export const extraFrameByte = (offset: number, header: Uint8Array): number =>
  offset < header.byteLength ? header[offset]! : 65 + ((offset - header.byteLength) % 26);

export const makeExtraFrame = (bodyBytes: number): Uint8Array => {
  const header = makeExtraHeader(bodyBytes);
  const bytes = new Uint8Array(header.byteLength + bodyBytes);
  bytes.set(header);

  for (let index = header.byteLength; index < bytes.byteLength; index++)
    bytes[index] = extraFrameByte(index, header);

  return bytes;
};
