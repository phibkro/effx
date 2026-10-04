# Spec 0011 — Schools directory and management migration

Status: **operator-approved and accepted locally** at the clean, unlanded mono-web `effx/profile-baseline` commit `188f2385da419af3b4cbf60bcf4c9ccb5768c136 (unpublished)`. This frozen design originally inspected mono-web `dd7a5f399df335b30e630b55586e924f820f73aa (unpublished)` and the vendored effx distribution `17374d6008bbad4894ce38cc64f18808ca8d96ae`; no implementation/tests had run _when the design was proposed_. The operator approved the complete mixed group and the separate real management browser spec before implementation. Exact checks, sizes and remaining boundaries are in [Schools slice evidence](../research/schools-slice-evidence.md). Paths below are relative to mono-web unless prefixed `effx/`. Profile's +159 maintained-line observation and Schools' measured delta are descriptive, **not stop conditions**. Native TypeScript/Effect schema and handler signatures remain the type gate; effx generates readable, single-source HTTP bindings, not a substitute type system.

## Outcome and bounded cutover

An authorized user can browse the existing `/dashboard/skoler` directory and administer partner-school facts, department associations and school/department/semester capacity through the existing Foldkit workflow and generated SDK. One effx declaration emits the **complete `directory` group**; the backend binds its four operations once on the canonical `ExternalNativeApi`. Keep People directory behavior and its independently owned authority, all three Schools operations, Profile, the other API groups and the internal receipts root unchanged in wire meaning. Preserve Schools' domain service, SQL/transactions, receipt handling and UI Model; no schema migration, provider action or deployment belongs to this slice (`packages/http-api/src/directory.ts:99-260`; `packages/http-api/src/api.ts:25-88`; `apps/backend/src/directory/http.ts:225-246`; `docs/system.md:245-263`).

**Approved atomic mixed-group choice:** `directory` has **one People and three Schools endpoints**, not two groups. Native `HttpApi.add` replaces a prior group with the same identifier, and the builder validates that one group handler binds every endpoint. A generated three-School `DirectoryApiHandlers` cannot coexist with a separate People group/layer. The People endpoint is therefore declared too, preserving its exact schema, metadata, handler and authorization; **People domain/UI behavior is not migrated**. This is a four-operation _contract/binding_ cutover for a three-operation Schools _business_ slice. The alternative effx partial-group binder was unnecessary and not added (`node_modules/effect/src/unstable/httpapi/HttpApi.ts:142-153`, `HttpApiBuilder.ts:127-141,393-406`; `effx/packages/compiler/src/generate/http.ts:394-436`; `apps/backend/src/directory/http.ts:225-246` at the pre-migration source).

| Qualified operation                                              | Existing wire contract                                                                                                                                                                                                                                                                                                                                                                                                                 | AccessSpec and failure contract                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `directory.listPeople` — `GET /api/people`                       | No declared query/body/custom headers; `PeopleDirectoryResponse` has `activePeople`, `inactivePeople`, nullable `nextCursor`, with each entry's person/contact, null study programme, departments and activity; 200 JSON with `private, no-store`, `Vary: Origin`; no ETag/304.                                                                                                                                                        | `PersonSecurity`; `profile.read-directory`, `profile.people-directory`, `SnapshotRead`; local problems `request.malformed`, `header.malformed`, `authority.denied`, `origin.denied`, `directory.cursor-malformed`, `internal.error`, `directory.unavailable`, plus 401 middleware credential errors. **People remains authored by People/Organization, not Schools.** (`packages/http-api/src/directory.ts:34-117`; `endpoint-problems.ts:301-310`; `apps/backend/src/directory/http.ts:116-222`.)                                                                                                                                                                                                                                                                    |
| `directory.listSchools` — `GET /api/schools`                     | Optional **one** `department` query using `DepartmentId`; no body/custom headers. Annotated `SchoolDirectorySchema` includes active/inactive school rows, contact, language, visible departments and activity; 200 private/no-store JSON, no ETag/304. Unknown, duplicate or malformed query is rejected before actor resolution.                                                                                                      | `PersonSecurity`; `schools.read-directory`, `schools.directory`, `SnapshotRead`; local problems `request.malformed`, `header.malformed`, `authority.denied`, `origin.denied`, `schools.invalid-department`, `internal.error`, `schools.unavailable`, plus middleware 401. (`packages/http-api/src/directory.ts:119-160`; `endpoint-problems.ts:312-321`; `apps/backend/src/schools/http.ts:89-155`.)                                                                                                                                                                                                                                                                                                                                                                  |
| `directory.readSchoolManagement` — `GET /api/schools/management` | No query/body/custom headers; 200 private/no-store `SchoolManagement` with scoped departments, semesters, schools, capacity plans and history; no ETag/304.                                                                                                                                                                                                                                                                            | `PersonSecurity`; `schools.manage`, `schools.management`, `SnapshotRead`; retains the **same broad declared** `SchoolAdministrationProblem` union as POST, even when a code is write-only in practice. (`packages/http-api/src/directory.ts:170-217`; `packages/domain/src/schools/administration.ts:75-108`.)                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `directory.executeSchoolCommand` — `POST /api/schools/commands`  | Required `Idempotency-Key` (22–128 base64url characters); JSON `SchoolCommand` tagged union: CreateSchool, ReviseSchool, ReplaceSchoolDepartments, CreateCapacity, ReviseCapacity. Every command has `commandId` and reason; edits carry observed revision(s). 200 `SchoolCommandResult` with `no-store`, `Vary: Origin`, strong ETag. **No HTTP If-Match**: command revisions are in the body. The header key must equal `commandId`. | `PersonSecurity`; `schools.manage`, `schools.management`, `Transaction`; retains the broad 20-code `SchoolAdministrationProblem` union: `authority.denied`, `origin.denied`, `request.malformed`, `request.too-large`, `media-type.unsupported`, `header.malformed`, `idempotency-key.invalid`, `idempotency.in-flight`, `idempotency.digest-conflict`, `idempotency.response-expired`, `transaction.conflict`, `resource.not-found`, `precondition.failed`, `schools.invalid-command`, `schools.association-in-use`, `schools.inactive`, `schools.capacity-exists`, `schools.unavailable`, `idempotency.unavailable`, `internal.error`, plus middleware 401. (`packages/http-api/src/directory.ts:170-245`; `packages/domain/src/schools/administration.ts:36-108`.) |

All four are external Person cookie **or** delegated OAuth user-bearer operations; current `personNativeAccess` supplies Reveal and no extra requirement, while middleware supplies `credential.missing|credential.invalid` 401. GET responses use the shared private response headers; POST uses the existing entity mutation headers. Problem statuses, RFC 9457 bodies, `www-authenticate`, and retry-after variants come from the native registry, not new Schools tables (`packages/http-api/src/access.ts:71-104`; `common.ts:10-37,49-59`; `http-semantics.ts:136-196,1398-1508`). Keep the group OpenAPI title `Directories`, description `Scoped people and school directories.`, `x-displayName: Directories`, each operation summary/description and application-owned provenance (`packages/http-api/src/directory.ts:99-260`; `common.ts:193-222`).

## Existing execution and UI that stay owned by mono-web

- **People:** `listPeople` rejects any query, resolves one Organization authority projection/instant, authorizes against its own AccessSpec, pages Profile in 200-row batches, filters row visibility and partitions active/inactive. Its current `DirectoryApiHttpOptions.resolveAuthority` remains distinct from Schools' `resolveActor` (`apps/backend/src/directory/http.ts:42-52,116-222`; `apps/backend/src/router.ts:199-210`).
- **Schools directory:** `listSchools` strictly decodes the optional department before resolving the Person; `readSchoolsDirectory` takes Organization authority and a Schools read in a repeatable-read read-only transaction at one instant. SQL restricts rows and visible associations, checks department existence before out-of-scope denial, and includes unassigned schools only for unfiltered global access (`apps/backend/src/schools/http.ts:89-155`; `packages/domain/src/schools/authority.ts:13-44`; `packages/database/src/schools/directory.ts:48-118`; `postgres.ts:68-168`).
- **Management:** `readSchoolManagementHttp` rejects query, resolves credential and evaluates `schools.manage` before a scope-filtered read. `executeSchoolCommandHttp` strictly decodes a bounded 32,768-byte JSON body, checks header/body identity, then resolves current credential and authorizes **inside** `executeNativeHttpCommandPostgres` prepare on each retry/replay. `Schools.authorizeCommand` and `Schools.executeCommand` keep authority over both current/requested department associations, current revisions, advisory locks, domain receipt, immutable audit, capacity constraints and dependent-record protection. The transport receipt commits the exact HTTP response with the state. No school deletion, no writes by mere directory members, no provider side effect (`apps/backend/src/schools/administration-http.ts:34-148`; `apps/backend/src/http-api/receipt-transaction.ts:207-329`; `packages/database/src/schools/administration.ts:38-141,160-391`; `docs/system.md:245-263`). Numbered database migrations remain frozen (`packages/database/migrations/{0019-schools-directory,0061-scoped-school-administration}.sql`; `handoffs/2026-09-27.md:44-52`).
- **Browser:** `/dashboard/skoler` mounts the existing Foldkit element; its one Model tracks read states, search/tabs and the management form plus Pending/Failed/Conflict/Saved/Invalid mutation states. Existing Commands use the canonical generated SDK: listSchools, readSchoolManagement, executeSchoolCommand; the latter sends the command ID as Idempotency-Key. Preserve local search/keyboard tabs, scoped management/history, stale-result rejection, command-identity-preserving retry and mount/unmount resource ownership; do not replace the proxy or Model with a parallel client (`apps/dashboard/app/routes/dashboard.skoler._index.tsx:1-7`; `app/foldkit/schools/{main,model,command,update,view,management-view,browser-client,elements}.ts`; `app/foldkit/schools/browser-client.ts:19-69`; `apps/dashboard/server.mjs:38-59`).

## Proposed legal source and dependency seams

Choose **declaration-only builders**, not decorators on fake static methods. Current `HttpApiEndpoint` declarations are in `packages/http-api/src/directory.ts:99-260`. Two representative existing declarations are:

```ts
export const ListSchoolsEndpoint = HttpApiEndpoint.get("listSchools", "/api/schools", {
  query: { department: Schema.optional(DepartmentId) },
  success: privateReadResponse(
    SchoolDirectorySchema.annotate({
      identifier: "SchoolDirectory",
      description: "Active and inactive school directory entries.",
      examples: [SchoolDirectoryExample],
    }),
  ),
  error: endpointProblemResponses(DirectoryListSchoolsProblem),
}).middleware(PersonSecurity);

export const ExecuteSchoolCommandEndpoint = HttpApiEndpoint.post(
  "executeSchoolCommand",
  "/api/schools/commands",
  {
    headers: IdempotencyHeaders,
    payload: SchoolCommand,
    success: entityMutationResponse(SchoolCommandResult),
    error: endpointProblemResponses(SchoolAdministrationProblem),
  },
).middleware(PersonSecurity);
```

Those excerpts omit their **existing** `annotateAccessSpec` and `operationAnnotations` chains, which must move intact into the new declaration via the app-owned annotators below; the full source is `packages/http-api/src/directory.ts:135-160,170-260`. After exporting the currently inline School query and annotated response schema as values, and extracting existing code tuples/response-header schemas, the proposed collector-legal source in `packages/http-api/src/directory.effx.ts` is:

```ts
export const DirectoryGroup = Http.group({
  root: ExternalNativeApi,
  group: "directory",
  title: "Directories",
  description: "Scoped people and school directories.",
  displayName: "Directories",
});

export const ListSchools = Operation.query({
  name: "directory.listSchools",
  input: SchoolsDirectoryQuery,
  success: SchoolDirectoryResponse,
})
  .http.get("/api/schools")
  .http.contract({
    root: "external-native-api",
    group: "directory",
    query: SchoolsDirectoryQuery,
    success: SchoolDirectoryResponse,
    status: 200,
    responseHeaders: PrivateReadResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      operationId: "directory.listSchools",
      summary: "List schools",
      description: "Returns the native school directory in authority scope.",
      annotator: nativeOperationAnnotations,
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "DirectoryListSchoolsProblem",
    codes: DirectoryListSchoolsCodes,
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "schools.read-directory" },
    requirements: [],
    canonicalScopeResolver: SchoolsDirectoryResolver,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead",
  })
  .declare();

export const ExecuteSchoolCommand = Operation.command({
  name: "directory.executeSchoolCommand",
  input: SchoolCommand,
  success: SchoolCommandResult,
})
  .http.post("/api/schools/commands")
  .http.contract({
    root: "external-native-api",
    group: "directory",
    headers: IdempotencyHeaders,
    payload: SchoolCommand,
    success: SchoolCommandResult,
    status: 200,
    responseHeaders: EntityMutationResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      operationId: "directory.executeSchoolCommand",
      summary: "Maintain schools",
      description:
        "Applies one scoped school or capacity command with an explicit observed revision and atomic history.",
      annotator: nativeOperationAnnotations,
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "SchoolAdministrationProblem",
    codes: SchoolAdministrationCodes,
  })
  .http.access({
    annotator: directoryAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "schools.manage" },
    requirements: [],
    canonicalScopeResolver: SchoolsManagementResolver,
    concealment: { _tag: "Reveal" },
    decisionTime: "Transaction",
  })
  .declare();
```

This is a **design excerpt, not committed TypeScript**: the named exports do not exist until the approved implementation. The other two required declarations follow exactly this `Http.group`/`.declare()` pattern: `ListPeople` uses exported `EmptyDirectoryInput`, `PeopleDirectoryResponse`, `PrivateReadResponseHeaders`, `DirectoryListPeopleCodes`, `profile.read-directory`/`profile.people-directory`, SnapshotRead, its original metadata; `ReadSchoolManagement` uses `EmptyDirectoryInput`, `SchoolManagement`, `PrivateReadResponseHeaders`, **the same** `SchoolAdministrationCodes`/`SchoolAdministrationProblem` as POST, `schools.manage`/`schools.management`, SnapshotRead, its original metadata (`packages/http-api/src/directory.ts:99-117,193-217`). No operation has a stub `.handler`; no HTTP contract imports a backend handler. The compiler stores schemas as exported refs; the `input` on an empty GET is only the operation's semantic input, **not** a fabricated request body (`effx/packages/runtime/src/builder.ts:94-107`; `effx/packages/frontend-ts/src/lower.ts:292-296,364-397`).

**Reusable source seam:** extract `PrivateReadResponseHeaders` from the existing `privateReadResponse` construction. Give the existing neutral entity-mutation header schema a neutral name (migrate Profile callers, no duplicate copy). Generalize the already registry-backed `profileProblems` callable to `nativeProblems` and migrate Profile callers, keeping each endpoint's single exported readonly code tuple. Move the tiny Profile provenance wrapper to a neutral `nativeOperationAnnotations` that calls the existing `operationAnnotations`; update Profile to use it. Then the Schools and People declarations reuse native HTTP/Problem/metadata mechanisms without duplicating literals (`packages/http-api/src/http-semantics.ts:136-196`; `endpoint-problems.ts:98-166,301-321`; `profile-effx-adapters.ts:55-72`; `common.ts:208-222`). The generated SDK remains the sole `HttpApiClient.make(ExternalNativeApi)` projection (`packages/sdk/src/effect-client.ts:68-95`).

**Owned adapters:** `directoryAccessAnnotations` must validate each exact People/Schools capability + resolver + decision-time combination, then derive the existing `personNativeAccess`/`accessSpecAnnotations`. Export distinct resolver symbols for `profile.people-directory`, `schools.directory`, and `schools.management`; they map to registered IDs, not guessed names. Keep School query `department` → domain `departmentId` translation, current actor/scope resolution, failure mapping and command transaction in the owning handlers/service/SQL. Do not broaden the Profile self-edit access validator or copy its fixed `profile.owner` requirement onto a directory endpoint (`packages/http-api/src/access.ts:71-104,322-380`; `profile-effx-adapters.ts:7-72`; `apps/backend/src/schools/{http,administration-http}.ts`; `packages/domain/src/schools/authority.ts`).

**One generated output set:** extend **both** existing `tsconfig.effx.json` `files` lists with `directory.effx.ts`, retaining `profile.effx.ts` and the same `effx.projectRoot`. One contract emit must produce `profile-contract.ts` **and** `directory-contract.ts`; one backend handlers emit must produce both handler artifacts from the same IR/hash. Do not run two group-specific projects in the same `.effx/generated` directory: effx's manifest removes files owned by a previous emit that are not in the new file set (`effx/packages/cli/src/commands.ts:125-180`; `effx/packages/compiler/src/generate/http.ts:515-582`; `packages/http-api/tsconfig.effx.json:1-10`; `apps/backend/tsconfig.effx.json:1-10`). Integrate both passes before OpenAPI generation and type-aware lint/check on a fresh checkout; rename the Profile-only generation recipe instead of retaining a misleading alias. The generated `DirectoryApi` replaces the old handwritten group **once** in `src/api.ts`; `directory.ts` remains an independent People/School schema source and must not re-export the generated group, because the generated file imports its schemas. One generated full-root handler factory binds **all four** raw callbacks; People raw handler delegates to the unchanged People function, Schools raw callbacks to the existing School functions. Invoke each generated lazy guard at the old authorization position—People after query rejection with one authority projection, Schools directory after strict query decode, management GET after no-query validation, POST inside receipt prepare after strict body/key checks and before domain authorization. A request-local Web Request bridge may be shared with Profile rather than copied as mutable process state (`packages/http-api/src/api.ts:13-50`; `apps/backend/src/directory/http.ts:116-246`; `apps/backend/src/profile/http.ts:208-272`; `apps/backend/src/schools/http.ts:89-155`; `apps/backend/src/schools/administration-http.ts:66-147`).

## Proven constraints and open implementation checks

- **Mixed group is a proven compiler-composition constraint, not a reason to hand-author two groups.** A partial generated factory cannot satisfy the four-key native group; this proposal avoids changing the compiler by declaring all four (`effx/packages/compiler/src/generate/http.ts:394-436`; installed `HttpApiBuilder.ts:393-406`).
- **Inline schemas cannot lower into effx schema refs.** Export the current optional query, annotated `SchoolDirectory` response (including its example/identifier) and shared header schemas. This is application refactoring, not a missing type checker (`effx/packages/frontend-ts/src/lower.ts:292-296,364-397`; `packages/http-api/src/directory.ts:119-145`).
- **Do not use `metadata.commandIdentity` for School POST.** Its current compiler rule requires both required Idempotency-Key **and If-Match**; Schools has only the former and carries revision preconditions in `SchoolCommand`. Adding If-Match would change the wire contract. Preserve existing key/body equality and transactional revision logic (`effx/packages/compiler/src/extensions/http-contract.ts:259-273`; `packages/http-api/src/directory.ts:219-226`; `apps/backend/src/schools/administration-http.ts:91-110`).
- **No additional compiler feature is proven necessary yet.** The collector and emitter accept multiple source files/groups in one project by source inspection, not by an executed Schools build (`effx/packages/frontend-ts/src/project.ts:132-143`; `effx/packages/compiler/src/generate/http.ts:515-582`). Check typed raw E/R, actual Schema refs, full-root People/Schools group metadata and output on the pinned rc.116 target. A real diagnostic must be reproduced and routed as a compiler blocker; do not cast, widen declared failures, suppress the failure, copy status lists or hand-edit generated files. If a new `_tag` source-metadata lint exception is required, follow the repository exception registry rather than inheriting Profile's suppression without review (`packages/http-api/src/profile.effx.ts:58-70`; `.agents/skills/effect-house/references/exceptions.md`).

## Named real journey and acceptance after approval

`just e2e schools` currently invokes `apps/dashboard/e2e/run-real-native-schools-directory.mjs` and its one `native-schools-directory.spec.ts` test. It proves a real disposable PostgreSQL directory snapshot, browser session/authority matrix, forced 503/retry, search, filter, tabs, denied users, axe and request confinement. Its runner asserts **GET `/api/schools` only** for the directory-specific ledger. It does **not** exercise either management endpoint; `just golden school-service` is a separate downstream Placements/coverage journey and cannot substitute for a School-management command (`justfile:127-149`; `apps/dashboard/package.json:42-45`; `apps/dashboard/e2e/native-schools-directory.spec.ts:110-320`; `run-real-native-schools-directory.mjs:366-395,441-515`; `tools/e2e/golden-school-service.mjs:4-31`).

After approval, keep that directory proof untouched and **extend the named `just e2e schools` runner** to host a separate management browser spec and its own evidence/ledger. Seed synthetic authorized global and department-limited leaders plus directory-only/denied actors in disposable PostgreSQL. Via `/dashboard/skoler` and the real Better Auth cookie, prove scoped management GET/history, CreateSchool and ReviseSchool (including deactivation), ReplaceSchoolDepartments, CreateCapacity and ReviseCapacity, reason/observed revisions, refreshed directory, same-key exact response replay and changed-digest conflict, stale revision 412, unavailable/invalid/denied operations without mutation, association-in-use refusal, and receipt/audit durability. Assert that a department-only holder cannot change shared facts or another department; the old directory-only failure/retry/axe assertions and its GET-only ledger remain. Audit the management GET/POST paths separately. A focused People HTTP regression and a People dashboard read verify the mixed group's fourth operation without changing People business logic. Do not claim a management journey from the current read-only test (`docs/system.md:245-263`; `apps/dashboard/app/foldkit/schools/{model,management-view,update}.ts`; `apps/backend/src/directory/http.test.ts:397-632`; `apps/backend/src/schools/http.test.ts:196-412`).

Acceptance uses **one clean committed mono-web revision**, with heavy jobs run **serially** inside its `devenv shell` using the machine-wide `just measure` lock. The approved checks below all exited 0 at `188f2385 (unpublished)`; exact commands, durations and peak RSS are recorded in [Schools slice evidence](../research/schools-slice-evidence.md):

1. In a disposable clean checkout at that commit, `devenv shell -- bun install --frozen-lockfile`, then the unified effx generation recipe; assert identical contract/handler IR semantic hash and regenerated bytes on the integration tree. Preserve exactly 107 external operation tuples (four `directory`, two `profile`) and one excluded internal operation, plus People and Profile OpenAPI/schema/security metadata. Run focused HTTP native API, new directory-adapter, SDK operation-index and People/Schools backend/database tests with `devenv shell -- just measure --class test -- bun run --cwd <package> vitest run <named files> --no-file-parallelism --maxWorkers=1` (new management integration tests and Foldkit management/lifetime tests must be named and hosted, not left as unrun files).
2. `devenv shell -- just measure --class e2e -- just e2e schools` — existing directory proof **plus** new full management journey through the same real browser/API/PostgreSQL topology.
3. `devenv shell -- just measure --class e2e -- just e2e profile` — existing Profile denial, edit, stale/replay, actor confinement and accessibility regression on the same generated root.
4. `devenv shell -- just measure --class golden -- just golden school-service` — downstream placement/service regression, **not** School-management proof.
5. `devenv shell -- just measure --class check -- just check --concurrency=1` — native TypeScript/Effect, source safety, constructs, guides, format, lint and generated HTTP/SDK contracts. Do not report a partial suite as success. Record command exits, duration, peak RSS and clean revision; retain the Schools branch unlanded until operator review.

Count maintained source before/after on the same contract/handler/domain/SQL/UI responsibilities, including People contract relocation and new hand-written adapters; count generated contract/handler and whole OpenAPI/SDK projections separately. A positive LOC delta is observation, **not** rejection. Full repository `just test`, other journeys and production/provider cutover remain separate claims unless actually exercised. This design authorizes **no** main merge, deployment, credential action or writer transfer (`AGENTS.md#verification-and-resources`; `effx/docs/specs/0004-monoweb-migration-plan.md:312-332`).

## Observed local result

The generated complete Directory and retained Profile groups passed the named real browser and PostgreSQL journeys, downstream school-service golden, focused People/Schools/Profile tests, full `just check` and full `just test` at one clean commit. Complete external OpenAPI and SDK operation-index files were byte-identical to their separately regenerated pre-migration counterparts. The Schools maintained-source delta was **+251 physical lines**, measured separately from 108 new generated Directory TypeScript lines; neither count gates the operator-approved outcome. See [Schools slice evidence](../research/schools-slice-evidence.md). Branch landing, deployment and production cutover remain unauthorized.
