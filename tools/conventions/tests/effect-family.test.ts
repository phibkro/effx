import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

/**
 * The `@effect/*` packages that follow `effect`'s version must resolve to the same version as
 * `effect` in the workspace lock. A caret range (`^4.0.5`) lets the resolver drift one package
 * ahead of `effect`, which breaks the peer range it declares (`effect ^4.0.6`) without failing
 * any other gate.
 *
 * `@effect/tsgo` (and its platform binaries) and `@effect/markdown-toc` are separate release
 * lines with their own version numbers. The lower-bound fixtures keep their own lock files
 * (they pin Effect 4.0.0 on purpose) and are not read here.
 */
const lockPath = new URL("../../../bun.lock", import.meta.url).pathname;

const isSeparateReleaseLine = (name: string): boolean =>
  name === "@effect/tsgo" || name.startsWith("@effect/tsgo-") || name === "@effect/markdown-toc";

// A lock entry is a tuple whose first element is "<name>@<version>".
const LockEntry = Schema.TupleWithRest(Schema.Tuple([Schema.String]), [Schema.Unknown]);

const Lock = Schema.Struct({
  packages: Schema.Record(Schema.String, LockEntry),
});

type Lock = typeof Lock.Type;

interface Resolved {
  readonly key: string;
  readonly name: string;
  readonly version: string;
}

const resolved = (lock: Lock): ReadonlyArray<Resolved> =>
  Object.entries(lock.packages).flatMap(([key, [head]]) => {
    // The version follows the last "@" of the head.
    const at = head.lastIndexOf("@");

    return at > 0 ? [{ key, name: head.slice(0, at), version: head.slice(at + 1) }] : [];
  });

const familyOf = (all: ReadonlyArray<Resolved>): ReadonlyArray<Resolved> =>
  all.filter((pkg) => pkg.name.startsWith("@effect/") && !isSeparateReleaseLine(pkg.name));

/** Human-readable findings; empty when the lock holds one `effect` and a matching family. */
const effectFamilyFindings = (lock: Lock): ReadonlyArray<string> => {
  const all = resolved(lock);

  const effectVersions = [
    ...new Set(all.filter((pkg) => pkg.name === "effect").map((p) => p.version)),
  ];

  if (effectVersions.length !== 1) {
    return [`expected one resolved effect version, found [${effectVersions.join(", ")}]`];
  }

  const [expected] = effectVersions;

  return familyOf(all)
    .filter((pkg) => pkg.version !== expected)
    .map(
      (pkg) => `${pkg.name}@${pkg.version} (${pkg.key}) must be ${expected}, the version of effect`,
    );
};

const isTsgo = (name: string): boolean =>
  name === "@effect/tsgo" || name.startsWith("@effect/tsgo-");

/**
 * `@effect/tsgo` is a separate release line, but two copies of it are not harmless: the Oxlint
 * presets, the language-service schema and the `effect-tsgo patch` binary each resolve one of them,
 * so a nested older copy (the vendored Oxlint plugin pins 0.36.4) makes the lint set and the editor
 * set disagree without failing another gate. Root `overrides` pins every copy to one version.
 */
const tsgoFindings = (lock: Lock): ReadonlyArray<string> => {
  const versions = [
    ...new Set(
      resolved(lock)
        .filter((pkg) => isTsgo(pkg.name))
        .map((pkg) => pkg.version),
    ),
  ];

  return versions.length === 1
    ? []
    : [`expected one resolved @effect/tsgo version, found [${versions.join(", ")}]`];
};

const readLock = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(lockPath);

  // bun.lock is JSONC (trailing commas), which JSON.parse rejects; Bun's own parser reads it.
  return yield* Schema.decodeUnknownEffect(Lock)(Bun.JSONC.parse(text));
});

const lockOf = (entries: Readonly<Record<string, string>>): Lock => ({
  packages: Object.fromEntries(
    Object.entries(entries).map(([key, head]) => [key, [head, "", {}, "sha512-probe"]]),
  ),
});

describe("Effect package family in the workspace lock", () => {
  it.effect("resolves every @effect/* package at the version of effect", () =>
    Effect.gen(function* () {
      const lock = yield* readLock;
      const family = familyOf(resolved(lock)).map((pkg) => pkg.name);

      // Guard against a vacuous pass if the lock layout or the name filter changes.
      assert.include(family, "@effect/vitest");
      assert.include(family, "@effect/platform-bun");
      assert.deepStrictEqual(effectFamilyFindings(lock), []);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect("resolves one copy of @effect/tsgo and its platform binaries", () =>
    Effect.gen(function* () {
      const lock = yield* readLock;

      // Guard against a vacuous pass if the lock layout or the name filter changes.
      assert.isTrue(resolved(lock).some((pkg) => pkg.name === "@effect/tsgo"));
      assert.deepStrictEqual(tsgoFindings(lock), []);
    }).pipe(Effect.provide(BunServices.layer)),
  );

  describe("negative control", () => {
    const aligned = {
      effect: "effect@4.0.6",
      "@effect/vitest": "@effect/vitest@4.0.6",
      "@effect/platform-node": "@effect/platform-node@4.0.6",
      "@effect/tsgo": "@effect/tsgo@0.48.0",
      "@effect/tsgo-linux-x64": "@effect/tsgo-linux-x64@0.48.0",
      "@effect/markdown-toc": "@effect/markdown-toc@0.1.0",
    };

    it("accepts an aligned family and ignores separate release lines", () => {
      assert.deepStrictEqual(effectFamilyFindings(lockOf(aligned)), []);
    });

    it("reports a family member that trails effect, including nested entries", () => {
      const findings = effectFamilyFindings(
        lockOf({
          ...aligned,
          "@effect/platform-node": "@effect/platform-node@4.0.5",
          "docgen/@effect/platform-node-shared": "@effect/platform-node-shared@4.0.0",
        }),
      );

      assert.deepStrictEqual(findings, [
        "@effect/platform-node@4.0.5 (@effect/platform-node) must be 4.0.6, the version of effect",
        "@effect/platform-node-shared@4.0.0 (docgen/@effect/platform-node-shared) must be 4.0.6, the version of effect",
      ]);
    });

    it("reports a family member that runs ahead of effect", () => {
      const findings = effectFamilyFindings(
        lockOf({ ...aligned, "@effect/vitest": "@effect/vitest@4.0.7" }),
      );

      assert.deepStrictEqual(findings, [
        "@effect/vitest@4.0.7 (@effect/vitest) must be 4.0.6, the version of effect",
      ]);
    });

    it("reports two resolved copies of effect", () => {
      const findings = effectFamilyFindings(
        lockOf({ ...aligned, "foldkit/effect": "effect@4.0.0" }),
      );

      assert.deepStrictEqual(findings, [
        "expected one resolved effect version, found [4.0.6, 4.0.0]",
      ]);
    });

    it("reports a second copy of @effect/tsgo, such as one nested under a vendored plugin", () => {
      assert.deepStrictEqual(tsgoFindings(lockOf(aligned)), []);

      assert.deepStrictEqual(
        tsgoFindings(
          lockOf({
            ...aligned,
            "@phibkro/oxlint-effect-plugin/@effect/tsgo": "@effect/tsgo@0.36.4",
          }),
        ),
        ["expected one resolved @effect/tsgo version, found [0.48.0, 0.36.4]"],
      );
    });
  });
});
