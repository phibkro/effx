import { dirname, resolve } from "node:path";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

/**
 * Spec 0034 R2. Effect's stability policy lets an API tagged `@stability unstable` or `experimental`
 * break in a minor release, so a published package whose code uses one must not accept the next
 * minor: its `effect` peer range is `>=X.Y.Z <X.(Y+1).0`. A package that depends on such a package
 * inherits the bound, because one `effect` serves both. The stability of each import is read from
 * the installed `effect` sources: the tag on a module's header, or on its `export * as` line in the
 * barrel it is imported through (`effect`, `effect/encoding`, ...). The scan sees modules, not
 * members; the member-level check is `effect-tsgo diagnostics` with an empty allowlist (spec 0034 R2).
 */
const root = resolve(import.meta.dirname, "../../..");

const effectSource = resolve(root, "node_modules/effect/src");

type Stability = "stable" | "unstable" | "experimental";

const isUnsafe = (stability: Stability | undefined): boolean =>
  stability === "unstable" || stability === "experimental";

const stabilityTag = /@stability (stable|unstable|experimental)/;

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    private: Schema.optional(Schema.Boolean),
    dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
    peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  }),
);

const decodeManifest = Schema.decodeUnknownSync(Manifest);

interface PublishedPackage {
  readonly name: string;
  readonly peer: string | undefined;
  /** Workspace packages it depends on. */
  readonly uses: ReadonlyArray<string>;
  /** `effect` modules its source imports whose stability is `unstable` or `experimental`. */
  readonly unsafe: ReadonlyArray<string>;
}

const semver = /^(\d+)\.(\d+)\.(\d+)$/;

/** `>=X.Y.Z <X.(Y+1).0`: the lowest minor that works, and no later one. */
const isBelowNextMinor = (range: string | undefined): boolean => {
  const match = /^>=(\S+) <(\S+)$/.exec(range ?? "");
  const lower = semver.exec(match?.[1] ?? "");
  const upper = semver.exec(match?.[2] ?? "");

  return (
    lower !== null &&
    upper !== null &&
    upper[1] === lower[1] &&
    Number(upper[2]) === Number(lower[2]) + 1 &&
    upper[3] === "0"
  );
};

/** Human-readable findings; empty when every package that needs a bound declares one. */
const peerFindings = (packages: ReadonlyArray<PublishedPackage>): ReadonlyArray<string> => {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));

  const needsBound = (pkg: PublishedPackage, seen: ReadonlySet<string>): ReadonlyArray<string> => {
    if (seen.has(pkg.name)) return [];

    const reasons = pkg.unsafe.map((module) => `${pkg.name} uses ${module}`);

    const inherited = pkg.uses.flatMap((use) => {
      const dependency = byName.get(use);

      return dependency === undefined ? [] : needsBound(dependency, new Set([...seen, pkg.name]));
    });

    return [...reasons, ...inherited];
  };

  return packages.flatMap((pkg) => {
    if (pkg.peer === undefined) return [];

    const reasons = needsBound(pkg, new Set());

    return reasons.length === 0 || isBelowNextMinor(pkg.peer)
      ? []
      : [
          `${pkg.name} peers effect "${pkg.peer}" but needs ">=X.Y.Z <X.(Y+1).0" (${reasons.join("; ")})`,
        ];
  });
};

const read = (file: string): Promise<string> => Bun.file(file).text();

const exists = (file: string): Promise<boolean> => Bun.file(file).exists();

/** The tag of the first doc comment of a file: the module's own stability. */
const headerStability = async (file: string): Promise<Stability | undefined> => {
  if (!(await exists(file))) return undefined;

  const text = await read(file);
  const header = text.slice(0, text.indexOf("*/") + 2);
  const tag = stabilityTag.exec(header)?.[1];

  return tag === "stable" || tag === "unstable" || tag === "experimental" ? tag : undefined;
};

/** The tag above `export * as <name> from` in a barrel. */
const barrelStability = async (barrel: string, name: string): Promise<Stability | undefined> => {
  const text = await read(barrel);
  const line = text.indexOf(`export * as ${name} from`);

  if (line < 0) return undefined;

  const before = text.slice(0, line);
  const tag = stabilityTag.exec(before.slice(before.lastIndexOf("/**")))?.[1];

  return tag === "stable" || tag === "unstable" || tag === "experimental" ? tag : undefined;
};

const importPattern =
  /import\s+(type\s+)?(?:\{([^}]*)\}|\*\s+as\s+\w+|\w+)\s+from\s+"(effect(?:\/[^"]*)?)"/g;

/** Every `effect` module a source text imports, with its stability. */
const importedStabilities = async (
  text: string,
): Promise<ReadonlyArray<readonly [string, Stability]>> => {
  const found: Array<readonly [string, Stability]> = [];

  for (const match of text.matchAll(importPattern)) {
    const specifier = match[3] ?? "effect";
    const subpath = specifier === "effect" ? "" : specifier.slice("effect/".length);
    const barrel = resolve(effectSource, subpath, "index.ts");

    if (await exists(barrel)) {
      for (const part of (match[2] ?? "").split(",")) {
        const name =
          part
            .trim()
            .replace(/^type\s+/, "")
            .split(/\s+as\s+/)[0] ?? "";

        const stability = name === "" ? undefined : await barrelStability(barrel, name);

        if (stability !== undefined) found.push([`${specifier}#${name}`, stability]);
      }
    } else {
      const stability = await headerStability(resolve(effectSource, `${subpath}.ts`));

      if (stability !== undefined) found.push([specifier, stability]);
    }
  }

  return found;
};

const sourcesOf = (directory: string): ReadonlyArray<string> => [
  ...new Bun.Glob("**/*.ts").scanSync({ cwd: resolve(directory, "src"), onlyFiles: true }),
];

const published = async (): Promise<ReadonlyArray<PublishedPackage>> => {
  const packages: Array<PublishedPackage> = [];

  for (const manifestPath of new Bun.Glob("packages/*/package.json").scanSync({ cwd: root })) {
    const manifest = decodeManifest(await read(resolve(root, manifestPath)));

    if (manifest.private === true) continue;

    const directory = dirname(resolve(root, manifestPath));
    const unsafe = new Set<string>();

    for (const file of sourcesOf(directory)) {
      for (const [module, stability] of await importedStabilities(
        await read(resolve(directory, "src", file)),
      )) {
        if (isUnsafe(stability)) unsafe.add(`${module} (${stability})`);
      }
    }

    packages.push({
      name: manifest.name,
      peer: manifest.peerDependencies?.effect,
      uses: Object.keys(manifest.dependencies ?? {}),
      unsafe: [...unsafe].sort(),
    });
  }

  return packages;
};

describe("published packages bound effect below the next minor when they use unstable APIs", () => {
  it("holds for every package in the workspace", async () => {
    const packages = await published();
    const names = packages.map((pkg) => pkg.name);

    // Guard against a vacuous pass: the scan must find the known unstable uses.
    expect(names).toEqual(expect.arrayContaining(["@effx/ir", "@effx/compiler", "@effx/runtime"]));
    expect(packages.find((pkg) => pkg.name === "@effx/ir")?.unsafe.join(" ")).toContain(
      "effect/crypto#Digest",
    );
    expect(packages.find((pkg) => pkg.name === "@effx/ir")?.unsafe.join(" ")).toContain(
      "effect#Graph",
    );

    expect(peerFindings(packages)).toEqual([]);
  });

  it("keeps the packages that use only stable APIs open to the next minor", async () => {
    const packages = await published();

    for (const name of ["@effx/runtime", "@effx/diagnostics"]) {
      const pkg = packages.find((candidate) => candidate.name === name);

      expect(pkg?.unsafe, name).toEqual([]);
      expect(pkg?.peer, name).toBe(">=4.0.0 <5");
    }
  });

  describe("negative control", () => {
    const base = { uses: [], unsafe: [] };

    it("accepts the next-minor bound and an open range for a stable-only package", () => {
      expect(
        peerFindings([
          {
            ...base,
            name: "unstable",
            peer: ">=4.1.0 <4.2.0",
            unsafe: ["effect/crypto/Digest (unstable)"],
          },
          { ...base, name: "stable", peer: ">=4.0.0 <5" },
        ]),
      ).toEqual([]);
    });

    it("rejects a package that uses an unstable API and accepts the next major", () => {
      expect(
        peerFindings([
          {
            ...base,
            name: "unstable",
            peer: ">=4.1.0 <5",
            unsafe: ["effect/crypto/Digest (unstable)"],
          },
        ]),
      ).toEqual([
        'unstable peers effect ">=4.1.0 <5" but needs ">=X.Y.Z <X.(Y+1).0" (unstable uses effect/crypto/Digest (unstable))',
      ]);
    });

    it("rejects an experimental use under a range that spans two minors", () => {
      expect(
        peerFindings([
          { ...base, name: "p", peer: ">=4.1.0 <4.3.0", unsafe: ["effect/Glob (experimental)"] },
        ]),
      ).toHaveLength(1);
    });

    it("makes a package inherit the bound of a workspace dependency", () => {
      expect(
        peerFindings([
          { ...base, name: "lib", peer: ">=4.1.0 <4.2.0", unsafe: ["effect#Graph (unstable)"] },
          { ...base, name: "app", peer: ">=4.1.0 <5", uses: ["lib"] },
        ]),
      ).toEqual([
        'app peers effect ">=4.1.0 <5" but needs ">=X.Y.Z <X.(Y+1).0" (lib uses effect#Graph (unstable))',
      ]);
    });

    it("recognises only a bound that ends at the next minor", () => {
      expect(isBelowNextMinor(">=4.1.0 <4.2.0")).toBe(true);
      expect(isBelowNextMinor(">=4.1.3 <4.2.0")).toBe(true);
      expect(isBelowNextMinor(">=4.1.0 <4.2.1")).toBe(false);
      expect(isBelowNextMinor(">=4.1.0 <4.3.0")).toBe(false);
      expect(isBelowNextMinor(">=4.1.0 <5")).toBe(false);
      expect(isBelowNextMinor("^4.1.0")).toBe(false);
      expect(isBelowNextMinor(undefined)).toBe(false);
    });
  });
});
