# Admissions - Gate 4 local parity acceptance

Observed 2026-10-04 on **clean mono-web `815a28f838a519c69da4574c4653293b83a9df31` (unpublished)**: one commit, `feat(admissions): generate the Admissions and outcome contracts and raw bindings`, on the spec 0027 acceptance revision `9850665245b6280a693e6947d90ed1b57cb322a5 (unpublished)`. The operator-owned mono-web `main` was not modified, and nothing was pushed, landed or deployed.

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

Mono-web file paths use the `mw/` prefix. The design is `docs/specs/0026-admissions-migration.md`. The effx pack stayed the pinned `e04c8d2a16636f81e65d478a4d06a07933f6896b`; nothing was re-vendored.

## What changed

- **Eighteen operations generated.** `mw/packages/http-api/src/admissions.effx.ts` (ten operations) and `admission-outcomes.effx.ts` (eight) replace the handwritten `HttpApiEndpoint` declarations and both `HttpApiGroup` classes. `mw/apps/backend/src/admission/{http,outcome-http}.ts` bind the generated raw factories with deferred guards at the 18 existing access decisions. Eleven operations are Queries and seven are Commands; `previewOutcomeTemplate` is the one Query over POST (`payloadIsQuery: true`).
- **Strict access, both projects.** `effx build --strict-access` exits 0 with 0 errors for the contract and the handler project, which now emit nine groups.
- **First uses probed alone first.** A `PUT` (`saveOutcomeTemplate`), a Query over POST (`previewOutcomeTemplate`) and `Capability.any` (the two board reads) were each declared in a minimal project against the pinned pack. Each produced an OpenAPI operation identical to its handwritten twin (9,711, 5,578 and 1,945 lines), its handlers type-checked, and removing `payloadIsQuery` failed with `EFFX2401`. The probes found one constraint, now met: `Http.problems` codes must be flat literal tuples.
- **Guards, not decisions.** Each handler hands its decision facts to the generated guard through a request-local frame (`http-guard.ts`); a guard that runs outside its own operation's frame, or for another kind of decision, is a defect, covered by `http-guard.test.ts`. Authorization still runs inside the committing transaction, before identity and receipt lookup, and the public rate limit and strict body bound still come first.
- **Problem codes keep one source.** The ten `Admissions*Problem` lists were hoisted into flat `Admissions*Codes` tuples in `endpoint-problems.ts`, and the unions derive from them. The three outcome lists keep their spread-composed tuples in `admission-outcomes.ts` (17, 24 and 18 codes) as the source. The declarations use flat copies in `admission-outcomes-effx-adapters.ts`; `admission-outcomes-effx-adapters.test.ts` compares each copy with its source element for element and at the type level. A throwaway mutation that swapped two codes in the 17-code copy failed that test at runtime and failed `tsc` at the type level; it was reverted. The copies are recorded in `STATE.md` to retire when the frontend resolves spreads of const tuples.
- **Access adapters.** `admissions-effx-adapters.ts` and `admission-outcomes-effx-adapters.ts` accept only the ten and the eight approved (resolver, capability, requirement, decision time) policies; each has negative tests for a widened capability, another resolver, another time and a dropped requirement.
- **Consumers.** The homepage `api-types.ts` and its application-options spec, and the dashboard `run-real-admission-period-management.mjs`, import the generated endpoints by operation name.

## Bytes: what is identical and the one accepted delta

| Artifact | Accepted 0027 baseline | At `815a28f8` |
| --- | --- | --- |
| SDK operation index | SHA-256 `df0a424f5d685bb5bc27da33241536cf5425049f3367c1eb8a73d383df240ba4`, 18,784 B, 111 operations | **identical** |
| External OpenAPI, whole document | `9e0b0035244ca89c758455b3bc7c44dc178a2b8ca78ad828ff4c2cb2475b2e2c`, 6,325,574 B | `572094dafeef770356b3e18c25ac2a7e40280142dcf2d6e9e31320f5281f2d7d`, 6,325,576 B |
| Seven earlier groups' generated contract and handler files (14 files) | - | `cmp` identical to the baseline worktree for Contact, Content, Directory, Organization, Profile, SocialEvents and TeamApplications |
| Semantic hash, contract and handler projects | `2901cf833cad441f246e430c942a6441ac7959a44afb36e3a5a98e700e17190e` (seven groups) | `d6cfe223dc0a79ae1426e9e681b4eebc318a93a928cde765167e673d864dfa21` in both (nine groups, as designed) |

**The OpenAPI delta is exactly one name swap.** The two documents differ only in which of the components `AdmissionPeriodManagementItem` and `AdmissionPeriodManagementItem_1` carries the unsuffixed name, at three `$ref` sites; the two components have identical contents. The generator emits a group's endpoints sorted by key (`packages/compiler/src/generate/http.ts:323`), so `createAdmissionPeriod` (a 201 variant made by `HttpApiSchema.status(201)`) is now met before `listAdmissionPeriods` (which nests the plain schema), and Effect names colliding identifiers by encounter order (`effect/src/unstable/httpapi/OpenApi.ts`, component extraction). The handwritten group listed the read first.

**Operator ruling (SocialEvents precedent):** whole-document byte equality is not the hard gate; wire, status, security and schema semantics are, and a `$ref` suffix swap is an accepted non-semantic projection delta. `packages/http-api/test/openapi-semantics.test.ts` enforces that. It renames every component to a name derived from its content (a refinement of content hashes over the `$ref` graph, until stable), rewrites every `$ref`, merges identical entries, and compares the canonical digest `0805f9889bea3a6201c7d65e539815183af0a95c9c2057ebd81eb218ec390997`. The same function gives that digest for the accepted 0027 document and for the generated one. It keeps negative controls on the document (a changed schema field, a removed status, a removed response header, an emptied security rule, a removed operation, each changes the digest; a component-name swap does not), and a throwaway mutation of a real schema field (`placed` in `AdmissionOutcomeAnnounceResource` to a string) failed the gate before it was reverted. The whole-document SHA `572094da...` is the post-0026 baseline.

## Measured acceptance

Every job ran under `devenv shell` and held mono-web's shared heavy lock through `just measure`. The ledger filtered by **revision `815a28f8` and `dirty: false`** gives these exits, wall times and peak RSS.

| Command after `devenv shell --` | Exit | Wall | Peak RSS | Observation |
| --- | ---: | ---: | ---: | --- |
| `just effx-native`, then `http-api generate` and `sdk generate` | 0 | 13,592 ms | 1,171,779,584 B | The bytes table above. |
| `just measure --class check -- just check-types --concurrency=1` | 0 | 3,871 ms | 1,798,504,448 B | Types and the HTTP contract. |
| `http-api` Vitest, all 13 files | 0 | 10,400 ms | 471,404,544 B | 68 tests, including the semantic, adapter and tuple tests. |
| `sdk` Vitest | 0 | 3,111 ms | 462,938,112 B | 9 tests; the index pins 111 operations. |
| `apps/backend` `admission-period.http`, `submit-application.http`, `returning-registration`, `outcome-policy.http`, `http-guard` | 0 | 5.6, 5.8, 3.3, 10.8, 2.6 s | 0.8-1.0 GiB | 4, 6, 1, 30 and 3 tests, on real PostgreSQL where the suite starts it. |
| `outcome-policy.postgres.test.ts` on PostgreSQL 18, then 17 | 0, 0 | 6.2, 6.2 s | 1.17, 1.10 GiB | 59 tests each, including PGlite and the 0081 upgrade proof. |
| `packages/database` `src/admissions src/admission-period src/application` | 0 | 12.3 s | 1.11 GiB | 66 tests. |
| `packages/domain` `src/admissions src/application src/admission-period` | 0 | 2.0 s | 0.27 GiB | 44 tests. |
| `apps/homepage` Vitest | 0 | 8.5 s | 0.46 GiB | 59 tests. |
| `just e2e applicant` | 0 | 59,033 ms | 3.55 GiB | Public application and confirmation. |
| `just e2e admission-periods` | 0 | 51,684 ms | 3.27 GiB | Scoped staff window create and revise. |
| `just e2e admission-outcomes` | 0 | 191,462 ms | 5.13 GiB | Real Better Auth, disposable PostgreSQL, the generated SDK, the React Router board and ProseMirror editor and a token-protected loopback mailbox: 21 API gates, 15 browser gates, 3 receipts, 9 mails. |
| `just e2e recommendation-applicant-progress` | 0 | 54,331 ms | 2.80 GiB | Authenticated progress. |
| `just e2e recommendation-returning` | 0 | 97,386 ms | 3.20 GiB | Returning assistant. |
| `just e2e contact` | 0 | 48,096 ms | 2.23 GiB | Shares the built homepage Worker and generated SDK. |
| `just golden school-service` | 0 | 76,865 ms | 5.18 GiB | Dated coverage after announcements. |
| `just e2e profile`, `schools`, `social-events`, `content-publication`, `organization`, `owner` | 0 each | 56.0, 73.0, 71.5, 81.6, 61.6, 55.2 s | 2.7-4.9 GiB | Earlier groups and the receipt-owner journey. |
| `just golden team-application` (normal) | 0 | 50,699 ms | 5.72 GiB | |
| the same with `GOLDEN_TEAM_APPLICATION_FAULT=after-submitted` | 1 | 32,504 ms | 3.83 GiB | The injected exit (`fault: Injected journey failure after-submitted`), with its evidence receipt. Not a passing normal golden. |
| the same with `GOLDEN_TEAM_APPLICATION_FAULT=interrupt-after-submitted` | 143 | 33,466 ms | 3.72 GiB | The injected exit (`Interrupted: SIGTERM`), with its evidence receipt. Not a passing normal golden. |
| `just measure --class check -- just check --concurrency=1` | 0 | 35,523 ms | 3.18 GiB | Layout, constructs, guides, exceptions, source safety, format, Effect-aware lint, types. |
| `just measure --class test -- just test --concurrency=1` | 0 | 92,904 ms | 2.83 GiB | 21 of 21 Turbo tasks; the aggregate exit. |

Two ledger rows at this revision are not results. A first batch was killed by the harness's 300-second tool deadline during `just e2e admission-outcomes` (exit 143, no assertion had failed); the journey then ran alone to the exit 0 above. A first byte-check step exited 127 only because `jq` is not in the devenv shell, after printing the same hashes; it was rerun without it.

## Source accounting

Physical `wc -l` of the ten named transport files, `mw/packages/http-api/src/{admissions,admission-outcomes}.ts` and `mw/apps/backend/src/admission/{http,http-reads,http-commands,http-access,http-context,outcome-http,outcome-http-support,outcome-template-http}.ts`: **2,661** at `98506652`, **2,273** at `815a28f8` (-388; the two contract files fell from 706 to 40 and 160 lines of schemas, parameters and problem lists, and the handler files lost their handwritten group assembly).

New authored files: `admissions.effx.ts` 393, `admission-outcomes.effx.ts` 302, `admissions-effx-adapters.ts` 222, `admission-outcomes-effx-adapters.ts` 239 and `http-guard.ts` 97, **1,253** lines. The maintained after-state of those files is therefore **3,526** lines against 2,661, +865, plus 190 inserted and 148 removed lines of support in `endpoint-problems.ts`, `http-semantics.ts`, `api.ts` and `index.ts`, and 14 inserted and 14 removed lines in the callers and the two effx project files. `STATE.md`, the construct pages and one module guide changed by 45 inserted and 36 removed lines of documentation. Test files (four new, one helper) are not counted. The generated contracts (91 and 82 lines) and handlers (127 and 107) are counted apart, **407** lines, and are not maintained. This is descriptive, not a LOC target: the declarations move the access, problem and header facts out of the handwritten endpoints into declarations and checked adapters.

## Not claimed

No production, provider, credential or deployment check was run. The mailbox is a local loopback sink: it proves transport acceptance of the exact bytes, not inbox delivery or provider HTML rendering. `just model check` and `just proof authorization-rules` were not run, because no authority code, relationship reach or Alloy model changed. `just e2e placement`, `onboarding` and `just golden recruitment` were not run: no shared readiness, account or placement seam changed. The 0027 policy and the pack were not re-examined. Two compiler improvements are logged by the operator outside this slice, for a later pack: static resolution of `...constTuple` in `Http.problems` codes, and deterministic content-derived component naming or declaration-order emit. The branch is unlanded; the operator controls landing and cutover.
