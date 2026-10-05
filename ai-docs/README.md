# AI docs

`LLMS.md` is generated from `ai-docs/src` and the distribution diagnostic registry. The layout
and rules follow Effect's own `ai-docs` (MIT, Effectful Technologies Inc.; see the header of `scripts/ai-docs.ts`).

## Add content

1. Add or update markdown in `ai-docs/src/**/index.md` for section intro text.
2. Add examples as `.ts` files in the same folder.
3. Run `bun run ai-docs` to regenerate `LLMS.md`.
4. Run `bun run ai-docs:check` (it fails when `LLMS.md` is stale).

The diagnostic catalogue is generated from Schema entries exposed by `@effx/compiler`,
using the shared `@effx/diagnostics` renderer (spec 0016). Edit entry descriptions and
examples, not the generated catalogue. `ai-docs:check` checks registry prose drift as
well as example-source drift. The site catalogue uses that same renderer through docs sync.

## Source file conventions

- Numeric filename prefixes control order. `0N_*` files are inlined in `LLMS.md`; `10_*` and above are only linked ("More examples").
- A top JSDoc block with `@title` and an optional description controls the rendered title and description.
- `fixtures` directories are ignored by the generator. Use them for supporting code shared by several examples.

## Example guidelines

Before writing an example, read the neighbouring examples and the current `LLMS.md`.

- Examples are real, type-checked TypeScript (`bun run typecheck` includes `ai-docs/**/*.ts`) and follow the repository lint rules for application code (`bun run lint`).
- Comment the how and why, not what the line does.
- Code represents real use. No toy examples that nobody would write.
- Import from `@effx/runtime`, `@effx/compiler`, `effect`; never from another package's `src/` path.
- Cite a spec, ADR or source path for every claim in prose.

## What ships

`bun run ai-docs` also copies `LLMS.md` to `packages/<name>/AGENTS.md` and `ai-docs/` to
`packages/<name>/ai-docs/` for every non-private package. Those copies are gitignored; `bun run pack`
puts them in the tarballs, so an installed package carries `node_modules/@effx/runtime/AGENTS.md`.
