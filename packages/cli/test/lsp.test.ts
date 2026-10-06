import { assert, describe, it } from "@effect/vitest";
import { Cause, Crypto, Effect, Exit, FileSystem, Layer, Option, Path, Schema } from "effect";
import { bundledDiagnosticEntries, compile, SourceFrontend } from "@effx/compiler";
import { BunServices } from "@effect/platform-bun";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { copyUsersFixture, encodeJsonString } from "../../../tools/testing/projects.ts";
import { resolveProject } from "../src/commands.ts";
import { acquirePeer } from "./lsp-transport-peer.ts";
import { expectTypeOf } from "vitest";
import { lsp } from "../src/lsp.ts";
import type { LspIO, TransportError } from "../src/lsp-transport.ts";
import {
  capabilities,
  decodeChange,
  decodeInitialize,
  pointRange,
  projectDiagnostic,
  selectRoot,
} from "../src/lsp-model.ts";

const TsconfigJson = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

const decodeTsconfig = Schema.decodeEffect(TsconfigJson);

const encodeTsconfig = Schema.encodeEffect(TsconfigJson);

describe("LSP method boundary and projection", () => {
  it("construction never acquires IO and keeps platform/frontend requirements", () => {
    let acquisitions = 0;

    const program = lsp({
      io: Effect.sync((): LspIO => {
        acquisitions++;
        throw new Error("Construction must not run IO");
      }),
    });

    assert.isTrue(Effect.isEffect(program));
    assert.strictEqual(acquisitions, 0);
    expectTypeOf<Effect.Success<typeof program>>().toEqualTypeOf<number>();
    expectTypeOf<Effect.Error<typeof program>>().toEqualTypeOf<TransportError>();
    expectTypeOf<Effect.Error<typeof program>>().not.toEqualTypeOf<never>();
    expectTypeOf<Effect.Services<typeof program>>().toEqualTypeOf<
      Crypto.Crypto | FileSystem.FileSystem | Path.Path | SourceFrontend
    >();
    expectTypeOf<Effect.Services<typeof program>>().not.toEqualTypeOf<never>();
    expectTypeOf<
      Effect.Error<ReturnType<typeof decodeInitialize>>
    >().toEqualTypeOf<Schema.SchemaError>();
  });
  it.effect("rejects malformed ranges rather than treating them as full replacements", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        decodeChange({
          textDocument: { uri: "file:///a.ts", version: 2 },
          contentChanges: [
            {
              range: { start: { line: -1, character: 0 }, end: { line: 0, character: 0 } },
              text: "secret",
            },
          ],
        }),
      );

      assert.strictEqual(error._tag, "SchemaError");
    }),
  );

  it.effect("decodes full replacements and sequential UTF-16 edits without altering text", () =>
    Effect.gen(function* () {
      const value = yield* decodeChange({
        textDocument: { uri: "file:///a.ts", version: 2 },
        contentChanges: [
          { text: "😀\r\na" },
          {
            range: { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } },
            text: "b",
          },
        ],
      });

      assert.strictEqual(value.contentChanges[0]?.text, "😀\r\na");
      assert.deepStrictEqual(value.contentChanges[1]?.range?.start, { line: 0, character: 2 });
    }),
  );

  it.effect("selects one declared root and never guesses among multiple folders", () =>
    Effect.gen(function* () {
      const params = yield* decodeInitialize({
        capabilities: {},
        rootUri: "file:///fallback",
        rootPath: "/legacy",
        workspaceFolders: [
          { uri: "file:///one", name: "one" },
          { uri: "file:///two", name: "two" },
        ],
      });

      assert.strictEqual(selectRoot(params, undefined, "/startup"), undefined);
      assert.deepStrictEqual(selectRoot(params, "relative/tsconfig.json", "/startup"), {
        kind: "path",
        value: "relative/tsconfig.json",
      });
      assert.deepStrictEqual(
        selectRoot(
          {
            capabilities: {},
            workspaceFolders: [{ uri: "file:///one", name: "one" }],
            rootUri: "file:///fallback",
          },
          undefined,
          "/startup",
        ),
        { kind: "uri", value: "file:///one" },
      );
      assert.deepStrictEqual(selectRoot({ capabilities: {} }, undefined, "/startup"), {
        kind: "path",
        value: "/startup",
      });
    }),
  );

  it("advertises only implemented synchronization, including textless save", () => {
    assert.deepStrictEqual(capabilities, {
      capabilities: {
        positionEncoding: "utf-16",
        textDocumentSync: { openClose: true, change: 2, save: { includeText: false } },
      },
    });
  });

  it("preserves point bounds across CRLF and astral text without inventing spans", () => {
    assert.deepStrictEqual(pointRange({ file: "a", line: 2, col: 2 }, "😀\r\nx"), {
      start: { line: 1, character: 1 },
      end: { line: 1, character: 1 },
    });
    assert.strictEqual(pointRange({ file: "a", line: 1, col: 2 }, "😀"), undefined);
    assert.strictEqual(pointRange({ file: "a", line: 2, col: 3 }, "😀\r\nx"), undefined);
    assert.strictEqual(pointRange({ file: "a", line: 0, col: 1 }, "x"), undefined);
  });

  it("preserves compiler occurrence bytes and encodes only bundled full-code anchors", () => {
    const code = "EFFX[@effx/persistence]/0001";
    const lookup = () => ({ uri: "file:///a.ts", text: "😀x" });

    const support = {
      relatedInformation: true,
      codeDescription: true,
      bundledCodes: { has: (candidate: string) => candidate === code },
      registryHref: "https://example.test/docs/diagnostics/registry/",
    };

    const result = projectDiagnostic(
      {
        code,
        severity: "warning",
        message: "exact\nmessage",
        location: { file: "a", line: 1, col: 3 },
        related: [
          {
            code: "EFFX0001",
            severity: "info",
            message: "related",
            location: { file: "b", line: 1, col: 1 },
          },
          { code: "EFFX0002", severity: "error", message: "unlocated" },
        ],
      },
      lookup,
      support,
    );

    assert.deepStrictEqual(result?.diagnostic, {
      range: { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } },
      severity: 2,
      source: "effx",
      code,
      message: "exact\nmessage\n\nRelated diagnostics:\nerror EFFX0002: unlocated",
      relatedInformation: [
        {
          location: {
            uri: "file:///a.ts",
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          },
          message: "related",
        },
      ],
      codeDescription: {
        href: `https://example.test/docs/diagnostics/registry/#${encodeURIComponent(code)}`,
      },
    });
    assert.strictEqual(result?.logs.length, 1);

    for (const log of result?.logs ?? []) {
      assert.include(log, "EFFX0002");
      assert.include(log, "effx explain");
    }

    const foreign = projectDiagnostic(
      {
        code: "EFFX[third-party]/0001",
        severity: "info",
        message: "foreign",
        location: { file: "a", line: 1, col: 1 },
      },
      lookup,
      support,
    );

    assert.notProperty(foreign!.diagnostic, "codeDescription");
  });
  it("retains primary bytes and related fallback context with selected third-party explain authority", () => {
    const primary = "Occurrence\r\n😀";
    const code = "EFFX[third-party]/0001";
    const selectedConfig = "/workspace/trusted config.ts";

    const result = projectDiagnostic(
      {
        code,
        severity: "error",
        message: primary,
        location: { file: "a", line: 1, col: 1 },
        related: [
          { code, severity: "warning", message: "unlocated context" },
          {
            code,
            severity: "info",
            message: "located context",
            location: { file: "b", line: 1, col: 1 },
          },
        ],
      },
      () => ({ uri: "file:///a.ts", text: "x" }),
      {
        relatedInformation: false,
        codeDescription: true,
        bundledCodes: { has: () => false },
        registryHref: "https://example.test/registry",
        selectedConfig,
      },
    );

    assert.isTrue(result?.diagnostic.message.startsWith(primary));
    assert.include(
      result?.diagnostic.message ?? "",
      "\n\nRelated diagnostics:\nwarning EFFX[third-party]/0001: unlocated context",
    );
    assert.include(result?.diagnostic.message ?? "", "located context (file:///a.ts:1:1)");
    assert.notProperty(result!.diagnostic, "relatedInformation");
    assert.notProperty(result!.diagnostic, "codeDescription");
    assert.isTrue(
      result!.logs.some((message) =>
        message.includes(`effx explain '${code}' --config '${selectedConfig}'`),
      ),
    );
  });
});

const Published = Schema.Struct({
  uri: Schema.String,
  version: Schema.optionalKey(Schema.Int),
  diagnostics: Schema.Array(
    Schema.Struct({
      range: Schema.Struct({
        start: Schema.Struct({ line: Schema.Int, character: Schema.Int }),
        end: Schema.Struct({ line: Schema.Int, character: Schema.Int }),
      }),
      severity: Schema.Literals([1, 2, 3]),
      source: Schema.Literal("effx"),
      code: Schema.String,
      message: Schema.String,
      codeDescription: Schema.optionalKey(Schema.Struct({ href: Schema.String })),
    }),
  ),
});

const decodePublished = Schema.decodeUnknownEffect(Published);

type PublishedDiagnostic = (typeof Published.Type)["diagnostics"][number];

const primaryMessage = (message: string): string => {
  const boundary = message.indexOf("\n\nRelated diagnostics:");

  return boundary === -1 ? message : message.slice(0, boundary);
};

type Peer = Effect.Success<ReturnType<typeof acquirePeer>>;

const decodeNativeCode = Schema.decodeUnknownOption(Schema.Struct({ code: Schema.Int }));

const initializePeer = Effect.fnUntraced(function* (peer: Peer, params: Schema.Json) {
  const result = yield* Effect.exit(peer.request("initialize", params));

  if (Exit.isSuccess(result)) return result.value;

  if (Cause.hasInterrupts(result.cause)) return yield* Effect.failCause(result.cause);

  const failure = result.cause.reasons.find(Cause.isFailReason);

  const nativeCode = decodeNativeCode(
    failure?.error._tag === "PeerError" ? failure.error.cause : undefined,
  );

  const stderr = yield* peer.stderr;

  const transportReason =
    stderr.match(/^effx lsp transport: (Closed|Framing|Decode|Capacity|IO|Handler)\r?$/mu)?.[1] ??
    "unobserved";

  const cliFailure = /Missing required flag: --trust-config\b/u.test(stderr)
    ? "MissingOption(trust-config)"
    : /Missing required flag: --build\b/u.test(stderr)
      ? "MissingOption(build)"
      : "unobserved";

  const child = yield* Effect.raceFirst(peer.exit.pipe(Effect.asSome), Effect.succeedNone);
  const code = Option.isSome(nativeCode) ? nativeCode.value.code : "unobserved";
  const childExit = Option.isSome(child) ? child.value.code : "unobserved";
  const decodedStderrUtf8Bytes = new TextEncoder().encode(stderr).byteLength;

  assert.fail(
    `LSP initialization failed; nativeCode=${code}; transportReason=${transportReason}; cliFailure=${cliFailure}; decodedStderrUtf8Bytes=${decodedStderrUtf8Bytes}; childExit=${childExit}`,
  );
});

const published = Effect.fnUntraced(function* (peer: Peer, uri: string, version?: number) {
  while (true) {
    const value = yield* decodePublished(
      yield* peer.waitNotification("textDocument/publishDiagnostics"),
    );

    if (value.uri === uri && (version === undefined || value.version === version)) return value;
  }
});

const liveProject = <A, E, R>(program: Effect.Effect<A, E, R>) =>
  program.pipe(
    Effect.scoped,
    Effect.provide(Layer.provideMerge(TsSourceFrontend.layer, BunServices.layer)),
  );

const clientParameters = {
  processId: null,
  capabilities: {
    textDocument: {
      publishDiagnostics: {
        versionSupport: true,
        relatedInformation: true,
        codeDescriptionSupport: true,
      },
    },
  },
} satisfies Schema.Json;

// Real pipes and a real TS frontend; protocol responses and child close are receipts.
// The copy is scope-owned; no source checkout, generated output or config is mutated.
describe("maintained LSP client project journeys", () => {
  it.live(
    "matches one-shot diagnostics, repairs an unsaved overlay, closes and exits without disk emission",
    () =>
      liveProject(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* copyUsersFixture();
          const file = path.join(directory, "src", "broken.ts");
          const saved = yield* fs.readFileString(file);
          const uri = (yield* path.toFileUrl(file)).href;
          const project = yield* resolveProject(path.join(directory, "tsconfig.json"));
          const checked = yield* compile(project.config, project.extensions);

          const expected: PublishedDiagnostic[] = [];

          for (const diagnostic of checked.diagnostics) {
            const location = diagnostic.location;

            if (location === undefined || path.resolve(directory, location.file) !== file) continue;
            const range = pointRange(location, saved);

            if (range === undefined)
              assert.fail("One-shot diagnostic point is outside its analyzed source snapshot");
            expected.push({
              range,
              severity:
                diagnostic.severity === "error" ? 1 : diagnostic.severity === "warning" ? 2 : 3,
              source: "effx",
              code: diagnostic.code,
              message: diagnostic.message,
            });
          }

          assert.isAbove(expected.length, 0);
          const peer = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          assert.deepStrictEqual(
            yield* initializePeer(peer, {
              ...clientParameters,
              rootUri: (yield* path.toFileUrl(directory)).href,
            }),
            capabilities,
          );
          yield* peer.notification("initialized", {});
          yield* peer.notification("textDocument/didOpen", {
            textDocument: { uri, languageId: "typescript", version: 1, text: saved },
          });
          const initial = yield* published(peer, uri, 1);
          assert.deepStrictEqual(
            initial.diagnostics.map(({ range, severity, source, code, message }) => ({
              range,
              severity,
              source,
              code,
              message: primaryMessage(message),
            })),
            expected,
          );

          for (const diagnostic of initial.diagnostics) {
            if (bundledDiagnosticEntries.some((entry) => entry.code === diagnostic.code))
              assert.deepStrictEqual(diagnostic.codeDescription, {
                href: `https://phibkro.github.io/effx/docs/diagnostics/registry#${encodeURIComponent(diagnostic.code)}`,
              });
            else assert.notProperty(diagnostic, "codeDescription");
          }

          const alias = path.join(directory, "broken-alias.ts");
          yield* fs.symlink(file, alias);
          yield* peer.notification("textDocument/didOpen", {
            textDocument: {
              uri: (yield* path.toFileUrl(alias)).href,
              languageId: "typescript",
              version: 10,
              text: "export {};",
            },
          });
          const isLog = Schema.is(Schema.Struct({ message: Schema.String }));
          yield* peer.waitNotification(
            "window/logMessage",
            (value) => isLog(value) && value.message.includes("Invalid notification"),
          );
          yield* peer.notification("textDocument/didChange", {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: "export {};\r\n//😀" }],
          });
          yield* peer.notification("textDocument/didChange", {
            textDocument: { uri, version: 3 },
            contentChanges: [
              {
                range: { start: { line: 1, character: 4 }, end: { line: 1, character: 4 } },
                text: "x",
              },
            ],
          });
          assert.deepStrictEqual((yield* published(peer, uri, 3)).diagnostics, []);
          yield* peer.notification("textDocument/didSave", { textDocument: { uri } });
          assert.deepStrictEqual((yield* published(peer, uri, 3)).diagnostics, []);
          yield* peer.notification("textDocument/didClose", { textDocument: { uri } });
          assert.deepStrictEqual((yield* published(peer, uri, 3)).diagnostics, []);
          assert.strictEqual(yield* fs.readFileString(file), saved);

          for (const output of [project.config.outDir, project.effxDir]) {
            if (output !== undefined) assert.isFalse(yield* fs.exists(output));
          }

          assert.strictEqual(yield* peer.request("shutdown"), null);
          yield* peer.notification("exit");
          assert.strictEqual((yield* peer.exit).code, 0);
        }),
      ),
    30000,
  );

  it.live(
    "enforces handshake and method errors without exposing malformed private payloads",
    () =>
      liveProject(
        Effect.gen(function* () {
          const directory = yield* copyUsersFixture();
          const peer = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          assert.strictEqual((yield* peer.requestError("unknown", {})).code, -32002);
          const secret = "private-source-payload-never-logged";
          assert.strictEqual(
            (yield* peer.requestError("initialize", { capabilities: {}, workspaceFolders: secret }))
              .code,
            -32602,
          );
          assert.deepStrictEqual(yield* peer.request("initialize", clientParameters), capabilities);
          assert.strictEqual(
            (yield* peer.requestError("initialize", clientParameters)).code,
            -32600,
          );
          assert.strictEqual(
            (yield* peer.requestError("textDocument/completion", {})).code,
            -32601,
          );
          yield* peer.notification("initialized", {});
          yield* peer.notification("textDocument/didOpen", { textDocument: secret });
          const isLog = Schema.is(Schema.Struct({ message: Schema.String }));

          const logged = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ message: Schema.String }),
          )(
            yield* peer.waitNotification(
              "window/logMessage",
              (value) => isLog(value) && value.message.includes("Invalid notification"),
            ),
          );

          assert.notInclude(logged.message, secret);
          assert.notInclude(yield* peer.stderr, secret);
          assert.strictEqual(yield* peer.request("shutdown"), null);
          yield* peer.notification("exit");
          assert.strictEqual((yield* peer.exit).code, 0);
        }),
      ),
    30000,
  );

  it.live(
    "requires one workspace unless the launch project explicitly overrides selection",
    () =>
      liveProject(
        Effect.gen(function* () {
          const directory = yield* copyUsersFixture();
          const path = yield* Path.Path;

          const folders = [
            { uri: "file:///not-selected-one", name: "one" },
            { uri: "file:///not-selected-two", name: "two" },
          ];

          const rejected = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          assert.strictEqual(
            (yield* rejected.requestError("initialize", {
              ...clientParameters,
              workspaceFolders: folders,
            })).code,
            -32602,
          );
          yield* rejected.notification("exit");
          assert.strictEqual((yield* rejected.exit).code, 1);

          const explicit = yield* acquirePeer(true, {
            cwd: directory,
            args: ["lsp", "--project", path.join(directory, "tsconfig.json")],
          });

          assert.deepStrictEqual(
            yield* explicit.request("initialize", {
              ...clientParameters,
              workspaceFolders: folders,
            }),
            capabilities,
          );
          assert.strictEqual(yield* explicit.request("shutdown"), null);
          yield* explicit.notification("exit");
          assert.strictEqual((yield* explicit.exit).code, 0);
        }),
      ),
    30000,
  );

  it.live(
    "cleans up on EOF and premature exit at the actual process root",
    () =>
      liveProject(
        Effect.gen(function* () {
          const directory = yield* copyUsersFixture();
          const beforeInitialize = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          yield* beforeInitialize.notification("exit");
          assert.strictEqual((yield* beforeInitialize.exit).code, 1);
          const running = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          yield* running.request("initialize", clientParameters);
          yield* running.notification("initialized", {});
          yield* running.eof;
          yield* running.exit;
          const afterShutdown = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          yield* afterShutdown.request("initialize", clientParameters);
          assert.strictEqual(yield* afterShutdown.request("shutdown"), null);
          yield* afterShutdown.eof;
          yield* afterShutdown.exit;
        }),
      ),
    30000,
  );

  it.live(
    "clears saved-JSON faults and resumes on repair using the real watcher",
    () =>
      liveProject(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* copyUsersFixture();
          const config = path.join(directory, "tsconfig.json");
          const savedConfig = yield* fs.readFileString(config);
          const file = path.join(directory, "src", "broken.ts");
          const saved = yield* fs.readFileString(file);
          const uri = (yield* path.toFileUrl(file)).href;
          const peer = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          yield* peer.request("initialize", clientParameters);
          yield* peer.notification("initialized", {});
          yield* peer.notification("textDocument/didOpen", {
            textDocument: { uri, languageId: "typescript", version: 1, text: saved },
          });
          const initial = yield* published(peer, uri, 1);
          assert.isAbove(initial.diagnostics.length, 0);
          yield* fs.writeFileString(config, "{");
          assert.deepStrictEqual((yield* published(peer, uri, 1)).diagnostics, []);
          const isLog = Schema.is(Schema.Struct({ message: Schema.String }));
          yield* peer.waitNotification(
            "window/logMessage",
            (value) => isLog(value) && value.message.includes("Analysis unavailable"),
          );
          yield* fs.writeFileString(config, savedConfig);

          const restored = yield* decodePublished(
            yield* peer.waitNotification("textDocument/publishDiagnostics", (value) => {
              const valid = Schema.is(Published)(value);

              return valid && value.uri === uri && value.diagnostics.length > 0;
            }),
          );

          assert.deepStrictEqual(restored.diagnostics, initial.diagnostics);
          assert.strictEqual(yield* peer.request("shutdown"), null);
          yield* peer.notification("exit");
          assert.strictEqual((yield* peer.exit).code, 0);
        }),
      ),
    30000,
  );

  it.live(
    "denies editor trust grants, imports authorized config once, and suspends on covered executable edits",
    () =>
      liveProject(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* copyUsersFixture();
          const config = path.join(directory, "effx.config.ts");
          const sentinel = path.join(directory, "config-imports.txt");
          const source = `import { appendFileSync } from "node:fs"; appendFileSync(${yield* encodeJsonString(sentinel)}, ${yield* encodeJsonString("import\n")}); export default {};`;
          yield* fs.writeFileString(config, source);
          const denied = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });

          const failure = yield* denied.requestError("initialize", {
            ...clientParameters,
            initializationOptions: { trustConfig: true, executableFiles: [config] },
          });

          assert.strictEqual(failure.code, -32603);
          assert.include(failure.message, config);
          assert.include(failure.message, "--trust-config");
          assert.isFalse(yield* fs.exists(sentinel));
          yield* denied.notification("exit");
          assert.strictEqual((yield* denied.exit).code, 1);

          const peer = yield* acquirePeer(true, {
            cwd: directory,
            args: ["lsp", "--config", config, "--exec-file", config],
          });

          yield* peer.request("initialize", clientParameters);
          yield* peer.notification("initialized", {});
          const file = path.join(directory, "src", "broken.ts");
          const uri = (yield* path.toFileUrl(file)).href;
          const saved = yield* fs.readFileString(file);
          yield* peer.notification("textDocument/didOpen", {
            textDocument: { uri, languageId: "typescript", version: 1, text: saved },
          });
          assert.isAbove((yield* published(peer, uri, 1)).diagnostics.length, 0);
          yield* peer.notification("textDocument/didChange", {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: "export {};" }],
          });
          assert.deepStrictEqual((yield* published(peer, uri, 2)).diagnostics, []);
          assert.strictEqual(yield* fs.readFileString(sentinel), "import\n");
          yield* fs.writeFileString(config, source + "\n// covered edit");
          assert.deepStrictEqual((yield* published(peer, uri, 2)).diagnostics, []);
          const isLog = Schema.is(Schema.Struct({ message: Schema.String }));
          yield* peer.waitNotification(
            "window/logMessage",
            (value) => isLog(value) && value.message.includes("RestartRequired"),
          );
          yield* peer.notification("textDocument/didChange", {
            textDocument: { uri, version: 3 },
            contentChanges: [{ text: saved }],
          });
          assert.strictEqual((yield* peer.requestError("unknown", {})).code, -32601);
          assert.strictEqual(yield* fs.readFileString(sentinel), "import\n");
          assert.strictEqual(yield* peer.request("shutdown"), null);
          yield* peer.notification("exit");
          assert.strictEqual((yield* peer.exit).code, 0);
        }),
      ),
    30000,
  );
  it.live(
    "negotiates optional diagnostic fields and ignores unrelated editor settings",
    () =>
      liveProject(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* copyUsersFixture();
          const peer = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          yield* peer.request("initialize", { processId: null, capabilities: {} });
          yield* peer.notification("initialized", {});
          const file = path.join(directory, "src", "broken.ts");
          const uri = (yield* path.toFileUrl(file)).href;
          yield* peer.notification("textDocument/didOpen", {
            textDocument: {
              uri,
              version: 1,
              languageId: "typescript",
              text: yield* fs.readFileString(file),
            },
          });
          const initial = yield* published(peer, uri);
          assert.notProperty(initial, "version");
          assert.isAbove(initial.diagnostics.length, 0);

          for (const diagnostic of initial.diagnostics)
            assert.notProperty(diagnostic, "codeDescription");
          yield* peer.notification("workspace/didChangeConfiguration", {
            settings: { editor: { theme: "dark" }, effx: { unrelatedEditorPreference: true } },
          });
          yield* peer.notification("$/setTrace", { value: "verbose" });
          yield* peer.notification("textDocument/didChange", {
            textDocument: { uri, version: 2 },
            contentChanges: [{ text: "export {};" }],
          });
          assert.deepStrictEqual((yield* published(peer, uri)).diagnostics, []);
          yield* peer.notification("workspace/didChangeConfiguration", {
            settings: { effx: { trustConfig: true } },
          });
          const isLog = Schema.is(Schema.Struct({ message: Schema.String }));
          yield* peer.waitNotification(
            "window/logMessage",
            (value) => isLog(value) && value.message.includes("RestartRequired"),
          );
          assert.strictEqual(yield* peer.request("shutdown"), null);
          assert.strictEqual((yield* peer.requestError("unknown", {})).code, -32600);
          yield* peer.notification("exit");
          assert.strictEqual((yield* peer.exit).code, 0);
        }),
      ),
    30000,
  );
  it.live(
    "refreshes saved output exclusions without leaving the former output unwatched",
    () =>
      liveProject(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* copyUsersFixture();
          const configPath = path.join(directory, "tsconfig.json");
          const saved = yield* decodeTsconfig(yield* fs.readFileString(configPath));
          const oldOutput = path.join(directory, "output-old");
          const oldRoot = path.join(oldOutput, "broken.ts");
          yield* fs.makeDirectory(oldOutput);

          const source = (yield* fs.readFileString(
            path.join(directory, "src", "broken.ts"),
          )).replaceAll('from "./', 'from "../src/');

          yield* fs.writeFileString(oldRoot, source);
          yield* fs.writeFileString(
            configPath,
            yield* encodeTsconfig({ ...saved, effx: { outDir: "output-old" } }),
          );
          const peer = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          yield* peer.request("initialize", clientParameters);
          yield* peer.notification("initialized", {});
          const uri = (yield* path.toFileUrl(oldRoot)).href;
          yield* peer.notification("textDocument/didOpen", {
            textDocument: { uri, version: 1, languageId: "typescript", text: source },
          });
          assert.deepStrictEqual((yield* published(peer, uri, 1)).diagnostics, []);
          yield* fs.writeFileString(
            configPath,
            yield* encodeTsconfig({
              ...saved,
              files: ["output-old/broken.ts"],
              effx: { outDir: "output-new" },
            }),
          );
          const isPublished = Schema.is(Published);

          const admitted = yield* decodePublished(
            yield* peer.waitNotification(
              "textDocument/publishDiagnostics",
              (value) => isPublished(value) && value.uri === uri && value.diagnostics.length > 0,
            ),
          );

          assert.strictEqual(admitted.version, 1);
          assert.strictEqual(yield* peer.request("shutdown"), null);
          yield* peer.notification("exit");
          assert.strictEqual((yield* peer.exit).code, 0);
        }),
      ),
    30000,
  );

  it.live(
    "rejects a selected source root through an owned-output symlink alias visibly",
    () =>
      liveProject(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const directory = yield* copyUsersFixture();
          const configPath = path.join(directory, "tsconfig.json");
          const saved = yield* decodeTsconfig(yield* fs.readFileString(configPath));
          const output = path.join(directory, "output");
          const physical = path.join(output, "broken.ts");
          const alias = path.join(directory, "src", "output-alias.ts");
          yield* fs.makeDirectory(output);
          const source = yield* fs.readFileString(path.join(directory, "src", "broken.ts"));
          yield* fs.writeFileString(physical, source);
          yield* fs.symlink(physical, alias);
          yield* fs.writeFileString(
            configPath,
            yield* encodeTsconfig({
              ...saved,
              files: ["src/output-alias.ts"],
              include: [],
              effx: { outDir: "output" },
            }),
          );
          const peer = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          yield* peer.request("initialize", clientParameters);
          yield* peer.notification("initialized", {});
          const uri = (yield* path.toFileUrl(alias)).href;
          yield* peer.notification("textDocument/didOpen", {
            textDocument: { uri, version: 1, languageId: "typescript", text: source },
          });
          const isLog = Schema.is(Schema.Struct({ message: Schema.String }));
          yield* peer.waitNotification(
            "window/logMessage",
            (value) => isLog(value) && value.message.includes("overlaps effx-owned output"),
          );
          assert.deepStrictEqual((yield* published(peer, uri, 1)).diagnostics, []);
          assert.strictEqual(yield* peer.request("shutdown"), null);
          yield* peer.notification("exit");
          assert.strictEqual((yield* peer.exit).code, 0);
        }),
      ),
    30000,
  );

  it.live(
    "closes aggregate overlay overflow rather than accepting dependent edits",
    () =>
      liveProject(
        Effect.gen(function* () {
          const path = yield* Path.Path;
          const directory = yield* copyUsersFixture();
          const peer = yield* acquirePeer(true, { cwd: directory, args: ["lsp"] });
          yield* peer.request("initialize", clientParameters);
          yield* peer.notification("initialized", {});
          const a = (yield* path.toFileUrl(path.join(directory, "capacity-a.txt"))).href;
          const b = (yield* path.toFileUrl(path.join(directory, "capacity-b.txt"))).href;
          const size = 7 * 1024 * 1024;
          const text = "x".repeat(size);

          for (const uri of [a, b]) {
            yield* peer.notification("textDocument/didOpen", {
              textDocument: { uri, version: 1, languageId: "plaintext", text },
            });
            yield* published(peer, uri, 1);
          }

          yield* peer.notification("textDocument/didChange", {
            textDocument: { uri: a, version: 2 },
            contentChanges: [
              {
                range: { start: { line: 0, character: size }, end: { line: 0, character: size } },
                text: "x".repeat(3 * 1024 * 1024),
              },
            ],
          });
          yield* peer.waitStderr("document admission capacity exceeded");
          assert.strictEqual((yield* peer.exit).code, 1);

          const late = yield* Effect.exit(
            peer.notification("textDocument/didChange", {
              textDocument: { uri: a, version: 3 },
              contentChanges: [{ text: "dependent edit" }],
            }),
          );

          assert.isTrue(Exit.isFailure(late));
          const isPublished = Schema.is(Published);

          for (const message of yield* peer.notifications) {
            if (message.method === "textDocument/publishDiagnostics" && isPublished(message.params))
              assert.isAtMost(message.params.version ?? 0, 1);
          }
        }),
      ),
    30000,
  );
  it.live(
    "omitted and explicit trust toggles reach the actual LSP handler without changing parsing authority",
    () =>
      liveProject(
        Effect.gen(function* () {
          const directory = yield* copyUsersFixture();

          for (const args of [["lsp"], ["lsp", "--no-trust-config"], ["lsp", "--trust-config"]]) {
            const peer = yield* acquirePeer(true, { cwd: directory, args });
            assert.strictEqual((yield* peer.requestError("unknown", {})).code, -32002);
            assert.deepStrictEqual(yield* initializePeer(peer, clientParameters), capabilities);
            assert.strictEqual(yield* peer.request("shutdown"), null);
            yield* peer.notification("exit");
            assert.strictEqual((yield* peer.exit).code, 0);
          }
        }),
      ),
    30000,
  );
});
