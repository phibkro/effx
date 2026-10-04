import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = new URL("../../..", import.meta.url).pathname;

describe("native Git hooks", () => {
  it("no-ops outside Git, installs into linked worktrees, and refuses foreign hooksPath", () => {
    const temporary = mkdtempSync(join(tmpdir(), "effx-git-hooks-"));
    const repository = join(temporary, "repository");
    const linkedWorktree = join(temporary, "linked-worktree");
    mkdirSync(repository, { recursive: true });

    try {
      const scriptDirectory = join(repository, "scripts");
      const hookDirectory = join(repository, ".githooks");
      mkdirSync(scriptDirectory, { recursive: true });
      mkdirSync(hookDirectory, { recursive: true });
      cpSync(
        join(root, "scripts/install-git-hooks.ts"),
        join(scriptDirectory, "install-git-hooks.ts"),
      );
      cpSync(join(root, ".githooks/commit-msg"), join(hookDirectory, "commit-msg"));
      cpSync(join(root, ".githooks/pre-commit"), join(hookDirectory, "pre-commit"));
      const installer = join(scriptDirectory, "install-git-hooks.ts");
      writeFileSync(
        join(repository, ".oxlintrc.json"),
        '{"ignorePatterns":["packages/frontend-ts/test/fixtures/rc116/**"],"rules":{"no-debugger":"error"}}\n',
      );
      writeFileSync(join(repository, ".oxfmtrc.json"), '{"ignorePatterns":["docs/research/**"]}\n');

      const outsideGit = Bun.spawnSync({
        cmd: ["bun", "run", installer],
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(outsideGit.exitCode).toBe(0);
      expect(outsideGit.stdout.toString()).toContain("no Git metadata");

      const initialized = Bun.spawnSync({
        cmd: ["git", "init", "--quiet"],
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(initialized.exitCode).toBe(0);

      for (const [key, value] of [
        ["user.name", "Effx Hook Test"],
        ["user.email", "hooks@example.invalid"],
      ]) {
        const configured = Bun.spawnSync({
          cmd: ["git", "config", "--local", key, value],
          cwd: repository,
          stdout: "pipe",
          stderr: "pipe",
        });

        expect(configured.exitCode).toBe(0);
      }

      chmodSync(join(hookDirectory, "commit-msg"), 0o755);
      chmodSync(join(hookDirectory, "pre-commit"), 0o755);
      writeFileSync(join(repository, "baseline.txt"), "hook fixture\n");

      const seeded = Bun.spawnSync({
        cmd: ["git", "-c", "core.hooksPath=/dev/null", "add", "."],
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(seeded.exitCode).toBe(0);

      const initialCommit = Bun.spawnSync({
        cmd: [
          "git",
          "-c",
          "core.hooksPath=/dev/null",
          "commit",
          "-m",
          "chore: prepare hook fixture",
        ],
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(initialCommit.exitCode).toBe(0);

      const installed = Bun.spawnSync({
        cmd: ["bun", "run", installer],
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(installed.exitCode).toBe(0);
      expect(
        Bun.spawnSync({
          cmd: ["git", "config", "--local", "--get-all", "core.hooksPath"],
          cwd: repository,
          stdout: "pipe",
          stderr: "pipe",
        })
          .stdout.toString()
          .trim(),
      ).toBe(".githooks");

      const addedWorktree = Bun.spawnSync({
        cmd: ["git", "worktree", "add", "--quiet", "--detach", linkedWorktree, "HEAD"],
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(addedWorktree.exitCode).toBe(0);
      const binaryDirectory = join(linkedWorktree, "node_modules/.bin");
      mkdirSync(binaryDirectory, { recursive: true });
      symlinkSync(join(root, "node_modules/.bin/oxfmt"), join(binaryDirectory, "oxfmt"));
      symlinkSync(join(root, "node_modules/.bin/oxlint"), join(binaryDirectory, "oxlint"));
      const marker = join(linkedWorktree, "commitlint-ran.txt");
      const commitlint = join(binaryDirectory, "commitlint");
      writeFileSync(
        commitlint,
        `#!/usr/bin/env bun\nimport { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\n`,
      );
      chmodSync(commitlint, 0o755);
      writeFileSync(join(linkedWorktree, "linked.txt"), "linked worktree\n");

      const staged = Bun.spawnSync({
        cmd: ["git", "add", "linked.txt"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(staged.exitCode).toBe(0);

      const committed = Bun.spawnSync({
        cmd: ["git", "commit", "-m", "chore: exercise linked worktree hook"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(committed.exitCode).toBe(0);
      expect(existsSync(marker)).toBe(true);
      const fixtureDirectory = join(linkedWorktree, "packages/frontend-ts/test/fixtures/rc116/src");
      mkdirSync(fixtureDirectory, { recursive: true });
      const ignoredFixture = join(fixtureDirectory, "profile-openapi.spec.ts");
      writeFileSync(ignoredFixture, "export   const profile='fixture'\n");

      const stagedUnformattedFixture = Bun.spawnSync({
        cmd: ["git", "add", "packages/frontend-ts/test/fixtures/rc116/src/profile-openapi.spec.ts"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(stagedUnformattedFixture.exitCode).toBe(0);

      const rejectedFormatting = Bun.spawnSync({
        cmd: ["git", "commit", "-m", "test: reject unformatted ignored fixture"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(rejectedFormatting.exitCode).not.toBe(0);
      expect(rejectedFormatting.stdout.toString() + rejectedFormatting.stderr.toString()).toContain(
        "pre-commit: oxfmt --check failed",
      );

      writeFileSync(ignoredFixture, 'export const profile = "fixture";\n');

      const stagedIgnoredFixture = Bun.spawnSync({
        cmd: ["git", "add", "packages/frontend-ts/test/fixtures/rc116/src/profile-openapi.spec.ts"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(stagedIgnoredFixture.exitCode).toBe(0);

      const committedIgnoredFixture = Bun.spawnSync({
        cmd: ["git", "commit", "-m", "test: allow formatted ignored fixture"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(committedIgnoredFixture.exitCode).toBe(0);
      const ignoredResearchDirectory = join(linkedWorktree, "docs/research");
      mkdirSync(ignoredResearchDirectory, { recursive: true });
      const ignoredResearch = join(ignoredResearchDirectory, "auth-yielded-permix-evaluation.md");
      writeFileSync(ignoredResearch, "# Auth yield evaluation\n\nA staged research note.\n");

      const stagedIgnoredResearch = Bun.spawnSync({
        cmd: ["git", "add", "docs/research/auth-yielded-permix-evaluation.md"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(stagedIgnoredResearch.exitCode).toBe(0);

      const committedIgnoredResearch = Bun.spawnSync({
        cmd: ["git", "commit", "-m", "docs: add ignored research note"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(committedIgnoredResearch.exitCode).toBe(0);
      const unformattedMarkdown = join(linkedWorktree, "unformatted.md");
      writeFileSync(unformattedMarkdown, "# Title\nBody\n");

      const stagedMarkdown = Bun.spawnSync({
        cmd: ["git", "add", "unformatted.md"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(stagedMarkdown.exitCode).toBe(0);

      const rejectedMarkdownCommit = Bun.spawnSync({
        cmd: ["git", "commit", "-m", "docs: reject unformatted staged Markdown"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(rejectedMarkdownCommit.exitCode).not.toBe(0);
      expect(
        rejectedMarkdownCommit.stdout.toString() + rejectedMarkdownCommit.stderr.toString(),
      ).toContain("pre-commit: oxfmt --check failed");

      const unstageMarkdown = Bun.spawnSync({
        cmd: ["git", "reset", "--", "unformatted.md"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(unstageMarkdown.exitCode).toBe(0);

      const lintFailure = join(linkedWorktree, "lint-failure.ts");

      writeFileSync(lintFailure, "debugger;\n");

      const stagedLintFailure = Bun.spawnSync({
        cmd: ["git", "add", "lint-failure.ts"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(stagedLintFailure.exitCode).toBe(0);

      const rejectedLint = Bun.spawnSync({
        cmd: ["git", "commit", "-m", "test: reject lint violation"],
        cwd: linkedWorktree,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(rejectedLint.exitCode).not.toBe(0);
      expect(rejectedLint.stdout.toString() + rejectedLint.stderr.toString()).toContain(
        "pre-commit: oxlint failed",
      );

      const foreignPath = Bun.spawnSync({
        cmd: ["git", "config", "--local", "--replace-all", "core.hooksPath", "foreign-hooks"],
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(foreignPath.exitCode).toBe(0);

      const refused = Bun.spawnSync({
        cmd: ["bun", "run", installer],
        cwd: repository,
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(refused.exitCode).not.toBe(0);
      expect(refused.stderr.toString()).toContain("Refusing to overwrite core.hooksPath");
      expect(
        Bun.spawnSync({
          cmd: ["git", "config", "--local", "--get-all", "core.hooksPath"],
          cwd: repository,
          stdout: "pipe",
          stderr: "pipe",
        })
          .stdout.toString()
          .trim(),
      ).toBe("foreign-hooks");
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });

  it("accepts a scope-less public release message and rejects wip and merge types", () => {
    const commitlint = join(root, "node_modules/.bin/commitlint");
    expect(existsSync(commitlint)).toBe(true);

    const valid = Bun.spawnSync({
      cmd: [
        "bun",
        "--bun",
        commitlint,
        "--edit",
        join(root, "tools/conventions/fixtures/commit-messages/valid.txt"),
      ],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });

    const invalid = Bun.spawnSync({
      cmd: [
        "bun",
        "--bun",
        commitlint,
        "--edit",
        join(root, "tools/conventions/fixtures/commit-messages/invalid.txt"),
      ],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });

    const mergeType = Bun.spawnSync({
      cmd: [
        "bun",
        "--bun",
        commitlint,
        "--edit",
        join(root, "tools/conventions/fixtures/commit-messages/merge-type.txt"),
      ],
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(valid.exitCode).toBe(0);
    expect(invalid.exitCode).not.toBe(0);
    expect(mergeType.exitCode).not.toBe(0);
  });
});
