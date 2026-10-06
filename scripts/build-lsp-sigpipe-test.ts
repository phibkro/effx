#!/usr/bin/env bun
/** @effect-diagnostics unstableApiUsage:off -- EX-0036: build-time native effect/process toolchain adapter. */
/**
 * Test-only Linux-x64/glibc condition/observation asset pipeline. Run from the repository root:
 * `bun scripts/build-lsp-sigpipe-test.ts`.
 *
 * Uses the maintained Nix GCC/binutils fallback examined in design §10. The
 * toolchain supplies target headers; no compiler, headers or Nix path ships.
 * Two independent scoped directories must produce identical bytes. ELF version
 * needs establish a symbol-version floor, not distribution compatibility: actual
 * packed-host qualification remains a separate director-owned gate.
 *
 * Audited target headers own all local signal structs. Only i32 observations
 * and one synchronous fixture callback cross this test ABI. ELF proves names,
 * not C types; the shared contract records source-reviewed signatures.
 * No runtime build is allowed.
 * Temporary files and subprocesses belong to this program's Scope; interruption
 * cancels children and removes build directories. No retries or durable state.
 * Only the closed manifest projection is written; tool output and causes are not.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { compareVersions, toolchainNarHash } from "./lsp-native-manifest.ts";
import {
  SigpipeAssetManifest as NativeAssetManifest,
  sigpipeAssetSymbols as nativeAssetSymbols,
  sigpipeSymbols as nativeSymbols,
} from "./test/sigpipe.contract.ts";

const sourceFile = "tools/native/lsp-sigpipe-test.c";

const assetDirectory = "tools/native/test-assets";

const library = "lsp-sigpipe-test.so";

// The existing path-backed Nix source has no published revision metadata. Require
// its actual content identity and use its immutable resolved path only at build
// time. A different registry source must be explicitly requalified, not guessed.
const ToolchainSource = Schema.Struct({
  path: Schema.String,
  locked: Schema.Struct({ narHash: Schema.Literal(toolchainNarHash) }),
});

export class NativeBuildFailure extends Schema.TaggedError<NativeBuildFailure>()(
  "NativeBuildFailure",
  {
    stage: Schema.Literals([
      "toolchain",
      "spawn",
      "collect",
      "exit",
      "reproducibility",
      "elf",
      "symbols",
      "dependencies",
      "projection",
      "io",
    ]),
  },
) {}

/** No raw command output, command arguments or foreign failures are reported. */
const toolOutput = Effect.fnUntraced(function* (
  executable: string,
  args: ReadonlyArray<string>,
  sourceReference: string,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const commandArgs =
    executable === "nix"
      ? args
      : [
          "shell",
          `${sourceReference}#gcc`,
          `${sourceReference}#binutils`,
          `${sourceReference}#patchelf`,
          "-c",
          executable,
          ...args,
        ];

  const child = yield* spawner
    .spawn(
      ChildProcess.make("nix", commandArgs, {
        env: { LC_ALL: "C", NIX_DONT_SET_RPATH: "1" },
        extendEnv: true,
        stdin: "ignore",
        stderr: "ignore",
        forceKillAfter: "2 seconds",
      }),
    )
    .pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "spawn" })));

  const [output, code] = yield* Effect.all(
    [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
    { concurrency: 2 },
  ).pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "collect" })));

  if (code !== 0) return yield* new NativeBuildFailure({ stage: "exit" });

  return output.trim();
}, Effect.scoped);

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const crypto = yield* Crypto.Crypto;
  const metadata = yield* toolOutput("nix", ["flake", "metadata", "--json", "nixpkgs"], "nixpkgs");

  // This transient decode strips metadata not needed for the build. The path is
  // never serialized; only the separately closed public manifest is written.
  const toolchainSource = yield* Schema.decodeEffect(Schema.fromJsonString(ToolchainSource))(
    metadata,
  ).pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "toolchain" })));

  const reference = `path:${toolchainSource.path}`;
  const first = yield* fs.makeTempDirectoryScoped({ prefix: "effx-lsp-native-" });
  const second = yield* fs.makeTempDirectoryScoped({ prefix: "effx-lsp-native-" });
  const source = yield* fs.readFile(sourceFile);

  // The test conditions need GNU pipe2/NSIG as well as POSIX thread signals.
  // Header feature selection belongs to the C source. Compilation below checks
  // actual declarations and pointer types; no private __USE_* macro is an ABI.

  // Build the same audited bytes independently; source paths and directories do
  // not enter ELF bytes (no debug info/ident/build-id, no Nix wrapper RPATH).
  for (const directory of [first, second]) {
    yield* fs.writeFile(`${directory}/readiness.c`, source);
    yield* toolOutput(
      "gcc",
      [
        "-shared",
        "-fPIC",
        "-std=c11",
        "-Werror=implicit-function-declaration",
        "-Werror=incompatible-pointer-types",
        "-O2",
        "-fno-ident",
        "-Wl,--build-id=none",
        "-Wl,--fatal-warnings",
        "-Wl,-z,defs",
        "-s",
        "-o",
        `${directory}/${library}`,
        `${directory}/readiness.c`,
      ],
      reference,
    );
    // Nix wrappers/CRT may add linker search paths and compiler comments. Remove
    // those build-only sections before rejecting every remaining Nix string.
    yield* toolOutput("patchelf", ["--set-rpath", "", `${directory}/${library}`], reference);
    yield* toolOutput("patchelf", ["--remove-rpath", `${directory}/${library}`], reference);
    yield* toolOutput(
      "objcopy",
      ["--remove-section=.comment", `${directory}/${library}`],
      reference,
    );
  }

  const bytes = yield* fs.readFile(`${first}/${library}`);
  const repeated = yield* fs.readFile(`${second}/${library}`);

  if (bytes.length !== repeated.length || !bytes.every((byte, index) => byte === repeated[index])) {
    return yield* new NativeBuildFailure({ stage: "reproducibility" });
  }

  const header = yield* toolOutput(
    "readelf",
    ["--file-header", "--wide", `${first}/${library}`],
    reference,
  );

  // ELF standard e_ident and e_machine, corroborated by maintained readelf.
  if (
    bytes.length < 20 ||
    bytes[0] !== 127 ||
    bytes[1] !== 69 ||
    bytes[2] !== 76 ||
    bytes[3] !== 70 ||
    bytes[4] !== 2 ||
    bytes[5] !== 1 ||
    !/Class:\s+ELF64/.test(header) ||
    !/Machine:\s+Advanced Micro Devices X86-64/.test(header) ||
    !/Type:\s+DYN/.test(header)
  ) {
    return yield* new NativeBuildFailure({ stage: "elf" });
  }

  const machine = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(
    18,
    true,
  );

  const dynamic = yield* toolOutput(
    "readelf",
    ["--dynamic", "--wide", `${first}/${library}`],
    reference,
  );

  const artifactText = new TextDecoder().decode(bytes);

  if (
    /\((?:RPATH|RUNPATH)\)/.test(dynamic) ||
    artifactText.includes("/nix/store/") ||
    /\(TEXTREL\)/.test(dynamic)
  ) {
    return yield* new NativeBuildFailure({ stage: "dependencies" });
  }

  const neededLibraries = [...dynamic.matchAll(/\(NEEDED\).*\[([^\]]+)\]/g)]
    .flatMap((match) => (match[1] === undefined ? [] : [match[1]]))
    .sort();

  if (neededLibraries.length !== 1 || neededLibraries[0] !== "libc.so.6") {
    return yield* new NativeBuildFailure({ stage: "dependencies" });
  }

  const versions = yield* toolOutput(
    "readelf",
    ["--version-info", "--wide", `${first}/${library}`],
    reference,
  );

  const requiredNames = [...versions.matchAll(/Name:\s+(\S+)/g)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

  if (
    requiredNames.length === 0 ||
    requiredNames.some((name) => !/^GLIBC_\d+\.\d+(?:\.\d+)?$/.test(name))
  ) {
    return yield* new NativeBuildFailure({ stage: "dependencies" });
  }

  const glibcVersions = [...new Set(requiredNames.map((name) => name.slice(6)))].sort(
    compareVersions,
  );

  const dynamicSymbols = yield* toolOutput(
    "readelf",
    ["--dyn-syms", "--wide", `${first}/${library}`],
    reference,
  );

  const exported = dynamicSymbols
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*\d+:\s+\S+\s+\d+\s+FUNC\s+GLOBAL\s+DEFAULT\s+(\d+)\s+(\S+)\s*$/.exec(line);

      return match?.[2] === undefined ? [] : [match[2]];
    })
    .sort();

  if (exported.join(",") !== nativeAssetSymbols.join(",")) {
    return yield* new NativeBuildFailure({ stage: "symbols" });
  }

  const compilerVersion = yield* toolOutput("gcc", ["-dumpfullversion"], reference);
  const compilerTarget = yield* toolOutput("gcc", ["-dumpmachine"], reference);
  const linkerIdentity = yield* toolOutput("ld", ["--version"], reference);
  const patcherIdentity = yield* toolOutput("patchelf", ["--version"], reference);
  const binutilsVersion = /^GNU ld \(GNU Binutils\) (\d+\.\d+(?:\.\d+)?)/.exec(linkerIdentity)?.[1];
  const patchelfVersion = /^patchelf (\d+\.\d+(?:\.\d+)?)/.exec(patcherIdentity)?.[1];

  const manifest = yield* Schema.decodeUnknownEffect(NativeAssetManifest, {
    onExcessProperty: "error",
  })({
    formatVersion: 1,
    abiVersion: 1,
    abi: nativeSymbols,
    exportedFunctions: exported,
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
    source: {
      file: sourceFile,
      byteLength: source.length,
      sha256: hex(yield* crypto.digest("SHA-256", source)),
    },
    compiler: { family: "gcc", version: compilerVersion, target: compilerTarget },
    toolchain: { sourceNarHash: toolchainSource.locked.narHash, binutilsVersion, patchelfVersion },
    reproducible: true,
  }).pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "projection" })));

  const projection = yield* Schema.encodeEffect(NativeAssetManifest, { onExcessProperty: "error" })(
    manifest,
  ).pipe(Effect.mapError(() => new NativeBuildFailure({ stage: "projection" })));

  // Both files are staged until every check and the closed projection succeed.
  yield* fs.makeDirectory(assetDirectory, { recursive: true });
  yield* fs.writeFileString(`${first}/manifest.json`, `${JSON.stringify(projection, null, 2)}\n`);
  yield* fs.copyFile(`${first}/${library}`, `${assetDirectory}/${library}`);
  yield* fs.copyFile(`${first}/manifest.json`, `${assetDirectory}/lsp-sigpipe-test.json`);
});

if (import.meta.main) {
  BunRuntime.runMain(
    program.pipe(
      Effect.scoped,
      Effect.mapError((error) =>
        Schema.is(NativeBuildFailure)(error) ? error : new NativeBuildFailure({ stage: "io" }),
      ),
      Effect.tapError((error) => Effect.logError({ stage: error.stage })),
      Effect.provide(BunServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
