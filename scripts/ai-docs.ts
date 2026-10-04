#!/usr/bin/env bun
/**
 * Renders `LLMS.md` from `ai-docs/src` and copies it, with the examples, into every publishable
 * package so it installs as `node_modules/<package>/AGENTS.md`.
 *
 * Source and license: adapted from `effect-ai-docgen`
 * (`packages/tools/ai-docgen/src/main.ts`) and `scripts/copy-ai-docs.mjs` in
 * https://github.com/Effect-TS/effect at commit b5a2d4c1d62c9620a68d72b7f20248c69ef7663b.
 * Differences: output order is sorted for determinism, `--check` mode, effx package rules, no
 * watch mode. The Effect sources are MIT licensed:
 *
 *   MIT License
 *
 *   Copyright (c) 2023 Effectful Technologies Inc
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy of this software
 *   and associated documentation files (the "Software"), to deal in the Software without
 *   restriction, including without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the
 *   Software is furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all copies or
 *   substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING
 *   BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 *   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
 *   DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 *
 * Modes (run from the repository root):
 *
 *   bun scripts/ai-docs.ts           write LLMS.md and the per-package copies
 *   bun scripts/ai-docs.ts --check   fail when LLMS.md is not what ai-docs/src renders
 *
 * Only `LLMS.md` is committed. `packages/<name>/AGENTS.md` and `packages/<name>/ai-docs/` are
 * derivations, gitignored, rebuilt by `bun run ai-docs` and consumed by `scripts/pack.ts`.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, FileSystem, Path, PlatformError, Schema } from "effect";

const aiDocsRoot = "ai-docs";

const sourceRoot = "ai-docs/src";

const outputFile = "LLMS.md";

const packagesRoot = "packages";

/** Files every publishable package must ship (npm `files` entries). */
const packageFiles = ["AGENTS.md", "ai-docs/**/*"] as const;

export class AiDocsError extends Schema.TaggedError<AiDocsError>()("AiDocsError", {
  message: Schema.String,
}) {}

interface ExampleMetadata {
  readonly title: string;
  readonly description: string | undefined;
  readonly content: string;
  readonly baseName: string;
}

const docBlockStart = "/**";

/** `01_service.ts` becomes "Service": strip the order prefix, separators, and capitalize. */
const titleFromFileName = (baseName: string): string => {
  const words = baseName.replace(/^\d+/, "").replace(/[-_]/g, " ").trim();

  return words.charAt(0).toUpperCase() + words.slice(1);
};

/**
 * Reads the first JSDoc block: `@title` overrides the title, the other lines are the description,
 * and the block is removed from the inlined code.
 */
const readMetadata = (baseName: string, source: string): ExampleMetadata => {
  const title = titleFromFileName(baseName);
  const start = source.indexOf(docBlockStart);

  if (start === -1) return { title, description: undefined, content: source, baseName };

  const lines = source.slice(start).split("\n");
  let resolvedTitle = title;
  let description = "";
  let content = source;

  for (const [index, line] of lines.entries()) {
    if (index === 0) continue;

    if (!line.startsWith(" *")) break;

    if (line.endsWith(" */")) {
      content = lines
        .slice(index + 1)
        .join("\n")
        .trim();
      break;
    }

    const text = line.replace(/^ \*\s?/, "");

    if (text.startsWith("@title")) {
      resolvedTitle = text.replace("@title", "").trim();
      continue;
    }

    description += `${text}\n`;
  }

  return {
    title: resolvedTitle,
    description: description.trim() === "" ? undefined : description.trim(),
    content,
    baseName,
  };
};

const isExample = (name: string): boolean => /\.tsx?$/.test(name);

const renderInline = (metadata: ExampleMetadata): string =>
  `### ${metadata.title}\n\n${metadata.description ?? ""}\n\n\`\`\`ts\n${metadata.content}\n\`\`\`\n`;

const renderLink = (
  metadata: ExampleMetadata,
  relativePath: string,
  firstMore: boolean,
): string => {
  const link = `[${metadata.title}](./${relativePath})`;
  const heading = firstMore ? "### More examples\n\n" : "";

  if (metadata.description === undefined) return `${heading}- **${link}**`;

  if (metadata.description.includes("\n")) {
    const indented = metadata.description
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");

    return `${heading}- **${link}**:\n${indented}`;
  }

  return `${heading}- **${link}**: ${metadata.description}`;
};

const directoryToMarkdown: (
  directory: string,
) => Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =
  Effect.fn("directoryToMarkdown")(function* (directory: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const indexPath = path.join(directory, "index.md");

    const indexMarkdown = (yield* fs.exists(indexPath))
      ? (yield* fs.readFileString(indexPath)).trim()
      : "";

    // Sorted: readDirectory order is platform-defined and the output must be reproducible.
    const entries = (yield* fs.readDirectory(directory)).sort();
    // Files named `0N_*` are inlined; anything else is only linked ("More examples").
    const hasInlineFiles = entries.some((entry) => entry.startsWith("0") && isExample(entry));

    const sections: Array<string> = [];

    for (const entry of entries) {
      const entryPath = path.join(directory, entry);
      const stat = yield* fs.stat(entryPath);

      if (stat.type === "Directory") {
        if (entry === "fixtures") continue;

        sections.push(`${yield* directoryToMarkdown(entryPath)}\n`);
        continue;
      }

      if (!isExample(entry)) continue;

      const baseName = path.basename(entry, path.extname(entry));
      const metadata = readMetadata(baseName, yield* fs.readFileString(entryPath));

      sections.push(
        baseName.startsWith("0")
          ? renderInline(metadata)
          : renderLink(metadata, entryPath, hasInlineFiles && baseName.startsWith("10")),
      );
    }

    const body = sections
      .filter((section) => section.trim() !== "")
      .join("\n")
      .trim();

    return indexMarkdown === "" ? body : `${indexMarkdown}\n\n${body}`;
  });

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    private: Schema.optionalKey(Schema.Boolean),
    files: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
);

const decodeManifest = Schema.decodeEffect(Manifest);

/** Every non-private package under `packages/` ships the generated docs; enforce its `files` list. */
const publishablePackages = Effect.fn("publishablePackages")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const names = (yield* fs.readDirectory(packagesRoot)).sort();
  const found: Array<string> = [];

  for (const name of names) {
    const manifestPath = path.join(packagesRoot, name, "package.json");

    if (!(yield* fs.exists(manifestPath))) continue;

    const manifest = yield* decodeManifest(yield* fs.readFileString(manifestPath));

    if (manifest.private === true) continue;

    for (const file of packageFiles) {
      if (!(manifest.files ?? []).includes(file)) {
        return yield* new AiDocsError({
          message: `${manifestPath} must include "${file}" in its files list`,
        });
      }
    }

    found.push(path.join(packagesRoot, name));
  }

  return found;
});

const copyToPackages = Effect.fn("copyToPackages")(function* (markdown: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const packageDirectory of yield* publishablePackages()) {
    const target = path.join(packageDirectory, "ai-docs");

    yield* fs.writeFileString(path.join(packageDirectory, "AGENTS.md"), markdown);
    yield* fs.remove(target, { recursive: true, force: true });
    yield* fs.copy(aiDocsRoot, target, { overwrite: true });
    // Only the sources ship; the per-package README and tooling files are not examples.
    yield* Console.log(`ai-docs: ${packageDirectory}/AGENTS.md, ${target}`);
  }
});

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const markdown = `${yield* directoryToMarkdown(sourceRoot)}\n`;

  if (Bun.argv.includes("--check")) {
    const current = (yield* fs.exists(outputFile)) ? yield* fs.readFileString(outputFile) : "";

    if (current !== markdown) {
      return yield* new AiDocsError({
        message: `${outputFile} is out of date with ${sourceRoot}. Run \`bun run ai-docs\` and commit the result.`,
      });
    }

    yield* Console.log(`ai-docs: ${outputFile} matches ${sourceRoot}`);

    return;
  }

  yield* fs.writeFileString(outputFile, markdown);
  yield* Console.log(`ai-docs: wrote ${outputFile} (${markdown.length} bytes)`);
  yield* copyToPackages(markdown);
});

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
