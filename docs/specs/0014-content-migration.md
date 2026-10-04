# Spec 0014 — Content publication migration, Gate 4

Status: **approved Content design; three prior repairs and generated cutover pending**. This source survey used clean mono-web `da1f63f240fb382df60b2768c59f0da5461c70b4 (unpublished)` and vendored effx `cbea7c7440a3b177b3e04b6ab4b3a9c686a6b026`; no implementation, compiler check, browser run, or branch merge had occurred when the design was first submitted. Mono-web paths below are relative to the integration worktree. The operator's mono-web `main` remains read-only. This approval does not authorize deployment, credentials, writer transfer, production data, or merging `fix/content-teams-review-0926` (`docs/specs/0004-monoweb-migration-plan.md:316-332`; `docs/research/tagged-access-constructor-evidence.md`).

## Outcome and scope

An authorized staff member uses **one** Foldkit workspace at `/dashboard/artikler`: read a scoped workspace and article, create and revise a draft, publish an immutable version, and unpublish it. Anonymous visitors see the published article on the homepage and `/nyheter` or `/nyhet/:slug`, but do not see drafts. The existing native API, generated SDK, real Better Auth, and PostgreSQL remain in that path. Move **all eight** Content endpoint declarations and their complete raw-handler binding into the one effx project already containing Profile, Directory and SocialEvents. Keep the two domain services, their authority, SQL, receipts and immutable history, the one Foldkit Model, same-origin bridge, and public homepage loaders application-owned (`packages/http-api/src/content.ts:131-372`; `packages/domain/src/content/{content-service,service}.ts`; `apps/backend/src/content/http.ts:12-55`; `apps/dashboard/app/foldkit/content/{model,main,command}.ts`; `apps/homepage/src/lib/news.server.ts`). Page text and sponsor presentation are Content model responsibilities, but this **article/news HTTP group** does not implement new endpoints for them (`apps/backend/src/content/AGENTS.md:14-30`; `packages/http-api/src/content.ts:131-372`).

The frozen group remains `content`, OpenAPI title `Content and news`, description `Native staff publication and public news operations.` It has **six staff Person operations and two anonymous public operations in one group**. Do not split the group, add a second client, change an operation ID, or infer UI authority from visible controls (`packages/http-api/src/content.ts:131-372`; `packages/http-api/src/api.ts:34-75`; `packages/sdk/native-api-operations.json`).

### Wire contract that codegen must reproduce

| Qualified operation and exact native route                                     | Declared input                                                                                                                 | Successful response                                                                                                                                   |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `content.readContentWorkspace` — `GET /api/content/articles`                   | Optional `department` query (`DepartmentId`); no route params, body or endpoint headers.                                       | 200 `ContentWorkspaceSchema`; private/no-store, `Vary: Origin`; no 304.                                                                               |
| `content.createArticle` — `POST /api/content/articles`                         | JSON `CreateArticleRequest`; required `Idempotency-Key`; no If-Match.                                                          | 201 `ContentArticleDetailSchema`; no-store, strong ETag, origin-relative Location, `Vary: Origin`.                                                    |
| `content.readArticle` — `GET /api/content/articles/:articleId`                 | `articleId: ArticleId`; optional conditional `If-Match` and `If-None-Match`; no query/body.                                    | 200 `ContentArticleDetailSchema` **or bodyless 304**; both private/no-store, strong ETag, `Vary: Origin`.                                             |
| `content.reviseArticle` — `PATCH /api/content/articles/:articleId`             | `articleId`; `ArticleMergePatch` with `application/merge-patch+json`; required Idempotency-Key **and strong If-Match**.        | 200 `ContentArticleDetailSchema`; no-store, strong ETag, `Vary: Origin`.                                                                              |
| `content.publishArticle` — `POST /api/content/articles/:articleId:publish`     | `articleId`; **empty JSON object** `PublishArticleRequest` (not an absent body); required Idempotency-Key and strong If-Match. | 200 `PublishArticleResponse` (`articleId`, `versionNumber`, `publishedAt`); no-store, strong ETag, `Vary: Origin`.                                    |
| `content.unpublishArticle` — `POST /api/content/articles/:articleId:unpublish` | `articleId`; **empty JSON object** `UnpublishArticleRequest`; required Idempotency-Key and strong If-Match.                    | 200 `UnpublishArticleResponse` (`articleId`); no-store, strong ETag, `Vary: Origin`. **Not 204.**                                                     |
| `content.listNews` — `GET /api/news`                                           | Optional `department` query; optional If-Match/If-None-Match; no body.                                                         | 200 annotated `PublishedNewsListingSchema` **or bodyless 304**; both public `max-age=60, s-maxage=300, must-revalidate`, strong ETag, `Vary: Origin`. |
| `content.readNewsArticle` — `GET /api/news/:slug`                              | `slug: ArticleSlug`; optional `version` query, integer ≥1; optional If-Match/If-None-Match.                                    | 200 annotated `PublishedNewsArticleSchema` **or bodyless 304**; same public cache, strong ETag and `Vary: Origin`.                                    |

The full source of these eight schemas, annotations and route strings is `packages/http-api/src/content.ts:51-73,75-129,131-372`. The existing request and response helpers own the actual header schemas and 200/201/304 branches (`packages/http-api/src/http-semantics.ts:53-87,91-99,136-202`; `packages/http-api/src/v2-schemas.ts:106-112,231-263,347-357`). `ContentArticleDetailSchema` and public news schemas are domain exports; the existing public news annotations supply identifier, description and example. Preserve those annotations when they become named symbols (`packages/domain/src/content/schema.ts:242-259,267-282,317-373`; `packages/http-api/src/content.ts:309-339`). Public and private cache headers differ: sharing one conditional response header schema would change the contract.

**Access is not a group-wide Person rule.** All eight endpoints are `External` and `Reveal`. The six staff endpoints use `PersonSecurity`, a Better Auth cookie **or** delegated OAuth user bearer, Person principal, and the capability/resolver/time below. Their middleware adds `credential.missing|credential.invalid` 401 separately. The two public reads have **no PersonSecurity**, accept `None` with Anonymous principal and `Capability.none`, have no requirements, and retain `SnapshotRead` (`packages/http-api/src/access.ts:34-48,71-104`; `packages/http-api/src/content.ts:141-150,170-180,201-211,230-241,261-272,289-300,320-348`; `packages/http-api/src/common.ts:50-68,87-108`).

| Operation              | Capability                                                    | Resolver                      | Decision and extra requirement       |
| ---------------------- | ------------------------------------------------------------- | ----------------------------- | ------------------------------------ |
| `readContentWorkspace` | `content.read-workspace`                                      | `content.articles`            | SnapshotRead; none                   |
| `createArticle`        | `content.create-article`                                      | `content.article-create`      | Transaction; none                    |
| `readArticle`          | `content.read-article`                                        | `content.article-by-id`       | SnapshotRead; none                   |
| `reviseArticle`        | `content.revise-article`                                      | `content.article-by-id`       | Transaction; `content.revisable`     |
| `publishArticle`       | `content.publish-article`                                     | `content.article-by-id`       | Transaction; `content.publishable`   |
| `unpublishArticle`     | **`content.publish-article`**, not a new unpublish capability | `content.article-by-id`       | Transaction; `content.unpublishable` |
| `listNews`             | none                                                          | `content.public-news`         | SnapshotRead; none                   |
| `readNewsArticle`      | none                                                          | `content.public-news-by-slug` | SnapshotRead; none                   |

Each endpoint keeps its **own ordered closed problem union**. These are `ContentReadContentWorkspaceProblem` (8 codes), `ContentCreateArticleProblem` (19), `ContentReadArticleProblem` (10), `ContentReviseArticleProblem` (25), `ContentPublishArticleProblem` (22), `ContentUnpublishArticleProblem` (22), `ContentListNewsProblem` (8) and `ContentReadNewsArticleProblem` (8). Preserve every code and its position from `packages/http-api/src/endpoint-problems.ts:1058-1213`, not a new shared superset or copied status map. For example, the public news unions declare conditional precondition failures but no authority/origin denial; the authenticated mutation unions declare idempotency, validation, transaction and Content failures. `NativeProblemRegistry` owns RFC 9457 status/body/retry headers, while PersonSecurity owns the staff 401 errors (`packages/http-api/src/http-semantics.ts:291-292,518-552,1153-1166,1520-1547`; `packages/http-api/src/common.ts:50-68`). The public path must not accidentally acquire a staff credential error.

## Ownership that generated declarations must not absorb

- **Domain and SQL.** `Content` serves anonymous listing and current/previous published-version reads; `ContentManagement` serves staff workspace/detail and create/revise/publish/unpublish. Staff reads depend on Organization and Profile; commands use Organization in their own transactions. Their database Layers and service requirement channels remain distinct (`packages/domain/src/content/{content-service,service}.ts`; `packages/database/src/content/postgres-layer.ts:16-80`; `docs/effect-exceptions.json:106-124`).
- **Authority.** Active global administrators can publish globally. Department publishers can publish their authorized scope. Editors can revise only their own not-yet-published drafts in all selected departments. Inactive or out-of-scope actors cannot mutate. The backend evaluates each actual endpoint AccessSpec. It resolves current credential/Organization authority inside a write transaction, not from a Foldkit button or an earlier GET (`packages/domain/src/content/actor.ts:28-147`; `apps/backend/src/content/{http-access,http-context,http-commands}.ts`; `packages/database/src/content/postgres.ts:149-193,337-356,583-618`). Membership-derived Content editing remains an existing policy question in mono-web `STATE.md:153-154`, not a new effx grant.
- **Reads and cache.** The SQL staff workspace/detail readers use repeatable-read, read-only snapshots and evaluate current Organization authority there. Their HTTP AccessSpec checks have **different existing placements**: workspace checks after `authorizedActor` and before the SQL workspace snapshot begins; detail checks after its detail/source read returns. Do not claim those two guards already run _inside_ the same SQL snapshot or move them there in a declaration-only migration. Public queries join current pointers to immutable versions; withdrawn/unknown articles do not reveal drafts. Each endpoint still checks access before a conditional 304/412. Keep the response ETag source, five-minute public cache policy and private no-store policy application-owned (`apps/backend/src/content/http-reads.ts:52-156`; `packages/database/src/content/postgres.ts:130-158,314-462`; `packages/database/src/content/news.ts:81-307`; `apps/backend/src/http-api/problem.ts:462-524`).
- **Writes and replay.** Create/revise sanitize HTML and keep a server-issued immutable slug. Revise checks article ownership/scope and expected revision; publish creates the next immutable version and current pointer; unpublish clears the pointer without erasing history. Domain command receipt and audit commit with article/version/link changes. The separate HTTP receipt stores exact response bytes/headers in the same serializable transaction, rechecks current credential/authority before lookup **even on replay**, and distinguishes in-flight, digest-conflict and expired receipts. If-Match, canonical request digest and strong ETags remain transport concerns (`packages/domain/src/content/{schema,sanitize,projection}.ts`; `packages/database/src/content/postgres.ts:464-1213`; `apps/backend/src/content/http-commands.ts:86-455`; `apps/backend/src/http-api/receipt-transaction.ts:240-329`). There is no Content-specific outbox/provider write to invent in this migration (`packages/database/migrations/0020-content-publication.sql:68-107`).
- **Browser.** `/dashboard/artikler` owns one Foldkit Model. It tracks workspace/detail request identity, editor fields, observed ETag, pending command, scope filter and errors. Six Commands load workspace/detail and create/revise/publish/unpublish through authenticated same-origin `/dashboard/content`, which calls the generated SDK. The embedded runtime disposes on disconnect. The homepage loaders for `/`, `/nyheter` and `/nyhet/:slug` consume the public SDK; they are **not** another Foldkit screen (`apps/dashboard/app/foldkit/content/{main,elements,model,command,update,bridge,browser-client,view}.ts`; `apps/dashboard/app/routes/dashboard.artikler._index.tsx`; `apps/dashboard/app/routes/__foldkit.content.ts`; `apps/homepage/src/lib/{news,news.server}.ts`).

## Unmerged Content changes: source evidence, not parity authority

Read-only comparison: `fix/content-teams-review-0926` at `08835acd6a35eeed5bc69e77465bb86518dac855 (unpublished)` against operator `main`; no checkout, merge or test of that branch. Its Content diff touches backend reads/problem mapping, domain slug projection, PostgreSQL reads, the Foldkit editor/proxy, homepage behavior and publication runner. **None** of its changes were accepted by the preceding SocialEvents cutover (`git diff main...fix/content-teams-review-0926 -- apps/backend/src/content packages/domain/src/content packages/database/src/content apps/dashboard/app/foldkit/content apps/dashboard/e2e/run-real-native-content-publication.mjs`; `handoffs/2026-09-27.md:162`).

1. **Workspace visibility.** Baseline can show a published working copy to a scoped editor of another department. The branch limits entries to revisable drafts and tests an unreleased title in a foreign department. This is a possible disclosure issue, not an effx guard feature (`packages/database/src/content/postgres.ts:225-245`; branch `packages/database/src/content/postgres.ts:225-242,276-290`; branch `postgres.test.ts:156-222`).
2. **Public validators.** Baseline public ETags use separate SQL metadata and omit mutable article-department links even though the body exposes department IDs. The branch hashes the strictly encoded actual listing/detail representation, changes a shared `conditionalJson` seam, and tests department-link-only changes for fresh 200/ETag followed by 304. The branch test is source expectation, **not a passing result** (`apps/backend/src/content/http-reads.ts:179-269`; branch `http-reads.ts:177-201,232-253`; branch `apps/backend/src/content/http.test.ts:221-294`; `apps/backend/src/http-api/problem.ts:485-525`).
3. **Slug bounds.** Baseline appends a suffix without bounding candidate length against the 255-character SQL slug constraint. The branch reserves suffix room and changes empty/all-punctuation handling; its long-title collision test is unrun here (`packages/domain/src/content/projection.ts:170-195`; branch `projection.ts:109-165`; branch `packages/database/src/content/postgres.test.ts:422-449`).
4. **Uncertain browser writes.** The branch prototypes a per-person sessionStorage journal for Create/Revise/Publish/Unpublish, exact-key replay after a dropped success response, retained dirty edits on stale conflict, and original-ETag submission. Current bridge rereads an ETag before some commands. The branch also changes homepage error mapping. Do not copy its journal, status messages or conflict workflow into a parity cutover. Multi-tab journal overwrites and persisted raw editor HTML need separate review (`apps/dashboard/app/routes/__foldkit.content.ts:139-242`; branch `apps/dashboard/app/foldkit/content/{model,update,command,browser-client}.ts`; branch `apps/dashboard/e2e/{run-real-native-content-publication.mjs,native-content-publication.spec.ts}`; branch `apps/homepage/src/lib/news.server.ts`).

**Operator decision (2026-10-03):** The first three branch-survey risks require **separate test-first repairs before** the Content generator cutover. Do not defer them or silently bundle their fixes into eight-endpoint codegen. The fourth, uncertain-write journal and homepage error mapping, remains a separate future product contract tracked in effx `STATE.md`. The named current journey does not prove a lost response or department-link-only ETag update.

## Proposed legal source and generated-binding seam

Use **declaration-only dense builders**, not decorators on fake methods. `ContentGroup = Http.group({ root: ExternalNativeApi, group: "content", title: "Content and news", description: "Native staff publication and public news operations.", defaults: { metadata: { annotator: nativeOperationAnnotations }, problems: { registry: nativeProblems }, access: { annotator: contentAccessAnnotations, exposure: "External", concealment: Concealment.reveal } } })` holds fields shared by **all eight**. Every exported `Operation.query/command({ name: "content.<key>", input, success }).in(ContentGroup).http.<verb>(exactPath).http.contract({...}).http.problems({ identifier, codes }).http.access({...}).declare()` keeps its own route, schemas, header/media/status, capability/resolver/time and problem codes. The safe group-prefixed `name` derives its existing operationId. Group defaults do **not** add an authorization rule to a public operation (`effx/packages/runtime/src/{Annotation,builder,authority}.ts`; `effx/packages/compiler/src/group-defaults.ts:37-49,172-279`; mono-web `packages/http-api/src/social-events.effx.ts:28-128`).

The mixed group uses **endpoint-local** `middleware: [PersonSecurity]`, Person credentials/principal and a Content capability for six staff operations. The two public operations explicitly use `middleware: []`, credentials `None`, principal `Anonymous`, `Capability.none`, no requirements and the public resolver. This favors an explicit public/staff interface over a Person default that needs a forgotten override to keep public news anonymous. One app-owned `contentAccessAnnotations` must validate the exact eight combinations and derive the existing `personNativeAccess` or `anonymousNativeAccess`. Export registered resolver symbols; never copy `profile.owner` into Content. Generated raw handlers need a real public `authorizeAnonymous` guard, not a fake successful Effect. They must invoke each staff guard at the **original handler placement**: workspace before its SQL snapshot, detail after its source read, and writes inside serializable prepare before receipt lookup. The ContentManagement SQL layer keeps its separate snapshot-time authority evaluation (`apps/backend/src/content/{http,http-access,http-reads,http-commands}.ts`; `packages/database/src/content/postgres.ts:130-158,314-462`; `effx/packages/compiler/src/generate/http.ts:345-438`).

Representative proposed source is **not committed TypeScript**. The named Content exports below do not exist until an approved implementation extracts them from the current native helpers:

```ts
export const ContentGroup = Http.group({
  root: ExternalNativeApi,
  group: "content",
  title: "Content and news",
  description: "Native staff publication and public news operations.",
  defaults: {
    metadata: { annotator: nativeOperationAnnotations },
    problems: { registry: nativeProblems },
    access: {
      annotator: contentAccessAnnotations,
      exposure: "External",
      concealment: Concealment.reveal,
    },
  },
});

export const CreateArticle = Operation.command({
  name: "content.createArticle",
  input: CreateArticleRequest,
  success: ContentArticleDetailSchema,
})
  .in(ContentGroup)
  .http.post("/api/content/articles")
  .http.contract({
    headers: IdempotencyHeaders,
    payload: CreateArticleRequest,
    status: 201,
    responseHeaders: CreatedMutationResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      summary: "Create article draft",
      description: "Creates or replays a native article draft command.",
    },
  })
  .http.problems({ identifier: "ContentCreateArticleProblem", codes: ContentCreateArticleCodes })
  .http.access({
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: Capability.one("content.create-article"),
    requirements: [],
    canonicalScopeResolver: ContentArticleCreateResolver,
    decisionTime: "Transaction",
  })
  .declare();

export const ReadNewsArticle = Operation.query({
  name: "content.readNewsArticle",
  input: ContentNewsVersionQuery,
  success: PublishedNewsArticleResponse,
})
  .in(ContentGroup)
  .http.get("/api/news/:slug")
  .http.contract({
    params: ContentNewsSlugParams,
    query: true,
    headers: ConditionalReadHeaders,
    status: 200,
    responseHeaders: PublicConditionalResponseHeaders,
    conditional: true,
    middleware: [],
    metadata: {
      summary: "Read published news article",
      description: "Returns the current or selected published version.",
    },
  })
  .http.problems({
    identifier: "ContentReadNewsArticleProblem",
    codes: ContentReadNewsArticleCodes,
  })
  .http.access({
    acceptedCredentials: ["None"],
    principalKinds: ["Anonymous"],
    capabilities: Capability.none,
    requirements: [],
    canonicalScopeResolver: ContentPublicNewsBySlugResolver,
    decisionTime: "SnapshotRead",
  })
  .declare();
```

For staff conditional `readArticle`, specify exported `ContentArticleParams`, `ConditionalReadHeaders`, `ProfileReadResponseHeaders`, `conditional: true` and 200/304. For `reviseArticle`, use the **existing** `ArticleMergePatch`, `IdempotencyIfMatchHeaders`, `mediaType: "application/merge-patch+json"`, entity-mutation headers and `content.revisable`; publish/unpublish retain empty JSON payloads, 200 bodies and their different requirement IDs. The other operations follow the same full-group pattern. Do not use `metadata.commandIdentity`: Create has no If-Match; no Content command identity source has been approved for an extra SDK helper (`packages/http-api/src/content.ts:131-372`; `effx/packages/compiler/src/extensions/http-contract.ts:260-273`).

**Application-owned preparation:** Export `Schema.Struct` values for the current `ContentDepartmentQuery`, `NewsVersionQuery`, article ID params and news slug params, then reuse those same values in the old contract during cutover; the existing field-object shorthands cannot lower as `Schema.Top` (`packages/http-api/src/content.ts:55-73,188,328`; `effx/packages/frontend-ts/src/lower.ts:449-455,546-580`). Extract the annotated public success schemas with the exact identifiers/descriptions/examples. Extract `PublicConditionalResponseHeaders` from the current `publicConditionalResponses` closure and make that helper reuse it; keep the existing private conditional headers (`packages/http-api/src/content.ts:309-339`; `http-semantics.ts:141-166`). Export the **eight existing ordered** Content problem-code tuples and derive both old endpoint unions and new `.http.problems` from them (`endpoint-problems.ts:1058-1213`). These are application source seams, not an invitation to add second registries or hand-edit generated files.

Extend both existing `tsconfig.effx.json` `files` lists with `content.effx.ts`. Keep Profile, Directory, SocialEvents and Content under **one** project root and one contract/handler emit per target; independent projects into the same `.effx/generated` directory can remove each other's manifest-owned files. Generated `ContentApi` replaces the handwritten group in `packages/http-api/src/api.ts` and package exports; generated `ContentApiHandlers` replaces all eight handwritten `.handleRaw` registrations while delegating to the same handlers. Keep the public and staff bridge, `Content` and `ContentManagement` Layers, SQL, HTML sanitizer, audit/receipt transaction and homepage consumers unchanged unless an explicitly approved product repair is separate (`apps/backend/src/content/http.ts:12-55`; `packages/http-api/src/{api,index}.ts`; `apps/backend/src/router.ts:199-220`; `effx/packages/cli/src/commands.ts:125-180`).

**Compiler implementation check, not a reproduced failure:** The present effx route validator appears to read the entire `:articleId:publish` or `:articleId:unpublish` segment as a parameter name. It then compares that string with exported `{ articleId }` params and can emit `EFFX2402` (`effx/packages/compiler/src/extensions/http-contract.ts:241-257`; `packages/http-api/src/content.ts:249-299`). This is a **source-derived prediction**, not an observed diagnostic: this design ran no compiler command. After approval, build all eight real Content declarations and run both strict effx project checks. **Only if the actual Content source reproduces the error**, route its precise diagnostic and full native route/params to `monoweb-gap` for the compiler fix. Do not rename the route, invent a fake param, omit either mutation, suppress diagnostics, hand-edit output, or scope the journey down to six endpoints. The generator also asks for a guard binding for each anonymous endpoint; use real `authorizeAnonymous` semantics and treat a type error there the same way (source inspection: `effx/packages/compiler/src/generate/http.ts:345-438`; `effx/packages/compiler/src/generate/guards.ts:13-43`).

## Named real journey and approval-bound falsifiers

The existing command is **`just e2e content-publication`**; there is no `just e2e content` recipe. It dispatches to `bun run --cwd apps/dashboard e2e:real-content-publication` and `apps/dashboard/e2e/run-real-native-content-publication.mjs`, which invokes `native-content-publication.spec.ts` in Chromium. The runner starts disposable PostgreSQL, native backend, generated SDK, production dashboard, production homepage and a local proxy; browser sessions sign in through real Better Auth. Preserve its forced workspace 503/retry, scoped staff and denied actors, create/revise/publish/unpublish, immutable versions, stale conflict, Idempotency-Key/If-Match native requests, anonymous news/filter/detail/front-page visibility, existing accessibility checks and route confinement. The current suite does **not** prove a conditional 304; focused HTTP tests must do so (`justfile:139-149`; `apps/dashboard/package.json:20-24`; `apps/dashboard/e2e/{run-real-native-content-publication.mjs,native-content-publication.spec.ts,native-content-publication-seed.mjs}`). Source review is **not** an observed pass at a migration revision.

The current named spec already asserts **at least three** `/dashboard/content` bridge requests and four exact native `/api/content/articles*` requests (`native-content-publication.spec.ts:525-558`). But its persisted `bridgeResponses` evidence filters `pathname.startsWith("/content")`, so that response list can be empty while the request assertions pass. After approval, select the real `/dashboard/content` responses and assert that response ledger is nonempty too. Keep the nonempty existing request assertions, native route/Idempotency-Key/If-Match checks and no-legacy-route checks; do not add an unhosted spec and call it acceptance (`apps/dashboard/e2e/native-content-publication.spec.ts:525-581`).

On **one clean committed mono-web revision** after approval, run heavy commands serially inside its `devenv shell` via `just measure --class <class> -- <command>` and collect exits, wall time and peak RSS from the ledger and `just measure --report` (`mono-web/AGENTS.md#verification-and-resources`). Required gates:

1. Frozen Bun install and one `just effx-native` emit; compare semantic hashes in both four-group manifests. Run `bun x effx check --project packages/http-api/tsconfig.effx.json --strict-access --emit=contract` and its backend handlers-project counterpart. Regenerate OpenAPI and SDK through repo recipes. Assert exactly **107 external IDs, eight `content` IDs, one excluded internal receipts ID**, unchanged security, statuses, headers, 200/201/304 body shapes and all closed problem unions. Compare **the complete** pre-/post-cutover OpenAPI and SDK bytes against the same clean committed source inputs. The accepted pre-Content reference has complete SDK SHA-256 `c4abcca1878171c84fd3c531c3fe5c93f92329818c59d4b73a8bf796bca8aad3` and OpenAPI SHA-256 `81e7b872178803a3c8bf6ccf86b96b5185ba560e9661b47e98d1d0d4e827b749` (`docs/research/tagged-access-constructor-evidence.md`). Investigate **every** delta before claiming parity; a SocialEvents-style identical-component `$ref` suffix difference is not automatically accepted for Content.
2. Focused `@effect/vitest` source-based contract/access/SDK-index, eight raw-binding/backend, real PostgreSQL Content/public-news and Foldkit workspace/bridge tests. Use existing package-specific Vitest files and add precise regressions only for observed gaps. Tests must prove six staff versus two truly anonymous routes, all eight endpoint keys, conditional 304, replay/If-Match and actor confinement. They do **not** replace the browser journey (`packages/http-api/test/native-api.test.ts`; `apps/backend/src/content/http.test.ts`; `packages/database/src/content/{postgres,news}.test.ts`; `apps/dashboard/app/foldkit/content/{update,view,command,bridge-route}.test.ts`; `packages/sdk/src/__tests__/profile-operation-index.test.ts`).
3. `devenv shell -- just measure --class e2e -- just e2e content-publication` — real staff and public browser/API/PostgreSQL proof through the generated full Content group, with the corrected nonempty bridge ledger. Then run `just e2e profile`, `just e2e schools`, and `just e2e social-events` **separately** under the same lock and revision. Prior accepted browser results cannot certify this new commit.
4. `devenv shell -- just measure --class check -- just check --concurrency=1` and `devenv shell -- just measure --class test -- just test --concurrency=1`, one job at a time. `just check` must include generated HTTP/OpenAPI/SDK, type-aware Effect lint, source safety, construct/guides/layout/exception checks; regenerate any checked-in derived pages through their own recipe. A partial package pass does not make a failed aggregate green.

Measure the same bounded contract/backend/domain/SQL/Foldkit/proxy/homepage responsibilities before and after on explicit source revisions with physical `wc -l`. Add authored adapter and `.effx.ts` lines to maintained after-state; count generated contract/handler TypeScript and whole OpenAPI/SDK projections **separately**. A positive maintained-line delta is descriptive, not a rejection gate. Record any remaining unverified browser, provider, lost-response and production boundary. Keep the operator-owned mono-web main checkout read-only and the accepted integration branch unlanded unless the operator separately authorizes a landing (`docs/specs/0004-monoweb-migration-plan.md:305-327`; mono-web `AGENTS.md`).

## Operator approval and repair-first prerequisites

The operator approved the **eight-endpoint single-group Content boundary**, mixed access with **endpoint-local** staff/public credentials, dense `.in(ContentGroup)` source, and the corrected nonempty `/dashboard/content` plus native `/api/content*` ledger in the named journey. Before any Content `.effx.ts` cutover commit, make **three independent repair commit pairs** on the same mono-web integration branch, each with a focused real-PostgreSQL/backend test **committed red and observed** before a separate minimal fix commit. If a test does not go red, record the observation and leave its source unchanged. Adapt only the necessary Content-specific idea from unmerged `fix/content-teams-review-0926`, with attribution in each fix commit message; do not merge/copy the branch.

1. **Workspace visibility:** a scoped editor of department A must not receive another department's published _working copy_, including an unreleased revision. Keep legitimate publisher/global administrator and own-draft projections. Test the real `ContentManagement.readWorkspace`/PostgreSQL path; change only the owning SQL projection if red.
2. **Public ETag:** change only article department links in PostgreSQL. An anonymous conditional GET for listing and detail with the old ETag must return **200 with a new ETag and changed department IDs**, not 304; unchanged bytes can return 304. Derive the validator from the strictly encoded representation only if red. Preserve Profile/Schools/SocialEvents ETags byte-for-byte for the same inputs; do not widen shared `conditionalJson` unless the source proves that necessary.
3. **Slug bounds:** create two articles whose long transliterated titles collide at the 255-character slug constraint. A real PostgreSQL test must require distinct valid slugs and atomic receipt/audit behavior. Bound normalization and reserve suffix room only if red; keep short-title behavior.

Record each repair and its enforcement in mono-web `STATE.md` under its Construction-over-trust policy after red→green. The unmerged journal/uncertain-write UI and homepage error mapping stay outside this Content parity migration; record that future contract alongside the SocialEvents lost-response item in effx `STATE.md`. `monoweb-gap` separately checks the `:articleId:publish` compiler route concern with a real fixture. If a clean compiler fix lands, re-vendor its pinned pack **before** writing Content declarations; otherwise route the actual diagnostic from approved complete Content source, not this source-only prediction. After all three repair decisions, run the original named journey, regressions and full checks above at **one clean Content cutover commit**. No production or operator-main action is approved.

## Reproduced compiler prerequisite (2026-10-03)

`monoweb-gap` ran a real Effect rc.116 fixture with the exact `POST /api/content/articles/:articleId:publish` and `:unpublish` paths and exported `{ articleId }` params. The original effx check emitted **two `EFFX2402` errors**; native HttpApi accepted both routes with the one `articleId` parameter. The fixture-backed compiler repair is effx `f3c6bf8ae6205b9b60a449d01faed63744beb765` (`packages/compiler/src/extensions/http-contract.ts:164-191,285-304`). Mono-web re-vendored the exact f3c pack at `8dd959a9 (unpublished)`, after the three repair pairs and before `content.effx.ts` at `19d0c28d (unpublished)`. Both strict unified four-group project checks then exited 0 with only the known TypeScript-version warning `EFFX0001`, and one emit generated **all eight** Content endpoints, including both unchanged suffix routes. No fake route name, param alias, compiler diagnostic suppression or branch merge was needed. This observation closes the earlier source-only prediction; it does not replace the named browser/full-suite acceptance gates above.
