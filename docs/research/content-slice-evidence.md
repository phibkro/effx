# Content publication — Gate 4 local parity acceptance

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

Observed 2026-10-04 on **clean mono-web `fcc2f3e029b49c9bd0f0446c37c193416c362f50 (unpublished)`**, retained unlanded in `mw`. Every final compiler, focused, browser, `just check`, and `just test` job below has this exact revision and `dirty: false` in the machine's `just measure` ledger. The operator's `mono-web/main` at `f433ea906c9f9af5134c7316d54c78d8c859038f` remained read-only. This is local Chromium/Better Auth/native HTTP/disposable PostgreSQL acceptance, **not** a production, provider, credential, or writer cutover (`docs/specs/0014-content-migration.md`; mono-web `AGENTS.md`). The evidence-only mono-web `STATE.md` commit `fcc2f3e0 (unpublished)` preceded, rather than followed, this final serial run. This effx evidence commit follows the run and is not part of the measured mono-web revision.

## Complete generated group, existing authority

`packages/http-api/src/content.effx.ts` declares all **eight** existing operations in one `ContentGroup`; the contract and handlers project from the **same four-group IR**, alongside Profile, Directory, and SocialEvents. Contract and handler manifests have identical semantic hash `5d47dabb6d6b26b67a9abfab485f2881adbb0f789a5130b49106a6a34f21f9f2`. The externally generated index has exactly **107 operations**, eight in `content`, and excludes the one internal receipts operation:

| Operation | Method and path |
| --- | --- |
| `content.createArticle` | `POST /api/content/articles` |
| `content.listNews` | `GET /api/news` |
| `content.publishArticle` | `POST /api/content/articles/{articleId}:publish` |
| `content.readArticle` | `GET /api/content/articles/{articleId}` |
| `content.readContentWorkspace` | `GET /api/content/articles` |
| `content.readNewsArticle` | `GET /api/news/{slug}` |
| `content.reviseArticle` | `PATCH /api/content/articles/{articleId}` |
| `content.unpublishArticle` | `POST /api/content/articles/{articleId}:unpublish` |

`packages/http-api/src/api.ts` uses the generated Content group in place of the deleted handwritten endpoint declarations. `apps/backend/src/content/http.ts` binds all eight through `GeneratedContentApiHandlers`, with two genuinely anonymous public guards and six staff guards. The generated factory delegates to existing typed raw handlers: no duplicate authority decision, fake anonymous Person, no-op guard, SQL rewrite, or SDK echo. ContentManagement and public Content remain separate domain/database services. Workspace and article reads retain their **different original authorization placements**, and writes continue to recheck current actor/Organization authority in their serializable transaction before receipt lookup, including replay. Original HTTP conditional, idempotency, version, cache, strict problem and response encoding remain application-owned (`docs/specs/0014-content-migration.md:39-47`; mono-web `apps/backend/src/content/{http,http-reads,http-commands,http-context}.ts`).

## Repairs actually red before declaration cutover

Each of the first three independent regressions was **committed and observed failing on real PostgreSQL/backend before its distinct minimal fix commit** on the mono-web integration history. The unmerged `fix/content-teams-review-0926` was used as attributed source evidence for those narrow fixes, not merged wholesale; its journal/uncertain-write UI and homepage error mapping stayed out (`mono-web/STATE.md:81-89`).

| Defect, committed red → fix | Observed red output, then source repair |
| --- | --- |
| Foreign working-copy disclosure: `58aae63e (unpublished)` → `60b429af (unpublished)` | A department-A editor's workspace unexpectedly included `Department B PRIVATE working title` alongside A's own draft, although B's private detail was denied. The SQL workspace projection now applies `canReviseDraft` before including mutable working copies; publisher/global administrator and own-draft reads remain (`packages/database/src/content/workspace-visibility-postgres.test.ts`). Red focused run exited **1**; green exited **0**. |
| Public stale validators: `2aa9f2e8 (unpublished)` → `e87a1c2b (unpublished)` | After a department-link-only commit, both anonymous listing and article conditional GETs returned stale **304** and unchanged ETags despite changed visible `departmentIds`; expected fresh **200** and changed tags. Both now derive ETags from the strictly decoded, once-encoded public representation. The shared conditional response keeps the original lazy default path and byte-level regression for adjacent endpoints (`apps/backend/src/content/http-news-etag.postgres.test.ts`; `apps/backend/src/http-api/conditional-json.test.ts`). Red exited **1**; green exited **0**. |
| Long transliterated slug: `c396f76d (unpublished)` → `9c92e455 (unpublished)` | Creating a title of 255 `æ` characters transliterated to 510 ASCII characters and failed the real database insert with `ContentPersistenceError(operation='insert content draft'): effect/sql/SqlError`; the 255-character slug limit was not met. The slug allocator bounds the base and reserves collision-suffix room before PostgreSQL insertion; two long, colliding titles now persist distinct bounded slugs with receipt/audit, while short titles keep their behavior (`packages/database/src/content/slug-postgres.test.ts`; `packages/domain/src/content/projection.test.ts`). Red exited **1**; green exited **0**. |

The compiler prerequisite was **also reproduced**, not inferred: a real rc.116 fixture with `POST /api/content/articles/:articleId:publish` and `:unpublish` and exported `{ articleId }` produced **two `EFFX2402` errors** even though native HttpApi accepts the routes. The fixture began at effx `4b266d7`; parser/grammar repairs `18905e7` and `29b68c9` are included in compiler distribution **effx `f3c6bf8ae6205b9b60a449d01faed63744beb765`**, which adds a typechecked stable generated Content fixture. Mono-web vendored it at `8dd959a9 (unpublished)` **before** writing the eight declarations. `tools/effx-dist/manifest.json` pins runtime SHA-256 `7a2a4d26e5003ecfab13ddf783a8c8be5304945ab678d2eeb191a294b3ecd909` and CLI SHA-256 `84a927098f05a9041887bf12f9ad8940255d4b3b2112fd7b8b629ce2c2b59397`, both checked against on-disk archives. Both final strict four-group project checks and the emit exited **0**; each printed only known warning `EFFX0001` (compiler TS 6.0.3, project TS 7.0.2). The target's `just check` is the authoritative type/lint gate (`docs/specs/0014-content-migration.md:182-184`). A later compiler change was not re-vendored during this frozen acceptance.
Semantic hashes are bound to the effx compiler commit named above; later IR revisions change them.

## Pre-existing midnight hydration defect, separately red → green

The first named Content journey on clean generated-Content backend commit `ef826549 (unpublished)` exercised the real staff, public, SQL, and HTTP path, but exited **1** at the final `pageErrors` assertion: four React text-hydration `#418` errors on anonymous news pages (40 seconds, peak RSS 4.5 GiB). This was **not caused by effx**: original mono-web `main` at `f433ea90` already used `new Date(publishedAt).toLocaleDateString("nb-NO")` at all three `/nyheter` and `/nyhet/:slug` render sites, with an implicit host timezone. At `2026-10-03T22:30:00Z`, controlled UTC rendering said `3.10.2026`, but Europe/Oslo said `4.10.2026`.

Commit `52242f8b (unpublished)` extracted those unchanged route expressions into one real rendering helper and committed a focused UTC-versus-Oslo test **red**: 1 failed/7 passed, `expected '3.10.2026' to be '4.10.2026'`. Fix `3d6e37a3 (unpublished)` formats the publication date with an explicitly named `Europe/Oslo` zone; it also names that zone at all four previously implicit dashboard date/time formatters in `foldkit/{interview,recruitment,scheduling,social-events}/view.ts`. The pre-existing `packages/domain/src/time.ts` owns RFC 3339 validation and canonical ISO, **not UI presentation**; this follows the homepage's existing explicit-Oslo `Intl.DateTimeFormat` convention (`apps/homepage/src/lib/public-team-application.ts:181-189`) rather than adding duplicate domain state. `anti-slop/no-implicit-date-time-zone` rejects zoneless `Intl.DateTimeFormat` and date locale calls in both apps; its **15** positive/negative test cases include valid UTC/Oslo zones and number formatting. The focused news test then passed **8/8**, full app-source scoped lint passed, and the original named publication journey passed on the clean final revision with `pageErrors: []`. No hydration suppression, client-only rendering, or weakened browser ledger assertion was used (`mono-web/STATE.md:91-95`; `apps/dashboard/e2e/native-content-publication.spec.ts:525-578`).

## Whole-API byte comparison, not a sampled endpoint check

A retained clean detached mono-web checkout at `604cbde54ad60e338d9e4cafb56942106c0918e1 (unpublished)` contains the **handwritten Content API root**, before the eight-endpoint root/backend replacement, and regenerates the accepted pre-Content whole-API reference bytes. At the final revision, package-owned OpenAPI and SDK generation each exited 0. Complete-file `cmp -s` against that reference returned **0 for both files** (identical), not just identical `content` subsets:

| Projection | Pre-Content SHA-256 | Final SHA-256 | Whole file |
| --- | --- | --- | --- |
| `packages/http-api/openapi.json` | `81e7b872178803a3c8bf6ccf86b96b5185ba560e9661b47e98d1d0d4e827b749` | identical | 5,360,174 bytes; 157,287 physical lines |
| `packages/sdk/native-api-operations.json` | `c4abcca1878171c84fd3c531c3fe5c93f92329818c59d4b73a8bf796bca8aad3` | identical | 18,009 bytes; 655 physical lines |

This establishes unchanged full wire-projection bytes, including operation IDs, paths, security, headers, statuses, problem unions and 200/201/304 shapes, relative to the independently retained reference. It does **not** prove production policy or provider behavior. The reference whole-file digests also match the accepted pre-Content digests recorded in `docs/specs/0014-content-migration.md:165`.

## One clean final revision: measured serial acceptance

Commands below ran inside the final worktree's `devenv shell`. Each `just measure` held the machine-wide heavy lock; results are from the per-job machine ledger filtered by **revision `fcc2f3e0 (unpublished)`, `dirty: false`**, corroborated by `just measure --report`. `bun install --frozen-lockfile` separately exited **0** (1,252 installs across 1,562 packages checked, no changes). No unchanged failing browser suite was rerun to hunt a pass: the initial #418 failure is recorded above; the next publication run was after its source repair.

| Command after `devenv shell --` | Exit | Ledger wall | Peak RSS | Result |
| --- | ---: | ---: | ---: | --- |
| `just measure --class check -- just effx-native` | 0 | 7,165 ms | 1,064,480,768 B | Both four-group contract/handler emits, hash equal. |
| `just measure --class check -- bun x effx check --project packages/http-api/tsconfig.effx.json --strict-access --emit=contract` | 0 | 3,326 ms | 954,880,000 B | Strict source/IR check. |
| `just measure --class check -- bun x effx check --project apps/backend/tsconfig.effx.json --strict-access --emit=handlers` | 0 | 3,446 ms | 911,364,096 B | Strict typed raw handler check. |
| `just measure --class check -- bun run --cwd packages/http-api generate` | 0 | 4,143 ms | 997,281,792 B | Complete OpenAPI, 107 external/one internal excluded. |
| `just measure --class check -- bun run --cwd packages/sdk generate` | 0 | 532 ms | 10,403,840 B | Complete 107-operation SDK index. |
| `just measure --class test -- bun run --cwd packages/http-api vitest run test/content-effx-adapters.test.ts test/native-api.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 2,763 ms | 423,256,064 B | 2 files, **19** passed; exact group/access/problems/headers. |
| `just measure --class test -- bun run --cwd apps/backend vitest run src/content/http.test.ts src/content/http-command-guards.postgres.test.ts src/content/http-news-etag.postgres.test.ts src/http-api/conditional-json.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 11,769 ms | 770,572,288 B | 4 files, **12** passed; real PostgreSQL, guards and public ETags. |
| `just measure --class test -- bun run --cwd packages/database vitest run src/content/slug-postgres.test.ts src/content/workspace-visibility-postgres.test.ts src/content/postgres.test.ts src/content/news.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 9,208 ms | 1,023,328,256 B | 4 files, **19** passed; actual PostgreSQL visibility, slug, commands and news. |
| `just measure --class test -- bun run --cwd packages/domain vitest run src/content/projection.test.ts src/content/actor.test.ts src/content/sanitize.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 1,246 ms | 246,861,824 B | 3 files, **14** passed. |
| `just measure --class test -- bun run --cwd apps/dashboard vitest run app/foldkit/content/update.test.ts app/foldkit/content/view.test.ts app/foldkit/content/command.test.ts app/foldkit/content/bridge-route.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 5,548 ms | 465,489,920 B | 4 files, **24** passed; Foldkit Model, commands and real bridge semantics. |
| `just measure --class test -- bun run --cwd packages/sdk vitest run src/__tests__/generated-native-client.test.ts src/__tests__/profile-operation-index.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 2,776 ms | 390,578,176 B | 2 files, **9** passed, all eight Content SDK operation keys. |
| `just measure --class test -- bun run --cwd apps/homepage vitest run test/news.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 1,979 ms | 383,975,424 B | **8** passed, including the previously red UTC/Oslo boundary. |
| `just measure --class e2e -- just e2e content-publication` | 0 | 79,649 ms | 4,862,750,720 B | Original spec 0062, real staff/public Chromium/Better Auth/PostgreSQL. |
| `just measure --class e2e -- just e2e profile` | 0 | 47,366 ms | 2,708,615,168 B | Original Profile edit/conflict/replay/denial/accessibility. |
| `just measure --class e2e -- just e2e schools` | 0 | 69,716 ms | 3,710,533,632 B | Original Schools directory **and** management suites. |
| `just measure --class e2e -- just e2e social-events` | 0 | 69,751 ms | 2,980,229,120 B | Original SocialEvents access/replay/snapshot/keyboard/mobile; zero page errors. |
| `just measure --class check -- just check --concurrency=1` | 0 | 59,859 ms | 2,958,745,600 B | Full format/lint/types/OpenAPI/layout/guides/constructs/exceptions/source-safety; **16/16** type graph tasks. |
| `just measure --class test -- just test --concurrency=1` | 0 | 317,044 ms | 2,626,314,240 B | Full package aggregate **21/21 tasks succeeded** (3 cached); not inferred from an earlier partial pass. |
| `just measure --class test -- node --test tools/oxlint/anti-slop/rules/no-implicit-date-time-zone.test.ts` | 0 | 193 ms | 0 B sampled | **15/15** valid/invalid lint cases and negative controls. |

The Content Chromium test's final confinement assertions require **nonempty** `/dashboard/content` bridge response ledger with 503/200 GET and 409/200 POST; exact four native `/api/content/articles*` requests (including `Idempotency-Key` on PATCH and `:publish`), anonymous listing/detail/homepage requests, no Schools or legacy request, and **no page errors**. The bridge response filter was corrected in `5964136e (unpublished)` before final acceptance; no response ledger can pass vacuously (`apps/dashboard/e2e/native-content-publication.spec.ts:525-578`). Expected unpublished/withdrawn article 404s during the journey are not suite failures. The homepage worker's signal-143 exit occurs during runner teardown; the aggregate browser result and measured exit were both 0.

## Maintained lines are descriptive

Physical `wc -l`, with an explicit, consistent bounded source selection: one old Content contract; eight non-test backend Content `.ts`; nine non-test domain Content `.ts`; four non-test database Content `.ts`; nine non-test Foldkit Content `.ts` (excluding `.d.ts`); the one dashboard Content bridge route; homepage `news.ts`, `news.server.ts`, and `/`, `/nyheter`, `/nyhet/:slug` routes. The before source is the clean post-repair, **pre-declaration** commit `ce3f02cb (unpublished)` (37 files); after is clean `fcc2f3e0 (unpublished)` (38 files), replacing `content.ts` with the authored `.effx.ts` and access/header/schema adapter. Test files, shared code, guides, compiler archives and generated outputs are excluded on both sides. This explicitly enumerated 37-file pre-source is **not** the earlier, narrower 36-file estimate in other planning prose.

| Responsibility | Before lines | After lines |
| --- | ---: | ---: |
| Contract: handwritten → `.effx.ts` + authored adapter | 372 | 479 |
| Backend Content HTTP | 1,139 | 1,258 |
| Domain Content | 1,297 | 1,297 |
| Database Content | 1,832 | 1,832 |
| Foldkit Content | 1,271 | 1,271 |
| Dashboard bridge route | 242 | 242 |
| Public homepage news routes/loaders | 535 | 542 |
| **Maintained total** | **6,688** | **6,921 (+233)** |

Of the maintained after-state, authored `content.effx.ts` is **316** lines and `content-effx-adapters.ts` is **163**. Generated Content contract and handler TypeScript add **82** and **107** lines (**189** separate generated lines), not counted as maintained. Complete whole-API OpenAPI and SDK JSON sizes/lines are reported above, separately. The positive maintained delta is **not** a parity rejection gate.

No provider, deployed environment, credential mutation, writer transfer, receipt recovery after a lost whole browser response, or approval of journal/uncertain-write UI was exercised. Membership-derived Content editing remains an existing policy question; this cutover introduces no grant. The three earlier accepted contexts and all four named browser journeys passed at the final local commit, but that is **not** authorization to land the branch on operator-owned `main` or deploy.