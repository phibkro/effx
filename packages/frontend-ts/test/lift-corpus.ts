import { BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Path, Schema } from "effect";
import { Hex } from "effect/encoding";
import { beforeAll } from "vitest";
import { CompilerFault } from "@effx/compiler";
import { testDirectory } from "../../../tools/testing/projects.ts";
import { ts } from "../src/ts.ts";

export const corpusRoot = new URL("./fixtures/lift-corpus/", import.meta.url).pathname;

const repositoryRoot = new URL("../../../", import.meta.url).pathname;

const runtimeRoot = new URL("./fixtures/lift-corpus/runtime/", import.meta.url).pathname;

const Sha256 = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{64}$/u, { message: "Expected a lowercase hex SHA-256" }),
);

const CorpusFile = Schema.Struct({
  path: Schema.String,
  /** The hash of the exact bytes this snapshot yields for the logical path. */
  sha256: Sha256,
  /** The hash of the historical bytes of the same logical path; equal when nothing was migrated. */
  originalSha256: Sha256,
  /** Where the bytes live: the historical snapshot it derives from, or its own migrated blob. */
  origin: Schema.Literals(["historical", "migrated"]),
});

const Snapshot = Schema.Struct({
  name: Schema.String,
  /** A historical snapshot is immutable provenance; a stable snapshot is the actual acceptance input. */
  role: Schema.Literals(["historical", "stable"]),
  revision: Schema.String,
  derivedFrom: Schema.optionalKey(Schema.String),
  migration: Schema.optionalKey(Schema.String),
  /** The digest of the sorted `path<TAB>sha256` list of this snapshot's bytes. */
  snapshotSha256: Sha256,
  entry: Schema.Array(Schema.String),
  files: Schema.Array(CorpusFile),
  unresolvedGeneratedImports: Schema.Array(
    Schema.Struct({ from: Schema.String, spec: Schema.String }),
  ),
});

export const Manifest = Schema.Struct({
  repository: Schema.String,
  format: Schema.String,
  license: Schema.String,
  snapshots: Schema.Array(Snapshot),
});

export type Manifest = typeof Manifest.Type;

export type CorpusSnapshot = Manifest["snapshots"][number];

export type CorpusFile = CorpusSnapshot["files"][number];

const decodeManifest = Schema.decodeEffect(Schema.fromJsonString(Manifest));

const decodeExports = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ exports: Schema.Record(Schema.String, Schema.String) })),
);

const encodeConfig = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      compilerOptions: Schema.Struct({
        target: Schema.String,
        module: Schema.String,
        moduleResolution: Schema.String,
        strict: Schema.Boolean,
        noEmit: Schema.Boolean,
        skipLibCheck: Schema.Boolean,
        allowImportingTsExtensions: Schema.Boolean,
        paths: Schema.Record(Schema.String, Schema.Array(Schema.String)),
      }),
      files: Schema.Array(Schema.String),
      effx: Schema.Struct({ projectRoot: Schema.String, target: Schema.Literal("effect-4.0") }),
    }),
  ),
);

/** The manifest of every immutable snapshot of the corpus. */
export const readManifest = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* decodeManifest(yield* fs.readFileString(path.join(corpusRoot, "manifest.json")));
});

/** The storage path of the exact bytes a snapshot yields for one logical path. */
export const blobPath = (path: Path.Path, snapshot: CorpusSnapshot, file: CorpusFile): string =>
  path.join(
    corpusRoot,
    file.origin === "migrated" ? snapshot.name : (snapshot.derivedFrom ?? snapshot.name),
    `${file.path}.source`,
  );

/** The lowercase hex SHA-256 of exact bytes, from the platform's own Crypto service. */
export const sha256Of = Effect.fnUntraced(function* (bytes: Uint8Array) {
  const crypto = yield* Crypto.Crypto;

  return Hex.encode(yield* crypto.digest("SHA-256", bytes));
});

/**
 * Reads one logical file after proving its bytes against the manifest. A changed byte is a fault, never a
 * silently different acceptance input.
 */
export const readVerifiedBlob = Effect.fnUntraced(function* (
  snapshot: CorpusSnapshot,
  file: CorpusFile,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = blobPath(path, snapshot, file);
  const bytes = yield* fs.readFile(source);

  if ((yield* sha256Of(bytes)) !== file.sha256)
    return yield* new CompilerFault({
      stage: "lift-corpus",
      message: `immutable source changed: ${snapshot.name}/${file.path}`,
    });

  return { source, bytes };
});

/**
 * The corpus runtime is installed once from its frozen lock, never by a test:
 * `bun install --frozen-lockfile --cwd packages/frontend-ts/test/fixtures/lift-corpus/runtime`.
 */
export const requireLiftCorpusRuntime = () => {
  beforeAll(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        return yield* fs.exists(path.join(runtimeRoot, "node_modules/effect/package.json"));
      }).pipe(Effect.provide(BunServices.layer)),
    ).then((exists) => {
      if (!exists)
        throw new Error(
          `lift corpus runtime dependencies are missing; run bun install --frozen-lockfile --cwd "${runtimeRoot}" before running the tests.`,
        );
    }),
  );
};

/**
 * The test scope owns each copy of the stable snapshots, the actual acceptance inputs. The authored
 * bytes and the historical provenance stay read-only.
 */
export const copyLiftCorpus = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const manifest = yield* readManifest();
  const parent = yield* testDirectory("lift-corpus-");

  const snapshots: Array<{
    readonly name: string;
    readonly directory: string;
    readonly tsconfigPath: string;
    readonly revision: string;
    readonly snapshotSha256: string;
    readonly unresolvedGeneratedImports: CorpusSnapshot["unresolvedGeneratedImports"];
  }> = [];

  for (const snapshot of manifest.snapshots) {
    if (snapshot.role !== "stable") continue;
    const directory = path.join(parent, snapshot.name);
    yield* fs.makeDirectory(directory, { recursive: true });
    yield* fs.symlink(path.join(runtimeRoot, "node_modules"), path.join(directory, "node_modules"));

    for (const file of snapshot.files) {
      const { source } = yield* readVerifiedBlob(snapshot, file);
      const destination = path.join(directory, file.path);
      yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
      yield* fs.copyFile(source, destination);
    }

    const domain = yield* decodeExports(
      yield* fs.readFileString(path.join(directory, "packages/domain/package.json")),
    );

    const paths: Record<string, ReadonlyArray<string>> = {};
    paths["@effx/runtime"] = [path.join(repositoryRoot, "packages/runtime/src/index.ts")];
    paths["@effx/runtime/diagnostics"] = [
      path.join(repositoryRoot, "packages/runtime/src/diagnostics.ts"),
    ];
    paths["@effx/diagnostics"] = [path.join(repositoryRoot, "packages/diagnostics/src/index.ts")];

    for (const [key, value] of Object.entries(domain.exports))
      paths[key === "." ? "@vektorprogrammet/domain" : `@vektorprogrammet/domain/${key.slice(2)}`] =
        [path.join(directory, "packages/domain", value)];
    const tsconfigPath = path.join(directory, "tsconfig.json");
    yield* fs.writeFileString(
      tsconfigPath,
      yield* encodeConfig({
        compilerOptions: {
          target: "ESNext",
          module: "ESNext",
          moduleResolution: "bundler",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          allowImportingTsExtensions: true,
          paths,
        },
        files: snapshot.entry,
        effx: { projectRoot: ".", target: "effect-4.0" },
      }),
    );
    snapshots.push({
      name: snapshot.name,
      directory,
      tsconfigPath,
      revision: snapshot.revision,
      snapshotSha256: snapshot.snapshotSha256,
      unresolvedGeneratedImports: snapshot.unresolvedGeneratedImports,
    });
  }

  return { parent, snapshots, manifest };
});

/**
 * One TypeScript diagnostic of a copied snapshot's own sources. A missing generated contract reads as
 * `module not found` with its specifier; every other diagnostic keeps its full message.
 */
export const snapshotDiagnostics = (snapshot: {
  readonly directory: string;
  readonly tsconfigPath: string;
}): ReadonlyArray<string> => {
  const read = ts.readConfigFile(snapshot.tsconfigPath, (file) => ts.sys.readFile(file));
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, snapshot.directory);
  const program = ts.createProgram(parsed.fileNames, parsed.options);

  return ts
    .getPreEmitDiagnostics(program)
    .filter(
      (diagnostic) =>
        diagnostic.file === undefined || !diagnostic.file.fileName.includes("/node_modules/"),
    )
    .map((diagnostic) => {
      const file =
        diagnostic.file === undefined
          ? ""
          : diagnostic.file.fileName.slice(snapshot.directory.length + 1);

      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      const missing = /^Cannot find module '([^']+)'/u.exec(message);

      return missing === null
        ? `${file} TS${diagnostic.code} ${message}`
        : `${file} module not found ${missing[1]}`;
    })
    .toSorted();
};
