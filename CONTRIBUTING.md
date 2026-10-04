# Contributing

Thanks for helping improve effx. Before changing the compiler, read [`AGENTS.md`](AGENTS.md), [`STATE.md`](STATE.md), and the relevant frozen contract in [`docs/specs/`](docs/specs/). Preserve the invariants recorded in [`docs/decisions/`](docs/decisions/).

## Development commands

Run these from the repository root:

| Task                   | Command                      |
| ---------------------- | ---------------------------- |
| TypeScript diagnostics | `bun run typecheck`          |
| Effect diagnostics     | `bun run effect:diagnostics` |
| Lint                   | `bun run lint`               |
| Format                 | `bun run fmt`                |
| Check formatting       | `bun run fmt:check`          |
| Tests                  | `bun run test`               |
| Full check             | `bun run check`              |
| Build release tarballs | `bun run pack`               |

`bun run check` combines TypeScript diagnostics, lint, formatting checks, and tests. `bun run effect:diagnostics` runs the Effect-specific diagnostics separately.

## Specs and decisions

For a non-trivial compiler slice, write or update a frozen `docs/specs/NNNN-*.md` contract before implementation. Define observable behavior and the checks that can falsify it; keep the implementation choice open until the contract is settled. Record an architectural trade-off that affects an invariant in a numbered `docs/decisions/NNNN-*.md` ADR. Update [`STATE.md`](STATE.md) when the mission state, evidence, or open questions change. Do not silently change an accepted contract: revise the spec explicitly when evidence requires it.

## Commits and changesets

Use Conventional Commits, for example `feat(compiler): add operation analysis`, `fix(cli): report missing project config`, or `docs: clarify extension authoring`. Keep each commit focused on one change.

Scope is optional. Allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`, and `test`; `merge` remains accepted for the fleet-generated integration commits already in effx history. Commit bodies have no line-length limit.

`bun install` runs `prepare` and installs the native Git hooks in `.githooks` (no Husky). The `commit-msg` hook runs commitlint; the light `pre-commit` hook runs `oxfmt --check` and Oxlint only on staged files. CI checks commit messages too, because hooks can be bypassed.

WIP handoff commits must still use a valid type, for example `chore(wip): hand off unfinished changes`; do not use a `wip(...)` type. The first public-release squash commit is `chore: initial public release`.

For changes to a public package, add a Changesets file with `bunx changeset` and include the affected package and semver impact. Private packages are ignored by release configuration. Do not run a publish command locally.

The release workflow is intentionally inactive until the repository operator configures the `NPM_TOKEN` Actions secret. It is owner-gated and must not be used to bypass the review and release process.

## Deploying the docs

The `apps/docs` static export is deployed to GitHub Pages by `.github/workflows/docs.yml` on pushes to `main` that touch `apps/docs`, `docs/`, `ai-docs/`, `packages/*/src`, `LLMS.md`, or `scripts/docs-*.ts`, and on manual `workflow_dispatch`. The workflow does not create the repository or change Pages settings. The maintainer must put the repository on GitHub and set Settings → Pages → Build and deployment → Source to **GitHub Actions**.

The site URL is `https://<owner>.github.io/<repo>/` (docs at `/docs/`), with its base path taken from `actions/configure-pages`. Until GitHub Pages is enabled, the Configure Pages step fails with an explanatory message.

To preview a project-site build locally, run `DOCS_BASE_PATH=/<repo> bun run docs:build`, then serve `apps/docs/out` under `/<repo>` with a static server. See [`apps/docs/README.md`](apps/docs/README.md) for details and static-export limits.

## Compatibility

Supported releases are Effect `>=4.0.0 <5`. Effect `4.0.0-rc.116` remains accepted temporarily for the vektorprogrammet migration. The TypeScript frontend uses TypeScript 6.0; the TypeScript 7 JavaScript API is pending 7.1.
