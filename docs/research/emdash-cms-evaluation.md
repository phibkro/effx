# EmDash CMS as a replacement for mono-web's hand-rolled CMS and editable-content UI

Research and recommendation only. Nothing was migrated, deployed or registered; no Cloudflare API was called. Researched 2026-10-04.

## Pins

| Subject | Revision read | Evidence |
| --- | --- | --- |
| EmDash | `emdash@1.1.0` = commit `913cb1bb9b7f08c3ff0d258b4420e53835b6a58e` (tagged 2026-10-01); npm `latest` is `1.1.0` | [S1], [S2] |
| EmDash `main` (activity only) | `4c5aa726a2d858f125109d7727af34d645c5b874`, 2026-10-03 | [S2] |
| mono-web | clean integration revision `8152c389 (unpublished)`, read-only; every path is `mw/<repo-relative>` | `mw/AGENTS.md`, `mw/README.md`, `mw/docs/system.md`, `mw/docs/architecture.md`, `mw/STATE.md` |
| effx authority | `docs/specs/0014-content-migration.md`, `docs/research/content-slice-evidence.md` | this repository |

Citation form: `[Sn]` is a primary source from the list at the end; `mw/<path>:<line>` is mono-web at `8152c389 (unpublished)`. Line counts are physical `wc -l` over `git ls-files`. A claim I could not verify from a primary source is tagged **[UNVERIFIED]** or **[ESTIMATE]** and collected in the last section.

## Verdict in one screen

**Don't adopt** EmDash as a replacement for the Content context, and don't use it for email templates. One narrower use (public page copy) is defensible but not yet worth a third service.

```text
 surface                                      EmDash fit            recommendation
 -------------------------------------------  --------------------  ---------------------------------
 department-scoped articles + staff workspace blocked by authz      keep hand-rolled
 public news read (ETag, pinned versions)     partial (no ETag)     keep hand-rolled
 email templates (outcome mail, coming)       wrong shape           typed domain data, closed placeholders
 team pages, contact, schools directory       not content           keep (they are facts / a relay)
 static copy: om-oss, foreldre, skoler, FAQ   good fit              only if edit frequency justifies a service
 sponsors / department blurbs / media         good fit              same; native PageText is the alternative
```

Why, in three lines:

1. The only large removable code (about 6.8k of 7.3k maintained lines) is the department-scoped article lifecycle, and EmDash has no way to express or enforce department scope: five global roles, ownership only, no read-filter hook, and three lifecycle actions with no guard hook.
2. EmDash needs its own user table. mono-web's identity can reach it only through Cloudflare Access or a custom auth provider, and the Cloudflare-hosted path is exclusive in production.
3. mono-web's articles are not a cutover gate (`mw/STATE.md:275`), nothing runs in production, and the surfaces EmDash fits (about 470 lines of hardcoded Norwegian copy) are not database-driven today. A third service, second identity store and second backup chain buy little for that.

## 1. What EmDash is

### 1.1 Ownership, licence, maturity

| Question | Answer | Source |
| --- | --- | --- |
| Official Cloudflare? | Yes in substance. The licence names "Copyright 2026 Cloudflare Inc."; the 1.0 announcement is on the Cloudflare Blog, written by Cloudflare staff, and says Cloudflare migrated its own blog to it. The GitHub repository sits in the org `emdash-cms`, not `cloudflare`. | [S4], [S3], [S2] |
| Licence | MIT, copyright Cloudflare Inc. | [S1], [S2], [S4] |
| First release | npm `0.0.1` on 2026-04-01; repository created the same day. | [S1], [S2] |
| Stable | First stable line is `1.0.1` (2026-09-28, after `1.0.1-rc.0/.1`); `1.1.0` followed on 2026-10-01. | [S1] |
| Cadence | 60 npm releases between 2026-04-01 and 2026-10-01, 13 of them since 2026-09-01. | [S1] |
| Contributors | GitHub's contributor count (including anonymous) is about 203; the blog says more than 175 people and more than 1,800 commits, with two named maintainers. | [S2], [S3] |
| Open work | 189 open issues and 189 open pull requests on 2026-10-04. | [S2] |
| Security policy | `SECURITY.md` at the `1.1.0` tag still says "EmDash is a beta CMS" and "currently in beta preview", although the same week's blog calls 1.0 stable. Private vulnerability reporting through GitHub. | [S23], [S3] |

### 1.2 Architecture

- **Runtime.** An Astro integration. The public site and the admin "are parts of one deployed application rather than a frontend and a separate CMS service". Server output is required; the admin is a React app served at `/_emdash/admin/`. [S6], [S29]
- **Where it runs.** Cloudflare Workers with D1 (or Hyperdrive to an existing PostgreSQL, or a Durable Object SQL adapter, `@emdash-cms/cloudflare/db/do`), R2 and optional KV object cache; or any Node.js server (`engines.node >=22.16`) with SQLite, libSQL or PostgreSQL, and local or S3 storage. Astro `>=6` is a peer dependency. [S1], [S5], [S11], [S32]
- **Data model.** Collections and fields defined in the admin or a seed file, stored as SQL tables per collection (`ec_<collection>`), with field types including `string`, `text`, `slug`, `portableText`, `image`, `file`, `reference`, `select`, `repeater`, `blocks`, `json`. Each entry has `status` (`draft`, `scheduled`, `published`), `authorId`, `locale`, `translationGroup`, revision pointers. Rich text is Portable Text JSON, not HTML. [S6], [S10], [S8]
- **Editor.** TipTap/ProseMirror-based rich-text editor, form generated from the collection, media picker, revisions, per-collection edit locks (seven-minute lease), scheduling, signed preview URLs. [S29], [S1], [S14]
- **Plugin model.** Two formats. Native plugins run in-process with full runtime access. Sandboxed plugins run in a Dynamic Worker on Cloudflare (needs the Workers Paid plan and a `worker_loaders` binding) or in a `workerd` child process on Node, limited to declared capabilities; on Node only wall-time is enforced. A decentralised AT-Protocol plugin registry launched with 1.0. [S12], [S3]

### 1.3 Auth and roles

- Login methods: passkeys (default, WebAuthn), magic link (needs email), GitHub, Google, Microsoft, Atmosphere (AT Protocol) providers, and Cloudflare Access as a separate exclusive production mode. A custom login method is an `AuthProviderDescriptor`. The docs list no generic OIDC provider. [S7]
- Five global roles on one integer scale: Subscriber 10, Contributor 20, Author 30, Editor 40, Admin 50. Permissions are a flat map from permission to minimum role level; ownership adds only `*_own` versus `*_any`. There are no custom roles, no per-collection or per-term permissions. [S7], [S16]
- Personal access tokens (`ec_pat_`) and OAuth tokens carry scopes (`content:read`, `content:write`, `media:*`, `schema:*`, `settings:*`, `transfer:*`, `admin`); a scope never exceeds the owning user's role. [S24]

### 1.4 i18n

- **Admin UI.** `nb` (Norsk bokmål) is registered and `enabled: true`. My parse of its gettext catalogue finds 1,514 of 3,184 messages translated (47.6%), against 100% for English and 96.4% for German; untranslated strings fall back to English. The project's rule is that every translation must be reviewed by a fluent speaker. [S18], [S31]
- **Content.** Row-per-locale entries linked by `translation_group`, each with its own slug, status and revisions; fallback chain from the Astro `i18n` config; per-locale menus and taxonomies. A single-language Norwegian site needs no `i18n` block at all. [S10]

### 1.5 API surface

- REST under `/_emdash/api/`, with a generated OpenAPI 3.1 document at `GET /_emdash/api/openapi.json`. The spike returned 103 paths. [S9], spike
- A TypeScript client class `EmDashClient` (`emdash/client`), a CLI (`em`, `emdash`) and an MCP server at `/_emdash/api/mcp`. [S25], [S1], [S24]
- No GraphQL: neither the README nor the documentation mentions it. [S5], [S9]
- **Webhooks.** Not a core feature. A sandboxed plugin `@emdash-cms/plugin-webhook-notifier` exists (`0.2.2` in the repository). [S30]
- **Preview and drafts.** Revision-enabled collections keep a live and a draft revision; HMAC-SHA256 signed `_preview` URLs make `getEmDashEntry()` return the draft. Preview is an in-process middleware feature of the Astro site. [S8], [S14]
- **Concurrency.** `PUT /content/{collection}/{id}` takes an optional `_rev`; omitting it makes the write unconditional. There is no `Idempotency-Key`. [S8], [S9]
- **Published reads need a credential.** The auth middleware's public list contains setup, login, comments, media files, search and snapshot, but not `/_emdash/api/content/*`. [S17]

### 1.6 Self-hosting outside Cloudflare

Supported: Node.js server with SQLite (single process, persistent disk, WAL), libSQL, or PostgreSQL (several processes), plus local disk or S3-compatible storage. The scaffolder takes `--platform node`. [S11], [S28]

## 2. mono-web: what is deployed where

| Fact | Source |
| --- | --- |
| Production runs the legacy PHP application; native replacement is not authorized or rehearsed. | `mw/STATE.md:9` |
| Operator decisions: the backend is a portable Bun process with PostgreSQL, not a Cloudflare Worker; DigitalOcean is the selected host, with provisioning deferred; hosted Supabase runs PostgreSQL 17. | `mw/STATE.md:15-21` |
| "Nothing runs in production; every database is disposable." | `mw/STATE.md:24` |
| "There is no Cloudflare Worker backend composition." The R2 receipt adapter and Cloudflare mail adapter are unselected provider adapters. | `mw/docs/architecture.md:355-357` |
| Homepage and dashboard have Worker entry points and per-PR preview Workers; the previews have no backend. | `mw/docs/architecture.md:360-364`, `mw/apps/homepage/wrangler.jsonc`, `mw/STATE.md:155-156` |
| Homepage is React Router; it reads the backend through the generated SDK. | `mw/apps/homepage/src/lib/team-directory.server.ts`, `mw/apps/homepage/src/lib/news.server.ts` |
| Articles, changelogs, events, surveys and certificates "are not default cutover gates". | `mw/STATE.md:275` |

So the native stack today is Bun, PostgreSQL, Better Auth, Effect HTTP with an effx-generated contract, Foldkit dashboard and a Workers-hosted public site. Nothing of it is on Cloudflare D1, R2 or KV.

## 3. Surface-area coverage

### 3.1 The Content context, measured

Bounded set: authoring/admin UI and content backend only. Physical lines, non-test.

| Layer | Files | Lines |
| --- | --- | ---: |
| HTTP contract | `mw/packages/http-api/src/content.effx.ts` 316, `content-effx-adapters.ts` 163, `content.ts` 116 | 595 |
| Backend HTTP | `mw/apps/backend/src/content/*.ts` (8 files; commands 470, reads 274) | 1,258 |
| Domain | `mw/packages/domain/src/content/*.ts` (9 files; schema 445, projection 211, sanitize 175, actor 150) | 1,297 |
| Database | `mw/packages/database/src/content/*.ts` (`postgres.ts` 1,440, `news.ts` 307) plus `mw/packages/database/migrations/0020-content-publication.sql` 119 | 1,951 |
| Foldkit staff workspace | `mw/apps/dashboard/app/foldkit/content/*` (11 files incl. 304 lines of CSS) | 1,584 |
| Dashboard bridge | `mw/apps/dashboard/app/routes/__foldkit.content.ts` 242, `dashboard.artikler._index.tsx` 13 | 255 |
| Homepage news | `mw/apps/homepage/src/routes/nyheter.tsx` 88, `nyhet.$slug.tsx` 76, `lib/news.ts` 95, `lib/news.server.ts` 115 | 374 |
| **Total maintained** | | **7,314** |
| Tests (unit and PostgreSQL) | domain 343, database 1,007, backend 719, Foldkit 838, other 713 | 3,620 |
| Browser journey | `mw/apps/dashboard/e2e/native-content-publication*`, `run-real-native-content-publication.mjs` | 1,488 |

`docs/research/content-slice-evidence.md` reports 6,921 maintained lines for a slightly different selection at an earlier revision; this table adds the migration and the four homepage news files and excludes the generated output.

### 3.2 Surface table

Every user-facing content surface mono-web has, with EmDash coverage: **native** (works as shipped), **config** (collection and field setup, no code), **plugin** (needs custom or third-party plugin code), **none**.

| # | Surface | Routes / files (lines) | EmDash | Notes |
| --- | --- | --- | --- | --- |
| 1 | Staff article workspace: scoped list, create, revise draft, publish, unpublish, sticky flag, department filter | `/dashboard/artikler`; `mw/apps/dashboard/app/foldkit/content/*` 1,584, bridge 255. The editor is a title input and a raw-HTML `<textarea>` (`view.ts:148-154`). | **native** for editing, drafts, publish/unpublish, schedule, revisions, trash, preview, edit lock; **config** for `sticky` (a `boolean` field); **none** for department-scoped visibility and authority (section 4) | EmDash's editor is far richer than a textarea of HTML. The gap is authority, not features. |
| 2 | Article lifecycle commands and staff HTTP (create, revise with merge-patch, publish creates immutable numbered version, unpublish) | contract 595, backend 1,258, domain 1,297, database 1,951 | **native** for the lifecycle; **config** for department links (a multi-valued taxonomy can tag an entry with several departments, but a tag carries no authority); **none** for `Idempotency-Key` receipts, immutable numbered versions, authority over the tags (including organization-wide articles) and authority rechecked in the writing transaction | EmDash keeps one live and one draft revision per entry; its migration `059` introduces a keep-count of 50 for revisions. [S21] |
| 3 | Public news: `/nyheter`, `/nyhet/:slug?versjon=N`, homepage teaser on `/` | homepage 374 lines; backend `GET /api/news`, `/api/news/:slug` with strong content-hash ETags and 304; `mw/packages/database/src/content/news.ts` 307 | **native** for published reads inside Astro; **partial** headless: published reads need a token and the spike saw `cache-control: private, no-store` with no `ETag`; **none** for pinned old versions | Details in section 5. |
| 4 | Static public copy: Om oss, For foreldre, For skoler, assistant and team FAQ | `mw/apps/homepage/src/routes/_home.om-oss.tsx`, `_home.foreldre.tsx`, `_home.skoler.tsx`, `src/api/{om-oss,foreldre,faq}.ts`, `components/text-picture-paragraph.tsx` (471 lines); `_home.assistenter.tsx` 261 mixes FAQ with the application form | **native/config**: `pages` and `faq` collections with `portableText` and `repeater` fields | Not database-driven today; `api/om-oss.ts` carries "TODO: This data should be fetched from backend later". This is EmDash's best fit. |
| 5 | Sponsors, department blurbs, footer statistics | `mw/apps/homepage/src/lib/dev-content.ts` 221, `src/api/sponsor.ts` 13; the home page prints a "DEV CONTENT" banner (`_home._index.tsx:43`) | **native/config**: collection plus media field | `PageText` and `SponsorPresentation` are modelled in `mw/docs/model/contexts.cml:1931-1949` but no code implements them. |
| 6 | Team pages and team applications | `/team`, `/team/:department`, `/team/:teamId/soknad`; `lib/team-directory*.ts`, `components/team-tabs.tsx`, routes (394) | **none**, and it should stay none | Built from Organization facts (departments, teams, intake state) through the SDK, not editorial text. |
| 7 | Contact page and department contact | `/kontakt`, `/kontakt/:department`; 500 homepage lines plus `mw/apps/backend/src/contact` 360 | **none** | An anonymous per-address quota relay to a department mailbox; no editable content beyond department contact data from surface 5. |
| 8 | Schools: public "for skoler" page | `_home.skoler.tsx` 138 | **native/config** (same as surface 4) | The dashboard school directory, capacity and dated service are domain data and out of scope. |
| 9 | Email templates | literals in `mw/packages/domain/src/team-application/notification.ts:73-101`, `mw/apps/backend/src/onboarding/delivery.ts:91-92`, `mw/packages/database/src/password-recovery.ts:456`, `mw/apps/backend/src/contact/http.ts:49`, `mw/apps/backend/src/receipt/delivery.ts`; admission outcome mail is not sent yet (`mw/STATE.md:175`) | **none** | EmDash's email is a delivery pipeline for its own mail. It has no template-with-placeholders model for application mail. Section 5.4. |
| 10 | Media and images | Articles have no images: `hasImage: false` is hard-coded at `mw/packages/domain/src/content/projection.ts:104` and `mw/packages/database/src/content/news.ts:175,296`. Static assets: 1.2 MB under `mw/apps/homepage/public/images`. Receipt files are private custody files (filesystem or R2 adapter), not editorial media. | **native** (media library, folders, usage tracking, signed upload to R2/S3/local) | EmDash would add a capability mono-web does not have. It does not replace anything. |
| 11 | Audit trail, command receipts, in-transaction authority | domain command receipts, immutable version history, HTTP receipts | **none** (partial plugin) | Section 4.3. |

### 3.3 How much hand-rolled code is removable

Counts are measured; the removable split is my classification.

| Scenario | Removable (maintained) | New code needed | Net |
| --- | ---: | --- | --- |
| **A. Replace the Content context with EmDash, keep department scope** | 0 for any layer that carries scope | Plugin guard, authority endpoint, user sync, headless adapter. Not enforceable for reads or for three lifecycle actions (section 4), so the requirement is not met. | Not feasible without dropping a requirement |
| **A′. Same, but drop department scope and receipts** | about 6,790 of 7,314 lines: Foldkit 1,584 + bridge 255, contract 595, backend 1,258, domain 1,147 (all but `actor.ts` 150), database 1,951; plus up to 3,620 test lines and 1,488 browser-journey lines | **[ESTIMATE]** 600-1,200 lines: headless adapter (today's `news.server.ts` + `news.ts` are 210), user and role sync, rewritten journey | about 5,600-6,200 lines gross, and a security regression against `mw/docs/system.md:581-584` |
| **B. EmDash for public copy only (surfaces 4, 5, 8)** | about 0 hand-rolled CMS lines, because nothing editable exists yet; roughly 470 lines of copy become data | Headless adapter, global-admin accounts, one more service | It avoids writing native `PageText` and `SponsorPresentation`. |

**What must stay in every scenario:** the Organization authority projection and `reachedDepartments` (used by every context, not just Content); Better Auth sessions and the OAuth provider; the notification outbox and immutable envelopes; the team directory, contact relay and school administration; the homepage rendering layer; the generated SDK path for mono-web's own operations.

**What must stay if department scope stays:** `mw/packages/domain/src/content/actor.ts` (150 lines) and the database facts it reads. Without them nothing could tell EmDash who may touch which department.

## 4. Auth and authorization fit

### 4.1 Can EmDash accept mono-web's identity?

Not directly. EmDash keeps its own users: it "still stores a local user so roles, ownership, and disabled-user checks continue to work" even in Cloudflare Access mode. [S7] Options, best first:

| Path | What it takes | What goes wrong |
| --- | --- | --- |
| 1. mono-web as OIDC provider, Cloudflare Access in front, EmDash `access()` adapter with `roleMapping` | Better Auth's OAuth provider plugin issues ID tokens and serves OIDC discovery "when you use the `openid` scope" [S27]. mono-web configures only `native-api` and `offline_access` (`mw/packages/database/src/oauth-config.ts:13`), so the change is a configuration decision, not new code **[UNVERIFIED that no other change is needed]**. Access has a generic OIDC connector with custom claims [S26]; EmDash maps IdP groups to roles [S7]. | Needs a Cloudflare Zero Trust tenant and Cloudflare in the request path, which sits uneasily with the operator decision that the backend is not on Cloudflare (`mw/STATE.md:15`). In production Access is exclusive: passkeys, providers, invites and self-signup are off. Roles update only at login (`syncRoles`). Whether the `access()` adapter runs on a Node deployment is **[UNVERIFIED]**; it ships in `@emdash-cms/cloudflare`. |
| 2. Custom `AuthProviderDescriptor` doing OIDC against mono-web | Write and maintain login and callback routes, admin components and a storage collection inside a native plugin. [S7] | New security-critical code on a CMS whose first stable release is 2026-09-28; the Atmosphere package is the documented reference implementation. |
| 3. Separate EmDash accounts (passkeys or GitHub/Google/Microsoft) for a small editorial group | Invite by email; REST lists users and can update, disable and enable them but the inventory has no create. [S9] | A second identity store. Offboarding is two systems: "A disabled or deleted Microsoft account … not an open EmDash session or the passkeys registered in EmDash". [S7] mono-web resolves authority from current facts at each command (`mw/docs/system.md:594-600`), and for interview staffing says removed interviewers "lose assignment-based access on the next authorized interaction" (`mw/docs/system.md:228`). |

### 4.2 Can it express department-scoped editing?

mono-web's rule (`mw/packages/domain/src/content/actor.ts`): authority is a pure function of one Organization projection at one instant. A global administrator, or a holder of `content.publish` for the whole organization, administers all content. A holder of `content.publish` in some departments (board leadership or delegation) publishes and revises any non-organization-wide draft that intersects those departments. Any other active member edits **only their own unpublished drafts, and only if every department of the draft is in the member's active memberships**. Articles carry several departments, and an empty set means organization-wide. The workspace shows an actor only what they may revise (`mw/docs/system.md:581-584`), and a defect that leaked a foreign department's working title was repaired test-first (`mw/STATE.md:85`).

What EmDash offers against that:

| Needed | EmDash | Verdict |
| --- | --- | --- |
| Per-department role | Roles are global integers; `hasPermission` compares `user.role >= Permissions[permission]`. No collection-, term- or field-scoped permission. [S16] | Not expressible. One collection per department does not help: permission is not per collection. One EmDash site per department multiplies operations and still cannot express organization-wide articles. |
| Hide other departments' drafts from an editor | `content:read_drafts` (Contributor and above) exposes drafts, scheduled and trashed entries of every collection; there is no read hook in the hook table. [S7], [S15] | Not expressible. This is exactly the leak class `mw/STATE.md:85` repaired. |
| Block a write by a department rule | `content:beforeSave`, `beforePublish`, `beforeUnpublish`, `beforeSchedule`, `beforeDelete` can cancel; the event carries `actor: { id, role }`. A plugin could call a mono-web authority endpoint (capability `network:request`, `allowedHosts`) with the actor's mapped Person. [S15] | Partly expressible, with three holes below. |
| Guard every lifecycle action | The lifecycle table lists **no before-hook** for "Discard draft" and "Restore a revision" and only an after-hook for "Restore from Trash". [S8] | A scoped editor can discard a draft, restore a revision or restore from trash on another department's article. Verified in the documentation; I did not run the exploit. |
| Map EmDash user to Person | `actor.id` is an EmDash user id; the only shared key is email. | Needs a mapping the CMS does not own, and role sync through `PUT /admin/users/{id}`. |

### 4.3 What is lost compared with today

| Property today | Where it lives | Under EmDash |
| --- | --- | --- |
| Authority resolved inside the committing transaction, never reused across retries | `mw/docs/system.md` authority model; `mw/AGENTS.md` boundary practices | A plugin hook calling mono-web is a network round trip outside any shared transaction. TOCTOU between check and write. |
| Command receipts and `Idempotency-Key` replay; replay rechecks current authority | `docs/specs/0014-content-migration.md` | None. `_rev` is optional on REST and gives conflict detection only. |
| Immutable numbered published versions, `?versjon=N` | `mw/packages/domain/src/content/projection.ts:165` | One live and one draft revision; older ones are revision history behind authentication, with a keep-count of 50 in the prune migration. [S21] The runtime pruning behaviour is **[UNVERIFIED]**. |
| Attributable audit history committed with state | domain history tables | The audit-log plugin records `create`, `update`, `delete`, media upload and delete only, not publish or unpublish, and writes to plugin storage after the fact. [S20] Core `audit_logs` is for security events. |
| Outbox and "provider I/O after commit" | `mw/AGENTS.md` boundary practices | Not applicable to EmDash, but any hook-to-mono-web call is provider I/O in the middle of an EmDash write. |

## 5. Integration shape

### 5.1 Headless or full site

**Headless, if ever adopted.** The homepage is React Router on Workers with typed SDK loaders (`mw/apps/homepage/src/lib/news.server.ts`); making it an Astro application is a rewrite of the public site, not a CMS decision. EmDash is designed for in-process use: Astro pages call `getEmDashCollection()` inside the same deployment [S6]. Headless means the homepage server calls EmDash REST with a read-only token (`content:read` scope on a Subscriber-level user returns published content only [S7], [S24]); a published read without a token returns 401 (spike and [S17]). The homepage therefore holds a long-lived EmDash credential and must cache, because the spike saw `cache-control: private, no-store` on content reads.

### 5.2 How the Effect backend, the SDK and effx relate to it

mono-web's rule is one authoritative contract with derived transports (`mw/AGENTS.md`). The Content group is an effx declaration (`content.effx.ts`) that generates the HTTP contract, handlers, OpenAPI and SDK for **mono-web's own** eight operations, each with an access annotation, capability, resolver and closed problem union (`docs/specs/0014-content-migration.md`).

EmDash is a foreign service with its own OpenAPI 3.1 document. An effx group would describe operations mono-web serves; nothing here is served by mono-web. Recommendation:

- **External context, no effx HTTP group.** A boundary adapter `EmDashContent` (an Effect service returning Effects, per the house decision ladder) that calls the REST API with Effect's HTTP client and decodes the few collections it reads with Schema. Pin the adapter to one EmDash release and test it against that release's `openapi.json`.
- **Typed adapter generated from EmDash's OpenAPI** is possible in principle; I did not evaluate a generator against this document **[UNVERIFIED]**. It is overkill for two or three collections.
- **If a plugin guard were built**, the one part that belongs in effx is the authority question it asks: an internal service-principal operation such as `content.authorizeEmDashWrite`, declared like the other service-principal operations, so the answer comes from the same resolvers and the same Organization projection. mono-web already models a service caller as a separate principal with its own grant (`mw/docs/system.md:663-665`).

### 5.3 Data migration: articles, slugs, ETags

Nothing runs in production and there is no native article data (`mw/STATE.md:24`), so migration cost is near zero today; the legacy PHP database holds the real articles and its import path for Content was not located **[UNVERIFIED]**. If migrated:

| Item | mono-web | EmDash | Consequence |
| --- | --- | --- | --- |
| Body | sanitized HTML (`mw/packages/domain/src/content/sanitize.ts`) | Portable Text; an `htmlBlock` block type exists for raw HTML (`packages/core/src/content/converters/portable-text-identity.ts`) | Either keep HTML in an `htmlBlock` (loses the rich editor's value) or convert HTML to Portable Text (no converter in the repository; only WordPress and Gutenberg importers). |
| Slug | transliterated and server-issued: `Åpent møte på Ås – Ærlig talt!` becomes `apent-mote-pa-as-aerlig-talt` (`projection.ts:175-184`) | Unicode-preserving: the spike produced `åpent-møte-på-ås-ærlig-talt` for the same title [S22], spike | Imported slugs must be set explicitly, and EmDash's own slugging would diverge from the legacy law for every new article. |
| Versions | numbered immutable, public by `?versjon=N` | live plus draft revision | Older public versions would need to become separate entries or be dropped. |
| ETag | strong content-hash ETag, `If-None-Match` 304, `If-Match` 412, public `max-age=60, s-maxage=300` | no HTTP validators; `_rev` is an opaque write-conflict token (the spike decoded it as `version:updatedAt`); stale or malformed `_rev` gives 409 `CONFLICT` | The homepage adapter must derive its own validator. The department-links-only stale-304 defect (`mw/STATE.md:86`) would have to be re-proven against the adapter. |
| Authors | `createdByPersonId` | `authorId` of an EmDash user; bylines are separate records | Persons without EmDash users become guest bylines. |

### 5.4 Email templates

**Keep them as typed domain data with closed placeholders.** EmDash is not a sensible home:

1. mono-web freezes the message at enqueue. The envelope is built inside the command transaction and "queued notifications retain their original content and recipients" (`mw/docs/system.md:232`; `mw/packages/domain/src/team-application/notification.ts:60-101`). A remote CMS read inside that transaction is provider I/O before commit. Templates must be readable from local SQL in the same transaction.
2. Today's mail is plain text (`MailDeliveryRequest.text`, `mw/packages/domain/src/mail.ts`). EmDash's content model is Portable Text with no placeholder concept; its mail is its own delivery pipeline. [S29]
3. Placeholders are a closed set (applicant name, department, semester, school, outcome). Closing them by construction means a template that names an unknown placeholder fails at write time, not at send time. A `Schema` literal union does that; a rich-text field cannot.
4. Maintenance commands in mono-web carry a reason, an observed revision and commit state, history and receipt together (`mw/docs/system.md:230-231`). An editable template belongs in that pattern, under a named capability for the outcome-messaging team.

This is a design recommendation derived from the sources above, not a tested design.

## 6. Risks

| Risk | Assessment |
| --- | --- |
| Cloudflare lock-in | Moderate, and avoidable on Node. Portable abstractions (Kysely, S3 API) work with SQLite, D1, libSQL, PostgreSQL, R2, S3, local disk. But sandboxed plugins, KV cache, Hyperdrive, Access and Durable Object SQL are Cloudflare features; the README says it "runs best on Cloudflare". [S5], [S11], [S12] The one SSO route that fits (section 4.1, path 1) is Cloudflare. |
| Maturity | Young but active: first release 2026-04-01, stable 2026-09-28, 60 releases in six months, 189 open issues, and a security policy that still says beta. Expect upgrades about every three days on average and a migration regime of its own (`deployment/core-migrations`). |
| Security posture | Positives: passkey-first, per-endpoint rate limits, sandboxed plugins, scoped tokens, signed preview, private reporting. Negatives observed: direct dependencies `arctic` and `@oslojs/crypto` are flagged "Package no longer supported" on npm, and `@oslojs/webauthn` appears in `packages/auth`; `SECURITY.md` says beta. `npm audit --omit=dev` on the scaffold reported 0 vulnerabilities (the exit code was masked by a pipe). I did no code audit. [S1], [S23] |
| Backup and export | A JSON export is "for inspection or custom tooling", omits users, tokens, plugin data and media files, and "EmDash does not implement restoring this JSON format"; recovery needs a raw database backup and a separate media copy. A site package transfers content, settings and media but not users or tokens. [S13] `EMDASH_ENCRYPTION_KEY` is outside every backup. |
| Editor accessibility | An automated axe-core WCAG 2.1 AA e2e suite covers admin pages (14 `test(` calls), with `color-contrast` and `aria-valid-attr-value` excluded as upstream design-system issues. I found no manual audit or conformance statement. [S19] mono-web's journeys make "accessibility, mobile layout, keyboard use" part of the contract (`mw/docs/architecture.md:336-337`), and `mw/apps/dashboard/e2e/native-content-publication.spec.ts:207,456` asserts zero axe-core violations for the administrator and author pages of the current workspace. |
| Norwegian editor | Bokmål UI exists but is 47.6% translated by my count. Editors would see mixed English and Norwegian. [S18] |
| Cost | Software is free (MIT). Sandboxed plugins on Cloudflare need the Workers Paid plan. [S12] D1, R2 and Hyperdrive pricing, and any DigitalOcean sizing for an extra Node process and PostgreSQL database, were **not researched**. |
| Operator workload | A third deployable (Astro Node server; scaffold `node_modules` was 725 MB with 673 packages), a second user store, a second backup and restore chain (database dump plus media plus encryption key), passkey domain binding, a headless token to rotate, and frequent upgrades. mono-web's operator model is a single Bun backend with PostgreSQL and a documented recovery guide (`mw/docs/delivery-recovery.md`). |
| Product fit | EmDash assumes the site is Astro and editors work in its admin. "Headless against a React Router app" is the less-trodden path. |

## 7. Spike (throwaway, local, no deploy, no account)

Scratch directory under the system temp location, deleted afterwards (confirmed absent). Node 24.20.0, npm.

| Step | Command | Exit | Observation |
| --- | --- | ---: | --- |
| Scaffold | `npm create emdash@latest my-site -- --template starter --platform node --pm npm --install --yes` | 0 | 673 packages in 54 s (58 s wall); installed `emdash 1.1.0`, `astro 7.3.5`, `@astrojs/node 11.1.6`; starter seed has collections `posts` and `pages`; 10 npm deprecation lines including `arctic` and `@oslojs/*` |
| Serve | `astro dev --port <port> --host 127.0.0.1` (background) | started | `GET /_emdash/api/setup/status` gave 200 with `needsSetup: true` and `authMode: "passkey"` |
| Unauthenticated read | `GET /_emdash/api/content/posts`, `/openapi.json`, `/manifest` | 401 each | `NOT_AUTHENTICATED`; consistent with the public-route list in [S17] |
| Dev-only session | `GET /_emdash/api/auth/dev-bypass` | 200 | Local throwaway admin, role 50 (`/auth/me`); not available in production |
| OpenAPI | `GET /_emdash/api/openapi.json` | 200 | OpenAPI 3.1.0, 103 paths; `info.version` reads `0.1.0`, not the package version |
| Content read | `GET /_emdash/api/content/posts` and `/{id}` | 200 | Envelope `{success,data}`; item has `id,type,slug,status,data,authorId,createdAt,updatedAt,publishedAt,liveRevisionId,draftRevisionId,version,locale,translationGroup,seo,bylines`; `cache-control: private, no-store`; **no `ETag` or `Last-Modified`**; `_rev` present in the detail response |
| Slug | `POST /content/posts` with title `Åpent møte på Ås – Ærlig talt!`, then `POST …/publish` | 201, 200 | Slug `åpent-møte-på-ås-ærlig-talt`, status `published` |
| Concurrency | `PUT /content/posts/{id}` with a bad `_rev` | 409 | `CONFLICT`, "Malformed _rev token" |
| Anonymous after setup | `GET /_emdash/api/content/posts` | 401 | Published content is not anonymously readable over REST |
| Stop and clean | `astro dev stop`, remove scratch directory | not captured (output piped) | Tool printed "Stopped dev server"; no process left on the port; directory absent |

Not exercised: the browser admin (so I did not see the Norwegian UI rendered; the locale facts come from the catalogue), multi-user roles, plugin hooks, Cloudflare targets, Access, PostgreSQL mode, backup and restore.

## 8. Verdict

**Don't adopt EmDash** as a replacement for mono-web's Content context or for email templates. The removable code is real (up to about 6.8k maintained lines and 3.6k test lines for articles), but it is the code that enforces a requirement EmDash cannot express: department-scoped, fact-derived, transactionally rechecked authority with a read-side that never leaks another department's drafts. Adopting it would trade that for a plugin that cannot guard three lifecycle actions and a read path with no filter.

"Adopt for some surfaces" is defensible only for public page copy (about, parents, schools, FAQ, sponsors, department blurbs and a media library), where authority is a handful of global editors and EmDash's editor, preview, revisions and media are a real gain. It is not justified now, because:

- I found no request or evidence in the sources I read that these surfaces need editing, and they are hardcoded today;
- articles and this content are not cutover gates (`mw/STATE.md:275`);
- it adds a service, a user store, a backup chain and an upgrade cadence to a stack whose operator model is one Bun process and one PostgreSQL;
- native `PageText` and `SponsorPresentation` aggregates are already modelled in `mw/docs/model/contexts.cml:1931-1949` and are small beside the 7.3k-line article slice.

### Conditions that would change the verdict

| Condition | Moves to |
| --- | --- |
| EmDash gains scoped permissions or custom roles, a read-filter hook, and a before-hook on every lifecycle action including discard, restore revision and restore from trash | Reopen articles (adopt for articles, behind a plugin that asks mono-web) |
| EmDash documents a generic OIDC login provider that runs without Cloudflare, or mono-web accepts Cloudflare Access in front of the editorial site | Removes the identity blocker |
| Department scope is dropped as a product decision (for example one national editorial team publishes all news) | Scenario A′ becomes legitimate; weigh the 5,600-6,200-line saving against the adapter and the second user store |
| The organization wants non-engineer editing of marketing pages, media-rich pages or a second language, and edit frequency makes native `PageText` look costlier than a service | Adopt for public copy only (scenario B) |
| The homepage moves to Astro on Workers with D1 and R2 | EmDash becomes the default shape rather than an extra service |
| The Norwegian admin catalogue passes a reviewed threshold the editors accept, and an independent accessibility audit of the editor is published | Removes two editor-quality risks |

### Minimal next step if the conditions flip toward scenario B

A one-day throwaway spike, not a migration: EmDash on Node with PostgreSQL, a `pages` and `faq` collection seeded from `mw/apps/homepage/src/api/*.ts`, one global-admin passkey account, a read-only token, and a single homepage loader (`/om-oss`) reading it through an Effect adapter decoded with Schema and cached. Measure: loader latency and cache behaviour, `_rev`-derived validators, Norwegian editor rendering in a browser, and the restore drill from a database dump plus media copy. Accept only if the restore drill passes and the global-admin-only authority is acceptable to the operator.

## 9. Claims not verified from a primary source

- **[UNVERIFIED]** That enabling the `openid` scope in `mw/packages/database/src/oauth-config.ts` is sufficient to make mono-web usable as an OIDC provider for Cloudflare Access. Both vendors' documents describe the features; I did not run the flow.
- **[UNVERIFIED]** That the `access()` adapter from `@emdash-cms/cloudflare` runs on a Node.js deployment.
- **[UNVERIFIED]** The runtime revision-pruning behaviour. I read migration `059` (`REVISION_KEEP_COUNT = 50`), not the pruning job.
- **[UNVERIFIED]** That the three unguarded lifecycle actions (discard draft, restore revision, restore from trash) are exploitable by a department-scoped editor in a plugin-guarded deployment. It follows from the lifecycle table; I ran no multi-user test.
- **[UNVERIFIED]** The 47.6% Norwegian translation figure is from my own parse of the gettext file (3,184 messages, 1,514 non-empty `msgstr`), not from the project's dashboard.
- **[UNVERIFIED]** The GitHub contributor count (about 203) comes from the API's last-page number with `anon=1`; the blog gives "more than 175".
- **[UNVERIFIED]** Whether Bun, rather than Node, runs EmDash; `engines.node` is `>=22.16` and the spike used Node.
- **[UNVERIFIED]** An OpenAPI-driven Effect client generator for EmDash's document; not evaluated.
- **[UNVERIFIED]** The existence and shape of a legacy PHP article import into the native Content context; not located in `mw`.
- **[ESTIMATE]** The 600-1,200 line cost of the integration glue in scenario A′; not measured.
- **Not researched:** D1, R2, Hyperdrive and DigitalOcean pricing; EmDash's behaviour under real multi-editor load; a code-level security audit; whether `npm audit` is clean for the full `1.1.0` dependency tree (only the scaffold's production tree).
- Statements about mono-web describe revision `8152c389 (unpublished)` as read; I did not run its checks or journeys.

## Sources

Base for EmDash repository files: `https://github.com/emdash-cms/emdash/blob/913cb1bb9b7f08c3ff0d258b4420e53835b6a58e/`, abbreviated `E/`.

- **[S1]** npm registry metadata for `emdash`: `https://registry.npmjs.org/emdash` (versions, publish times, licence, `engines`, peer dependencies, dependencies).
- **[S2]** GitHub repository and search API for `emdash-cms/emdash`: `https://api.github.com/repos/emdash-cms/emdash` (created, licence, open counts), `/contributors?per_page=1&anon=1`, `/search/issues`.
- **[S3]** Cloudflare Blog, "EmDash 1.0: the stable CMS with a secure plugin registry", published 2026-09-28: `https://blog.cloudflare.com/emdash-cms-plugin-registry/`.
- **[S4]** `E/LICENSE`.
- **[S5]** `E/README.md`.
- **[S6]** `E/docs/src/content/docs/concepts/architecture.mdx`; also `why-emdash.mdx`.
- **[S7]** `E/docs/src/content/docs/guides/authentication.mdx`.
- **[S8]** `E/docs/src/content/docs/reference/content-lifecycle.mdx`.
- **[S9]** `E/docs/src/content/docs/reference/rest-api.mdx`.
- **[S10]** `E/docs/src/content/docs/guides/internationalization.mdx`.
- **[S11]** `E/docs/src/content/docs/deployment/database.mdx`.
- **[S12]** `E/docs/src/content/docs/deployment/plugin-sandbox.mdx`.
- **[S13]** `E/docs/src/content/docs/guides/backups.mdx`.
- **[S14]** `E/docs/src/content/docs/guides/preview.mdx`.
- **[S15]** `E/docs/src/content/docs/reference/hooks.mdx`.
- **[S16]** `E/packages/auth/src/rbac.ts`.
- **[S17]** `E/packages/core/src/astro/middleware/auth.ts` (lines 94-135, `PUBLIC_API_PREFIXES`, `PUBLIC_API_EXACT`).
- **[S18]** `E/packages/admin/src/locales/locales.ts` and `E/packages/admin/src/locales/nb/messages.po`.
- **[S19]** `E/e2e/tests/accessibility.spec.ts`.
- **[S20]** `E/packages/plugins/audit-log/src/plugin.ts` and `emdash-plugin.jsonc`.
- **[S21]** `E/packages/core/src/database/migrations/059_revision_prune_queue.ts`.
- **[S22]** `E/packages/admin/src/slugify.ts`.
- **[S23]** `E/SECURITY.md`.
- **[S24]** `E/docs/src/content/docs/reference/mcp-server.mdx` (scopes, tokens).
- **[S25]** `E/packages/core/src/client/index.ts`.
- **[S26]** Cloudflare Docs, "Generic OIDC": `https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/generic-oidc/`.
- **[S27]** Better Auth, "OAuth 2.1 Provider": `https://better-auth.com/docs/plugins/oauth-provider`.
- **[S28]** `E/docs/src/content/docs/getting-started.mdx` and `E/packages/create-emdash/src/flags.ts`.
- **[S29]** `E/docs/src/content/docs/concepts/admin-panel.mdx`; `guides/email.mdx`.
- **[S30]** `E/packages/plugins/webhook-notifier/package.json`.
- **[S31]** `E/docs/src/content/docs/contributing/translating.mdx`.
- **[S32]** `E/packages/cloudflare/package.json` (export map: `./db/d1`, `./db/hyperdrive`, `./db/do`).
- **spike** The local scaffold run in section 7 (EmDash `1.1.0`, starter template, Node 24.20.0).
