import { NativePlatform } from "../../../scripts/native-platform.ts";
import { assert, describe, it } from "@effect/vitest";
import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Schema } from "effect";
import { Digest } from "effect/crypto";
import {
  compareVersions,
  NativeAssetManifest,
  nativeAssetSymbols,
  nativeSymbols,
} from "../../../scripts/lsp-native-manifest.ts";

const root = new URL("../../../", import.meta.url).pathname;

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(NativeAssetManifest), {
  onExcessProperty: "error",
});

/** Offline artifact tests: no compiler, subprocess, dlopen, descriptor or host qualification. */
describe("build-time LSP native artifact", () => {
  it.effect("detects source or ELF byte drift rather than trusting copied metadata", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const digest = yield* Digest.Digest;

      const manifest = yield* decodeManifest(
        yield* fs.readFileString(`${root}packages/cli/native/lsp-readiness.json`),
      );

      const source = yield* fs.readFile(`${root}${manifest.source.file}`);
      const bytes = yield* fs.readFile(`${root}packages/cli/native/${manifest.library}`);
      assert.strictEqual(source.length, manifest.source.byteLength);
      assert.strictEqual(yield* digest.digestHex(Digest.sha256, source), manifest.source.sha256);
      assert.strictEqual(bytes.length, manifest.byteLength);
      assert.strictEqual(manifest.abiVersion, 2);
      assert.deepStrictEqual(manifest.abi, nativeSymbols);
      assert.deepStrictEqual(manifest.exportedFunctions, nativeAssetSymbols);
      assert.strictEqual(yield* digest.digestHex(Digest.sha256, bytes), manifest.sha256);
      const changed = bytes.slice();
      changed[changed.length - 1] = (changed[changed.length - 1] ?? 0) ^ 1;
      assert.notStrictEqual(yield* digest.digestHex(Digest.sha256, changed), manifest.sha256);
      assert.strictEqual(bytes[4], 2);
      assert.strictEqual(bytes[5], 1);
      assert.strictEqual(
        new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(18, true),
        manifest.elfMachine,
      );
      assert.isFalse(new TextDecoder().decode(bytes).includes("/nix/store/"));
      assert.deepStrictEqual(manifest.neededLibraries, ["libc.so.6"]);
      assert.isAbove(manifest.glibcVersions.length, 0);
      assert.strictEqual(
        [...manifest.glibcVersions].sort(compareVersions).at(-1),
        manifest.minimumGlibc,
      );
    }).pipe(Effect.provide(NativePlatform)),
  );

  it.effect("rejects unapproved evidence fields at every manifest level", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;

      const manifest = yield* decodeManifest(
        yield* fs.readFileString(`${root}packages/cli/native/lsp-readiness.json`),
      );

      const decode = Schema.decodeUnknownEffect(NativeAssetManifest, { onExcessProperty: "error" });

      for (const input of [
        { ...manifest, environment: "not-an-approved-field" },
        { ...manifest, source: { ...manifest.source, arguments: [] } },
        {
          ...manifest,
          compiler: { ...manifest.compiler, privatePayload: "not-an-approved-field" },
        },
        { ...manifest, neededLibraries: ["libgcc_s.so.1"] },
        { ...manifest, sha256: "invalid" },
        { ...manifest, elfMachine: 183 },
        { ...manifest, abiVersion: 1 },
        { ...manifest, exportedFunctions: manifest.exportedFunctions.slice(1) },
        { ...manifest, exportedFunctions: [...manifest.exportedFunctions, "unexpected_export"] },
        { ...manifest, abi: { ...manifest.abi, privatePayload: "not-an-approved-field" } },
        {
          ...manifest,
          abi: {
            ...manifest.abi,
            socket_write_now: { args: ["i32", "ptr", "u64"], returns: "i32" },
          },
        },
      ]) {
        const error = yield* Effect.flip(decode(input));
        assert.strictEqual(error._tag, "SchemaError");
      }
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it("orders glibc requirements numerically, including three-component versions", () => {
    assert.deepStrictEqual(["2.9", "2.2.5", "2.34", "2.10"].sort(compareVersions), [
      "2.2.5",
      "2.9",
      "2.10",
      "2.34",
    ]);
    assert.strictEqual(compareVersions("2.34", "2.34.0"), 0);
  });
});
