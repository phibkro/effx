# effx docs

Next.js + [Fumadocs](https://fumadocs.dev) site, scaffolded with `create-fumadocs-app`
(`+next+fuma-docs-mdx`). It is a static export: `bun run docs:build` writes `apps/docs/out`.

| Command (repository root) | Does                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `bun run docs:dev`        | dev server on http://localhost:3000/docs (needs `bun run docs:sync` and `docs:api` once)   |
| `bun run docs:build`      | clears `.next` and `.source`, then `docs:sync` + `docs:api` + `next build` (static export to `apps/docs/out`)                 |
| `bun run docs:sync`       | renders `docs/decisions` and `docs/specs` into `content/docs/{decisions,specs}`            |
| `bun run docs:api`        | generates `content/docs/api/**` from JSDoc with `@effect/docgen`                           |
| `bun run docs:check`      | parses documentation fences and checks their languages with the configured highlighter (also the first step of `bun run check`) |

`content/docs/{decisions,specs,api}` are generated and gitignored. Never edit them or `.source/`.

## Deployment (GitHub Pages)

`.github/workflows/docs.yml` builds and deploys on push to `main`. Inputs are environment variables
read in `next.config.mjs` and `lib/shared.ts`:

| Variable           | Default                 | Meaning                                                                       |
| ------------------ | ----------------------- | ----------------------------------------------------------------------------- |
| `DOCS_BASE_PATH`   | empty                   | `/<repo>` for a project site; empty for a user site or custom domain         |
| `DOCS_SITE_ORIGIN` | `http://localhost:3000` | origin used for absolute Open Graph image URLs                                |

Local check of a project-site build: `DOCS_BASE_PATH=/effx bun run docs:build`, then serve
`apps/docs/out` under `/effx` with any static server.

## What a static export cannot do

| Server feature in the scaffold                                  | Static replacement                                                                                                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `proxy.ts` (`/docs/x.md` rewrite, `Accept: text/markdown`)       | Removed: Next.js does not support Proxy in a static export. Page Markdown stays at `/llms.mdx/docs/<slug>/content.md` (the "Copy Markdown" button) |
| Search API route computing results per request                  | `staticGET` writes the index at build time; the browser downloads it (about 7.6 MB, 1.4 MB gzipped) on first search and searches locally            |
| On-demand Open Graph images                                      | Pre-rendered at build time by the route handler (about 110 PNGs); their URLs are absolute, so deploys must set `DOCS_SITE_ORIGIN`                    |
| Unlisted `/docs/*` URLs                                          | `dynamicParams = false`: only pages from `generateStaticParams` exist; others get `404.html`                                                       |

`trailingSlash: true` is required: GitHub Pages redirects `/docs/x` to `/docs/x/` when a `docs/x/`
directory exists (a section with subpages), and without it that directory has no `index.html`.

## Fence-language policy

`lib/highlighter.ts` is shared by the app and the fast `docs:check` guard. Unregistered language
names fall back to `text`; registered languages still get syntax highlighting. Authors do not have
to change unknown labels to `text` to keep deployment green. This is a build-time presentation
policy, not a relaxation of application validation. `lib/source.ts` applies it with
`applyMdxPreset`, preserving the other Fumadocs plugins and code-block notation.

Verified against the installed packages:

- Fumadocs Core **16.16.0**, `dist/rehype-code.core-COgx9A69.d.ts:25-29`: `defaultLanguage`
  handles unlabelled fences; `fallbackLanguage` handles unavailable languages.
- Core `dist/rehype-code.core-BFENmmvo.js:34-46` replaces an unknown label with the fallback
  before calling Shiki. `:518-520` loads custom registrations via the `langs` option.
- Fumadocs MDX **15.4.6**, `dist/remark-include-B6rmf4sh.js:17-55`: `applyMdxPreset` forwards
  `rehypeCodeOptions`. Its collection-level `mdxOptions` replaces the preset, so use this helper.
- The installed Shiki version is **4.5.0**. No Shiki internal files or generated `.source/` files
  are edited.

The guard parses `docs/**/*.md`, `apps/docs/content/**/*.{md,mdx}`, and `ai-docs/**/*.{md,mdx}`
with the Markdown/MDX parser (including nested and tilde fences), then runs the actual rehype-code
plugin once per language label. It checks Cedar/TypeScript colored tokens and asserts a synthetic,
unregistered language renders identically to `text`. Failures identify the source and line. This
tests language resolution in about two seconds without docgen, Google Fonts or Next.js; it is not a
full MDX build, link check or substitute for `docs:build`.

### Cedar grammar provenance

`public/vendor/cedar/cedar.tmLanguage.json` is an unchanged **7,204-byte** TextMate grammar from
[the official Cedar VS Code extension](https://github.com/cedar-policy/vscode-cedar/blob/e592133f33e4e9d2dd93ea7ee2e003e7e4e28e66/syntaxes/cedar.tmLanguage.json),
pinned to commit **e592133f33e4e9d2dd93ea7ee2e003e7e4e28e66** (extension 0.10.6). That commit
updated syntax highlighting on 2026-09-23; all grammar includes refer to its local repository.
SHA-256: `1eadf97850ff9ac1062b4955d11875c830068fe7fbcf028a65244d630b192a2d`.
The adapter only changes the language id from `Cedar` to `cedar`. Upstream **Apache-2.0** license
and **NOTICE** accompany the grammar and are copied into the static export. There is no VS Code
extension dependency and no build-time grammar download.
