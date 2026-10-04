# Spec 0005 — HTTP contract extension (Gate 1, part A)

Status: **spec-frozen**. This is the operator-approved first implementation gate from
[spec 0004](0004-monoweb-migration-plan.md). AccessSpec runtime enforcement is part B,
not a claim made by these contract projections.

## Outcome

A declaration with `@Query` or `@Command`, `@Http.<Method>` and optional
`@Http.Contract`/`@Http.Problems` compiles to a typed Effect `HttpApi` contract,
handlers, and a client. Equivalent builder syntax yields the same IR. A malformed
combination produces a diagnostic before code generation. The existing users example
without the new annotations retains its `effx` root, `operations` group and public
`Api`/`ApiHandlers`/`Client` exports (`docs/specs/0001-compiler-kernel.md`,
`docs/specs/0002-source-frontend.md`, `packages/compiler/src/generate/{http,client}.ts`).

The target is byte/status-compatible mono-web v0.2. Part A records and emits
contract metadata; it does **not** authorize a request, choose an actor, translate
all domain failures into problems, issue Cedar leases, or generate persistence
(`docs/specs/0004-monoweb-migration-plan.md`,
`../vektorprogrammet/mono-web/packages/http-api/src/{api,profile,http-semantics}.ts`).

## IR v2

- `ApplicationIR.version` becomes literal `2`; `make`/`empty`, canonical JSON,
  normalization, graph projection and Arbitrary generate v2 only.
- `EdgeKind` adds `ExtensionOf`. Its `from` is an `ext:` `Extension` node;
  its `to` is an existing node, usually an `operation:`; its `qualifier`
  equals the extension node's `tag` (`HttpContract`/`ProblemContract`).
  At most one of either tag attaches to an operation. An extension with no
  outgoing `ExtensionOf` is `EFFX1003` (error). A wrong/missing target is
  `EFFX1002`, and duplicate incompatible nodes remain `EFFX1001`.
- `migrate(v1|v2)` is pure, idempotent, preserves v1 nodes/edges unchanged,
  and returns v2; `decode(unknown)` and `decodeString(string)` accept v1 and
  v2 through the migration then validate against the v2 Schema. `encode` and
  `canonical` always emit v2. No `ts.*` object or source location enters IR.
- The legacy v1 decode is a compatibility boundary, not a second mutable IR.
  Keep an explicit v1 input Schema with its old edge set and fixture.
  A malformed/unknown version fails Schema decoding, not an implicit cast.
  A v1 Extension without `ExtensionOf` is preserved as data; compiler analysis
  reports `EFFX1003` if that IR is compiled (`packages/ir/src/{ApplicationIR,Edge,canonical}.ts`,
  `docs/decisions/0002-ir-is-graph-shaped-and-schema-defined.md`).

## Source syntax and lowering

```ts
@Query({ name: "User.Get", input: GetUserInput, success: User.Public })
@Http.Get("/users/:id")
@Http.Contract({ group: "users", params: Params, query: Query,
  headers: Headers, success: User.Public, middleware: [PersonSecurity],
  metadata: { operationId: "users.get", summary: "Read user" } })
@Http.Problems({ registry: UserProblemResponses,
  codes: ["user.not-found"], map: { UserNotFound: "user.not-found" } })
static get(input: typeof GetUserInput.Type) { /* existing Effect handler */ }
```

The builder has `.http.contract(options)` and `.http.problems(options)` steps,
producing precisely `Http.Contract [options]` and `Http.Problems [options]` in
source order. Decorators return `undefined`, as before. `registry` is one
**exported derivation function symbol**; `middleware` entries are exported
`HttpApiMiddleware.Service` marker symbols. The TS frontend lowers schema
values to `SchemaRef`, all symbols to `SymbolRef`, and literal fields to JSON.
It does not evaluate an application module. Exported non-service symbols are
recognized **only** at `Http.Problems.registry`, not as arbitrary identifiers
(`packages/runtime/src/{Annotation,decorators,builder}.ts`,
`packages/frontend-ts/src/{collect,lower,resolve}.ts`).

The `Http.Contract` value has:

| Property                                | Type/default                                                                 | Meaning                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `root`                                  | string, default `"effx"`                                                     | Root API identifier; each distinct root emits a separate `HttpApi`.                                                                                                                    |
| `group`                                 | required string                                                              | `HttpApiGroup.make` identifier. Unannotated operations keep `"operations"`.                                                                                                            |
| `params`, `query`, `headers`, `payload` | optional exported schemas                                                    | Separate request channels. `query` emits the installed Effect v4 endpoint `query` option (not `urlParams`).                                                                            |
| `success`                               | required exported schema                                                     | Successful response schema, independent of the `Operation`'s domain result.                                                                                                            |
| `status`                                | optional number                                                              | `HttpApiSchema.status(status)` on the success schema; default is the schema's own/default status.                                                                                      |
| `mediaType`                             | optional string                                                              | `HttpApiSchema.asJson({ contentType })` on the payload schema; absent keeps Effect's default encoding.                                                                                 |
| `responseHeaders`                       | optional exported schema                                                     | `HttpApiSchema.WithHeaders(success, responseHeaders)`; handler must return the typed header-bearing response.                                                                          |
| `conditional`                           | boolean, default false                                                       | GET adds bodyless `304` via `HttpApiSchema.WithHeaders(NoContent.pipe(status(304)), responseHeaders)` alongside the same header-bearing success; handler owns ETag/precondition logic. |
| `middleware`                            | optional marker symbol array                                                 | `.middleware(Marker)` in declaration order; no marker is instantiated by effx.                                                                                                         |
| `metadata`                              | optional `{ operationId?, summary?, description?, tags?, commandIdentity? }` | OpenAPI fields project into `OpenApi.annotations`. Gate 2A's `commandIdentity` is an exported symbol for a typed client helper; it is **not** sent to OpenAPI.                         |

### Gate 2A amendment — command identity

`Http.Contract.metadata.commandIdentity` lowers an exported application function
to an importable `SymbolRef`. It is legal only for a Command whose headers
schema exposes both `idempotency-key` and `if-match`. The client generator
types the helper against the endpoint request and imports the function; it
never evaluates it during compilation. The application owns key creation,
precondition retention, retry and replay policy. See
[spec 0007](0007-client-and-foldkit.md#stable-command-identity).

An extension contributes `Extension { id: ext:http-contract/<operation>,
extension: "http-contract", tag: "HttpContract", data: ... }` and
`ExtensionOf` to the owning operation. `data` contains plain JSON records for
`SchemaRef`s and `SymbolRef`s, not live schema/runtime values. Decode the
extension data with an Effect Schema before analysis or generation.
An `Http.Contract` without an HTTP exposure, a duplicate contract, a different
`success` with an incompatible handler type, GET with an explicit `payload`,
`conditional` on a non-GET or without `responseHeaders`, a path-param schema
mismatch, or an unsafe root/group identifier produces `EFFX2402` (error),
never a silently dropped property. Existing unannotated GET payload behavior
remains unchanged for the users fixture (`packages/compiler/src/extensions/transports.ts`,
`packages/compiler/src/generate/http.ts`).

## Problem responses

`Http.Problems({ registry, codes, map? })` contributes `Extension {
  id: ext:problem-contract/<operation>, extension: "problem-contract",
  tag: "ProblemContract", data: { registry: SymbolRef, codes, map }
}` plus `ExtensionOf` to the owning operation. `codes` is nonempty and unique.
`map` keys are inferred/declared domain error schema export names (`_tag` for
Schema.TaggedError); values must occur in `codes`. For each error lacking a
map entry, a status-annotated SchemaRef can pass through unchanged; all others
produce `EFFX2205`. A mapping to an absent code is `EFFX2206`. Duplicate
problem contracts or no HTTP exposure also produce `EFFX2402`.

The generated endpoint does not substitute a JSON union for typed HTTP errors.
It imports the supplied `registry` derivation function and emits
`error: Registry("<OperationName>Problem", ["code", ...])` where that
function returns `endpointProblemResponses(problemUnion(identifier, codes))`.
This is the **exact two-stage mono-web derivation**: `problemUnion` creates
closed RFC 9457 variants; `endpointProblemResponses` folds them by status,
including their headers. Mono-web can expose this composition as an adapter
function without changing its `NativeProblemRegistry`, `problemUnion`, or
`endpointProblemResponses`. Effx neither imports mono-web nor copies its
registry (`../vektorprogrammet/mono-web/packages/http-api/src/{endpoint-problems,http-semantics}.ts`).

For an operation with `Http.Problems`, error schemas emitted by that derivation
replace the default direct domain-error schema list. The generated handler
remains an ordinary Effect handler: its domain-error → Problem conversion and
`ProblemBoundaryLive` are **hand-written** until an explicit runtime mapping
contract exists. A typed generated API that does not accept that handler is a
failure, not permission to weaken the error union.

## Generation and compatibility

- Group HTTP exposures by `(root, group)`, sorted by stable operation ID.
  Emit a group class per distinct pair; one root class per root. Preserve
  `Api`, `ApiHandlers`, `Client`, and the `operations` identifier for the unannotated default group. Its class is `HttpOperations` to avoid collision with the imported RPC `Operations` in the shared server module (`packages/compiler/src/generate/{http,rpc}.ts`).
  For additional groups/roots use stable, collision-checked exported names.
  Generate `HttpApiBuilder.group` for every nonempty group; keep default
  `Api` as the root `effx` (empty when all operations target another root).
- Generate client services/calls against the matching root/group, not against
  hard-coded `client.operations`; keep existing default `Client` API.
  Internal/nondefault roots never leak into a default-root client.
- Endpoint options use Effect v4's `params`, `query`, `headers`, `payload`,
  `success`, `error`; media/status wrappers come from `HttpApiSchema`.
  Middleware and `OpenApi.annotations` attach after endpoint construction.
  Generator output is deterministic ordinary TypeScript/Effect.
- This slice does not generate an OpenAPI document or a new mono-web SDK index.
  The generated HttpApi root remains the one contract from which those
  projections derive later (`node_modules/effect/src/http-api/{HttpApiEndpoint,HttpApiSchema,OpenApi}.ts`,
  `../vektorprogrammet/mono-web/packages/sdk/scripts/generate-operations.ts`).

## Branch deltas considered

These unmerged mono-web refs are behind `main`; their diffs were read against
`main...<branch>` at the named paths. They are evidence for later parity, not
an instruction to merge them or to import mono-web into effx
(`docs/research/monoweb-branches.md`, §§“Branches with commits not on current main”,
“Migration takeaways”). No mono-web RPC refactor was found there.

| Branch diff                                                                                                                                                                                       | Shape and Gate 1A decision                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fix/oauth-review-0926`: `packages/domain/src/authz/access.ts`, `packages/http-api/src/access.ts`                                                                                                 | Adds `OAuthBotBearer` to the credential union, treating it as a delegated Person read but rejecting bot writes. `Http.Contract.middleware` already carries an opaque marker `SymbolRef`; **no auth rule was generated**. Part B must preserve `SnapshotRead`-only bot semantics and reuse mono-web's interpreter.                                                                       |
| `fix/organization-review-0926`: no delta at `packages/http-api/src/access.ts` or `packages/domain/src/authz/access.ts`; `packages/http-api/src/organization.ts` adds `lookupAppointmentCandidate` | This is a **POST read with private email in the body**, `PersonSecurity`, and `SnapshotRead`. The transport channels support its payload, but current `EFFX2401` rejects `@Query` over POST. Deliberately **not** weakening that semantic rule in Gate 1A: migrating this unmerged operation needs an explicit Query-over-POST design/ADR revision, not a dishonest `@Command` relabel. |
| `feat/team-application-queue-pilot-0926`: `packages/http-api/src/common.ts`, `packages/http-api/src/http-semantics.ts`                                                                            | Adds `ServiceSecurity` and a service-bearer `WWW-Authenticate` challenge. Marker `SymbolRef` and registry-derived problem headers already cover the contract shape. Credential enforcement and service-principal grants stay in Part B.                                                                                                                                                 |
| `fix/recruitment-review-0926`: `packages/http-api/src/{endpoint-problems,http-semantics}.ts`                                                                                                      | Adds `recruitment.correction-closed` and other registry-backed 409/422 codes. `Http.Problems.codes` and the supplied derivation function accept these without adding a hard-coded effx code/status table.                                                                                                                                                                               |
| `fix/frontend-http-review-0926`: `packages/sdk/src/{failure,command-identity,command-keys}.ts`, `apps/dashboard/app/foldkit/profile/command.ts`                                                   | Adds typed SDK failure classes, stable retry key/If-Match identity, and `ConfirmedEarlierProfileSave` after expired response receipts. The generated client must preserve declared problem failures; SDK classification, retry identity and Foldkit messages are **not** generated in Gate 1A. They remain hand-written until client/Foldkit parity gates.                              |

## Verification / DoD

| Gate              | Required observation                                                                                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v2 laws           | v2 encode/decode, canonical/hash and graph round trips; migration idempotence; a frozen v1 fixture decodes to v2 with identical nodes/old edges; an orphan extension produces `EFFX1003`.                                 |
| Syntax law        | Decorated and builder fixture operations have equal annotations and canonical IR except handler symbol. A plain exported registry function and middleware marker lower as Symbols.                                        |
| Generator         | Generated fixture `http.ts` and `client.ts` typecheck under the existing tsc harness. Inspect typed params/query/headers, middleware and problem derivation in output. Legacy users fixture remains type-correct.         |
| Negative controls | `EFFX2402` for GET+payload and non-GET conditional; `EFFX2205` for unmapped domain error; `EFFX2206` for a code absent from `codes`; `EFFX1003` for an orphan extension. Errors skip generation.                          |
| Local gates       | `bun run typecheck`, `bun run effect:diagnostics`, focused IR/compiler/runtime/frontend tests, Oxfmt on touched paths, and `bun run lint` after the concurrent config lands. Record exact commands/results in `STATE.md`. |

No code is complete if it merely emits placeholder roots, returns successful
no-op handlers, silently ignores an annotation, or passes only a compiler
fixture without typechecking the generated artifact. No mono-web code is
imported by effx. The operator separately accepted byte/status compatibility,
mono-web's in-transaction AccessSpec interpreter, and the maintained-source
LOC metric (`docs/specs/0004-monoweb-migration-plan.md`,
`docs/decisions/0007-cedar-authorizes-effx-issues-leases.md`).
