import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

const hooksPath = ".githooks";

if (!existsSync(resolve(root, ".git"))) {
  await Bun.write(Bun.stdout, "Git hooks were not installed: no Git metadata is present.\n");
} else {
  const inspect = Bun.spawnSync({
    cmd: ["git", "config", "--local", "--get-all", "core.hooksPath"],
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (inspect.exitCode !== 0 && inspect.exitCode !== 1) {
    throw new Error(`Unable to read core.hooksPath: ${inspect.stderr.toString()}`);
  }

  const configuredPaths =
    inspect.exitCode === 0
      ? inspect.stdout
          .toString()
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      : [];

  const expected = resolve(root, hooksPath);
  const conflictingPath = configuredPaths.find((value) => resolve(root, value) !== expected);

  if (conflictingPath !== undefined) {
    throw new Error(
      `Refusing to overwrite core.hooksPath ${JSON.stringify(conflictingPath)}; configure ${hooksPath} explicitly first.`,
    );
  }

  const result = Bun.spawnSync({
    cmd: ["git", "config", "--local", "core.hooksPath", hooksPath],
    cwd: root,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });

  if (result.exitCode !== 0) {
    throw new Error(`Unable to configure Git hooks at ${hooksPath}.`);
  }

  await Bun.write(Bun.stdout, `Installed native Git hooks from ${hooksPath}.\n`);
}
