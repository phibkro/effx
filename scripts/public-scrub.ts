#!/usr/bin/env bun
/** @effect-diagnostics unstableApiUsage:off -- this CLI uses read-only git and hostname probes at its process boundary */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, FileSystem, Path, Schema, String } from "effect";

class PublicScrubError extends Schema.TaggedError<PublicScrubError>()("PublicScrubError", {
  message: Schema.String,
}) {}

class TextDecodeError extends Schema.TaggedError<TextDecodeError>()("TextDecodeError", {
  message: Schema.String,
}) {}

const researchPath = "docs/research/2026-10-02-deep-research-report.md";

const researchHeader =
  "Operator-provided research report (2026-10-02). Inline citations were lost when the report was exported; claims are not individually sourced here. Primary-source verification for decisions lives in docs/specs and docs/research.\n\n";

const evidenceNotice =
  "Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.";

const evidenceSentinel = "\uE000PUBLIC_SCRUB_EVIDENCE\uE001";

const normalizedHostPhrase = "maintainer's workstation";

const hostSentinel = "\uE000PUBLIC_SCRUB_HOST\uE001";

const expectedCitations = 40;

const evidenceFiles = new Set([
  "docs/research/content-slice-evidence.md",
  "docs/research/lift-spike.md",
  "docs/research/legibility-dense-form.md",
  "docs/research/monoweb-branches.md",
  "docs/research/profile-baseline.md",
  "docs/research/profile-slice-blockers.md",
  "docs/research/profile-slice-evidence.md",
  "docs/research/rc116-compat.md",
  "docs/research/schools-slice-evidence.md",
  "docs/research/social-events-slice-evidence.md",
  "docs/research/tagged-access-constructor-evidence.md",
  "docs/research/team-applications-slice-evidence.md",
  "docs/research/organization-slice-evidence.md",
]);

const citations = /\uE200cite\uE202[^\uE200\uE201]*\uE201/g;

const commitHash = /(?<![a-fA-F0-9])[a-fA-F0-9]{7,40}(?![a-fA-F0-9])/g;

const trailingPunctuation = /[.,:!?]+$/;

interface FileChange {
  readonly file: string;
  readonly paths: number;
  readonly hosts: number;
  readonly unpublished: number;
  readonly evidenceNote: number;
  readonly citations: number;
}

export const lineLossViolation = (
  file: string,
  original: string,
  transformed: string,
  replacementCount: number,
): string | undefined => {
  const originalLines = original.split(/\r\n|\r|\n/).length;
  const transformedLines = transformed.split(/\r\n|\r|\n/).length;
  const removedLines = originalLines - transformedLines;

  return removedLines > replacementCount
    ? `${file}: scrub would remove ${removedLines} lines for ${replacementCount} replacement(s)`
    : undefined;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const run = (command: string, args: ReadonlyArray<string>) => {
  const result = Bun.spawnSync({ cmd: [command, ...args], stdout: "pipe", stderr: "ignore" });

  return { code: result.exitCode, text: new TextDecoder().decode(result.stdout) };
};

const gitOutput = (args: ReadonlyArray<string>): string | undefined => {
  const result = run("git", args);

  return result.code === 0 ? result.text : undefined;
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const repoRoot = path.resolve(".");
  const args = Bun.argv.slice(2);
  const apply = args.includes("--apply");
  const reportOutput = args.find((arg) => arg.startsWith("--report="))?.slice("--report=".length);

  if (
    args.some((arg) => arg !== "--apply" && arg !== "--dry-run" && !arg.startsWith("--report=")) ||
    (args.includes("--apply") && args.includes("--dry-run"))
  ) {
    return yield* new PublicScrubError({
      message: "Usage: bun run scripts/public-scrub.ts [--dry-run | --apply] [--report=<file>]",
    });
  }

  const listing = gitOutput(["-C", repoRoot, "ls-files", "-z"]);

  if (listing === undefined) return yield* new PublicScrubError({ message: "git ls-files failed" });

  const files = listing
    .split("\0")
    .filter((file) => file.length > 0)
    .sort();

  const sharedProjects = path.join(path.sep, "srv", "share", "projects");
  const monoWebRoot = path.join(sharedProjects, "vektorprogrammet", "mono-web");
  const effectRoot = path.join(sharedProjects, "effect");
  const effectCommit = String.trim(gitOutput(["-C", effectRoot, "rev-parse", "HEAD"]) ?? "");

  if (!/^[a-f0-9]{40}$/i.test(effectCommit)) {
    return yield* new PublicScrubError({
      message: "Could not resolve Effect clone HEAD for public source links",
    });
  }

  const projectRootPattern = new RegExp(
    `^${escapeRegExp(sharedProjects)}/(effx(?:-[^/]+)?)(?:/(.*))?$`,
  );

  const sharedPathPattern = new RegExp(
    `${escapeRegExp(sharedProjects)}/[^\\s)\\]}>\\x60"'<>;,]+`,
    "g",
  );

  const homeRoot = path.join(path.sep, "home");
  const tmpRoot = path.join(path.sep, "tmp");

  const privatePathPattern = new RegExp(
    `(?:${escapeRegExp(homeRoot)}|${escapeRegExp(tmpRoot)})/[^\\s)\\]}>\\x60"'<>;,]+`,
    "g",
  );

  const hostname = String.trim(run("hostname", []).text);

  const hostnamePattern =
    hostname.length > 0
      ? new RegExp(`(?<![A-Za-z0-9_.-])${escapeRegExp(hostname)}(?![A-Za-z0-9_.-])`, "g")
      : undefined;

  const unpublishedOutput =
    gitOutput(["-C", monoWebRoot, "rev-list", "--branches", "--not", "--remotes=origin"]) ?? "";

  const unpublishedPrefixes = new Set<string>();

  for (const hash of unpublishedOutput
    .split(/\s+/)
    .filter((value) => /^[a-f0-9]{40}$/i.test(value))) {
    for (let length = 7; length <= hash.length; length += 1)
      unpublishedPrefixes.add(hash.slice(0, length));
  }

  const mapOtherProject = (absolutePath: string, suffix: string, punctuation: string): string => {
    const pieces = suffix.split("/").filter((piece) => piece.length > 0);

    for (let length = pieces.length; length > 0; length -= 1) {
      const candidate = path.join(sharedProjects, ...pieces.slice(0, length));

      const topLevel = String.trim(
        gitOutput(["-C", candidate, "rev-parse", "--show-toplevel"]) ?? "",
      );

      if (topLevel.length === 0) continue;

      const remote = String.trim(gitOutput(["-C", topLevel, "remote", "get-url", "origin"]) ?? "");

      const github = /(?:git@github\.com:|https?:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/.exec(
        remote,
      );

      if (github === null) return `${path.basename(topLevel)}${punctuation}`;

      const relative = path.relative(topLevel, absolutePath);
      const kind = path.extname(absolutePath).length > 0 ? "blob" : "tree";

      return `https://github.com/${github[1]}/${kind}/HEAD/${relative}${punctuation}`;
    }

    return `${pieces[0] ?? "project"}${punctuation}`;
  };

  const mapSharedPath = (absolutePath: string): string => {
    const punctuation = trailingPunctuation.exec(absolutePath)?.[0] ?? "";
    const cleanPath = absolutePath.slice(0, absolutePath.length - punctuation.length);
    const suffix = cleanPath.slice(sharedProjects.length + 1);

    const monoWebRelative = suffix.startsWith("vektorprogrammet/mono-web-effx-baseline/")
      ? suffix.slice("vektorprogrammet/mono-web-effx-baseline/".length)
      : suffix === "vektorprogrammet/mono-web-effx-baseline"
        ? ""
        : suffix.startsWith("vektorprogrammet/mono-web/")
          ? suffix.slice("vektorprogrammet/mono-web/".length)
          : suffix === "vektorprogrammet/mono-web"
            ? ""
            : undefined;

    if (monoWebRelative !== undefined) {
      return `${monoWebRelative.length > 0 ? `mw/${monoWebRelative}` : "mw"}${punctuation}`;
    }

    if (cleanPath === effectRoot || cleanPath.startsWith(`${effectRoot}/`)) {
      const relative = cleanPath.slice(effectRoot.length).replace(/^\//, "");
      const kind = relative.length > 0 ? "blob" : "tree";
      const target = relative.length > 0 ? `/${relative}` : "";

      return `https://github.com/Effect-TS/effect/${kind}/${effectCommit}${target}${punctuation}`;
    }

    const effx = projectRootPattern.exec(cleanPath);

    if (effx !== null) return `${effx[2] ?? "."}${punctuation}`;

    return mapOtherProject(cleanPath, suffix, punctuation);
  };

  const replaceMatches = (
    source: string,
    pattern: RegExp,
    replace: (match: string) => string,
  ): string => {
    let cursor = 0;
    let output = "";

    for (const match of source.matchAll(pattern)) {
      const start = match.index ?? 0;
      output += source.slice(cursor, start) + replace(match[0]);
      cursor = start + match[0].length;
    }

    return output + source.slice(cursor);
  };

  const changes: Array<FileChange> = [];

  for (const file of files) {
    const bytes = yield* fs.readFile(path.join(repoRoot, file));

    const decoded = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      catch: () => new TextDecodeError({ message: "Tracked file is not UTF-8 text" }),
    }).pipe(Effect.catchTag("TextDecodeError", () => Effect.succeed(null)));

    if (decoded === null) continue;

    const original = decoded;
    let transformed = original;
    const count = { paths: 0, hosts: 0, unpublished: 0, evidenceNote: 0, citations: 0 };

    if (file === researchPath) {
      const citationsBefore = [...original.matchAll(citations)].length;
      const hasHeader = original.startsWith(researchHeader);

      if (citationsBefore !== expectedCitations && !(citationsBefore === 0 && hasHeader)) {
        return yield* new PublicScrubError({
          message: `${file}: expected ${expectedCitations} markers initially (or 0 on rerun), found ${citationsBefore}`,
        });
      }

      const withoutCitations = original.replace(citations, "");
      const citationsAfter = [...withoutCitations.matchAll(citations)].length;

      if (citationsAfter !== 0) {
        return yield* new PublicScrubError({
          message: `${file}: citation markers remain after scrubbing`,
        });
      }

      count.citations = citationsBefore;
      transformed = hasHeader ? original : `${researchHeader}${withoutCitations}`;
    } else {
      transformed = replaceMatches(transformed, sharedPathPattern, (match) => {
        count.paths += 1;

        return mapSharedPath(match);
      });
      transformed = replaceMatches(transformed, privatePathPattern, (match) => {
        count.paths += 1;
        const punctuation = trailingPunctuation.exec(match)?.[0] ?? "";

        return `${match.startsWith(tmpRoot) ? "temporary workspace" : ""}${punctuation}`;
      });

      if (transformed.includes(evidenceSentinel)) {
        return yield* new PublicScrubError({ message: `${file}: scrub sentinel already exists` });
      }

      transformed = transformed.replaceAll(evidenceNotice, evidenceSentinel);
      transformed = transformed.replaceAll(normalizedHostPhrase, hostSentinel);

      if (hostnamePattern !== undefined && file !== "scripts/public-scrub.ts") {
        transformed = transformed.replace(hostnamePattern, () => {
          count.hosts += 1;

          return normalizedHostPhrase;
        });
      }

      transformed = transformed.replaceAll(hostSentinel, normalizedHostPhrase);
      transformed = transformed.replaceAll(evidenceSentinel, evidenceNotice);
      transformed = transformed.replace(commitHash, (hash, offset) => {
        if (!unpublishedPrefixes.has(hash.toLowerCase())) return hash;

        const afterHash = transformed.slice(offset + hash.length);

        if (afterHash.startsWith(" (unpublished)") || afterHash.startsWith("` (unpublished)"))
          return hash;
        count.unpublished += 1;

        return `${hash} (unpublished)`;
      });

      if (evidenceFiles.has(file) && !transformed.includes(evidenceNotice)) {
        const headingEnd = transformed.indexOf("\n");
        transformed =
          headingEnd < 0
            ? `${transformed}\n\n${evidenceNotice}`
            : `${transformed.slice(0, headingEnd + 1)}\n${evidenceNotice}\n${transformed.slice(headingEnd + 1)}`;
        count.evidenceNote = 1;
      }
    }

    const replacementCount = count.paths + count.hosts + count.unpublished + count.citations;
    const lineLoss = lineLossViolation(file, original, transformed, replacementCount);

    if (lineLoss !== undefined) {
      return yield* new PublicScrubError({ message: lineLoss });
    }

    if (transformed !== original) {
      changes.push({ file, ...count });

      if (apply)
        yield* fs.writeFile(path.join(repoRoot, file), new TextEncoder().encode(transformed));
    }
  }

  const report = [
    `# Public-tree scrub ${apply ? "apply" : "dry run"}`,
    "",
    `Repository snapshot: ${String.trim(gitOutput(["-C", repoRoot, "rev-parse", "HEAD"]) ?? "unknown")}`,
    `Effect source revision: ${effectCommit}`,
    `Mode: ${apply ? "apply" : "dry-run (default)"}`,
    "",
    "## Mapping table",
    "- mono-web and unpushed mono-web worktrees → mw/<repo-relative-path>",
    "- Effect clone → pinned public GitHub source URL at the clone's HEAD",
    "- effx worktrees → repository-relative path",
    "- other project checkout → GitHub URL when available, otherwise package name",
    "- `/tmp` scratch paths → `temporary workspace`; `/home` paths are removed",
    "- Hostname tokens → `maintainer's workstation`",
    "- Hashes found only on local mono-web branches are preserved and suffixed `(unpublished)`",
    "- Citation markers are removed only from the research report; its header is prepended",
    "",
    "## Per-file change counts",
    "",
    "| File | Path mappings/removals | Hostnames | Unpublished hashes labelled | Evidence note added | Citation tokens removed |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...(changes.length === 0
      ? ["| _(no changes)_ | 0 | 0 | 0 | 0 | 0 |"]
      : changes.map(
          (change) =>
            `| \`${change.file}\` | ${change.paths} | ${change.hosts} | ${change.unpublished} | ${change.evidenceNote} | ${change.citations} |`,
        )),
    "",
    `Files changed: ${changes.length}`,
    "Unmapped absolute project paths: none; other checkouts fall back to their package name when no GitHub remote exists.",
    `Citation placeholders: expected 40 before, observed ${changes.find((change) => change.file === researchPath)?.citations ?? 0}, 0 after.`,
    "",
    apply ? "Applied to tracked files in this worktree only." : "No files were changed.",
    "",
  ].join("\n");

  yield* Console.log(report);

  if (reportOutput !== undefined) yield* fs.writeFileString(reportOutput, report);
});

if (import.meta.main) BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
