#!/usr/bin/env bun
/** @effect-diagnostics unstableApiUsage:off -- EX-0036: build-time native effect/process toolchain adapter. */
/**
 * Build-only Linux-x64/glibc asset pipeline. Run from the repository root:
 * `bun scripts/build-lsp-native.ts`.
 *
 * Uses the maintained Nix GCC/binutils fallback examined in design §10. The
 * toolchain supplies target headers; no compiler, headers or Nix path ships.
 * Two independent scoped directories must produce identical bytes. ELF version
 * needs establish a symbol-version floor, not distribution compatibility: actual
 * packed-host qualification remains a separate director-owned gate.
 *
 * The audited POSIX source exports seven int-only functions. poll owns its local
 * struct; neither pointers nor read buffers cross its ABI. Native C has full
 * process authority and no memory-safety containment. No runtime build is allowed.
 * Temporary files and subprocesses belong to this program's Scope; interruption
 * cancels children and removes build directories. No retries or durable state.
 * Only the closed manifest projection is written; tool output and causes are not.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const sourceFile = "tools/native/lsp-readiness.c";
const assetDirectory = "packages/cli/native";
const library = "lsp-readiness.so";
// The existing path-backed Nix source has no published revision metadata. Require
// its actual content identity and use its immutable resolved path only at build
// time. A different registry source must be explicitly requalified, not guessed.
const toolchainNarHash = "sha256-69xHQhAeMAD2wDXO7T2pcOZIF9Sga2W+JkmY2a11Ops=";
const ToolchainSource = Schema.Struct({
  path: Schema.String,
  locked: Schema.Struct({ narHash: Schema.Literal(toolchainNarHash) }),
});

const digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const version = Schema.String.check(Schema.isPattern(/^\d+\.\d+(?:\.\d+)?$/));
const positive = Schema.Int.check(Schema.isGreaterThan(0));

/** Exact public fields agreed with the native root; unknown fields are rejected. */
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
  source: Schema.Struct({ file: Schema.Literal("tools/native/lsp-readiness.c"), byteLength: positive, sha256: digest }),
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

export class NativeBuildFailure extends Schema.TaggedError<NativeBuildFailure>()("NativeBuildFailure", {
  stage: Schema.Literals(["toolchain", "reproducibility", "elf", "symbols", "dependencies", "projection", "io"]),
}) {}

const symbols = ["ready_now", "fd_flags", "poll_in", "poll_hup", "poll_err", "poll_invalid", "pollfd_size"];

/** Numerically order dotted glibc version requirements, not lexicographically. */
export const compareVersions = (left: string, right: string): number => {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/** No raw command output, command arguments or foreign failures are reported. */
const toolOutput = Effect.fnUntraced(function* (executable: string, args: ReadonlyArray<string>, sourceReference: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const commandArgs = executable === "nix" ? args : [
    "shell", `${sourceReference}#gcc`, `${sourceReference}#binutils`, `${sourceReference}#patchelf`, "-c", executable, ...args,
  ];
  const child = yield* spawner.spawn(ChildProcess.make("nix", commandArgs, {
    env: { LC_ALL: "C", NIX_DONT_SET_RPATH: "1" },
    extendEnv: true,
    stdin: "ignore",
    stderr: "ignore",
    forceKillAfter: "2 seconds",
  })).pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "toolchain" })));
  const [output, code] = yield* Effect.all([
    Stream.mkString(Stream.decodeText(child.stdout)),
    child.exitCode,
  ], { concurrency: 2 }).pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "toolchain" })));
  if (code !== 0) return yield* new NativeBuildFailure({ stage: "toolchain" });
  return output.trim();
}, Effect.scoped);

const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const metadata = yield* toolOutput("nix", ["flake", "metadata", "--json", "nixpkgs"], "nixpkgs");
  // This transient decode strips metadata not needed for the build. The path is
  // never serialized; only the separately closed public manifest is written.
  const toolchainSource = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ToolchainSource))(metadata)
    .pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "toolchain" })));
  const reference = `path:${toolchainSource.path}`;
  const first = yield* fs.makeTempDirectoryScoped({ prefix: "effx-lsp-native-" });
  const second = yield* fs.makeTempDirectoryScoped({ prefix: "effx-lsp-native-" });
  const source = yield* fs.readFile(sourceFile);
  // Build the same audited bytes independently; source paths and directories do
  // not enter ELF bytes (no debug info/ident/build-id, no Nix wrapper RPATH).
  for (const directory of [first, second]) {
    yield* fs.writeFile(`${directory}/readiness.c`, source);
    yield* toolOutput("gcc", [
      "-shared", "-fPIC", "-O2", "-fno-ident", "-Wl,--build-id=none", "-Wl,--fatal-warnings", "-s",
      "-o", `${directory}/${library}`, `${directory}/readiness.c`,
    ], reference);
    // Nix wrappers/CRT may add linker search paths and compiler comments. Remove
    // those build-only sections before rejecting every remaining Nix string.
    yield* toolOutput("patchelf", ["--set-rpath", "", `${directory}/${library}`], reference);
    yield* toolOutput("patchelf", ["--remove-rpath", `${directory}/${library}`], reference);
    yield* toolOutput("objcopy", ["--remove-section=.comment", `${directory}/${library}`], reference);
  }
  const bytes = yield* fs.readFile(`${first}/${library}`);
  const repeated = yield* fs.readFile(`${second}/${library}`);
  if (bytes.length !== repeated.length || !bytes.every((byte, index) => byte === repeated[index])) {
    return yield* new NativeBuildFailure({ stage: "reproducibility" });
  }
  const header = yield* toolOutput("readelf", ["--file-header", "--wide", `${first}/${library}`], reference);
  // ELF standard e_ident and e_machine, corroborated by maintained readelf.
  if (bytes.length < 20 || bytes[0] !== 127 || bytes[1] !== 69 || bytes[2] !== 76 || bytes[3] !== 70 ||
    bytes[4] !== 2 || bytes[5] !== 1 ||
    !/Class:\s+ELF64/.test(header) || !/Machine:\s+Advanced Micro Devices X86-64/.test(header) ||
    !/Type:\s+DYN/.test(header)) {
    return yield* new NativeBuildFailure({ stage: "elf" });
  }
  const machine = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(18, true);
  const dynamic = yield* toolOutput("readelf", ["--dynamic", "--wide", `${first}/${library}`], reference);
  const artifactText = new TextDecoder().decode(bytes);
  if (/\((?:RPATH|RUNPATH)\)/.test(dynamic) || artifactText.includes("/nix/store/") || /\(TEXTREL\)/.test(dynamic)) {
    return yield* new NativeBuildFailure({ stage: "dependencies" });
  }
  const neededLibraries = [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)].flatMap((match) => match[1] === undefined ? [] : [match[1]]).sort();
  if (neededLibraries.length !== 1 || neededLibraries[0] !== "libc.so.6") {
    return yield* new NativeBuildFailure({ stage: "dependencies" });
  }
  const versions = yield* toolOutput("readelf", ["--version-info", "--wide", `${first}/${library}`], reference);
  const requiredNames = [...versions.matchAll(/Name:\s+(\S+)/g)].flatMap((match) => match[1] === undefined ? [] : [match[1]]);
  if (requiredNames.length === 0 || requiredNames.some((name) => !/^GLIBC_\d+\.\d+(?:\.\d+)?$/.test(name))) {
    return yield* new NativeBuildFailure({ stage: "dependencies" });
  }
  const glibcVersions = [...new Set(requiredNames.map((name) => name.slice(6)))].sort(compareVersions);
  const dynamicSymbols = yield* toolOutput("readelf", ["--dyn-syms", "--wide", `${first}/${library}`], reference);
  const exported = dynamicSymbols.split("\n").flatMap((line) => {
    const match = /^\s*\d+:\s+\S+\s+\d+\s+FUNC\s+GLOBAL\s+DEFAULT\s+(\d+)\s+(\S+)\s*$/.exec(line);
    return match?.[2] === undefined ? [] : [match[2]];
  }).sort();
  if (exported.join(",") !== [...symbols].sort().join(",")) {
    return yield* new NativeBuildFailure({ stage: "symbols" });
  }
  const compilerVersion = yield* toolOutput("gcc", ["-dumpfullversion"], reference);
  const compilerTarget = yield* toolOutput("gcc", ["-dumpmachine"], reference);
  const linkerIdentity = yield* toolOutput("ld", ["--version"], reference);
  const patcherIdentity = yield* toolOutput("patchelf", ["--version"], reference);
  const binutilsVersion = /^GNU ld \(GNU Binutils\) (\d+\.\d+(?:\.\d+)?)/.exec(linkerIdentity)?.[1];
  const patchelfVersion = /^patchelf (\d+\.\d+(?:\.\d+)?)/.exec(patcherIdentity)?.[1];
  const manifest = yield* Schema.decodeUnknownEffect(NativeAssetManifest, { onExcessProperty: "error" })({
    formatVersion: 1,
    library,
    platform: "linux",
    architecture: "x64",
    elfClass: bytes[4] === 2 ? 64 : 32,
    elfMachine: machine,
    libc: "glibc",
    minimumGlibc: glibcVersions[glibcVersions.length - 1],
    glibcVersions,
    neededLibraries,
    byteLength: bytes.length,
    sha256: hex(yield* crypto.digest("SHA-256", bytes)),
    source: { file: sourceFile, byteLength: source.length, sha256: hex(yield* crypto.digest("SHA-256", source)) },
    compiler: { family: "gcc", version: compilerVersion, target: compilerTarget },
    toolchain: { sourceNarHash: toolchainSource.locked.narHash, binutilsVersion, patchelfVersion },
    reproducible: true,
  }).pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "projection" })));
  const projection = yield* Schema.encodeEffect(NativeAssetManifest, { onExcessProperty: "error" })(manifest)
    .pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "projection" })));
  // Both files are staged until every check and the closed projection succeed.
  yield* fs.makeDirectory(assetDirectory, { recursive: true });
  yield* fs.writeFileString(`${first}/manifest.json`, `${JSON.stringify(projection, null, 2)}\n`);
  yield* fs.copyFile(`${first}/${library}`, `${assetDirectory}/${library}`);
  yield* fs.copyFile(`${first}/manifest.json`, `${assetDirectory}/lsp-readiness.json`);
});

if (import.meta.main) {
  BunRuntime.runMain(program.pipe(
    Effect.scoped,
    Effect.mapError((error) => error instanceof NativeBuildFailure ? error : new NativeBuildFailure({ stage: "io" })),
    Effect.provide(BunServices.layer),
  ));
}
