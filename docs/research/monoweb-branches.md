# mono-web branch and worktree survey for effx

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

## Scope and migration lens

Survey scope: the `mono-web` repository at `main` (`f433ea90`), its registered worktrees and refs, and the sibling `mono-web-*` directories. All reads under `vektorprogrammet` were read-only; no tests or builds were run there.

The effx migration plan’s §§1–4 identify the relevant seam: HTTP contracts and groups, `AccessSpec`, the problem registry and endpoint problem unions, SDK generation, Foldkit command adapters, and the People/Profile proving slice (`docs/specs/0004-monoweb-migration-plan.md`, §§1–4). This plan is explicitly proposed and does not authorize production cutover. Here, **high** means a branch diff touches one or more of those contract/security/problem/SDK/Profile/Foldkit-command surfaces; **low** means it does not.

`main` is checked out at `mw`, on branch `main`, HEAD `f433ea90`. `git log --oneline -5 main` and `git log --oneline -5 HEAD` both returned:

```text
f433ea90 fix: keep the lead handoff out of the published documentation
69879488 fix: restore the pre-merge apps/docs, which the revert deleted by mistake
abc62b6b Revert "Merge branch 'docs/fumadocs-integration-0927'"
7917ee86 docs: de-link the correction-window spec, which is not on main yet
d417ba0f Merge branch 'docs/fumadocs-integration-0927'
```

## Worktree and sibling-directory inventory

`git worktree list` reported the root `main` worktree, the 21 `mono-web-*` linked worktrees below, and two additional detached checkouts outside the sibling-directory scope: `temporary workspace` and `temporary workspace`, both at `1c01937d (unpublished)`. The detached `mono-web-economy-red` checkout is dirty but has no branch and no commits ahead of current `main`; its 13 status entries were left untouched.

Ahead/behind is shown as **ahead / behind**. It is computed from `git rev-list --left-right --count main...HEAD` (right count / left count). Diffstat is the requested `git diff --stat main...HEAD | tail -1`; the detached checkout has no committed delta from `main`.

| Sibling path | Branch / HEAD | `status --short \| wc -l` | Ahead / behind | Diffstat tail |
|---|---|---:|---:|---|
| `mono-web-admissions-affiliation` | `fix/admissions-affiliation-sub` / `db4ce5ac (unpublished)` | 0 | 3 / 53 | 17 files, 702 insertions, 67 deletions |
| `mono-web-admissions-core` | `fix/admissions-core-0926` / `5d05e6e2 (unpublished)` | 0 | 21 / 28 | 76 files, 4,102 insertions, 482 deletions |
| `mono-web-admissions-onboarding` | `fix/admissions-onboarding-sub` / `0ae7a9eb (unpublished)` | 0 | 2 / 53 | 20 files, 533 insertions, 55 deletions |
| `mono-web-admissions-ownership` | `fix/admissions-ownership-sub` / `9f7c48da (unpublished)` | 0 | 2 / 53 | 11 files, 396 insertions, 95 deletions |
| `mono-web-admissions-returning` | `fix/admissions-returning-sub` / `b7a52b86 (unpublished)` | 0 | 2 / 53 | 13 files, 920 insertions, 79 deletions |
| `mono-web-certificates` | `feat/certificates-0926` / `512a6bc0 (unpublished)` | 0 | 9 / 33 | 59 files, 3,539 insertions, 204 deletions |
| `mono-web-content-fix` | `fix/content-teams-review-0926` / `08835acd (unpublished)` | 0 | 18 / 33 | 102 files, 4,544 insertions, 990 deletions |
| `mono-web-delivery-fix` | `fix/delivery-review-0926` / `31c82272 (unpublished)` | 0 | 9 / 41 | 68 files, 2,323 insertions, 555 deletions |
| `mono-web-domain-scope` | `experiment/domain-scope-0926` / `efc6cdb3 (unpublished)` | 0 | 5 / 80 | 186 files, 5,781 insertions, 1,569 deletions |
| `mono-web-economy-fix` | `fix/economy-review-0926` / `31b4b5af (unpublished)` | 0 | 6 / 41 | 64 files, 4,294 insertions, 400 deletions |
| `mono-web-economy-red` | detached / `67cbf97e` | 13 | 0 / 49 | no committed delta |
| `mono-web-effect-pin` | `build/effect-version-pin-0927` / `5f4afd32 (unpublished)` | 0 | 6 / 33 | 15 files, 750 insertions, 27 deletions |
| `mono-web-frontend-fix` | `fix/frontend-http-review-0926` / `64966b20 (unpublished)` | 0 | 10 / 35 | 94 files, 2,778 insertions, 434 deletions |
| `mono-web-oauth-fix` | `fix/oauth-review-0926` / `44bc3416 (unpublished)` | 0 | 8 / 41 | 51 files, 2,722 insertions, 420 deletions |
| `mono-web-org-fix` | `fix/organization-review-0926` / `8c0f2510 (unpublished)` | 0 | 12 / 33 | 28 files, 1,526 insertions, 117 deletions |
| `mono-web-org-race` | `test/organization-race-0927` / `01e74103 (unpublished)` | 0 | 9 / 33 | 23 files, 1,332 insertions, 117 deletions |
| `mono-web-placements-fix` | `fix/placements-review-0926` / `31b4435f (unpublished)` | 0 | 12 / 33 | 34 files, 1,673 insertions, 209 deletions |
| `mono-web-pq-pilot` | `feat/team-application-queue-pilot-0926` / `6a5ccdaf (unpublished)` | 0 | 11 / 33 | 46 files, 2,790 insertions, 129 deletions |
| `mono-web-recruitment-fix` | `fix/recruitment-review-0926` / `27265998 (unpublished)` | 0 | 9 / 33 | 68 files, 4,083 insertions, 211 deletions |
| `mono-web-schema` | `refactor/schema-declaration-0927` / `bc2a82d0 (unpublished)` | 0 | 1 / 28 | 1 file, 94 insertions |
| `mono-web-teardown-flake` | `fix/postgres-teardown-flake-0927` / `7246edeb (unpublished)` | 0 | 4 / 26 | 14 files, 1,853 insertions, 363 deletions |

Two additional sibling directories are a **separate bare Git repository and its linked worktree**, not worktrees of the `mono-web` repository above. Both point at `integration/0062-final` / `90925066`; against that separate repository’s own `main`, the branch is 776 ahead / 0 behind, with `1,062 files changed, 237,651 insertions(+), 40,622 deletions(-)`. `mono-web-durable-preview` has one dirty status entry. `mono-web-durable.git` is bare, so it has no worktree status count. This older preview history is not comparable to current `mono-web/main` and was not folded into its ahead/behind counts.

The required sibling log and stat commands were run for every checkout: `git log --oneline main..HEAD | head -20` and `git diff --stat main...HEAD | tail -1`. The following branch matrix summarizes the commit topics and changed-path evidence rather than reproducing up to 20 log lines per checkout.

## Branches with commits not on current `main`

The table includes every ref for which `git rev-list main..<ref>` was nonzero. For local branches, dirty counts and worktree paths are live. A dash means the ref has no checked-out worktree, so dirty count is not applicable. Key paths are changed files from the branch diff; topic text is grounded in its commits and, where noted, branch specs.

| Branch @ HEAD | Worktree; dirty | Ahead / behind | Topic from branch commits | Effx relevance | Key changed files |
|---|---|---:|---|---|---|
| `fix/admissions-affiliation-sub` @ `db4ce5ac (unpublished)` | `mono-web-admissions-affiliation`; 0 | 3 / 53 | Admission evidence and placement self-affiliation window | **high** — HTTP contract | `packages/http-api/src/placements.ts`; `apps/backend/src/placements/http.test.ts`; `apps/backend/src/placements/affiliation-eligibility.test.ts` |
| `fix/admissions-core-0926` @ `5d05e6e2 (unpublished)` | `mono-web-admissions-core`; 0 | 21 / 28 | Admission readiness, typed conflicts, returning/replay and outcome fixes; `docs/specs/admissions-core-review-fixes.md` | **high** — HTTP contracts/problems | `packages/http-api/src/admission-outcomes.ts`; `packages/http-api/src/onboarding.ts`; `apps/backend/src/admission/http-commands.ts` |
| `fix/admissions-onboarding-sub` @ `0ae7a9eb (unpublished)` | `mono-web-admissions-onboarding`; 0 | 2 / 53 | Require effective admission readiness before issuing onboarding | **high** — HTTP contract | `packages/http-api/src/onboarding.ts`; `apps/backend/src/onboarding/http.ts`; `apps/dashboard/app/routes/dashboard.onboarding.tsx` |
| `fix/admissions-ownership-sub` @ `9f7c48da (unpublished)` | `mono-web-admissions-ownership`; 0 | 2 / 53 | Isolate anonymous applicants by submission | **low** — no named migration surface | `apps/backend/src/admission/http-commands.ts`; `apps/backend/src/admission/submit-application.http.test.ts`; `docs/system.md` |
| `fix/admissions-returning-sub` @ `b7a52b86 (unpublished)` | `mono-web-admissions-returning`; 0 | 2 / 53 | Preserve returning-applicant replay and service evidence | **low** — no named migration surface | `apps/backend/src/admission/http-commands.ts`; `apps/backend/src/admission/returning-registration.test.ts`; `docs/system.md` |
| `feat/certificates-0926` @ `512a6bc0 (unpublished)` | `mono-web-certificates`; 0 | 9 / 33 | Days-served certificates and dashboard workflow; `docs/specs/certificates-days-served.md` | **high** — Foldkit command adapter | `apps/dashboard/app/foldkit/certificates/{command,model,update}.ts`; `apps/dashboard/app/foldkit/certificates/main.ts` |
| `fix/content-teams-review-0926` @ `08835acd (unpublished)` | `mono-web-content-fix`; 0 | 18 / 33 | Content/team intake and social-event lost-response review; `docs/specs/content-teams-review.md` | **high** — problem/access, HTTP contracts, Foldkit commands | `apps/backend/src/http-api/problem.ts`; `packages/domain/src/authz/access.ts`; `packages/http-api/src/{organization,social-events,team-application}.ts`; `apps/dashboard/app/foldkit/{content,social-events}/command.ts` |
| `fix/delivery-review-0926` @ `31c82272 (unpublished)` | `mono-web-delivery-fix`; 0 | 9 / 41 | Delivery worker recovery, typed failures and provider endpoint restrictions; `docs/specs/delivery-review-fixes.md` | **low** — worker/outbox scope | `apps/backend/src/application/{effects,worker}.ts`; `apps/backend/src/config.ts`; `packages/database/src/outbox-lifecycle.ts` |
| `experiment/domain-scope-0926` @ `efc6cdb3 (unpublished)` | `mono-web-domain-scope`; 0 | 5 / 80 | Scope codemod and domain module reshaping | **high** — Profile and access-control context | `packages/domain/src/profile/{errors,index,model.test,schema,service}.ts`; `packages/domain/src/authz/{access,delegation,reach}.ts` |
| `fix/economy-review-0926` @ `31b4b5af (unpublished)` | `mono-web-economy-fix`; 0 | 6 / 41 | Economy review handoff and fixes; `docs/specs/economy-review-fixes.md` | **low** — outside named surfaces | `apps/backend/src/receipt/config.ts`; `apps/backend/src/main.ts`; economy review paths |
| `build/effect-version-pin-0927` @ `5f4afd32 (unpublished)` | `mono-web-effect-pin`; 0 | 6 / 33 | Effect version pin handoff | **low** — build/tooling | `.agents/skills/effect-house/SKILL.md`; `.github/workflows/checks.yml`; root manifests |
| `fix/frontend-http-review-0926` @ `64966b20 (unpublished)` | `mono-web-frontend-fix`; 0 | 10 / 35 | Frontend HTTP review and profile form-key correction; `docs/specs/frontend-http-review.md` | **high** — Profile, SDK failure and Foldkit command adapter | `apps/dashboard/app/foldkit/profile/{command,model,update}.ts`; `packages/sdk/src/{failure,command-identity,command-keys}.ts` |
| `fix/oauth-review-0926` @ `44bc3416 (unpublished)` | `mono-web-oauth-fix`; 0 | 8 / 41 | OAuth review and access-spec fixes | **high** — AccessSpec/authz | `packages/http-api/src/access.ts`; `packages/domain/src/authz/access.ts`; `packages/domain/src/authz/access.test.ts` |
| `fix/organization-review-0926` @ `8c0f2510 (unpublished)` | `mono-web-org-fix`; 0 | 12 / 33 | Organization review fixes; `docs/specs/organization-review.md` | **high** — AccessSpec and HTTP contract | `packages/http-api/src/organization.ts`; `packages/domain/src/authz/reach.ts`; `apps/backend/src/organization/http.ts` |
| `test/organization-race-0927` @ `01e74103 (unpublished)` | `mono-web-org-race`; 0 | 9 / 33 | PostgreSQL race test for board independence | **high** — access-control and HTTP contract behavior | `packages/http-api/src/organization.ts`; `packages/domain/src/authz/reach.ts`; `packages/http-api/test/native-api.test.ts` |
| `fix/placements-review-0926` @ `31b4435f (unpublished)` | `mono-web-placements-fix`; 0 | 12 / 33 | Placements review fixes; `docs/specs/placements-review-fixes.md` | **high** — HTTP contract | `packages/http-api/src/placements.ts`; `apps/backend/src/placements/http.ts`; `apps/backend/src/placements/http.test.ts` |
| `feat/team-application-queue-pilot-0926` @ `6a5ccdaf (unpublished)` | `mono-web-pq-pilot`; 0 | 11 / 33 | Team-application queue pilot and operation grants; `docs/specs/infrastructure-ports.md#pilot-progress` | **high** — access/problem and HTTP contracts | `packages/http-api/src/{common,http-semantics,team-application}.ts`; `packages/domain/src/authz/operation-grants.ts` |
| `fix/recruitment-review-0926` @ `27265998 (unpublished)` | `mono-web-recruitment-fix`; 0 | 9 / 33 | Interview correction window; `docs/specs/interview-correction-window.md` | **high** — endpoint problems, HTTP contracts, Foldkit command adapter | `packages/http-api/src/{endpoint-problems,http-semantics,onboarding,recruitment}.ts`; `apps/dashboard/app/foldkit/interview/command.ts` |
| `refactor/schema-declaration-0927` @ `bc2a82d0 (unpublished)` | `mono-web-schema`; 0 | 1 / 28 | Replace the frozen numbered-migration mechanism with a schema declaration; `docs/specs/schema-declaration.md` | **low** — database workflow only | `docs/specs/schema-declaration.md` |
| `fix/postgres-teardown-flake-0927` @ `7246edeb (unpublished)` | `mono-web-teardown-flake`; 0 | 4 / 26 | Preserve guardian death as PostgreSQL teardown cause; `docs/specs/postgres-teardown.md` | **low** — test resource lifecycle | `docs/constructs/test-harness.md`; `docs/specs/postgres-teardown.md`; `tools/postgres/` |
| `spike/persisted-queue-outbox-0925` @ `8841dda3 (unpublished)` | —; — | 1 / 486 | Deliver team-application notifications through Effect PersistedQueue | **low** — migration plan explicitly defers generic outbox lifecycle | `apps/backend/src/team-application/worker.ts`; `packages/database/migrations/0073-team-application-persisted-queue.sql`; `docs/architecture.md` |
| `durable/feat/durable-apex-preview` @ `8457fe00` | —; — | 2 / 1,916 | Durable Apex preview service supervision | **low** — preview infrastructure, not migration contract | `infra/host/preview-services.sh`; `infra/host/units/vektor-preview-backend.service`; `design-specs/0070-durable-apex-preview.md` |
| `origin/test/preview-secretspec-0926` @ `5fcdff97` | —; — | 2 / 232 | Re-run and exercise SecretSpec Worker Preview deployment/delete | **low** — no net tree diff against `main` | No changed paths in `git diff main...origin/test/preview-secretspec-0926`; commits `5fcdff97`, `7110c338` |

There are 20 local branch refs with unmerged commits, all checked out in the sibling worktrees. The three additional unmerged refs above have no checkout in `git worktree list`. The worktree `mono-web-economy-red` is not included in that branch count: it is detached at a commit already contained in `main`, with 13 dirty paths. All local unmerged worktrees are clean and 26–80 commits behind current `main`; their `ahead` counts range from 1 to 21. This is a stale-branch survey, not a landing/readiness assessment.

Other refs in `git branch -a --sort=-committerdate` that are not ahead of this `main` include `origin/HEAD`, `origin/main`, `origin/integration/0062-final`, `origin/feat/0020-pr-preview-delivery`, `receipt-verified/head`, and the `origin/publish/*` refs (`0002`, `0003`, `0004`, `0010`–`0012`, `0014`, `0015`, `0017`–`0019`). The separately stored `mono-web-durable.git` history is not the same branch graph as this checkout.

## RPC refactor finding (no matching ref found; 23 lines)

- The requested `git log --all --oneline -i --grep=rpc` returned no commits in the `mono-web` repository.
- The requested `git grep -l "effect/rpc\\|RpcGroup\\|Rpc\\." ... -- 'packages/**' 'apps/**'` returned no source files on any branch ref.
- Whole-word, case-insensitive `rpc` searches over text source (`packages/**`, `apps/**`) also returned no files; broad unfiltered substring matches were binary assets/package artifacts, not an RPC implementation.
- `git log --all --name-only --oneline -i --grep=rpc` returned no commit-path records.
- `git grep -i rpc` across `docs/specs/*rpc*` and `handoffs/**` returned no branch docs or handoff mentions.
- The same source/commit/spec/handoff searches were run in the separate `mono-web-durable-preview` / `mono-web-durable.git` history and also returned no RPC implementation or refactor spec.
- Therefore there is no discoverable RPC-refactor branch/spec/source to read; no claim can be made that mono-web has `RpcGroup` per context, RPC-specific auth/problem mapping, or an SDK/Foldkit RPC consumer.
- The RPC layer’s completion state and whether a refactor is “already on main” are not applicable: the scanned current `main` and its branch refs contain no matching RPC layer or refactor.
- **What effx should borrow from that alleged branch:** nothing is evidenced. Do not derive RPC semantics from branch-name hearsay or retrofit HTTP patterns as RPC.
- **Relevant, but HTTP-only, source paths to reuse for this migration:** `packages/http-api/src/{api,access,common,http-semantics,endpoint-problems}.ts`; `packages/sdk/src/effect-client.ts`; `apps/dashboard/app/foldkit/profile/command.ts`; and `apps/backend/src/profile/http.ts`.
- Those current mono-web paths are the HTTP, access, typed-problem, SDK and Profile material already cited by effx’s migration plan; they are not evidence of an RPC transport.
- The effx repo’s own invariant says generated output is ordinary Effect `HttpApi`, `Rpc`, or `Command` (`AGENTS.md`, invariant 9). Keep the compiler’s Rpc extension as its own effx contract until a real upstream RPC source/branch is located.

## Most recent handoff and operator direction

The newest and only file in `mono-web/handoffs/` is `handoffs/2026-09-27.md`. It is dated evidence, and its stated `main` hash (`1da22ce4`) is older than the live `main` surveyed here (`f433ea90`). It contains no RPC mention; its operator decisions relevant to transport are HTTP/SDK-oriented:

1. The architecture direction is FCIS + DDD: bounded contexts organize modelling/code, not runtime modules; the core is a stateless library of pure algebraic APIs; one generic imperative runner is the shell; Layer requirements are service interfaces provided at composition roots; stateful coalgebra is reserved for state bound to operations (`handoffs/2026-09-27.md`, decision 4).
2. Effect’s `FetchHttpClient.Fetch` workaround was removed from SDK tests; the fake fetches were replaced by real in-memory `HttpApi` endpoint tests. `HttpApiEndpoint.ClientRequest` remains a registered upstream defect exception, `EX-0010` (`handoffs/2026-09-27.md`, lines 28–33).
3. The interview-correction branch’s declared sequence is “generate SDK/OpenAPI, then the dashboard, journey, model, docs,” keeping the generated contract upstream of its dashboard consumer (`handoffs/2026-09-27.md`, branch table; `docs/specs/interview-correction-window.md`).
4. No operator decision establishes an RPC protocol, per-context RpcGroups, or RPC error/auth mapping. Handoff direction aligns with the effx plan’s generated HTTP client and source-contract-first work, not an RPC migration precedent.

## Migration takeaways

- Highest-value branch source to review for effx’s listed gaps: the endpoint contract/problem/access files in `fix/content-teams-review-0926`, `fix/oauth-review-0926`, `fix/organization-review-0926`, `feat/team-application-queue-pilot-0926`, and `fix/recruitment-review-0926`.
- The closest SDK/Foldkit evidence is `fix/frontend-http-review-0926` (`packages/sdk/src/{failure,command-identity,command-keys}.ts` and Profile `command.ts`), `feat/certificates-0926` (certificates `command.ts`), and `fix/recruitment-review-0926` (interview `command.ts`). Treat those as native HTTP-client/Foldkit patterns, not RPC client patterns.
- `experiment/domain-scope-0926` has direct Profile/authz domain changes, but it is mostly domain-scope reorganization; inspect only the referenced source paths before borrowing a design.
- Admission, placement, organization, recruitment and content branches add useful business/contract evidence but are 26–80 commits behind `main`; use the live branch diffs and their specs, not this summary or old handoff state, before any implementation choice.
- The branch candidate most directly matching the operator’s “RPC refactor” clue was not found in either checked branch graph. A separate location/ref name is a prerequisite for any RPC-layer analysis; the present survey cannot infer that work’s API or status.

## Verification boundary

This was a read-only source survey: Git inventory/history/diff metadata and targeted reads of the effx plan, the newest handoff, and research-note conventions. No mono-web file was modified, and no test, build, or deployment was run.
