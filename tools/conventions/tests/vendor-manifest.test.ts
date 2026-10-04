import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../..", import.meta.url).pathname;

const jsonStringField = (source: string, field: string): string => {
  const match = new RegExp(`"${field}"\\s*:\\s*"([^"]+)"`).exec(source);

  if (match?.[1] === undefined) {
    throw new Error(`Missing string field ${field}`);
  }

  return match[1];
};

describe("vendored plugin provenance", () => {
  it("keeps the manifest identity equal to the embedded package identity", () => {
    const manifest = readFileSync(join(root, "tools/vendor/manifest.json"), "utf8");
    expect(manifest).not.toMatch(/"sourceRepository"\s*:/);
    const version = jsonStringField(manifest, "version");
    const commit = jsonStringField(manifest, "commit");
    const artifact = jsonStringField(manifest, "artifact");

    expect(artifact).toBe(`oxlint-effect-plugin-${version}-${commit}.tgz`);

    const packed = Bun.spawnSync({
      cmd: ["tar", "-xOzf", join(root, "tools/vendor", artifact), "package/package.json"],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(packed.exitCode).toBe(0);

    const embeddedPackage = packed.stdout.toString();
    expect(jsonStringField(embeddedPackage, "name")).toBe(jsonStringField(manifest, "package"));
    expect(jsonStringField(embeddedPackage, "version")).toBe(version);
    // Documented in AGENTS.md: npm's 0.1.0 pins oxlint 1.76.0; this source build accepts ^1.56.0.
    expect(
      jsonStringField(
        embeddedPackage.slice(embeddedPackage.indexOf('"peerDependencies"')),
        "oxlint",
      ),
    ).toBe("^1.56.0");
  });

  it("keeps the tarball bytes equal to the manifest sha256", () => {
    const manifest = readFileSync(join(root, "tools/vendor/manifest.json"), "utf8");
    const artifact = jsonStringField(manifest, "artifact");

    const digest = new Bun.CryptoHasher("sha256")
      .update(readFileSync(join(root, "tools/vendor", artifact)))
      .digest("hex");

    expect(digest).toBe(jsonStringField(manifest, "sha256"));
  });
});
