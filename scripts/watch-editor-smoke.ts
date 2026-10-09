import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Path, Schema, Stdio, Stream } from "effect";
import { acquireCommand } from "../packages/cli/test/packed-watch-peer.ts";
import { acquirePeer } from "./lsp-test-peer.ts";
import type { PackedCommand } from "../packages/cli/test/packed-watch-peer.ts";
import type { PeerError } from "./lsp-test-peer.ts";
import { PackedStdoutReceipt, regularStdoutSentinel } from "./packed-lsp-stdout.ts";
import { publicInstall, workspaceOverrides } from "./install-public.ts";

/**
 * After the committed-reference gate and pack: bun scripts/watch-editor-smoke.ts <final-SHA>
 * Consumes (never builds, packs, or publishes) dist-artifacts/manifest.json.
 * The root scope owns the disposable consumer and every real installed CLI child.
 * Receipts are completed dev cycles, versioned diagnostic publications, and child exits;
 * deadlines fail the journey, never stand in for successful observation.
 */
class SmokeFailure extends Schema.TaggedError<SmokeFailure>()("SmokeFailure", {
  journey: Schema.String,
}) {
  override get message() {
    return this.journey;
  }
}

const requireThat = (condition: boolean, journey: string) =>
  condition ? Effect.void : Effect.fail(new SmokeFailure({ journey }));

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

const ArtifactManifest = Schema.Struct({
  commit: Schema.String,
  sha256s: Schema.Record(Schema.String, Schema.String),
});

const decodeArtifacts = Schema.decodeUnknownEffect(Schema.fromJsonString(ArtifactManifest));

const Point = Schema.Struct({ line: Schema.Int, character: Schema.Int });

const Published = Schema.Struct({
  uri: Schema.String,
  version: Schema.optionalKey(Schema.Int),
  diagnostics: Schema.Array(
    Schema.Struct({
      code: Schema.String,
      severity: Schema.Int,
      message: Schema.String,
      source: Schema.String,
      range: Schema.Struct({ start: Point, end: Point }),
    }),
  ),
});

const decodePublished = Schema.decodeUnknownEffect(Published);

const isPublished = Schema.is(Published);

const isLog = Schema.is(Schema.Struct({ message: Schema.String }));

interface EditorReceipts {
  readonly request: (
    method: string,
    params?: Schema.Json,
  ) => Effect.Effect<Schema.Json, PeerError | Schema.SchemaError>;
  readonly notification: (method: string, params?: Schema.Json) => Effect.Effect<void, PeerError>;
  readonly waitNotification: (
    method: string,
    predicate?: (params: Schema.Json) => boolean,
  ) => Effect.Effect<Schema.Json>;
  readonly exit: Effect.Effect<{ code: number | null; signal: string | null }>;
  readonly protocolErrorCount: Effect.Effect<number>;
}

const publication = Effect.fnUntraced(function* (
  peer: EditorReceipts,
  uri: string,
  version?: number,
) {
  return yield* decodePublished(
    yield* peer.waitNotification(
      "textDocument/publishDiagnostics",
      (value) =>
        isPublished(value) &&
        value.uri === uri &&
        (version === undefined || value.version === version),
    ),
  );
});

const stopEditor = Effect.fnUntraced(function* (peer: EditorReceipts) {
  yield* requireThat((yield* peer.request("shutdown")) === null, "LSP shutdown response");
  yield* peer.notification("exit");
  yield* requireThat((yield* peer.exit).code === 0, "LSP clean exit");
  yield* requireThat(
    (yield* peer.protocolErrorCount) === 0,
    "maintained client observes protocol-only stdout",
  );
});

const parameters = {
  processId: null,
  capabilities: { textDocument: { publishDiagnostics: { versionSupport: true } } },
} satisfies Schema.Json;

const smoke = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const stdio = yield* Stdio.Stdio;
  const args = yield* stdio.args;
  const expectedSourceSHA = args[0] ?? "";
  yield* requireThat(
    args.length === 1 && /^[a-f0-9]{40}$/.test(expectedSourceSHA ?? ""),
    "Usage: bun scripts/watch-editor-smoke.ts <40-character-final-SHA>",
  );
  const root = yield* path.fromFileUrl(new URL("../", import.meta.url));
  const artifacts = path.join(root, "dist-artifacts");

  const manifest = yield* decodeArtifacts(
    yield* fs.readFileString(path.join(artifacts, "manifest.json")),
  );

  yield* requireThat(
    manifest.commit === expectedSourceSHA,
    "manifest commit equals expected final SHA",
  );

  const digest = Effect.fnUntraced(function* (file: string) {
    return Array.from(yield* crypto.digest("SHA-256", yield* fs.readFile(file)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  });

  const dependencies = new Map<string, string>([
    ["effect", "4.0.0"],
    ["@effect/platform-bun", "4.0.0"],
    ["@typescript/typescript6", "6.0.2"],
    ["vscode-jsonrpc", "9.0.3"],
  ]);

  const packages = ["diagnostics", "runtime", "ir", "compiler", "persistence", "cli"];
  yield* requireThat(
    Object.keys(manifest.sha256s).length === packages.length,
    "six distribution artifacts",
  );

  for (const name of packages) {
    const candidates = Object.keys(manifest.sha256s).filter(
      (filename) =>
        filename.startsWith(`effx-${name}-`) &&
        filename.endsWith(`-${expectedSourceSHA}.tgz`) &&
        path.basename(filename) === filename,
    );

    yield* requireThat(candidates.length === 1, `exact artifact for @effx/${name}`);
    const filename = candidates[0]!;
    const file = path.join(artifacts, filename);
    yield* requireThat(
      (yield* digest(file)) === manifest.sha256s[filename],
      `tarball byte integrity: ${name}`,
    );
    dependencies.set(`@effx/${name}`, `file:${file}`);
  }

  const owned = yield* fs.makeTempDirectoryScoped({ prefix: "effx-packed-watch-" });
  const consumer = path.join(owned, "consumer");
  yield* fs.makeDirectory(consumer);

  const write = Effect.fnUntraced(function* (relative: string, content: string) {
    yield* fs.writeFileString(path.join(consumer, relative), content);
  });

  yield* write(
    "package.json",
    yield* encodeJson({
      name: "effx-watch-editor-acceptance-consumer",
      version: "1.0.0",
      type: "module",
      dependencies: Object.fromEntries(dependencies),
      overrides: workspaceOverrides(dependencies),
    }),
  );

  const run = Effect.fnUntraced(function* (executable: string, commandArgs: ReadonlyArray<string>) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* acquireCommand(consumer, executable, commandArgs);
        yield* child.eof;

        return yield* child.finish;
      }),
    ).pipe(Effect.timeout("120 seconds"));
  });

  yield* publicInstall(consumer, false, true);
  const lock = yield* fs.readFile(path.join(consumer, "bun.lock"));

  const lockHash = Array.from(yield* crypto.digest("SHA-256", lock), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

  yield* publicInstall(consumer, true, true);
  yield* requireThat(
    (yield* digest(path.join(consumer, "bun.lock"))) === lockHash,
    "consumer lockfile unchanged",
  );
  const cli = path.join(consumer, "node_modules", ".bin", "effx");

  const clean = `import { Operation } from "@effx/runtime";
import { Effect, Schema } from "effect";
export const Input = Schema.Struct({});
export const Output = Schema.String;
export const route = () => "/smoke";
export const read = Operation.query({ name: "Smoke.Read", input: Input, success: Output })
  /*😀*/ .http.get("/smoke")
  .handler((_input: typeof Input.Type) => Effect.succeed("ok"));
throw new Error("Application modules must never execute");
`;

  const broken = clean.replace('.http.get("/smoke")', ".http.get(route())");

  const project = yield* encodeJson({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      skipLibCheck: true,
    },
    include: ["app.ts"],
    effx: { emit: "all" },
  });

  yield* write("tsconfig.json", project);
  yield* write("app.ts", clean);
  const cfgSentinel = path.join(consumer, "config-imports.txt");
  const sentinel = yield* encodeJson(cfgSentinel);

  const config = `import { defineConfig } from "@effx/cli/config";
await Bun.write(${sentinel}, (await Bun.file(${sentinel}).exists() ? await Bun.file(${sentinel}).text() : "") + "import\\n");
export default defineConfig({ outDir: ".effx/custom", generators: { http: true } });
`;

  yield* write("effx.config.ts", config);
  // Read-only check/dev/LSP may evaluate selected config, but never emit output.
  yield* requireThat((yield* run(cli, ["check"])).code === 0, "installed one-shot clean check");
  yield* write("app.ts", broken);
  const checked = yield* run(cli, ["check"]);
  yield* requireThat(
    checked.code !== 0 && checked.text.includes("EFFX1102"),
    "installed registered compiler error",
  );

  const diagnosticLine = checked.text
    .split("\n")
    .find((line) => line.includes("EFFX1102"))!
    .trim();

  yield* write("app.ts", clean);
  // Snapshot all consumer-owned inputs, including unexpected hidden cache/output
  // entries. Dependencies and the explicit config evaluation receipt are excluded.

  const snapshotInputs = Effect.fnUntraced(function* () {
    const entries: Array<string> = [];
    const pending = [consumer];

    while (pending.length > 0) {
      const directory = pending.pop()!;

      for (const name of (yield* fs.readDirectory(directory)).sort()) {
        const file = path.join(directory, name);

        if (file === path.join(consumer, "node_modules") || file === cfgSentinel) continue;
        const relative = path.relative(consumer, file);
        const info = yield* fs.stat(file);
        entries.push(`${relative}:${info.type}:${info.mode}`);

        if (info.type === "Directory") pending.push(file);
        else entries.push(`${relative}:${yield* digest(file)}`);
      }
    }

    return entries.sort().join("\n");
  });

  // Amendment B: an actual maintained Node topology passes an owned regular
  // descriptor as the installed CLI's fd1. No stdin bytes or EOF can cause the
  // refusal. This fails on late rejection, accidental output, or config/artifact
  // writes; native writer exclusion remains the separate Root acquisition law.
  const regularStdoutFile = path.join(owned, "protocol.log");
  yield* fs.writeFileString(regularStdoutFile, regularStdoutSentinel);
  const beforeRegularStdout = yield* snapshotInputs();
  const beforeRegularConfig = yield* digest(cfgSentinel);

  const regularStdoutPeer = yield* run("node", [
    path.join(root, "scripts", "packed-lsp-stdout.ts"),
    cli,
    consumer,
    regularStdoutFile,
  ]);

  yield* requireThat(regularStdoutPeer.code === 0, "packed regular-stdout peer joins successfully");

  const regularStdout = yield* Schema.decodeEffect(Schema.fromJsonString(PackedStdoutReceipt), {
    onExcessProperty: "error",
  })(regularStdoutPeer.text.trim());

  yield* requireThat(
    regularStdout.fileUnchanged &&
      regularStdout.fd1Before.device === regularStdout.fd1After.device &&
      regularStdout.fd1Before.inode === regularStdout.fd1After.inode &&
      (yield* fs.readFileString(regularStdoutFile)) === regularStdoutSentinel,
    "packed regular fd1 preserves identity and receives zero protocol bytes",
  );
  yield* requireThat(
    (yield* snapshotInputs()) === beforeRegularStdout &&
      (yield* digest(cfgSentinel)) === beforeRegularConfig &&
      !(yield* fs.exists(path.join(consumer, ".effx"))),
    "regular-stdout refusal preserves config receipt and all consumer bytes",
  );

  const defaultSnapshot = yield* snapshotInputs();
  let cycles = 0;
  const completedCycles = new Map<PackedCommand, number>();

  const cycle = Effect.fnUntraced(function* (child: PackedCommand, errors: number) {
    const summary = yield* child.next((line) =>
      /^\d+ error\(s\), \d+ warning\(s\), \d+ info$/.test(line.trim()),
    );

    const markers = Array.from((yield* child.output).matchAll(/^effx dev cycle (\d+)$/gm));
    const marker = Number(markers.at(-1)?.[1]);
    yield* requireThat(
      Number.isSafeInteger(marker) && marker > (completedCycles.get(child) ?? 0),
      "dev completed cycle markers increase",
    );
    completedCycles.set(child, marker);
    yield* requireThat(
      summary.trim().startsWith(`${errors} error(s),`),
      "completed dev replacement count",
    );
    cycles++;
  });

  const beforeDefault = yield* fs.readFileString(path.join(consumer, "tsconfig.json"));
  yield* Effect.scoped(
    Effect.gen(function* () {
      const dev = yield* acquireCommand(consumer, cli, ["dev"]);
      yield* cycle(dev, 0);
      yield* write("app.ts", broken);
      const observed = yield* dev.next((line) => line.includes("EFFX1102"));
      yield* requireThat(
        observed.trim() === diagnosticLine,
        "dev uses identical check diagnostic bytes",
      );
      yield* cycle(dev, 1);
      yield* write("app.ts", clean);
      yield* cycle(dev, 0);
      yield* requireThat(
        (yield* fs.readFileString(cfgSentinel)) === "import\nimport\nimport\n",
        "default dev imports config once despite error and repair",
      );
      yield* dev.interrupt;

      const stopped = yield* dev.finish;

      yield* requireThat(stopped.code === 130, "default dev SIGINT joins cleanly");
      yield* write("app.ts", broken);
      yield* write("app.ts", clean);
      yield* requireThat(
        (yield* dev.output) === stopped.text,
        "post-stop native edits cannot publish output",
      );
    }),
  ).pipe(Effect.timeout("45 seconds"));
  yield* requireThat(
    !(yield* fs.exists(path.join(consumer, ".effx"))),
    "default dev no effx output",
  );
  yield* requireThat(
    (yield* fs.readFileString(path.join(consumer, "tsconfig.json"))) === beforeDefault,
    "default dev preserves project config",
  );
  yield* Effect.scoped(
    Effect.gen(function* () {
      const dev = yield* acquireCommand(consumer, cli, ["dev"]);
      yield* cycle(dev, 0);
      yield* dev.eof;
      yield* requireThat((yield* dev.finish).code === 0, "default dev EOF stop");
    }),
  ).pipe(Effect.timeout("30 seconds"));
  yield* requireThat(
    (yield* snapshotInputs()) === defaultSnapshot,
    "default dev complete no-write input snapshot",
  );

  // Normal writer authority, failure preservation, custom output, manifest-only
  // obsolete removal, and a competing actual packed writer (not a fake lock).
  for (const outDir of [".effx/generated", ".effx/custom"]) {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const dev = yield* acquireCommand(consumer, cli, ["dev", "--build", "--out-dir", outDir]);
        yield* cycle(dev, 0);
        yield* dev.next((line) => line.startsWith("wrote "));
        const manifestFile = path.join(consumer, ".effx", "manifest.json");
        const beforeManifest = yield* fs.readFileString(manifestFile);
        const beforeIR = yield* digest(path.join(consumer, ".effx", "ir.json"));

        const generated = yield* Schema.decodeEffect(
          Schema.fromJsonString(Schema.Struct({ generated: Schema.Array(Schema.String) })),
        )(beforeManifest);

        yield* requireThat(generated.generated.length > 0, "packed generation emits projections");
        const hashes = new Map<string, string>();

        for (const file of generated.generated)
          hashes.set(file, yield* digest(path.resolve(consumer, ".effx", file)));
        yield* write("app.ts", broken);
        yield* cycle(dev, 1);
        yield* requireThat(
          (yield* fs.readFileString(manifestFile)) === beforeManifest &&
            (yield* digest(path.join(consumer, ".effx", "ir.json"))) === beforeIR,
          "invalid cycle preserves metadata",
        );

        for (const [file, hash] of hashes)
          yield* requireThat(
            (yield* digest(path.resolve(consumer, ".effx", file))) === hash,
            "invalid cycle preserves generated bytes",
          );
        yield* write("app.ts", clean);
        yield* cycle(dev, 0);
        yield* dev.next((line) => line.startsWith("wrote "));
        const competing = yield* run(cli, ["build", "--out-dir", outDir]);
        yield* requireThat(
          competing.code !== 0 && competing.text.includes("already owned"),
          "competing packed writer refused",
        );
        const alias = path.join(consumer, "output-alias");
        yield* fs.symlink(path.join(consumer, outDir), alias);
        yield* Effect.scoped(
          Effect.gen(function* () {
            const other = yield* acquireCommand(consumer, cli, [
              "dev",
              "--build",
              "--out-dir",
              alias,
            ]);

            yield* other.next((line) => line.includes("already owned"));
            yield* other.eof;
            const refused = yield* other.finish;
            yield* requireThat(
              !refused.text.includes("wrote "),
              "symlink competing watch refuses writes",
            );
          }),
        );
        yield* fs.remove(alias);
        yield* requireThat(
          (yield* fs.readFileString(manifestFile)) === beforeManifest,
          "competing writers preserve manifest",
        );
        yield* fs.writeFileString(path.join(consumer, outDir, "unrelated.txt"), "keep\n");
        const oldHttp = path.join(consumer, outDir, "http.ts");
        yield* requireThat(yield* fs.exists(oldHttp), "initial HTTP projection exists");
        yield* write("app.ts", clean.replace('  /*😀*/ .http.get("/smoke")\n', ""));
        yield* cycle(dev, 0);
        yield* dev.next((line) => line.startsWith("wrote "));
        yield* requireThat(
          !(yield* fs.exists(oldHttp)),
          "manifest-owned obsolete projection removed",
        );
        yield* requireThat(
          (yield* fs.readFileString(path.join(consumer, outDir, "unrelated.txt"))) === "keep\n",
          "unowned sentinel preserved",
        );
        yield* dev.interrupt;
        yield* dev.finish;
      }),
    ).pipe(Effect.timeout("60 seconds"));
    yield* write("app.ts", clean);
  }

  yield* fs.remove(path.join(consumer, ".effx"), { recursive: true });
  yield* fs.remove(cfgSentinel);
  const uri = (yield* path.toFileUrl(path.join(consumer, "app.ts"))).href;
  const configPath = path.join(consumer, "effx.config.ts");
  const editorSnapshot = yield* snapshotInputs();
  yield* Effect.scoped(
    Effect.gen(function* () {
      const denied = yield* acquirePeer(true, { cwd: consumer, main: cli, args: ["lsp"] });

      const error = yield* denied.requestError("initialize", {
        ...parameters,
        initializationOptions: { trustConfig: true },
      });

      yield* requireThat(
        error.code === -32603 && error.message.includes("--trust-config"),
        "editor cannot grant config trust",
      );
      yield* requireThat(!(yield* fs.exists(cfgSentinel)), "trust denied before config import");
      yield* denied.eof;
      yield* denied.exit;
      yield* requireThat(
        (yield* denied.protocolErrorCount) === 0,
        "trust denial remains protocol-only stdout",
      );
    }),
  ).pipe(Effect.timeout("30 seconds"));
  let diagnosticCount = 0;
  yield* Effect.scoped(
    Effect.gen(function* () {
      const peer = yield* acquirePeer(true, {
        cwd: consumer,
        main: cli,
        args: ["lsp", "--config", configPath, "--exec-file", configPath],
      });

      yield* peer.request("initialize", parameters);
      yield* peer.notification("initialized", {});
      yield* peer.notification("textDocument/didOpen", {
        textDocument: { uri, languageId: "typescript", version: 1, text: broken },
      });
      const error = yield* publication(peer, uri, 1);
      const diagnostic = error.diagnostics.find((value) => value.code === "EFFX1102");
      yield* requireThat(diagnostic !== undefined, "unsaved registered diagnostic");
      diagnosticCount += error.diagnostics.length;

      if (diagnostic !== undefined) {
        const line = broken.split("\n")[diagnostic.range.start.line]!;
        yield* requireThat(
          diagnostic.source === "effx" &&
            diagnostic.severity === 1 &&
            diagnosticLine.includes(diagnostic.message) &&
            diagnosticLine.endsWith(
              `:${diagnostic.range.start.line + 1}:${diagnostic.range.start.character + 1}`,
            ) &&
            line.includes("😀"),
          "LSP UTF-16 point and diagnostic match saved check",
        );
      }

      const offset = broken.indexOf("route())", broken.indexOf("/*😀*/"));
      const preceding = broken.slice(0, offset).split("\n");
      const start = { line: preceding.length - 1, character: preceding.at(-1)!.length };
      yield* peer.notification("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [
          {
            range: { start, end: { ...start, character: start.character + "route()".length } },
            text: '"/smoke"',
          },
        ],
      });
      yield* requireThat(
        (yield* publication(peer, uri, 2)).diagnostics.length === 0,
        "UTF-16 ranged repair clears",
      );
      yield* peer.notification("textDocument/didChange", {
        textDocument: { uri, version: 3 },
        contentChanges: [{ text: broken }],
      });
      yield* requireThat(
        (yield* publication(peer, uri, 3)).diagnostics.some((value) => value.code === "EFFX1102"),
        "full replacement diagnostic version",
      );
      yield* peer.notification("textDocument/didChange", {
        textDocument: { uri, version: 2 },
        contentChanges: [{ text: clean }],
      });
      yield* peer.notification("textDocument/didChange", {
        textDocument: { uri, version: 4 },
        contentChanges: [{ text: clean }],
      });
      yield* requireThat(
        (yield* publication(peer, uri, 4)).diagnostics.length === 0,
        "newest accepted repair clears",
      );
      yield* peer.notification("textDocument/didClose", { textDocument: { uri } });
      yield* requireThat(
        (yield* publication(peer, uri, 4)).diagnostics.length === 0,
        "close clears document",
      );
      yield* requireThat(
        (yield* fs.readFileString(cfgSentinel)) === "import\n",
        "config imported once across overlays",
      );
      yield* stopEditor(peer);
    }),
  ).pipe(Effect.timeout("45 seconds"));
  yield* requireThat(
    (yield* fs.readFileString(path.join(consumer, "app.ts"))) === clean &&
      !(yield* fs.exists(path.join(consumer, ".effx"))),
    "LSP leaves source and effx disk untouched",
  );
  yield* requireThat(
    (yield* snapshotInputs()) === editorSnapshot,
    "LSP complete no-write input snapshot",
  );

  // Critical A aliases: actual public package import plus an external computed
  // route. Old physical target bytes remain unchanged when the logical route moves.
  const staticAlias = path.join(consumer, "node_modules", "smoke-config");
  const computedAlias = path.join(owned, "computed-alias");
  const targets = [path.join(owned, "target-a"), path.join(owned, "target-b")];

  for (const target of targets) {
    yield* fs.makeDirectory(target);
    yield* fs.writeFileString(
      path.join(target, "package.json"),
      yield* encodeJson({
        name: "smoke-config",
        version: "1.0.0",
        type: "module",
        exports: "./index.ts",
      }),
    );
    yield* fs.writeFileString(path.join(target, "index.ts"), "export const enabled = true;\n");
  }

  yield* fs.symlink(targets[0]!, staticAlias);
  yield* fs.symlink(targets[0]!, computedAlias);

  const aliasConfig = `import { defineConfig } from "@effx/cli/config";
import { enabled } from "smoke-config";
const suffix = "alias/index.ts";
const computed = await import("../computed-" + suffix);
await Bun.write(${sentinel}, (await Bun.file(${sentinel}).exists() ? await Bun.file(${sentinel}).text() : "") + "import\\n");
export default defineConfig({ strictAccess: !enabled || !computed.enabled,
  executableCoverage: { files: ["node_modules/smoke-config/index.ts", "../computed-alias/index.ts"] } });
`;

  yield* write("effx.config.ts", aliasConfig);

  for (const alias of [staticAlias, computedAlias]) {
    yield* fs.remove(cfgSentinel);
    const oldTarget = yield* digest(path.join(targets[0]!, "index.ts"));
    yield* Effect.scoped(
      Effect.gen(function* () {
        const peer = yield* acquirePeer(true, {
          cwd: consumer,
          main: cli,
          args: ["lsp", "--config", configPath],
        });

        yield* peer.request("initialize", parameters);
        yield* peer.notification("initialized", {});
        yield* peer.notification("textDocument/didOpen", {
          textDocument: { uri, languageId: "typescript", version: 1, text: broken },
        });
        yield* requireThat(
          (yield* publication(peer, uri, 1)).diagnostics.some((value) => value.code === "EFFX1102"),
          "alias epoch starts with real compiler error",
        );
        const replacement = alias + "-next";
        yield* fs.symlink(targets[1]!, replacement);
        yield* fs.rename(replacement, alias);
        yield* requireThat(
          (yield* publication(peer, uri, 1)).diagnostics.length === 0,
          "alias retarget clears stale diagnostics",
        );
        yield* peer.waitNotification(
          "window/logMessage",
          (value) => isLog(value) && value.message.includes("RestartRequired"),
        );
        yield* peer.notification("textDocument/didChange", {
          textDocument: { uri, version: 2 },
          contentChanges: [{ text: broken }],
        });
        yield* requireThat(
          (yield* peer.requestError("unknown", {})).code === -32601,
          "suspended editor remains responsive",
        );
        const pending = yield* peer.notifications;
        yield* requireThat(
          !pending.some(
            (value) =>
              value.method === "textDocument/publishDiagnostics" &&
              isPublished(value.params) &&
              value.params.version === 2 &&
              value.params.diagnostics.length > 0,
          ),
          "suspended epoch cannot republish diagnostics",
        );
        yield* requireThat(
          (yield* fs.readFileString(cfgSentinel)) === "import\n" &&
            (yield* digest(path.join(targets[0]!, "index.ts"))) === oldTarget,
          "retarget does not re-import or edit old target",
        );
        yield* stopEditor(peer);
      }),
    ).pipe(Effect.timeout("45 seconds"));
    yield* fs.remove(alias);
    yield* fs.symlink(targets[0]!, alias);
  }

  for (const [filename, hash] of Object.entries(manifest.sha256s))
    yield* requireThat(
      (yield* digest(path.join(artifacts, filename))) === hash,
      "artifact tarballs remain untouched",
    );
  yield* requireThat(
    !(yield* fs.exists(path.join(consumer, ".effx"))),
    "editor aliases create no output",
  );
  yield* Stream.succeed(
    (yield* encodeJson({
      expectedSourceSHA,
      journeys: [
        "integrity",
        "install",
        "frozen-install",
        "check",
        "dev",
        "dev-eof",
        "build-normal",
        "build-custom",
        "writer-refusal",
        "manifest-obsolete",
        "trust",
        "lsp-regular-stdout-refusal",
        "lsp-overlays",
        "static-package-alias",
        "external-computed-alias",
      ],
      cycles,
      diagnosticCount,
      noWrite: { defaultDev: true, lsp: true, regularStdout: true },
      regularStdout,
      protocolErrorCount: 0,
      tarballs: packages.length,
    })) + "\n",
  ).pipe(Stream.run(stdio.stdout()));
});

BunRuntime.runMain(smoke.pipe(Effect.scoped, Effect.provide(BunServices.layer)));
