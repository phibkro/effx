/** @effect-diagnostics unstableApiUsage:off -- EX-0023: scoped actual-host native capability test subprocess custody. */
import { assert, describe, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Schema, Stream, type Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import * as process from "node:process";
import { fileURLToPath } from "node:url";
import { acquireLinuxLspIO, defaultLinuxLspManifestPath, LinuxLspError } from "../lsp-linux.ts";
import { type LspIO } from "@effx/cli";
import { LinuxPeerResult } from "./lsp-linux.contract.ts";
import { NativeAssetManifest, compareVersions } from "../lsp-native-manifest.ts";

const peer = fileURLToPath(new URL("./lsp-linux.peer.ts", import.meta.url));

const runPeer = Effect.fnUntraced(function* (
  mode: string,
  form = "socket",
  manifest = defaultLinuxLspManifestPath,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const child = yield* spawner.spawn(
        ChildProcess.make("node", [peer, process.execPath, manifest, mode, form], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "ignore",
          forceKillAfter: "1 second",
        }),
      );

      const text = yield* child.stdout.pipe(Stream.decodeText(), Stream.mkString);
      assert.strictEqual(
        Number(yield* child.exitCode),
        0,
        "Node peer exited unsuccessfully; this code alone does not establish a deadline kill",
      );

      return yield* Schema.decodeEffect(Schema.fromJsonString(LinuxPeerResult))(text.trim());
    }),
  ).pipe(Effect.timeout("15 seconds"));
});

// Each live case uses real public Bun dlopen and actual OS descriptors; there is
// no monkeypatch, fake readiness implementation or imported fixture execution.
describe("Linux native LSP boundary", () => {
  it("construct-and-discard preserves channels and performs no acquisition", () => {
    const operation = acquireLinuxLspIO("/not-an-asset");
    expectTypeOf(operation).toEqualTypeOf<Effect.Effect<LspIO, LinuxLspError, Scope.Scope>>();
    expectTypeOf(operation).not.toMatchTypeOf<Effect.Effect<LspIO, LinuxLspError>>();
    assert.isTrue(compareVersions("2.44", "2.2.5") >= 0);
    assert.isFalse(compareVersions("2.9", "2.10") >= 0);
    assert.isFalse(compareVersions("2.2.4", "2.2.5") >= 0);
  });

  it.live.each(["socket", "fifo", "file", "pty"])(
    "bounds real %s read/backing and drains to EOF",
    (form) =>
      Effect.gen(function* () {
        const result = yield* runPeer("read", form);
        assert.strictEqual(result.code, 0);
        assert.deepStrictEqual(
          result.receipts.map((r) => r.event),
          ["acquired", "result", "released"],
        );
        const read = result.receipts.find((r) => r.event === "result");
        assert.isDefined(read);
        assert.isTrue((read?.bytes ?? 0) > 0);
        assert.isTrue((read?.maximumRead ?? Infinity) <= 65536);
        assert.isTrue((read?.maximumBacking ?? Infinity) <= 65536);

        if (form === "file" || form === "fifo") assert.strictEqual(read?.bytes, 131072);

        if (form === "socket") assert.isTrue((read?.bytes ?? 0) > 1_000_000);

        if (form === "pty") assert.strictEqual(read?.bytes, 4);

        if (form !== "pty") assert.strictEqual(result.stdoutBytes, 0);
      }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live.each(["closed", "ownership", "probe", "callbacks"])(
    "%s law at the actual boundary",
    (mode) =>
      Effect.gen(function* () {
        const result = yield* runPeer(mode);
        assert.strictEqual(result.code, 0);
        assert.deepStrictEqual(
          result.receipts.map((r) => r.event),
          ["acquired", "result", "released"],
        );
        assert.isTrue((result.receipts.find((r) => r.event === "result")?.checks?.length ?? 0) > 0);
        assert.strictEqual(result.stdoutBytes, 0);
      }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("SIGINT finalizes after an acquisition receipt", () =>
    Effect.gen(function* () {
      const result = yield* runPeer("signal");
      assert.deepStrictEqual(
        result.receipts.map((r) => r.event),
        ["acquired", "released"],
      );
      assert.strictEqual(result.stdoutBytes, 0);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("unread stdout fails and releases without a peer drain", () =>
    Effect.gen(function* () {
      const result = yield* runPeer("blocked-write");
      assert.strictEqual(result.code, 0);
      assert.deepStrictEqual(
        result.receipts.map((r) => r.event),
        ["acquired", "result", "released"],
      );
      assert.deepStrictEqual(result.receipts.find((r) => r.event === "result")?.checks, [
        "writer-deadline",
        "release-deadline",
      ]);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("classifies a real broken pipe and releases", () =>
    Effect.gen(function* () {
      const result = yield* runPeer("broken-write");
      assert.strictEqual(result.code, 0);
      assert.deepStrictEqual(
        result.receipts.map((r) => r.event),
        ["acquired", "result", "released"],
      );
      assert.deepStrictEqual(result.receipts.find((r) => r.event === "result")?.checks, [
        "broken-pipe",
      ]);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live.each(["device", "procfs"])("rejects unsupported %s before any read", (form) =>
    Effect.gen(function* () {
      const result = yield* runPeer("read", form);
      assert.isFalse(result.receipts.some((r) => r.event === "acquired"));
      assert.strictEqual(result.receipts.find((r) => r.event === "failure")?.reason, "StdinForm");
      assert.strictEqual(result.stdoutBytes, 0);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live("constructing a nonexistent acquisition does not load or adopt fd0", () =>
    Effect.gen(function* () {
      const result = yield* runPeer("lazy");
      assert.deepStrictEqual(result.receipts, [
        { event: "result", checks: ["construction-is-lazy"] },
      ]);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.live.each(["digest", "target", "glibc", "elf", "library", "symbol"])(
    "rejects actual asset %s metadata corruption",
    (field) =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const directory = yield* fs.makeTempDirectoryScoped();
        const path = directory + "/lsp-readiness.json";
        const original = yield* fs.readFileString(defaultLinuxLspManifestPath);

        const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(NativeAssetManifest))(
          original,
        );

        const bytes = yield* fs.readFile(
          fileURLToPath(new URL("../../packages/cli/native/lsp-readiness.so", import.meta.url)),
        );

        if (field === "library") bytes[0] = 0;

        if (field === "symbol") {
          const symbol = new TextEncoder().encode("ready_now\0");
          let replaced = 0;

          for (let offset = 0; offset <= bytes.length - symbol.length; offset++) {
            if (symbol.every((value, index) => bytes[offset + index] === value)) {
              bytes[offset] = 120;
              replaced++;
            }
          }

          assert.isTrue(replaced > 0, "the actual ELF must contain its required public symbol");
        }

        yield* fs.writeFile(directory + "/lsp-readiness.so", bytes);

        const changed =
          field === "library" || field === "symbol"
            ? { ...manifest, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }
            : field === "digest"
              ? { ...manifest, sha256: "0".repeat(64) }
              : field === "target"
                ? { ...manifest, architecture: "arm64" }
                : field === "elf"
                  ? { ...manifest, elfMachine: 183 }
                  : { ...manifest, minimumGlibc: "999.0" };
        // Json encodes the deliberately invalid declared target without casting it
        // into the trusted manifest Type, then the real root performs its decoding.

        const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Json))(changed);
        yield* fs.writeFileString(path, encoded);
        const result = yield* runPeer("read", "socket", path);
        assert.isFalse(result.receipts.some((r) => r.event === "acquired"));
        assert.strictEqual(
          result.receipts.find((r) => r.event === "failure")?.reason,
          field === "library" || field === "symbol"
            ? "NativeLoad"
            : field === "digest"
              ? "Integrity"
              : field === "glibc"
                ? "Libc"
                : "Manifest",
        );
        assert.strictEqual(result.stdoutBytes, 0);
      }).pipe(Effect.provide(BunServices.layer)),
  );
});
