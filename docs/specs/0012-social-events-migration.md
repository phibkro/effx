# Spec 0012 — SocialEvents migration, Gate 4

Status: **approved design; implementation and acceptance pending**. This does not authorize branch integration, deployment, credentials, or production cutover. Mono-web source inspected at clean `effx/profile-baseline` commit `188f2385da419af3b4cbf60bcf4c9ccb5768c136 (unpublished)`; effx source at `258e12b33d044ac20fa2a9ab1042630d1472c710` (2026-10-03). Paths without a prefix below are relative to mono-web. The source inventory and unmerged-branch comparison are static inspections, **not** exercised tests of this design. This is the next bounded context after the accepted Schools/People Gate 4 migration in `docs/specs/0011-schools-migration.md` and `docs/research/schools-slice-evidence.md`; spec 0004 §4–6 still defines the overall migration boundary. Operator approval freezes exactly three existing endpoints and the Foldkit screen; lost-response recovery and GET-by-ID need a separate future product contract.

## Outcome and bounded cutover

An authenticated member opens `/dashboard/arrangementer`, sees only current-authority departments and canonical semesters, selects one scope, sees its ordered events, creates a team event, and sees the new row after a server-backed reload. The native backend still resolves credentials and Organization authority and writes real PostgreSQL events, command receipts, audit rows, and HTTP response receipts; the dashboard still uses its one Foldkit Model and generated SDK. The change moves **exactly the three existing SocialEvents endpoint declarations and their raw backend bindings** into the one effx source/IR/output set shared with Profile and Directory. It does not generate or rewrite domain rules, SQL, Better Auth, receipt execution, or Foldkit behavior (`packages/http-api/src/social-events.ts:74-156`; `apps/backend/src/social-events/http.ts:246-403`; `apps/dashboard/app/foldkit/social-events/{model,command,update,view,bridge,browser-client,main,elements}.ts`).

| Operation and wire                                                         | Schema and successful response                                                                                                                                                                                                                                                                                            | AccessSpec and declared problems                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `social-events.readScope`: `GET /api/social-events/scope`                  | No query, payload, or endpoint request header schema. `SocialEventScopeResource` returns the authorized departments and canonical semesters with `observedAt`. HTTP 200 JSON, private/no-store and `Vary: Origin`; **no ETag or 304**.                                                                                    | `PersonSecurity`; `social-events.read-scope`, resolver `social-events.scope`, `SnapshotRead`. Codes: `request.malformed`, `header.malformed`, `authority.denied`, `origin.denied`, `internal.error`, `dependency.unavailable`, `organization.unavailable`.                                                                                                                                                                                                                                                        |
| `social-events.list`: `GET /api/social-events?departmentId=…&semesterId=…` | **Both** typed fields from `SocialEventScope.fields` are required; the handler permits exactly these two query keys and no duplicates. No endpoint payload or request-header schema. `SocialEventListResource` has `observedAt`, scope, ordered events. HTTP 200, same private/no-store response headers and no ETag/304. | `PersonSecurity`; `social-events.read`, resolver `social-events.list`, `SnapshotRead`. Same read-scope codes **plus `scope.invalid`**.                                                                                                                                                                                                                                                                                                                                                                            |
| `social-events.create`: `POST /api/social-events`                          | Required `Idempotency-Key` and JSON `CreateSocialEventRequest`; typed audience, department/semester, title, nullable description/link, and ordered RFC 3339 event times. `SocialEventResource` at **201** with `Cache-Control: no-store`, `Vary: Origin`, strong `ETag`, origin-relative `Location`; no `If-Match`.       | `PersonSecurity`; `social-events.create`, resolver `social-events.create`, `Transaction`. Codes: `request.malformed`, `header.malformed`, `authority.denied`, `origin.denied`, `idempotency-key.invalid`, `idempotency.in-flight`, `idempotency.digest-conflict`, `idempotency.response-expired`, `request.too-large`, `media-type.unsupported`, `validation.failed`, `scope.invalid`, `internal.error`, `dependency.unavailable`, `organization.unavailable`, `idempotency.unavailable`, `transaction.conflict`. |

These are the actual local endpoint problem unions, not hypothetical statuses: `packages/http-api/src/social-events.ts:33-72`. Problem bodies/status/`Retry-After` belong to `NativeProblemRegistry`, not new SocialEvents status tables (`packages/http-api/src/http-semantics.ts`; `apps/backend/src/http-api/problem.ts`). Each endpoint also admits existing middleware 401 credential failures. `personNativeAccess` supplies external exposure, either Better Auth cookie **or** delegated person OAuth user bearer, Person principal, its one capability, no additional requirements, Reveal concealment and the listed resolver/decision time; preserve exact `operationAnnotations` summary/description and group OpenAPI title `Social events` and description `Department and semester scoped team social events.` (`packages/http-api/src/access.ts:71-104`; `packages/http-api/src/social-events.ts:74-156`). There is **no fourth `readEvent` endpoint** in this frozen surface.

## Execution and browser ownership that must not move into generated code

- **Read and authority.** Both GETs establish `observedAt` at the first SQL snapshot and resolve current credential and Organization grants inside one repeatable-read, read-only transaction. Scope comes from active global-administrator or active Organization team membership; list filters the authorized department and canonical semester, ordered by `start_at`, then `event_id`. The browser's selected scope is not authority. Inactive/unaffiliated persons have no grant. Existing `AssistantsAndTeamMembers` audience does **not** itself grant assistant-only access, and list does not filter its rows by audience; do not silently change that business rule, semester-window validation, or unknown-scope concealment while moving declarations (`apps/backend/src/social-events/http.ts:175-306`; `packages/domain/src/social-events/authority.ts:23-128`; `packages/database/src/social-events/postgres.ts:108-147,200-278`; `packages/domain/src/social-events/schema.ts:39-88`).
- **Create and replay.** The backend rejects malformed/oversized input and canonicalizes typed request data; a serializable transaction resolves credential and Organization authority, authorizes selected department, validates database scope, then executes the existing HTTP identity-lock/receipt path. Domain `SocialEvents.create` and SQL insert the event at revision zero, immutable domain command receipt and audit together; the HTTP response capsule is committed in that transaction. A replay first rechecks **current** credential/authority, then returns the same stored 201 response bytes/headers for the same actor, operation, target, key and body; changed digest, in-flight key and expired 24-hour capsule retain their distinct problems. The generic HTTP receipt identity lock exists, but there is no separate SocialEvents domain replay/authorization lock; do not claim either absent globally or newly generated (`apps/backend/src/social-events/http.ts:301-403`; `apps/backend/src/http-api/receipt-transaction.ts:205-325`; `packages/database/src/social-events/postgres.ts:281-395`; `packages/database/migrations/0043-native-social-event-creation.sql:1-136`).
- **Browser and lifetime.** `/dashboard/arrangementer` mounts the existing Foldkit element. Its one Model owns scope/list/draft/request IDs/create states; its three Commands load scope, list, create. The same-origin `/dashboard/social-events` bridge owns session checks, generated SDK calls, strict response decoding and native-problem translation. Scope changes reload and stale request IDs cannot replace current state. Successful create reloads the **server list**, not a guessed local row; mounting embeds a runtime and disconnect disposes it. Preserve keyboard, focusable scroll, mobile layout, text labels and half-open seven-day status boundary (`apps/dashboard/app/routes/{dashboard.arrangementer._index,__foldkit.social-events}.tsx`; `apps/dashboard/app/foldkit/social-events/{model,command,update,view,bridge,browser-client,elements,main}.ts`).

The existing `just e2e social-events` dispatches to `bun run --cwd apps/dashboard e2e:real-social-events` / `bun e2e/run-real-native-social-events.mjs`: disposable PostgreSQL, native backend, generated SDK, production dashboard, real Better Auth and Chromium. Preserve its exact 201 headers, two audiences, null/empty formatting, post-then-collection-GET, deterministic ordering and time labels, identical-key replay, concurrent 409 with `Retry-After: 1`, changed-body conflict, expired-receipt denial, invalid-time 422, cross-scope and inactive denial, current-authority revocation on reads/create/replay, repeatable-read snapshot, SQL row/receipt/audit counts and immutability, accessibility/keyboard/overflow and clean resource disposal (`justfile:139-149`; `apps/dashboard/e2e/run-real-native-social-events.mjs:455-974,977-1167`). Its `postThenGet` is a **collection GET**, not a GET of `Location` (`run-real-native-social-events.mjs:554-574,949-953`). No tests were run for this proposal.

## Unmerged lost-response branch: information, not the implementation plan

At survey time `fix/content-teams-review-0926` tip `08835acd6a35eeed5bc69e77465bb86518dac855 (unpublished)` was **unmerged**. Inspection used `git diff main...fix/content-teams-review-0926` and `git show` without checkout or edits. The branch prototypes **fourth** `GET /api/social-events/:eventId` contract/service/SQL/handler, `resource.not-found`, and focused same-/foreign-department tests; it first reads the event in a snapshot then authorizes using its stored department. An existing foreign-department ID is 403, a missing ID is 404: that disclosure order needs a separate explicit decision (`fix/content-teams-review-0926:packages/http-api/src/social-events.ts:54-64,136-163`; `:apps/backend/src/social-events/http.ts:296-317`; `:apps/backend/src/social-events/http.test.ts:95-137`). Its `readEvent` is not needed to generate the three existing operations.

The same branch prototypes a per-person, tab-session journal written before create, restoration after reload, and an explicit confirm/retry with the **same key and canonical payload** after a proxy observes an upstream 201 but drops the browser response (`git diff main...fix/content-teams-review-0926 -- apps/dashboard/app/foldkit/social-events/{model,update,command,bridge,browser-client}.ts apps/dashboard/e2e/run-real-native-social-events.mjs`). Current Model increments command sequence and releases pending create on failure; a reload creates a new seed and retains no submitted key, so the UI's generic “try again” can submit a **new** command after an ambiguous commit. That is a source-derived risk, **not** a reproduced current failure. An exact POST replay can confirm the result while the 24-hour capsule survives, subject to fresh authorization; after expiry the server returns `idempotency.response-expired` rather than recreating the event. Crucially, the proposed GET-by-ID cannot recover an **entirely lost** POST response when `Location`/server-issued random `eventId` was never received; it only rereads a known ID (`apps/backend/src/social-events/http.ts:352-372`; `apps/backend/src/http-api/receipt-transaction.ts:226-235,289-294`). The branch also changes event label behavior. **Do not merge, copy its fourth operation/labels/journal, or call this Gate 4 migration “lost-response recovery”.** Decide that product behavior separately with an explicit whole-response-loss journey if authorized; preserve the three-operation parity scope here.

Static execution concern independent of effx: `packages/database/src/social-events/postgres.ts:391-394` turns a create `SqlError` into a `SocialEventPersistenceError` with string-only message, but `apps/backend/src/http-api/receipt-transaction.ts:56-78,311-325` discovers retryable SQL races by `SqlError` or its recursive cause. **[INFERENCE]** A create-side serialization/unique SQL race may miss the documented one retry and map to `dependency.unavailable`; generic receipt SQL failures can still retry. This was not exercised. Do not attribute it to code generation or claim a pass; an approved separate fault/race test and source fix should decide whether current behavior is broken.

## Proposed legal effx source, side by side with existing contract

The current canonical declaration is ordinary native Effect, not a mock handler (`packages/http-api/src/social-events.ts:102-145`):

```ts
export const ListSocialEventsEndpoint = HttpApiEndpoint.get("list", "/api/social-events", {
  query: SocialEventScope.fields,
  success: privateReadResponse(SocialEventListResource),
  error: endpointProblemResponses(SocialEventsListProblem),
}).middleware(PersonSecurity);

export const CreateSocialEventEndpoint = HttpApiEndpoint.post("create", "/api/social-events", {
  headers: IdempotencyHeaders,
  payload: CreateSocialEventRequest,
  success: createdMutationResponse(SocialEventResource.pipe(HttpApiSchema.status(201))),
  error: endpointProblemResponses(SocialEventsCreateProblem),
}).middleware(PersonSecurity);
```

These excerpts omit the source's `annotateAccessSpec` and `operationAnnotations` chains; migrate those too. Reuse the accepted Schools **declaration-only builder** form: one exported group in `packages/http-api/src/social-events.effx.ts`, three exported `.declare()` operations, no `.handler()`, dummy static methods or backend import. Example source below is **proposed**, not committed or compiled:

```ts
export const SocialEventsGroup = Http.group({
  root: ExternalNativeApi,
  group: "social-events",
  title: "Social events",
  description: "Department and semester scoped team social events.",
});

export const ListSocialEvents = Operation.query({
  name: "social-events.list",
  input: SocialEventScope,
  success: SocialEventListResource,
})
  .http.get("/api/social-events")
  .http.contract({
    root: "external-native-api",
    group: "social-events",
    query: SocialEventScopeQuery,
    success: SocialEventListResource,
    status: 200,
    responseHeaders: PrivateReadResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      operationId: "social-events.list",
      summary: "List social events",
      description: "Returns social events in one authorized department and semester scope.",
      annotator: nativeOperationAnnotations,
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "SocialEventsListProblem",
    codes: SocialEventsListCodes,
  })
  .http.access({
    annotator: socialEventsAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "social-events.read" },
    requirements: [],
    canonicalScopeResolver: SocialEventsListResolver,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead",
  })
  .declare();

export const CreateSocialEvent = Operation.command({
  name: "social-events.create",
  input: CreateSocialEventRequest,
  success: SocialEventResource,
})
  .http.post("/api/social-events")
  .http.contract({
    root: "external-native-api",
    group: "social-events",
    headers: IdempotencyHeaders,
    payload: CreateSocialEventRequest,
    success: SocialEventResource,
    status: 201,
    responseHeaders: CreatedMutationResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      operationId: "social-events.create",
      summary: "Create social event",
      description: "Creates or replays one social event command.",
      annotator: nativeOperationAnnotations,
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "SocialEventsCreateProblem",
    codes: SocialEventsCreateCodes,
  })
  .http.access({
    annotator: socialEventsAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "social-events.create" },
    requirements: [],
    canonicalScopeResolver: SocialEventsCreateResolver,
    concealment: { _tag: "Reveal" },
    decisionTime: "Transaction",
  })
  .declare();
```

`ReadSocialEventScope` follows exactly that query builder with an exported empty input schema, no `.http.contract.query`, `SocialEventScopeResource`, `PrivateReadResponseHeaders`, `SocialEventsReadScopeCodes`, operation ID `social-events.readScope`, `social-events.read-scope`/`social-events.scope` and `SnapshotRead`. Export `SocialEventScopeQuery` from the existing `SocialEventScope.fields` once, then use that same schema in the builder and generated contract; preserve the current strict query boundary (`packages/domain/src/social-events/schema.ts`; `apps/backend/src/social-events/http.ts:119-137`). The `CreatedMutationResponseHeaders` export is an extraction of **the existing** `createdMutationResponse` headers (`...externalHeaders(NoStore), etag: StrongETag, location: OriginRelativeLocation`), not a second divergent declaration (`packages/http-api/src/http-semantics.ts:183-189`). Similarly reuse already-extracted `PrivateReadResponseHeaders` and native operation/problem adapters from the accepted Profile/Schools migration, and export the three local problem-code tuples from `social-events.ts` with unchanged order/identifiers. `socialEventsAccessAnnotations` validates the three exact capability/resolver/decision-time pairs, then derives the existing `personNativeAccess`/`accessSpecAnnotations`; exported typed resolver symbols reference registered IDs, not invented strings. Do **not** broaden Profile's `profile.owner` rule onto SocialEvents. `Http.group`, `.http.contract`, `.http.problems` and `.http.access` are compiler source annotations; runtime authorization still happens in the native handler (`effx/packages/runtime/src`; `effx/packages/compiler/src/generate/http.ts:49-168`; `docs/specs/0011-schools-migration.md:27-154`).

**One project, one emit.** Add `social-events.effx.ts` to the existing Profile+Directory `files` in **both** `packages/http-api/tsconfig.effx.json` and `apps/backend/tsconfig.effx.json`, keep one projectRoot/semantic hash and one backend handler artifact per group. Split-mode output then supplies `SocialEventsApi` and `SocialEventsApiHandlers` plus existing Profile/Directory from the **same** IR; never make three separate project emitters into one output directory (manifest cleanup can remove another group's output). Replace the handwritten SocialEvents group/endpoints and their obsolete import/export sites, and bind every generated raw SocialEvents endpoint to the **existing** implementation. `apps/backend/src/router.ts` remains the composition root; raw binder/access decisions must use the same request-local actor/snapshot, not invent a parallel authorization pass. Keep `SocialEvents` service, PostgreSQL reads/create, SQL migrations and immutable receipts application-owned; the Foldkit screen/bridge continue using the regenerated canonical SDK (`packages/http-api/src/api.ts`; `apps/backend/src/router.ts:210-220`; `apps/backend/src/social-events/http.ts`; `apps/dashboard/app/foldkit/social-events/bridge.ts`; `effx/packages/cli/src/commands.ts:125-180`). No shadow endpoints, aliases, alternate SDK, fake handlers or broadened URI matching.

**Compiler prerequisite (source-proven, not a runtime test failure):** the current effx group exporter uses `identifier("social-events")` which drops the hyphen to `socialevents`, then uppercases only its first letter. Consequently a valid `group: "social-events"` emits `SocialeventsApi`/`SocialeventsApiHandlers`, not the existing public `SocialEventsApi`/`SocialEventsApiHandlers` (`effx/packages/compiler/src/generate/emit.ts:133-138`; `http-contracts.ts:37-47`). An `Http.group` title/display name cannot fix this naming derivation. Before migration, approve a general hyphenated group-to-export-name correction in effx, add a regression for `social-events` alongside existing unhyphenated Profile/Directory, revendor the approved compiler into mono-web, and retain unchanged wire group `social-events` and `social-events.*` operation IDs. Do **not** paper over this by hand-maintaining a re-export alias or declaring a fake second group. This prerequisite needs its own compiler-source verification and generated-output/type checks; none were run for this proposal.

## Falsifiers and approval-bound acceptance

After approval, on a clean committed mono-web source revision with pinned effx distribution, execute **serially** inside its own `devenv shell`, each heavy job under `just measure --class <class> -- <command>`; never run parallel heavy jobs or touch the operator's mono-web `main`. Before browser suites, confirm the runner's required clean committed HEAD. At the **same** commit:

1. Run the existing `just effx-native` recipe (its two `bun x effx build --project <tsconfig.effx.json> --strict-access --emit=<contract|handlers>` invocations), then `bun x effx check --project packages/http-api/tsconfig.effx.json --strict-access --emit=contract` and its backend handlers-project counterpart; compare semantic hashes across Profile, Directory and SocialEvents contract/backend manifests. Regenerate OpenAPI and SDK from the unified source. Assert the whole external operation index remains **107**, with the original **three** SocialEvents operation IDs, and the separate internal receipts operation still brings the total to 108. Compare full OpenAPI/SDK bytes against the same committed pre-cutover baseline where the wire contract is intentionally unchanged; explicitly investigate any delta rather than narrowing to SocialEvents or trusting only typecheck (`justfile:29-33`; `packages/http-api/src/api.ts`; `packages/sdk/native-api-operations.json`; `docs/research/schools-slice-evidence.md`).
2. Add focused source-based contract, adapter, compiler-name, SDK-index and raw-handler tests: three exact paths/methods/group keys, query/request/response schema including 201 Location/ETag, access resolver and decision time, problem codes/status and complete raw binder; also preserve Profile/Directory checks. Add social authority/real-PostgreSQL/HTTP checks of same-snapshot reads, denied scopes, transaction rollback, response replay and revocation. Test any proposed retry repair by an actual SQL race/fault, not by an SDK echo. Use installed `@effect/vitest`/typed test Layers and disposable PostgreSQL (`packages/http-api/test/`; `apps/backend/src/social-events/`; `packages/database/src/social-events/`; `apps/dashboard/app/foldkit/social-events/update.test.ts`).
3. Run `devenv shell -- just measure --class e2e -- just e2e social-events` for the real unmodified browser/API/PostgreSQL journey. Keep its post-then-collection-GET and all denial/concurrency/replay/a11y/immutability assertions above. Then separately run `devenv shell -- just measure --class e2e -- just e2e profile` and `... -- just e2e schools` to detect mixed-group regressions. Source-observed historical passing results do not substitute for this new clean-commit run. An entirely lost POST-response/recovery case requires its **own future approved product contract and real Chromium/proxy-dropped-response journey**, not a claim of this three-endpoint parity suite.
4. Run focused lint/type checks and the full `devenv shell -- just measure --class check -- just check --concurrency=1` and `devenv shell -- just measure --class test -- just test --concurrency=1` (one job at a time). Record per-command exit code, duration/peak RSS from `just measure --report`, source hash and deviations. Update mono-web's intended system/STATE and remove superseded handwritten contract scaffolding only **after** the same complete journey passes; record source LOC deltas as description, not rejection of regenerated TypeScript (`AGENTS.md#verification-and-resources`; `docs/specs/0004-monoweb-migration-plan.md:305-327`).

**Operator decision (2026-10-03):** approved exactly three existing endpoints and the current Foldkit screen. Lost-response recovery and GET-by-ID belong to a separate future product contract, tracked in effx `STATE.md`; do not merge the unapproved branch. The compiler naming prerequisite is delegated separately. First prove the create-side SQL retry concern with a focused real-PostgreSQL fault/race test: if red, repair cause preservation at the source as its own commit with red→green evidence; if not, record that and do not change the source. No tests, builds, lints, generators, implementation, branch merge or browser journey had been run when this design was first submitted.
