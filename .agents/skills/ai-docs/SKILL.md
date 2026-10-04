---
name: ai-docs
description: effx AI documentation. Use when editing ai-docs/src, regenerating LLMS.md, or changing what ships as AGENTS.md in packages.
---

`LLMS.md` is generated from `ai-docs/src` by `scripts/ai-docs.ts`, adapted from Effect's
`effect-ai-docgen` (attribution and MIT license are in the script header). Read `ai-docs/README.md`
first; it owns structure, style and examples.

1. Inspect neighbouring examples under `ai-docs/src` and the current `LLMS.md`.
2. Edit sources under `ai-docs/src`: `index.md` per folder for prose, `NN_name.ts` for examples. Files named `0N_*` are inlined into `LLMS.md`; `10_*` and up are only linked; `fixtures/` is ignored.
3. Run `bun run ai-docs`. It writes `LLMS.md` (committed) and the gitignored `packages/<name>/AGENTS.md` + `packages/<name>/ai-docs/` that `bun run pack` ships.
4. Run `bun run typecheck`, `bun run lint`, `bun run fmt:check`, then `bun run ai-docs:check`.

Done means: sources and `LLMS.md` agree (`ai-docs:check` passes), every example type-checks and lints
as application code, and every claim cites a spec, ADR or source path. An example that needs an effx
symbol the compiler does not export publicly is a bug in the example, not a reason to import
internals. Examples never import from another package's `src/` path; use `@effx/*`.

The API reference is a different mechanism (`bun run docs:api`, `@effect/docgen`, JSDoc `@example`).
