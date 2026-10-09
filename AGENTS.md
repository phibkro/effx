# effx — agent rules

effx is an AOT application compiler for Effect v4. Decorators (`@Query`, `@Http.Get`, …)
and builder chains (`Operation.query(...).http.get(...)`) are _source syntax_; a collector
turns both into identical `Annotation`s, extensions interpret annotations into a
Schema-defined semantic IR, analyses read the IR graph, generators emit ordinary Effect.

## Invariants (do not relitigate; see `docs/decisions/`)

| #   | Invariant                                                                                                 | ADR       |
| --- | --------------------------------------------------------------------------------------------------------- | --------- |
| 1   | AOT analysis is authoritative; runtime decorators are no-ops/metadata only                                | 0001      |
| 2   | **decorator = contribution to IR, never generated behaviour**                                             | 0001      |
| 3   | IR is graph-shaped and defined with Effect `Schema`; `Graph`/`Trie`/`HashMap` are indexes, not the format | 0002      |
| 4   | Canonical JSON (RFC 8785 over the _normalized_ IR) is a projection; `semanticHash` = sha-256 of it        | 0003      |
| 5   | Schemas are preserved as `SchemaRef` (module/export/symbolId); never serialized                           | 0004      |
| 6   | `E`/`R` are inferred from the handler; `@Errors`/`@Requirements` assert and mismatches diagnose           | 0005      |
| 7   | `@Query` is a semantic claim, not a purity proof                                                          | 0006      |
| 8   | Cedar authorizes, effx issues leases (deferred past MVP)                                                  | 0007      |
| 9   | Generated code is ordinary Effect (`HttpApi`, `Rpc`, `Command`); no effx runtime DI                       | 0008      |
| 10  | **No `ts.*` objects in the IR.** Source locations live in the manifest, not the IR                        | spec 0001 |
| 11  | **Diagnostics are data, not failures.** `CompilerFault` is reserved for IO/invariant breakage             | spec 0001 |

## Effect lookup order (before writing any Effect)

1. `node_modules/effect/AGENTS.md` and the `ai-docs/src/...` examples it links.
2. `node_modules/effect/src/<Module>.ts` for exact signatures (v4 names drift: `Schema.TaggedError<X>()("Tag", fields)`, `Context.Service`, `Effect.fn`, `Effect.catch`).
3. Never write Effect from memory.

Rules: native Effect first; pure total transformations stay plain functions; no `async/await`;
no `JSON.parse` outside a Schema codec; no node builtins in packages; `BunServices` only at
composition roots. Unstable Effect APIs (`Arbitrary`, `cli`, `rpc`) stay behind adapters;
`effect/cli` is bound in the portable command graph `packages/cli/src/main.ts`.
The sole process root `scripts/effx.ts` provides native capabilities and runs it.
`effect/process` (unstable `ChildProcess`) is bound in `scripts/docs-api.ts` for docgen and in the scoped test adapter `packages/persistence/test/process.ts` for owned acceptance subprocesses (EX-0023, `docs/research/persistence-0022-evidence.md`), with file-level diagnostics directives.
EX-0023 also owns `packages/cli/test/packed-watch-peer.ts` for installed consumers
`scripts/watch-editor-smoke.ts` and `scripts/stable-v4-smoke.ts`. The caller Scope
owns every child and temporary project. Child output payloads are not logged.
The extended version/scope/verification record is in `docs/research/0018-watch-editor-design.md` §6.
EX-0023 also owns scripts/test/lsp-linux.test.ts, lsp-linux-extra.test.ts and
lsp-linux-sigpipe.test.ts for scoped native-host peer invocation. This does not
grant process APIs to portable product/session code.
`effect/sql` and `@effect/sql-pglite` are bound only in the reference adapter/database/harness modules of `examples/persistence`; file-level directives name EX-0022, recorded in `docs/research/persistence-0022-evidence.md`. These mandated native SQL APIs remain annotated unstable in Effect 4.0.0; they never enter the persistence compiler or generated port.

EX-0030 records the pinned maintained `vscode-jsonrpc` ABI, not permission to
override the hard ban on own Node imports/types or ambient Node authority in packages.
The previous package-Node exception wording was withdrawn by the director on
2026-10-06. A real process root outside packages must supply owned Effect-facing
IO/liveness and the single scoped callback bridge; native backend acceptance is pending.
EX-0031 records native sequential filesystem observation instead of the installed
unbounded push-watch backend. Both open records, exact versions, tests and retirement
triggers live in `docs/research/0018-watch-editor-design.md` §6. They are not verified
until the real boundary and cleanup tests pass. No global Bun resolver hook is permitted.
EX-0032 permits the installed TypeScript 6.0.3 runtime-exported `matchFiles` ABI
only inside `packages/frontend-ts/src/ts.ts`. It preserves native include/exclude
semantics for virtual source membership without a second glob implementation.
The runtime export is guarded; its local ABI assertion and retirement are recorded
in the same design evidence. No TypeScript object crosses the frontend service.
EX-0033 records read-only evaluated module-cache inventory data, not authority for
`node:module` inside a package. Native cache acquisition must belong to the same
outside-packages process root and supply a narrow inventory capability. Physical
keys supplement complete caller-declared logical coverage; they are neither full
provenance nor a sandbox. The legacy package acquisition remains unaccepted.
EX-0035 owns the approved qualified Linux LSP root boundary in scripts/lsp-linux.ts
and its trusted build-time readiness asset, not package-owned native imports.
Its test-only scope includes scripts/packed-lsp-stdout.ts, scripts/test/lsp-linux-extra.*
and lsp-linux-sigpipe.* plus tools/native/lsp-sigpipe-test.c and its test-assets.
EX-0036 owns unstable Effect ChildProcess only in scripts/build-lsp-native.ts
and scripts/build-lsp-sigpipe-test.ts for trusted build-time artifacts.
Both open records, examined versions, verification and retirement triggers live
in docs/research/0018-watch-editor-design.md §10. No implementation gate is claimed.
EX-0034 (open) owns the explicit spec 0019 lift-check native boundary: unstable `effect/process`
`ChildProcess`/`ChildProcessSpawner` only in `scripts/lift-execution.ts`, verified by the real-child
suites `scripts/test/lift-*.test.ts` (they import no unstable API and carry no directive), plus Effect
`HttpApi.reflect`/`OpenApi.fromApi` only as text in the generated `--check` witness that runs inside the
child. It grants no Node imports/types, process authority or global resolver hooks in packages and makes
no sandbox claim. Rules, exact APIs, examined versions, verification and the retirement trigger live in
`docs/research/0019-implementation-design.md` (S6 native child custody).

## Commands

Effect lint plugin pin: `tools/vendor/oxlint-effect-plugin-0.1.0-2b63bfe323f32cd6abc4c8e8c116ad12bf12e54e.tgz` is built from source at public commit `2b63bfe323f32cd6abc4c8e8c116ad12bf12e54e` (package version `0.1.0`); it is **not** the npm-published `@phibkro/oxlint-effect-plugin@0.1.0` artifact, even though both report version `0.1.0`. Reason: npm's `0.1.0` has `peerDependencies.oxlint: "1.76.0"`, which does not satisfy the repository's Oxlint `1.86.0`; the tarball's embedded `package.json` has `peerDependencies.oxlint: "^1.56.0"`, which does. MIT; identity and integrity (name, version, `sha256` of the tarball bytes, peer range) are checked by `tools/conventions/tests/vendor-manifest.test.ts` against `tools/vendor/manifest.json`. Replace the tarball when an npm release with a compatible peer range exists.

| Task               | Command                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| typecheck          | `bun run typecheck` (TypeScript diagnostics)                                                                                                                                                                  |
| Effect diagnostics | `bun run effect:diagnostics` (Effect-only diagnostics)                                                                                                                                                        |
| lint               | `bun run lint`                                                                                                                                                                                                |
| format             | `bun run fmt` (check: `bun run fmt:check`)                                                                                                                                                                    |
| tests              | `bun run test` (Vitest suites plus the Oxlint RuleTester suite)                                                                                                                                               |
| fast checks        | `bun run check` (includes `ai-docs:check`)                                                                                                                                                                    |
| CI / landing gate  | `bun run gate` (the one ordered gate list used by Check and local landings)                                                                                                                                   |
| docs site          | `bun run docs:dev`; `bun run docs:build` (clears stale `.next`/`.source`, sync + API + static export to `apps/docs/out`; deployed to GitHub Pages by `.github/workflows/docs.yml`, see `apps/docs/README.md`) |
| API reference      | `bun run docs:api` (`@effect/docgen`; fails on a broken `@example`)                                                                                                                                           |
| AI docs            | `bun run ai-docs` regenerates `LLMS.md`; `bun run ai-docs:check` fails on drift                                                                                                                               |

Before any fast-forward merge to `main`, install the merged tree frozen through `bash scripts/install-public.sh . --frozen-lockfile` (CI: `.github/actions/public-install`). That boundary replaces the child environment, uses a private home, cache and empty user config, the public registry and `--no-env-file`, and refuses project-owned `.npmrc`/`bunfig.toml`; it never logs resolver output. If `bun.lock` conflicts, apply package manifest changes and regenerate the lock with `bun install`; never hand-merge lockfile contents.

Run `bun run gate` on the committed tree before landing. Check calls that same script.
The stable Effect 4 fixture typecheck first generates Profile contract and handler projections in separate ignored projects.
Each project owns its output and manifest. `cmp` checks the fresh contract against the tracked golden and does not rewrite it.

## Package map

| Package                                      | Role                                                                                                                                         | Depends on                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `packages/diagnostics` (`@effx/diagnostics`) | Schema-defined diagnostic entries, typed factories, duplicate-safe registry and shared Markdown renderer (spec 0016)                         | effect                             |
| `packages/ir` (`@effx/ir`)                   | Schema-defined IR, StableId, normalize, canonical JSON + hash, graph index, Arbitrary adapter                                                | effect                             |
| `packages/compiler` (`@effx/compiler`)       | `Diagnostic`, distribution registry, `StageResult`, `SourceFrontend`, `Extension`, annotation implementations, pipeline and lift core        | ir, runtime, diagnostics           |
| `packages/frontend-ts` (`@effx/frontend-ts`) | TypeScript 6 compiler-API frontend producing `Collected`                                                                                     | compiler, runtime                  |
| `packages/runtime` (`@effx/runtime`)         | standards-compatible decorators and builders; runtime-owned annotation-definition diagnostic entries; source syntax only                     | effect, diagnostics                |
| `packages/cli` (`@effx/cli`)                 | `effx check/build/dev/lsp/inspect/graph/explain/surface check/cedar` composition root; explain is offline without implicit config evaluation | compiler, frontend-ts, diagnostics |
| `packages/persistence` (`@effx/persistence`) | Optional `Persist.Port` syntax/compiler extension, generated leaf ports and adapter conformance suites (spec 0022); no SQL or runtime DI     | compiler, runtime, ir              |
| `examples/users`                             | the User slice from the research report                                                                                                      | runtime                            |
| `apps/docs`                                  | Fumadocs (Next.js) site; not an Effect program, so oxlint/oxfmt ignore it (`docs:build` is its gate)                                         | generated pages                    |

Tests live in `packages/*/test/**/*.test.ts` and use `@effect/vitest` (`it.effect`). Files using
TC39 decorators are lowered by TypeScript 6 in `vitest.config.ts` (oxc cannot lower them yet).
Imports between packages go through `@effx/*` (tsconfig `paths` + vitest aliases).

## Documents

| File                       | Purpose                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `STATE.md`                 | mission state: lifecycle gate, evidence table, open questions                                                    |
| `docs/specs/NNNN-*.md`     | frozen contracts per slice                                                                                       |
| `docs/decisions/NNNN-*.md` | ADRs                                                                                                             |
| `docs/research/`           | source research (read-only input)                                                                                |
| `ai-docs/src`              | typechecked examples; `LLMS.md` derives from these and the distribution registry (edit sources, never `LLMS.md`) |
| `apps/docs/content/docs`   | authored site pages; `decisions/`, `specs/`, `api/` and `diagnostics/registry.md` are generated and gitignored   |
