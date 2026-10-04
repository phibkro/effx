#!/usr/bin/env bun
/** @effect-diagnostics unstableApiUsage:off -- effect/process runs the docgen CLI; registered in AGENTS.md */
/**
 * Generates the API reference pages in `apps/docs/content/docs/api/**` from JSDoc.
 *
 * Tool: `@effect/docgen` (the documentation generator Effect v4 ships; MIT, Effectful Technologies
 * Inc., https://github.com/Effect-TS/effect/tree/main/packages/tools/docgen). Each package that has
 * an API reference owns a project directory `apps/docs/docgen/<name>/` holding a `package.json`
 * (docgen requires `name` and `homepage` there) and a `docgen.json`. This script runs docgen in each
 * project directory, then converts its Jekyll output into Fumadocs pages:
 *
 * - docgen type-checks every `@example` block with the repository `tsc` and runs it with `tsx`
 *   (`runExamples: true`); a broken example fails this script and therefore `docs:build`.
 * - Jekyll front matter is replaced with Fumadocs front matter and `meta.json` ordering.
 * - `[Source](...)` links are dropped: the repository has no public URL to link to.
 *
 * The generated pages are gitignored; never edit them. Run through `bun run docs:api` so
 * `node_modules/.bin` (`docgen`, `tsc`, `tsx`) is on PATH.
 *
 * Research, evidence and rejected alternatives: `docs/research/api-docs-tooling.md`.
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const docgenRoot = "apps/docs/docgen";

const apiRoot = "apps/docs/content/docs/api";

export class DocsApiError extends Schema.TaggedError<DocsApiError>()("DocsApiError", {
  message: Schema.String,
}) {}

const sourceLink = /^\[Source\]\([^)]*\)\n+/gm;

const jekyllFrontMatter = /^---\n[\s\S]*?\n---\n+/;

const frontMatter = (title: string, description: string): string =>
  [
    "---",
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
  ].join("\n");

/** `extensions/http.ts.md` becomes `http`; docgen names pages after the module file. */
const moduleName = (page: string, path: Path.Path): string =>
  path.basename(page).replace(/\.ts\.md$/, "");

const convertPage = (markdown: string, title: string, description: string): string =>
  frontMatter(title, description) + markdown.replace(jekyllFrontMatter, "").replace(sourceLink, "");

const runDocgen = Effect.fn("runDocgen")(function* (project: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(ChildProcess.make("docgen", [], { cwd: project }));
      const output = yield* handle.all.pipe(Stream.decodeText(), Stream.mkString);
      const exitCode = yield* handle.exitCode;

      if (exitCode !== 0) {
        return yield* new DocsApiError({ message: `docgen failed in ${project}:\n${output}` });
      }
    }),
  ).pipe(
    Effect.mapError((error) =>
      error._tag === "DocsApiError" ? error : new DocsApiError({ message: String(error) }),
    ),
  );
});

const writeMeta = Effect.fn("writeMeta")(function* (
  directory: string,
  title: string,
  pages: ReadonlyArray<string>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  yield* fs.writeFileString(
    path.join(directory, "meta.json"),
    `${JSON.stringify({ title, pages }, null, 2)}\n`,
  );
});

const convertProject = Effect.fn("convertProject")(function* (name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const project = path.join(docgenRoot, name);
  const modules = path.join(project, "out", "modules");
  const target = path.join(apiRoot, name);
  const packageName = `@effx/${name}`;

  yield* runDocgen(project);

  yield* fs.remove(target, { recursive: true, force: true });
  yield* fs.makeDirectory(target, { recursive: true });

  const entries = (yield* fs.readDirectory(modules, { recursive: true })).sort();
  const pages = entries.filter((entry) => entry.endsWith(".ts.md"));

  if (pages.length === 0) {
    return yield* new DocsApiError({
      message: `docgen produced no module pages for ${packageName}`,
    });
  }

  const folders = new Map<string, Array<string>>();

  for (const page of pages) {
    const directory = path.dirname(page);
    const title = moduleName(page, path);
    const outputDirectory = path.join(target, directory);
    const markdown = yield* fs.readFileString(path.join(modules, page));

    yield* fs.makeDirectory(outputDirectory, { recursive: true });
    yield* fs.writeFileString(
      path.join(outputDirectory, `${title}.md`),
      convertPage(markdown, title, `API reference for ${path.join(packageName, directory, title)}`),
    );

    folders.set(directory, [...(folders.get(directory) ?? []), title]);
  }

  for (const [directory, titles] of folders) {
    const subfolders = [...folders.keys()].flatMap((other) =>
      other !== directory && path.dirname(other) === directory ? [path.basename(other)] : [],
    );

    yield* writeMeta(
      path.join(target, directory),
      directory === "." ? packageName : path.basename(directory),
      [...titles, ...subfolders],
    );
  }

  yield* Console.log(`docs-api: ${packageName} -> ${target} (${pages.length} modules)`);
});

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const names = (yield* fs.readDirectory(docgenRoot)).sort();

  const projects = yield* Effect.filter(names, (name) =>
    fs.exists(path.join(docgenRoot, name, "docgen.json")),
  );

  yield* fs.remove(apiRoot, { recursive: true, force: true });
  yield* fs.makeDirectory(apiRoot, { recursive: true });
  yield* Effect.forEach(projects, convertProject, { discard: true });

  yield* fs.writeFileString(
    path.join(apiRoot, "index.md"),
    `${frontMatter("API reference", "Generated from JSDoc by @effect/docgen")}\nGenerated from the JSDoc of each package by \`bun run docs:api\` (\`@effect/docgen\`). Every \`@example\` block is type-checked and executed during generation.\n`,
  );
  yield* writeMeta(apiRoot, "API reference", ["index", ...projects]);
});

BunRuntime.runMain(program.pipe(Effect.provide(BunServices.layer)));
