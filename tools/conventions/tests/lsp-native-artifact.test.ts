import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Crypto, Effect, FileSystem, Schema } from "effect";
import { compareVersions, NativeAssetManifest } from "../../../scripts/build-lsp-native.ts";

const root = new URL("../../../", import.meta.url).pathname;
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(NativeAssetManifest), {
  onExcessProperty: "error",
});
const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

/** Offline artifact tests: no compiler, subprocess, dlopen, descriptor or host qualification. */
describe("build-time LSP native artifact", () => {
  it.effect("detects source or ELF byte drift rather than trusting copied metadata", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const crypto = yield* Crypto.Crypto;
      const manifest = yield* decodeManifest(yield* fs.readFileString(`${root}packages/cli/native/lsp-readiness.json`));
      const source = yield* fs.readFile(`${root}${manifest.source.file}`);
      const bytes = yield* fs.readFile(`${root}packages/cli/native/${manifest.library}`);
      assert.strictEqual(source.length, manifest.source.byteLength);
      assert.strictEqual(hex(yield* crypto.digest("SHA-256", source)), manifest.source.sha256);
      assert.strictEqual(bytes.length, manifest.byteLength);
      assert.strictEqual(hex(yield* crypto.digest("SHA-256", bytes)), manifest.sha256);
      const changed = bytes.slice();
      changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
      assert.notStrictEqual(hex(yield* crypto.digest("SHA-256", changed)), manifest.sha256);
      assert.strictEqual(bytes[4], 2);
      assert.strictEqual(bytes[5], 1);
      assert.strictEqual(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(18, true), manifest.elfMachine);
      assert.isFalse(new TextDecoder().decode(bytes).includes("/nix/store/"));
      assert.deepStrictEqual(manifest.neededLibraries, ["libc.so.6"]);
      assert.isAbove(manifest.glibcVersions.length, 0);
      assert.strictEqual([...manifest.glibcVersions].sort(compareVersions).at(-1), manifest.minimumGlibc);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("rejects unapproved evidence fields at every manifest level", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const manifest = yield* decodeManifest(yield* fs.readFileString(`${root}packages/cli/native/lsp-readiness.json`));
      const decode = Schema.decodeUnknownEffect(NativeAssetManifest, { onExcessProperty: "error" });
      for (const input of [
        { ...manifest, environment: "not-an-approved-field" },
        { ...manifest, source: { ...manifest.source, arguments: [] } },
        { ...manifest, compiler: { ...manifest.compiler, privatePayload: "not-an-approved-field" } },
        { ...manifest, neededLibraries: ["libgcc_s.so.1"] },
        { ...manifest, sha256: "invalid" },
        { ...manifest, elfMachine: 183 },
      ]) {
        const error = yield* Effect.flip(decode(input));
        assert.strictEqual(error._tag, "SchemaError");
      }
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it("orders glibc requirements numerically, including three-component versions", () => {
    assert.deepStrictEqual(["2.9", "2.2.5", "2.34", "2.10"].sort(compareVersions), ["2.2.5", "2.9", "2.10", "2.34"]);
    assert.strictEqual(compareVersions("2.34", "2.34.0"), 0);
  });
});
