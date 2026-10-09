import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Crypto, Effect, FileSystem, Path, Schema } from "effect";
import { acquireCommand } from "../packages/cli/test/packed-watch-peer.ts";
import { acquirePeer } from "./lsp-test-peer.ts";
import { publicInstall } from "./install-public.ts";

// EX-0023: reuse the scoped, bounded native child adapter. No child output is logged.
// This root owns the disposable consumer, all children, and its socket server until scope close.
class SmokeFailure extends Schema.TaggedError<SmokeFailure>()("SmokeFailure", {
  step: Schema.String,
}) {
  override get message() {
    return this.step;
  }
}

const requireThat = (condition: boolean, step: string) =>
  condition ? Effect.void : Effect.fail(new SmokeFailure({ step }));

const encodeJson = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ commit: Schema.String, sha256s: Schema.Record(Schema.String, Schema.String) }),
  ),
);

const decodeUser = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ id: Schema.String, displayName: Schema.String })),
  { onExcessProperty: "error" },
);

const run = Effect.fnUntraced(function* (cwd: string, args: ReadonlyArray<string>, step: string) {
  const child = yield* acquireCommand(cwd, "bun", args);
  yield* child.eof;
  const result = yield* child.finish;

  yield* requireThat(result.code === 0, step);

  return result.text;
});

const protocolTest = `import { expect, test } from "bun:test";
import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import { Client, UserGet, UserChangeEmail } from "./.effx/generated/client.ts";
import { OperationsClient } from "./.effx/generated/rpc.ts";
import { AppRoutes } from "./src/server.ts";
import { Users } from "./src/services.ts";
import { Email, UserId } from "./src/schemas.ts";
const Server = Layer.mergeAll(AppRoutes, Client.layer, OperationsClient.layerTest).pipe(
  Layer.provideMerge(BunHttpServer.layerTest), Layer.provideMerge(Users.layer),
);
test("installed stable HTTP and RPC contracts", () => Effect.runPromise(
  Effect.gen(function* () {
    const id = UserId.make("1");
    expect(yield* UserGet({ id })).toEqual({ id, displayName: "Alice" });
    const email = Email.make("alice+stable@example.com");
    expect((yield* UserChangeEmail({ id, email })).email).toBe(email);
    const rpc = yield* OperationsClient.make;
    expect(yield* rpc["User.Get"]({ id })).toEqual({ id, displayName: "Alice" });
    const failure = yield* Effect.flip(rpc["User.ChangeEmail"]({ id, email: Email.make("bob@example.com") }));
    expect(failure._tag).toBe("EmailTaken");
    expect((yield* (yield* Users).find(id)).email).toBe(email);
  }).pipe(Effect.provide(Server)),
));
`;

const smoke = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const root = yield* path.fromFileUrl(new URL("../", import.meta.url));
  const artifacts = path.join(root, "dist-artifacts");

  const manifest = yield* decodeManifest(
    yield* fs.readFileString(path.join(artifacts, "manifest.json")),
  );

  const git = yield* acquireCommand(root, "git", ["rev-parse", "HEAD"]);
  const revision = yield* git.finish;

  yield* requireThat(
    revision.code === 0 && revision.text.trim() === manifest.commit,
    "exact committed pack",
  );

  const dependencies = new Map<string, string>([
    ["effect", "4.0.0"],
    ["@effect/platform-bun", "4.0.0"],
  ]);

  for (const [filename, expected] of Object.entries(manifest.sha256s)) {
    const bytes = yield* fs.readFile(path.join(artifacts, filename));
    const digest = yield* crypto.digest("SHA-256", bytes);
    const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");

    yield* requireThat(hash === expected, "artifact integrity");
    const name = /^effx-(diagnostics|runtime|ir|compiler|persistence|cli)-/.exec(filename)?.[1];

    yield* requireThat(name !== undefined, "closed package cohort");

    if (name !== undefined)
      dependencies.set("@effx/" + name, "file:" + path.join(artifacts, filename));
  }

  yield* requireThat(dependencies.size === 8, "complete six-package cohort");
  const consumer = yield* fs.makeTempDirectoryScoped({ prefix: "effx-stable-consumer-" });

  yield* fs.writeFileString(
    path.join(consumer, "package.json"),
    yield* encodeJson({
      name: "effx-stable-installed-acceptance",
      private: true,
      type: "module",
      dependencies: Object.fromEntries(dependencies),
      devDependencies: { typescript: "7.0.2", "@types/bun": "1.4.2" },
    }),
  );
  yield* fs.copy(path.join(root, "examples/users/src"), path.join(consumer, "src"));
  yield* fs.writeFileString(
    path.join(consumer, "tsconfig.json"),
    yield* encodeJson({
      compilerOptions: {
        target: "ESNext",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        types: ["bun"],
      },
      include: ["src/**/*.ts", ".effx/generated/**/*.ts", "smoke.spec.ts"],
    }),
  );
  yield* fs.writeFileString(path.join(consumer, "smoke.spec.ts"), protocolTest);
  yield* publicInstall(consumer, false, true);
  const cli = path.join(consumer, "node_modules/.bin/effx");

  yield* run(consumer, [cli, "check"], "installed stable check");
  yield* run(consumer, [cli, "build"], "installed stable generation");
  yield* run(
    consumer,
    ["node_modules/.bin/tsc", "--noEmit", "-p", "tsconfig.json"],
    "installed projection channels",
  );
  yield* run(consumer, ["test", "smoke.spec.ts"], "installed HTTP/RPC socket contracts");

  const user = yield* decodeUser(
    yield* run(
      consumer,
      ["src/cli-main.ts", "users", "get", "--input", '{"id":"1"}'],
      "generated CLI execution",
    ),
  );

  yield* requireThat(
    user.id === "1" && user.displayName === "Alice",
    "generated CLI public projection",
  );

  const rejected = yield* acquireCommand(consumer, "bun", [
    cli,
    "check",
    "--target",
    "effect-4.0-rc",
  ]);

  const refusal = yield* rejected.finish;

  yield* requireThat(
    refusal.code !== 0 && refusal.text.includes("effect-4.0"),
    "removed RC CLI choice",
  );

  // The maintained peer creates real inherited descriptors; only the installed packed root runs.
  // Successful initialization requires loading and validating its package-owned native asset.
  yield* Effect.scoped(
    Effect.gen(function* () {
      const peer = yield* acquirePeer(true, { cwd: consumer, main: cli, args: ["lsp"] });

      yield* peer.request("initialize", { processId: null, capabilities: {} });
      yield* peer.notification("initialized", {});
      const file = path.join(consumer, "src/operations.ts");
      const uri = "file://" + file;
      const text = yield* fs.readFileString(file);

      const Published = Schema.Struct({
        uri: Schema.String,
        diagnostics: Schema.Array(Schema.Struct({ code: Schema.String })),
      });

      const isPublished = Schema.is(Published);

      yield* peer.notification("textDocument/didOpen", {
        textDocument: { uri, languageId: "typescript", version: 1, text },
      });

      const publication = yield* peer.waitNotification(
        "textDocument/publishDiagnostics",
        (value) => isPublished(value) && value.uri === uri,
      );

      const diagnostics = yield* Schema.decodeUnknownEffect(Published)(publication);

      yield* requireThat(
        diagnostics.diagnostics.some((diagnostic) => diagnostic.code === "EFFX2504"),
        "installed native LSP compiler publication",
      );
      yield* requireThat(
        (yield* peer.request("shutdown")) === null,
        "installed native LSP shutdown",
      );
      yield* peer.notification("exit");
      const exit = yield* peer.exit;

      yield* requireThat(
        exit.code === 0 && (yield* peer.protocolErrorCount) === 0,
        "installed native LSP clean protocol and exit",
      );
    }),
  ).pipe(Effect.timeout("30 seconds"));
  yield* Effect.log(
    "stable installed consumer: checks, channels, HTTP, RPC, CLI, and RC rejection passed",
  );
}).pipe(Effect.scoped, Effect.provide(BunServices.layer));

BunRuntime.runMain(smoke);
