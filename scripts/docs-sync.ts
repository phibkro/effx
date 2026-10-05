#!/usr/bin/env bun
/**
 * Renders `docs/decisions/*.md` and `docs/specs/*.md` into the Fumadocs content tree.
 *
 * The repository documents are the only source of these texts (single source of truth). The
 * generated pages are gitignored in `apps/docs/.gitignore`; never edit them. Each run deletes and
 * rewrites the target folders, so a removed or renamed source cannot leave a stale page behind.
 *
 * Fumadocs MDX has an `<include>` tag, but it needs one hand-maintained wrapper per file. A
 * generated copy needs no wrapper and derives the `title` and `description` front matter from the
 * document itself (`# H1` and the `Status:` line).
 *
 * The diagnostic catalogue uses the shared registry renderer. The landing page links to it.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { bundledDiagnosticEntries } from "@effx/compiler";
import { composeRegistry, renderCatalogue, type DiagnosticEntry } from "@effx/diagnostics";
import { Console, Effect, FileSystem, Path, Schema } from "effect";

/** One folder of repository documents rendered under `apps/docs/content/docs/<slug>`. */
interface Collection {
  readonly source: string;
  readonly slug: string;
  readonly title: string;
}

const collections: ReadonlyArray<Collection> = [
  { source: "docs/decisions", slug: "decisions", title: "Architecture decisions" },
  { source: "docs/specs", slug: "specs", title: "Specifications" },
];

const contentRoot = "apps/docs/content/docs";

export class DocsSyncError extends Schema.TaggedError<DocsSyncError>()("DocsSyncError", {
  message: Schema.String,
}) {}

const descriptionLimit = 200;

const firstHeading = /^# (.+)$/m;

/** The `Status:` paragraph: from the marker to the next blank line. */
const statusParagraph = /^Status:\s*([\s\S]*?)(?:\n\s*\n|(?![\s\S]))/m;

const markdownSyntax = /[*_`]/g;

/** A link to another numbered document: `0005-x.md`, `./0005-x.md` or `../specs/0005-x.md`, with optional anchor. */
const siblingDocument = /^((?:\.\.\/(decisions|specs)\/|\.\/)?)(\d{4}-[^/#]+\.md)(#.*)?$/;

const externalTarget = /^(?:[a-z][a-z0-9+.-]*:|#|\/)/i;

/**
 * Links to documents this script renders become `./`-relative file links, the only form
 * `source.resolveHref` turns into a page URL (a bare `0005-x.md` is left as a dead href). Any other
 * relative link, including one to a document that has no page, points at a repository file that
 * is not on the site, so it degrades to its text.
 */
const rewriteLinks = (
  markdown: string,
  collection: string,
  rendered: ReadonlySet<string>,
): string =>
  markdown.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, text: string, target: string) => {
    if (externalTarget.test(target)) return match;

    const sibling = siblingDocument.exec(target);

    if (sibling !== null) {
      const folder = sibling[2] ?? collection;
      const name = sibling[3] ?? "";

      if (rendered.has(`${folder}/${name}`)) {
        return `[${text}](${folder === collection ? "./" : `../${folder}/`}${name}${sibling[4] ?? ""})`;
      }
    }

    return text.includes("`") ? text : `\`${text}\``;
  });

/** One-line description: the status paragraph without Markdown syntax, truncated. */
const summarize = (status: string | undefined): string | undefined => {
  if (status === undefined) return undefined;

  const plain = status
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(markdownSyntax, "")
    .replace(/\s+/g, " ")
    .trim();

  return plain.length <= descriptionLimit ? plain : `${plain.slice(0, descriptionLimit - 1)}…`;
};

/** Front matter values are JSON strings, which are valid YAML scalars. */
const frontMatter = (title: string, description: string | undefined): string =>
  [
    "---",
    `title: ${JSON.stringify(title)}`,
    ...(description === undefined ? [] : [`description: ${JSON.stringify(description)}`]),
    "---",
    "",
  ].join("\n");

const render = (
  source: string,
  fallbackTitle: string,
  collection: string,
  rendered: ReadonlySet<string>,
): string => {
  const heading = firstHeading.exec(source);
  const title = heading?.[1] ?? fallbackTitle;
  const body = heading === null ? source : source.replace(firstHeading, "").trimStart();

  return `${frontMatter(title, summarize(statusParagraph.exec(source)?.[1]))}\n${rewriteLinks(body, collection, rendered)}`;
};

/** Sorted `*.md` file names of one source folder. */
const documentNames = Effect.fn("documentNames")(function* (collection: Collection) {
  const fs = yield* FileSystem.FileSystem;

  return (yield* fs.readDirectory(collection.source)).filter((name) => name.endsWith(".md")).sort();
});

const renderCollection = Effect.fn("renderCollection")(function* (
  collection: Collection,
  rendered: ReadonlySet<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(contentRoot, collection.slug);
  const names = yield* documentNames(collection);

  if (names.length === 0) {
    return yield* new DocsSyncError({ message: `No documents found in ${collection.source}` });
  }

  yield* fs.remove(target, { recursive: true, force: true });
  yield* fs.makeDirectory(target, { recursive: true });

  const entries: Array<string> = [];

  for (const name of names) {
    const source = yield* fs.readFileString(path.join(collection.source, name));
    const slug = path.basename(name, ".md");

    yield* fs.writeFileString(
      path.join(target, name),
      render(source, slug, collection.slug, rendered),
    );
    entries.push(`- [${firstHeading.exec(source)?.[1] ?? slug}](./${slug}.md)`);
  }

  // A Fumadocs folder without an index page has no URL of its own; list the documents there.
  yield* fs.writeFileString(
    path.join(target, "index.md"),
    `${frontMatter(collection.title, `Rendered from ${collection.source}`)}\n${entries.join("\n")}\n`,
  );

  const pages = ["index", ...names.map((name) => path.basename(name, ".md"))];

  yield* fs.writeFileString(
    path.join(target, "meta.json"),
    `${JSON.stringify({ title: collection.title, pages }, null, 2)}\n`,
  );

  yield* Console.log(`docs-sync: ${collection.source} -> ${target} (${names.length} pages)`);
});

export const renderDiagnosticPage = (entries: ReadonlyArray<DiagnosticEntry>): string =>
  `${frontMatter("Diagnostic code registry", "Explanations and repairs from the bundled diagnostic registry.")}\n${renderCatalogue(entries)}`;

/** Replaceable docs projection; no application durability or transactional guarantee. */
export const renderDiagnostics = Effect.fn("renderDiagnostics")(function* () {
  const registry = yield* composeRegistry(bundledDiagnosticEntries);
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(contentRoot, "diagnostics", "registry.md");
  yield* fs.remove(target, { force: true });
  yield* fs.writeFileString(target, renderDiagnosticPage(registry.entries));
  yield* Console.log(
    `docs-sync: diagnostic registry -> ${target} (${registry.entries.length} entries)`,
  );
});

const program = Effect.gen(function* () {
  yield* renderDiagnostics();
  // Every document that will have a page, as `<folder>/<file>`; links to anything else degrade.
  const rendered = new Set<string>();

  for (const collection of collections) {
    for (const name of yield* documentNames(collection)) rendered.add(`${collection.slug}/${name}`);
  }

  yield* Effect.forEach(collections, (collection) => renderCollection(collection, rendered), {
    discard: true,
  });
}).pipe(Effect.provide(BunServices.layer));

if (import.meta.main) BunRuntime.runMain(program);
