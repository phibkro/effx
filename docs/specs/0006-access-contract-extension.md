# Spec 0006 — AccessContract and required guard bindings (Gate 1B)

Status: **spec-frozen**. Depends on [spec 0005](0005-http-contract-extension.md).
This slice records mono-web's access declaration and requires a typed application
binding. It neither authorizes a request nor replaces mono-web's transaction-time
AccessSpec interpreter (`docs/specs/0004-monoweb-migration-plan.md`, §3;
`docs/decisions/0007-cedar-authorizes-effx-issues-leases.md`).

## Outcome and security boundary

A protected HTTP operation names its accepted credentials, principal kinds,
capability expression, requirements, scope resolver, concealment policy and
decision time once. The compiler emits its endpoint annotation and requires an
application-supplied guard callback at the handler boundary. The handler invokes
that callback **inside its own read snapshot or committing transaction**; the
generated adapter must not pre-authorize outside that boundary
(`../vektorprogrammet/mono-web/packages/http-api/src/{access,profile,common}.ts`,
`../vektorprogrammet/mono-web/apps/backend/src/profile/http.ts`,
`../vektorprogrammet/mono-web/docs/architecture.md`).

Runtime decorators remain source annotations. Effx never executes an
`Http.Access` value during compilation, resolves a credential, interprets
relationship facts, chooses a Principal, or issues a lease. The application
supplies the actual interpreter and errors. A required typed binding is **not**
proof that the handler called it; the Profile journey in spec 0004 remains the
runtime security gate.

## Declaration and IR

```ts
@Query({ name: "Profile.Read", input: ReadInput, success: ProfileResponse })
@Http.Get("/api/profile")
@Http.Contract({ group: "profile", headers: ConditionalHeaders,
  success: ProfileResponse, middleware: [PersonSecurity] })
@Http.Access({
  annotator: profileAccessAnnotations,
  exposure: "External",
  acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
  principalKinds: ["Person"],
  capabilities: { _tag: "One", capability: "profile.read-self" },
  requirements: [{ id: "profile.owner" }],
  canonicalScopeResolver: ProfileCurrentPerson,
  concealment: { _tag: "Reveal" },
  decisionTime: "SnapshotRead"
})
static read(input: ReadInput, authorize: () => Effect.Effect<Principal, Problem, R>) {
  // Application code calls authorize() within its own snapshot.
}
```

Builder `.http.access(spec)` records the same `Http.Access [spec]` annotation
in source order. `@Http.Access` is permitted once per operation. The class
method, builder, and source collector agree on annotation arguments and the
normalized IR. The `annotator` and `canonicalScopeResolver` fields lower to
`SymbolRef`, not imported function results. The resolver is an application
symbol, not an effx-implemented scope lookup (`packages/runtime/src/{Annotation,decorators,builder}.ts`,
`packages/frontend-ts/src/{collect,lower,resolve}.ts`).

`AccessContract` data is an Effect Schema-validated JSON value:

| Field                    | Shape                                                                                                                                                | Mono-web source                                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `annotator`              | required `SymbolRef` of a user-provided `(spec) => Context` derivation                                                                               | `packages/http-api/src/access.ts` exports `accessSpecAnnotations` and merges it with `endpoint.annotateMerge`.                           |
| `exposure`               | `External \| Internal`                                                                                                                               | `packages/domain/src/authz/access.ts` `ExposureSchema`.                                                                                  |
| `acceptedCredentials`    | nonempty set of named alternatives: `None`, `BetterAuthCookie`, `OAuthUserBearer`, `OAuthServiceBearer`, `ObjectCapability`; later names remain data | `CredentialMechanismSchema`; OAuth branch adds `OAuthBotBearer` but rejects declaring it directly.                                       |
| `principalKinds`         | nonempty set: `Anonymous`, `Person`, `ServicePrincipal`, `CapabilityHolder`                                                                          | `PrincipalKindSchema`; person-or-service endpoints need more than one kind.                                                              |
| `capabilities`           | tagged `None`, `One { capability }`, `Any/All { capabilities: nonempty set }`                                                                        | `CapabilityExpressionSchema`; scope remains resource-specific.                                                                           |
| `requirements`           | `{ id, parameters? }[]`, with JSON-only parameters                                                                                                   | `TypedRequirementSchema`; domain validates registered IDs and scope relationships.                                                       |
| `canonicalScopeResolver` | exported `SymbolRef`                                                                                                                                 | Mono-web stores a resolver **ID**; the supplied annotator adapts this symbol to that ID. Effx does not assume an ID from an export name. |
| `concealment`            | tagged `Reveal` or `NotFound { stages: nonempty set }`                                                                                               | `ConcealmentPolicySchema`.                                                                                                               |
| `decisionTime`           | `SnapshotRead \| Transaction`                                                                                                                        | `AuthorizationModeSchema`.                                                                                                               |

The `Extension` node has `id: ext:access-contract/<operation>`,
`extension: "access-contract"`, `tag: "AccessContract"`, and the fields above.
`ExtensionOf` points to the owning `operation:` with qualifier
`AccessContract`. Duplicate declarations are errors, not silent deduplication.
`SchemaRef`/`SymbolRef` import paths remain frontend-resolved. No TypeScript
compiler object, live Schema, or function is serialized (`packages/ir/src/Node.ts`,
`packages/ir/src/Edge.ts`, `docs/specs/0005-http-contract-extension.md`).

### Branch semantics retained as data

The unmerged `fix/oauth-review-0926` branch adds `OAuthBotBearer` as a resolved
credential, permits it only for a delegated Person read, and rejects naming it
in `acceptedCredentials` without person confirmation. The unmerged
`feat/team-application-queue-pilot-0926` branch adds a service-only
`ServiceSecurity` marker and bearer challenge. Neither changes effx's closed
credential enum: names are registry-owned strings in this IR. The app's
annotator/interpreter validates their meaning. A `ServiceSecurity` marker
counts as a typed security marker when supplied in `Http.Contract.middleware`
(`../vektorprogrammet/mono-web/packages/domain/src/authz/access.ts` at
`fix/oauth-review-0926`, `../vektorprogrammet/mono-web/packages/http-api/src/common.ts`
at `feat/team-application-queue-pilot-0926`).

## Analyses and compiler option

| Diagnostic | Exact condition                                                                                                               | Severity                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `EFFX2501` | An `Operation{Command}` has an `AccessContract` with `SnapshotRead`.                                                          | error                                               |
| `EFFX2502` | An `Operation{Query}` has an `AccessContract` with `Transaction`.                                                             | warning                                             |
| `EFFX2503` | A protected operation accepts any credential other than sole `None`, but lacks an `Http.Contract` security middleware marker. | error                                               |
| `EFFX2504` | An operation with HTTP exposure has no `Http.Access`.                                                                         | warning by default; error with `strictAccess: true` |

A security marker is **not** any middleware: the TS frontend verifies the
installed `HttpApiMiddleware` security type stamp on each
`Http.Contract.middleware` value. It records the corresponding `SymbolRef` in
the contract data. Root schema-error middleware cannot satisfy `EFFX2503`.
The compiler checks only presence and identity of that declaration, not whether
a Layer implements it or whether the handler authorizes in the right
transaction (`node_modules/effect/src/http-api/HttpApiMiddleware.ts`,
`../vektorprogrammet/mono-web/packages/http-api/src/common.ts`).

`ProjectConfig.strictAccess?: boolean` defaults to false. Its value travels
through an immutable `AnalysisContext` to builtin analyses; no module-level
mode or hidden environment variable changes diagnostic severity.
`compileCollected` accepts an optional context for test and cached-IR users.
The CLI exposes `--strict-access` for `check` and `build`; its other commands
do not silently claim an access gate. Both modes report `EFFX2503` as an error.
Warnings alone do not block generation (`packages/compiler/src/{Collected,Extension,pipeline}.ts`,
`packages/cli/src/{main,commands}.ts`).

## HTTP lowering and guard interface

The supplied `annotator` returns the installed Effect `Context`, so the
HTTP generator calls
`endpoint.annotateMerge(Annotator({ exposure, acceptedCredentials, principalKinds,
capabilities, requirements, canonicalScopeResolver: Resolver, concealment,
decisionTime }))` **after** the endpoint's middleware and other annotations.
This is an ordinary importable call in generated TypeScript. Mono-web can map
the named credentials/capabilities and resolver symbol to its existing
`AccessSpec` and reuse `accessSpecAnnotations`; effx does not hard-code that
registry or serialize its returned Context (`node_modules/effect/src/http-api/HttpApiEndpoint.ts`,
`../vektorprogrammet/mono-web/packages/http-api/src/access.ts`).

`guards.ts` exports one required `Guards` record type per HTTP group with
protected operations. The key is the qualified operation ID. Each value has
`(request: HttpServerRequest) => Effect<Principal, Problem, R>` as derived from
the **handler's authored second argument**, a lazy nullary authorization
callback whose return type is that Effect. An absent or non-Effect callback
makes the generated code fail TypeScript checking. Generated code does not
manufacture a Principal or swallow a Problem (`node_modules/effect/src/http-api/HttpApiBuilder.ts`,
`packages/compiler/src/generate/http.ts`).

For a protected operation, `ApiHandlers(guards)` passes a thunk
`() => guards[operationId](request)` as the handler's second argument. The
handler calls it at the correct transaction/snapshot boundary. No generated
preflight grants write authority. An unprotected operation retains its normal
handler call. `AppRoutes` requires the group guard records when at least one
group is protected; the existing unprotected users example retains constant
`ApiHandlers` and `AppRoutes` exports. Distinct roots/groups get distinct type
names and binding fields, as they do for `HttpContract` generation
(`packages/compiler/src/generate/{http,http-contracts}.ts`,
`docs/specs/0005-http-contract-extension.md`).

### Query over POST, explicitly read-only

`@Http.Contract({ payloadIsQuery: true, payload: RequestSchema, ... })`
on a `@Query` exposed over POST satisfies the amended ADR 0010 and does not
raise `EFFX2401`. The flag is rejected with `EFFX2402` unless the operation is
a Query, the method is POST, and the body schema is present. A Query over any
other mutating method still raises `EFFX2401`.

This opt-in represents private query data in a body, not permission to write.
It fits mono-web's unmerged `lookupAppointmentCandidate` POST read, which
accepts exact email in its body and evaluates `SnapshotRead` authority. It
changes no claim about observational semantics and proves no handler purity
(`../vektorprogrammet/mono-web/packages/http-api/src/organization.ts` at
`fix/organization-review-0926`, `docs/decisions/0006-query-is-a-semantic-claim.md`).

## Fixtures and falsifiers

- A Profile-like fixture declares `GET /api/profile` with `SnapshotRead` and
  `PATCH /api/profile` with `Transaction`. Both name `PersonSecurity` and
  typed problems; the mutation requires `If-Match` and `Idempotency-Key`
  headers. Its authored handlers accept and invoke lazy guard callbacks.
- Decorator/builder annotations and canonical IR match after erasing only the
  syntax-bound handler symbol. `Http.Access` contributes exactly one linked
  `AccessContract` per annotated operation. Generated `http.ts`/`guards.ts`
  typecheck through the existing fixture tsc harness. A test passes an
  application guard record and checks that no Effect runs merely by building
  it; the handler determines when to run it.
- Negative fixtures assert all four diagnostic codes. `strictAccess` changes
  **only** `EFFX2504` from warning to error; generation is skipped under
  strict mode. A nonsecurity middleware does not suppress `EFFX2503`.
- Query-over-POST with `payloadIsQuery` passes and omitting or misplacing
  the flag fails; a POST body containing an email is not turned into a GET
  URL parameter. Tests assert the generated POST payload channel.
- Preserve the pre-existing default users example and v1→v2 decode laws.
  Required local gates: regenerated example build, `bun run typecheck`,
  `bun run effect:diagnostics`, `bun run lint`, `bun run fmt:check`, and
  `bun run test`. Record exercised evidence and limits in `STATE.md`.

Gate 1B is complete only when these contracts and negative controls exist.
The real mono-web Profile browser/PostgreSQL journey belongs to the later
proving slice; no static annotation can substitute for its transaction denial,
replay, or revocation observations (`docs/specs/0004-monoweb-migration-plan.md`).
