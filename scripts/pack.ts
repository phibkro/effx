import { $ } from "bun";
import { chmod, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Console, Effect } from "effect";
import cliPackage from "../packages/cli/package.json";
import compilerPackage from "../packages/compiler/package.json";
import irPackage from "../packages/ir/package.json";
import runtimePackage from "../packages/runtime/package.json";

const root = fileURLToPath(new URL("../", import.meta.url));

const artifacts = join(root, "dist-artifacts");

const revision = (await $`git rev-parse HEAD`.cwd(root).text()).trim();

const dirty = (await $`git status --porcelain --untracked-files=normal`.cwd(root).text()).trim();

if (dirty.length > 0) {
  throw new Error(
    "Commit the source before packing so the manifest identifies the exact source revision",
  );
}

const runtimeName = `effx-runtime-${runtimePackage.version}-${revision}.tgz`;

const irName = `effx-ir-${irPackage.version}-${revision}.tgz`;

const compilerName = `effx-compiler-${compilerPackage.version}-${revision}.tgz`;

const cliName = `effx-cli-${cliPackage.version}-${revision}.tgz`;

const packageTarballs = [
  { packageName: runtimePackage.name, filename: runtimeName },
  { packageName: irPackage.name, filename: irName },
  { packageName: compilerPackage.name, filename: compilerName },
  { packageName: cliPackage.name, filename: cliName },
];

const runtimeBundle = join(root, "packages/runtime/dist/index.js");

const irBundle = join(root, "packages/ir/dist/index.js");

const compilerBundle = join(root, "packages/compiler/dist/index.js");

const cliBundle = join(root, "packages/cli/dist/effx.js");

const cliConfigBundle = join(root, "packages/cli/dist/config.js");

const cliConfigTypes = join(root, "packages/cli/dist/config.d.ts");

const cliHasConfig = Object.keys(cliPackage.exports).includes("./config");

const bundles = [runtimeBundle, irBundle, compilerBundle, cliBundle];

if (cliHasConfig) bundles.push(cliConfigBundle, cliConfigTypes);

for (const bundle of bundles) {
  if (!(await Bun.file(bundle).exists())) throw new Error(`Missing build output: ${bundle}`);
}

await mkdir(artifacts, { recursive: true });

const stage = await mkdtemp(join(tmpdir(), "effx-pack-"));

const writePackage = async <Manifest extends object>(directory: string, manifest: Manifest) =>
  Bun.write(join(directory, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const copyPackageDocs = async (packagePath: string, destination: string) => {
  const packageDirectory = join(root, packagePath);
  await cp(join(packageDirectory, "AGENTS.md"), join(destination, "AGENTS.md"));
  await cp(join(packageDirectory, "ai-docs"), join(destination, "ai-docs"), {
    recursive: true,
  });
};

const packageExports = {
  ".": { types: "./dist/index.d.ts", default: "./dist/index.js" },
};

try {
  const runtimeStage = join(stage, "runtime");
  await mkdir(runtimeStage);
  await cp(join(root, "packages/runtime/dist"), join(runtimeStage, "dist"), { recursive: true });
  await cp(join(root, "packages/runtime/LICENSE"), join(runtimeStage, "LICENSE"));
  await copyPackageDocs("packages/runtime", runtimeStage);
  await writePackage(runtimeStage, {
    name: runtimePackage.name,
    version: runtimePackage.version,
    repository: runtimePackage.repository,
    license: runtimePackage.license,
    type: "module",
    files: ["dist", "AGENTS.md", "ai-docs/**/*", "LICENSE"],
    exports: packageExports,
    peerDependencies: runtimePackage.peerDependencies,
    publishConfig: runtimePackage.publishConfig,
  });
  await $`bun pm pack --filename ${join(artifacts, runtimeName)} --quiet`.cwd(runtimeStage).quiet();

  const irStage = join(stage, "ir");
  await mkdir(irStage);
  await cp(join(root, "packages/ir/dist"), join(irStage, "dist"), { recursive: true });
  await cp(join(root, "packages/ir/LICENSE"), join(irStage, "LICENSE"));
  await copyPackageDocs("packages/ir", irStage);
  await writePackage(irStage, {
    name: irPackage.name,
    version: irPackage.version,
    repository: irPackage.repository,
    license: irPackage.license,
    type: "module",
    files: ["dist", "AGENTS.md", "ai-docs/**/*", "LICENSE"],
    exports: packageExports,
    peerDependencies: irPackage.peerDependencies,
    publishConfig: irPackage.publishConfig,
  });
  await $`bun pm pack --filename ${join(artifacts, irName)} --quiet`.cwd(irStage).quiet();

  const compilerStage = join(stage, "compiler");
  await mkdir(compilerStage);
  await cp(join(root, "packages/compiler/dist"), join(compilerStage, "dist"), { recursive: true });
  await cp(join(root, "packages/compiler/LICENSE"), join(compilerStage, "LICENSE"));
  await copyPackageDocs("packages/compiler", compilerStage);
  await writePackage(compilerStage, {
    name: compilerPackage.name,
    version: compilerPackage.version,
    repository: compilerPackage.repository,
    license: compilerPackage.license,
    type: "module",
    files: ["dist", "AGENTS.md", "ai-docs/**/*", "LICENSE"],
    exports: packageExports,
    dependencies: compilerPackage.dependencies,
    peerDependencies: compilerPackage.peerDependencies,
    publishConfig: compilerPackage.publishConfig,
  });
  await $`bun pm pack --filename ${join(artifacts, compilerName)} --quiet`
    .cwd(compilerStage)
    .quiet();

  // The CLI bundle includes the private TypeScript frontend; config declarations reuse public compiler types.
  const cliStage = join(stage, "cli");
  const cliDist = join(cliStage, "dist");
  await mkdir(cliDist, { recursive: true });
  await cp(cliBundle, join(cliDist, "effx.js"));
  await chmod(join(cliDist, "effx.js"), 0o755);

  if (cliHasConfig) {
    await cp(cliConfigBundle, join(cliDist, "config.js"));
    await cp(cliConfigTypes, join(cliDist, "config.d.ts"));
  }

  await cp(join(root, "packages/cli/LICENSE"), join(cliStage, "LICENSE"));
  await copyPackageDocs("packages/cli", cliStage);

  const cliExports = cliHasConfig
    ? {
        ".": { default: "./dist/effx.js" },
        "./config": { types: "./dist/config.d.ts", default: "./dist/config.js" },
      }
    : { ".": { default: "./dist/effx.js" } };

  await writePackage(cliStage, {
    name: cliPackage.name,
    version: cliPackage.version,
    repository: cliPackage.repository,
    license: cliPackage.license,
    type: "module",
    files: ["dist", "AGENTS.md", "ai-docs/**/*", "LICENSE"],
    bin: { effx: "dist/effx.js" },
    exports: cliExports,
    dependencies: {
      "@effx/compiler": compilerPackage.version,
      "@typescript/typescript6": "6.0.2",
    },
    publishConfig: cliPackage.publishConfig,
  });
  await $`bun pm pack --filename ${join(artifacts, cliName)} --quiet`.cwd(cliStage).quiet();
} finally {
  await rm(stage, { recursive: true });
}

const packageFiles = new Map<string, Set<string>>();

for (const { packageName, filename } of packageTarballs) {
  const archive = join(artifacts, filename);

  const contents = (await $`tar -tzf ${archive}`.cwd(root).text()).split(/\r?\n/).filter(Boolean);

  await Effect.runPromise(
    Console.log(`${filename} contents:\n${contents.map((path) => `  ${path}`).join("\n")}`),
  );
  packageFiles.set(
    packageName,
    new Set(contents.map((path) => (path.startsWith("package/") ? path.slice(8) : path))),
  );
}

const trackedFiles = (await $`git ls-files`.cwd(root).text()).split(/\r?\n/).filter(Boolean);

const documentation = (
  await Promise.all(
    trackedFiles
      .filter((path) => /\.(?:md|mdx|txt)$/i.test(path))
      .map((path) => Bun.file(join(root, path)).text()),
  )
).join("\n");

const packagePathReference = /node_modules\/(@effx\/[^\s`"'<>/]+)\/([^\s`"'<>]+)/g;

for (const match of documentation.matchAll(packagePathReference)) {
  const packageName = match[1];
  const packagePath = match[2]?.replace(/[.,;:!?)}\]]+$/, "");

  if (packageName === undefined || packagePath === undefined) continue;

  const files = packageFiles.get(packageName);

  if (files === undefined) {
    throw new Error(
      `Documentation references ${packageName}/${packagePath}, but no package tarball was built`,
    );
  }

  if (!files.has(packagePath)) {
    throw new Error(
      `Documentation references node_modules/${packageName}/${packagePath}, but ${packageName} does not ship that path`,
    );
  }
}

const sha256 = async (path: string): Promise<string> => {
  const hasher = new Bun.CryptoHasher("sha256");

  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk);

  return hasher.digest("hex");
};

const sha256s: Record<string, string> = {};

for (const { filename } of packageTarballs) {
  sha256s[filename] = await sha256(join(artifacts, filename));
}

const manifest = { commit: revision, sha256s };

await Bun.write(join(artifacts, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
