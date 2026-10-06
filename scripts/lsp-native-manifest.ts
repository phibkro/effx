import { Schema } from "effect";

// Content identity from the actual build source, not a guessed revision.
export const toolchainNarHash = "sha256-69xHQhAeMAD2wDXO7T2pcOZIF9Sga2W+JkmY2a11Ops=";

const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));

const version = Schema.String.check(Schema.isPattern(/^\d+\.\d+(?:\.\d+)?$/));

const positive = Schema.Int.check(Schema.isGreaterThan(0));

/** Shared data contract only: importing it never loads a compiler or process adapter. */
export const NativeAssetManifest = Schema.Struct({
  formatVersion: Schema.Literal(1),
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
