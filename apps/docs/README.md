# effx docs

Next.js + [Fumadocs](https://fumadocs.dev) site, scaffolded with `create-fumadocs-app`
(`+next+fuma-docs-mdx`). It is a static export: `bun run docs:build` writes `apps/docs/out`.

| Command (repository root) | Does                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| `bun run docs:dev`        | dev server on http://localhost:3000/docs (needs `bun run docs:sync` and `docs:api` once)   |
| `bun run docs:build`      | `docs:sync` + `docs:api` + `next build` (static export to `apps/docs/out`)                 |
| `bun run docs:sync`       | renders `docs/decisions` and `docs/specs` into `content/docs/{decisions,specs}`            |
| `bun run docs:api`        | generates `content/docs/api/**` from JSDoc with `@effect/docgen`                           |

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
