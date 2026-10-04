# Admission outcome policy — spec 0027 local acceptance

Observed 2026-10-04 on **clean mono-web `9850665245b6280a693e6947d90ed1b57cb322a5` (unpublished)**. It is 41 commits on top of the accepted Contact revision `101ffb036ea8f6b10f0eb03c9970da45d3a9b2c4 (unpublished)` (`docs/research/contact-slice-evidence.md`), itself on the unpublished source baseline `8152c389f1176ede38b70417bab1332b0a311c21 (unpublished)`. The operator-owned mono-web `main` was not modified, and nothing was pushed, landed or deployed.

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

Mono-web file paths use the `mw/` prefix. The design is `docs/specs/0027-admission-outcome-policy.md`. This is a **handwritten-contract policy repair**, not an effx migration: the effx semantic IR hash `2901cf833cad441f246e430c942a6441ac7959a44afb36e3a5a98e700e17190e` is the same at Contact and at this revision.

## What changed

- **Two outcomes.** An admission outcome is `Admitted` or `Rejected`. `Substitute` is no outcome and no role: assistant B covers absent assistant A on one dated school run, and coverage records no longer carry a kind.
- **Two authorized steps.** For an interviewed applicant `Ja` derives Admitted and `Nei` derives Rejected, with no override. A `Kanskje` or returning applicant needs an explicit Rekruttering decision. The school coordinator then announces the outcome **once**; the announcement is final and queues one immutable mail envelope. `Rejected` is refused while the applicant has an active placement in the same department and semester, and a later placement for a Rejected applicant is refused; both orders contend on the same department row lock.
- **Authority is explicit.** Decide rides the existing delegable capability `admissions.outcomes` and announce rides `placements.coordinate`, each only by an active team delegation that reaches the department, or by an active global administrator. A department-board leader, a national-board leader, a team leader and a plain member each hold neither. Department template edits use the delegated coordinator only; global defaults use an active global administrator only.
- **Eight operations, 111 external.** The `admissionOutcomes` group grew from four to eight: `listScopes`, `readOutcomes`, `readOutcome`, `decideOutcome` (replaces `recordOutcome`, so the route suffix changes from `:record` to `:decide` and a pre-cutover receipt can not replay), `announceOutcome`, `readOutcomeTemplates`, `previewOutcomeTemplate` and `saveOutcomeTemplate`. Complete OpenAPI SHA-256 `9e0b0035244ca89c758455b3bc7c44dc178a2b8ca78ad828ff4c2cb2475b2e2c` (6,325,574 bytes) and SDK index `df0a424f5d685bb5bc27da33241536cf5425049f3367c1eb8a73d383df240ba4` (18,784 bytes) list 111 external operations; both changed only by these eight operations.
- **Migrations.** `0081` adds outcome provenance (`Decision`, `Recommendation`, `SemanticUpgrade`), a nullable decider that exists exactly for a Decision, a `NOT VALID` check that refuses any new `Substitute` revision while preserved history stays unchecked, an immutable announcement table, and drops the persisted coverage kind. For each current `Substitute` it appends one `Admitted` revision with provenance `SemanticUpgrade` and no decider. `0082` adds versioned outcome message templates (three approved Norwegian defaults seeded as global revision 1) and an immutable per-application outbox.
- **Mail and editor.** Subject, HTML and text are rendered at announce time from the effective template and stored as one immutable envelope; a later template edit or an exact replay changes none. A closed ProseMirror document schema, one fixed layout and an escaping renderer keep template data separate from code. The dashboard route `/dashboard/vikarer` became `/dashboard/opptaksutfall` with a decide board, a minimal coordinator announce board (no email or phone) and a template editor; `just e2e substitutes` became `just e2e admission-outcomes`.

## Upgrade proof, from a previous-schema seed

`mw/packages/database/src/admissions/outcome-policy.postgres.test.ts` builds the previous schema by applying the first 80 migrations, seeds it with that era's rows, applies the later migrations (`0081`, `0082`) and compares exact rows. It runs the same function against a real PostgreSQL cluster of the selected major and against PGlite. The seed holds:

| Previous-schema fact | Seeded rows |
| --- | --- |
| Outcome histories | a current `Substitute`; `Substitute` then `Admitted`; `Admitted` then a current `Substitute`; `Substitute` then `Rejected`; plain `Admitted`; plain `Rejected`; undecided, with two different deciders |
| Coverage records | a withdrawn `Substitute`-kind record and a current `Assistant`-kind record on one absence, and a current `Substitute`-kind record on another, on two dated commitments of one confirmed proposal |
| HTTP receipt | one successful pre-cutover `admissionOutcomes.recordOutcome` answer whose stored body names `Substitute` |

Asserted after the upgrade: exactly the two applications whose current outcome was `Substitute` get one appended `Admitted` revision each, attributed to nobody, with explicit `SemanticUpgrade` provenance; **zero earlier rows are rewritten** (all four preserved `Substitute` literals remain as history); no person is invented; no mail or announcement is created; provenance counts are 9 `Decision` and 2 `SemanticUpgrade`; a direct `Substitute` insert is refused while an `Admitted` control insert is accepted; and provenance/decider pairs the schema forbids are refused. For coverage: all three records keep their id, absence, covering person, recorder, instants and withdrawal (zero rewritten), the `Assistant|Substitute` column no longer exists, and one current record per absence still holds. For the receipt: the row is **identical** byte for byte, still names the stale three-value body and its old operation id, and the new cutover operation has a different id.

Negative controls (throwaway branch, deleted): a migration that keeps the coverage kind column fails both cases at `kindColumnAfter` (1 instead of 0); a migration that rewrites the old receipt's operation fails both at `receipts.unchanged` and at the operation list.

| Command | Result |
| --- | --- |
| `just measure --class test -- bun run --cwd packages/database vitest run src/admissions/outcome-policy.postgres.test.ts --no-file-parallelism --maxWorkers=1` (PostgreSQL 18; includes PGlite) | exit 0, 59 tests, 5,937 ms, 1.08 GiB |
| the same with `VEKTOR_POSTGRES_MAJOR=17` set outside `devenv shell` (PostgreSQL 17; includes PGlite) | exit 0, 59 tests, 5,724 ms, 1.14 GiB |

A first PostgreSQL 17 attempt set the variable inside the shell, so PostgreSQL 18 stayed on `PATH`; the harness refused to start (exit 1, 1.2 s, no test ran). That is an invocation error, recorded here, not a passing run.

## Observed red-first and integration findings

- **Red before any fix.** At `8152c389` plus only two test-only commits, the real-PostgreSQL policy suite and the native HTTP suite failed for policy reasons: the database suite 21 failures and 5 passed controls (after correcting one unrelated fixture version assertion), the HTTP suite 22 and then 28 failures against missing decide, announce and template routes. All were green after the implementation.
- **A real authority bypass, found by review before acceptance.** The first service helpers inherited the department board leader's reach for both new actions through the registry's `boardLeader: true`. The approved policy forbids that. Both actions now require an active delegation (`delegationsReaching` plus `scopeCovers`), with domain tests for active, ended, not-yet-started, cross-department, leaders-only, department-board, national-board, team-leader, plain-member and global-administrator cases, an HTTP test with a board leader and no delegation (403 on decide, board read, announce and template read/save), and Alloy laws (below).
- **Independent source review.** A read-only review reproduced one defect: an HTTPS link or button target such as `https://host\@other/path` parsed as host `host` but would render unchanged in mail. The validator now refuses any backslash and any authority that is not already canonical, with positive and negative controls.
- **Response header.** An announcement answered `no-store` where the contract says `private, no-store`, including on replay; the contract and handler now agree.
- **Journey repairs at their cause, no assertion loosened.** Invitation expiry carried microseconds; the leader's delegation pointed at a department-board team, which a delegation can not conform to; a plain member's scopes read is 403 and a plain membership elsewhere confers no scope; the coordinator lacked a contact profile; the viewer's own profile card contains an example address; a refused announcement leaves the state unannounced while a `Nei` derives Rejected; the entry revision counts the announcement; one browser context signed in twice; and dashboard `react`/`react-dom` re-resolved to 19.3.0, whose Bun server entry crashes at startup, so they are pinned to 19.2.8.
- **Finality is not a stale-ETag accident.** The "announced outcome is not decided again" check now sends the board's fresh ETag and demands `409 admission-outcome.final` and unchanged history. Two throwaway mutations (decide ignoring finality; finality only for `Ja`/`Nei`) turned the journey red at that check, in the first case with a 422 derived refusal and in the second with a 500. The page heading stays "Opptaksutfall"; the decision region is named "Avgjørelser" so that no two landmarks share a name, asserted with role queries and axe on every board state.

## One clean final revision: measured acceptance

Every job ran under `devenv shell` and held mono-web's shared heavy lock through `just measure`. The ledger filtered by **revision `98506652` and `dirty: false`** gives these exits, wall times and peak RSS. The Alloy and Context Mapper rows ran at `91887dfb`; `91887dfb..98506652` differs by exactly one test file, so no model or source file changed.

| Command after `devenv shell --` | Exit | Ledger wall | Peak RSS | Observation |
| --- | ---: | ---: | ---: | --- |
| `just measure --class check -- just check-types --concurrency=1` | 0 | 17,652 ms | 1,861,644,288 B | Types and generated HTTP contract. A later run of the same revision replayed Turbo's cache (753 ms) and also exited 0. |
| PostgreSQL 18 outcome-policy suite | 0 | 5,674 ms | 1,118,212,096 B | 59 tests. |
| PostgreSQL 17 outcome-policy suite | 0 | 5,469 ms | 1,079,828,480 B | 59 tests. |
| `… vitest run src/admission/outcome-policy.http.test.ts …` | 0 | 9,701 ms | 990,105,600 B | 30 native HTTP tests on real PostgreSQL: receipts, replay, delegation denials, preview, immutable envelope. |
| `just measure --class e2e -- just e2e admission-outcomes` | 0 | 185,610 ms | 5,093,699,584 B | Real Better Auth, disposable PostgreSQL, generated SDK, Foldkit board and template editor, token-protected loopback mailbox: 21 API gates, 15 browser gates, 3 receipts, 9 mails. |
| `just measure --class e2e -- just e2e applicant` | 0 | 53,862 ms | 3,324,841,984 B | Adjacent. |
| `just measure --class e2e -- just e2e admission-periods` | 0 | 48,693 ms | 3,191,238,656 B | Adjacent. |
| `just measure --class e2e -- just e2e recommendation-applicant-progress` | 0 | 51,749 ms | 2,705,776,640 B | Adjacent. |
| `just measure --class e2e -- just e2e recommendation-returning` | 0 | 90,915 ms | 3,442,888,704 B | Adjacent. |
| `just measure --class e2e -- just e2e contact` | 0 | 46,092 ms | 2,228,404,224 B | Shares the built homepage Worker and generated SDK. |
| `just measure --class e2e -- just golden school-service` | 0 | 70,545 ms | 5,066,301,440 B | Dated assistant coverage after interview-derived announcements, 26 checkpoints. |
| `just measure --class check -- just check --concurrency=1` | 0 | 31,435 ms | 3,683,196,928 B | Source safety, format, Effect-aware lint, types, layout, guides, constructs, exceptions. |
| `just measure --class test -- just test --concurrency=1` | 0 | 282,132 ms | 2,729,500,672 B | Full package test graph; the aggregate exit. |
| `just model check` (Alloy 6.2.0, at `91887dfb`) | 0 | 1,416,346 ms | 1,258,569,728 B | 126 commands: 43 of 43 checks hold, 53 of 53 mutants caught, 30 of 30 scenarios found, 0 unexpected. |
| `just model validate` (at `91887dfb`) | 0 | 3,082 ms | 290,881,536 B | Context Mapper validates `contexts.cml` without errors. |

The Alloy model now has no `Decide`/`Announce` in the board-leader capability table. Delegation witnesses must be a team of the right kind (Rekruttering or Skolekoordinering) holding the persisted capability, and mutants (board leader holds the authority; any team decides or announces; backing capabilities crossed) are each caught.

## Custody during integration

During integration a parallel director session wrote to the integration branch while this session held it. Foreign commits were classified against the approved spec and either re-applied by this session or rejected; the one that contradicted the approved authority rule was rejected, and the temporary debug probes of the other session were not integrated. Every foreign commit was preserved on a rescue reference and the parallel session's branch and checkout were left untouched. The operator stopped the parallel session, and a final process scan found nothing still running in either checkout.

## Not claimed

No production, provider, credential or deployment check was run. The mailbox is a local loopback sink: it proves transport acceptance of the exact bytes, not inbox delivery or provider HTML rendering. Rekruttering can still re-decide a Kanskje or returning outcome until the announcement; that is policy, not a defect. The branch is unlanded; the operator controls landing and cutover.
