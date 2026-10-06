import { Record, Schema } from "effect";

// Content identity from the actual build source, not a guessed revision.
export const toolchainNarHash = "sha256-69xHQhAeMAD2wDXO7T2pcOZIF9Sga2W+JkmY2a11Ops=";

/** Trusted C/header ABI shared by build and root; importing never loads native code.
 * Root owns buffers and validates pointer/count bounds. libc imports are separate.
 */
export const nativeSymbols = {
  ready_now: { args: ["i32"], returns: "i32" },
  fd_flags: { args: ["i32"], returns: "i32" },
  poll_in: { args: [], returns: "i32" },
  poll_hup: { args: [], returns: "i32" },
  poll_err: { args: [], returns: "i32" },
  poll_invalid: { args: [], returns: "i32" },
  pollfd_size: { args: [], returns: "i32" },
  output_ready_now: { args: ["i32"], returns: "i32" },
  poll_out: { args: [], returns: "i32" },
  open_output_now: { args: [], returns: "i32" },
  socket_write_now: { args: ["i32", "ptr", "u32"], returns: "i32" },
  fd_write_now: { args: ["i32", "ptr", "u32"], returns: "i32" },
  io_would_block: { args: ["i32"], returns: "i32" },
} as const;

export const nativeAssetSymbols = Object.keys(nativeSymbols).sort();

// ELF establishes defined function identity, not C types. These are the
// source-reviewed signatures, guarded separately in the closed projection.
const nativeAbi = Schema.Struct(
  Record.map(nativeSymbols, (signature) =>
    Schema.Struct({
      args: Schema.Tuple(signature.args.map((argument) => Schema.Literal(argument))),
      returns: Schema.Literal(signature.returns),
    }),
  ),
);

const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

const version = Schema.String.check(Schema.isPattern(/^\d+\.\d+(?:\.\d+)?$/));

const positive = Schema.Int.check(Schema.isGreaterThan(0));

/** Shared data contract only: importing it never loads a compiler or process adapter. */
export const NativeAssetManifest = Schema.Struct({
  formatVersion: Schema.Literal(1),
  abiVersion: Schema.Literal(2),
  abi: nativeAbi,
  exportedFunctions: Schema.Tuple(nativeAssetSymbols.map((name) => Schema.Literal(name))),
  library: Schema.Literal("lsp-readiness.so"),
  platform: Schema.Literal("linux"),
  architecture: Schema.Literal("x64"),
  elfClass: Schema.Literal(64),
  elfMachine: Schema.Literal(62),
  libc: Schema.Literal("glibc"),
  minimumGlibc: version,
  glibcVersions: Schema.Array(version),
  neededLibraries: Schema.Array(Schema.Literal("libc.so.6")),
  byteLength: positive,
  sha256: digest,
  source: Schema.Struct({
    file: Schema.Literal("tools/native/lsp-readiness.c"),
    byteLength: positive,
    sha256: digest,
  }),
  compiler: Schema.Struct({
    family: Schema.Literal("gcc"),
    version,
    target: Schema.String.check(Schema.isPattern(/^x86_64-[a-z0-9_-]+-linux-gnu$/)),
  }),
  toolchain: Schema.Struct({
    sourceNarHash: Schema.Literal(toolchainNarHash),
    binutilsVersion: version,
    patchelfVersion: version,
  }),
  reproducible: Schema.Literal(true),
});

/** Callers decode dotted version strings before this total ordering. */
export const compareVersions = (left: string, right: string): number => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);

  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);

    if (difference !== 0) return difference;
  }

  return 0;
};
