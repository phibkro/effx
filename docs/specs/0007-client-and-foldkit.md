# Spec 0007 — generated client and Foldkit command adapter (Gate 2A)

Status: **spec-frozen**. Depends on [HTTP contracts](0005-http-contract-extension.md)
and [access contracts](0006-access-contract-extension.md). Gate 2A replaces the
SDK/command glue of the Profile slice; it does not replace Profile's Model,
update, view, transaction-time authorization, database, or route bridge.

## Observable outcome

An effx Profile-like declaration produces a typed HTTP client, a stable index
of external operations, and an opt-in Foldkit Command definition. A caller can
send a real request through an in-process Bun HTTP server. A denied request
returns its declared 401 problem in the generated operation's typed failure
channel; a transport failure is distinguishable. The Foldkit definition uses
the same client call, maps success/failure to application Messages, and never
executes merely because update constructs a Command.

Mono-web's source of truth is `packages/http-api/src/api.ts`; the SDK derives
its groups and failure types from `ExternalNativeApi`, then reflects that
contract into `native-api-operations.json` (`packages/sdk/src/effect-client.ts`,
`packages/sdk/scripts/generate-operations.ts`). The Profile command accepts a
request ID and command, runs `updateOwnProfile`, and returns one of the
application's result Messages (`apps/dashboard/app/foldkit/profile/{command,message,update}.ts`).
The unmerged `fix/frontend-http-review-0926` branch adds a
`ConfirmedEarlierProfileSave` result for an expired replay receipt, and a
separate stateful command-identity helper; those are application policy, not
new transport semantics (`packages/sdk/src/{failure,command-identity,command-keys}.ts`
at that branch). The unchanged Profile browser/PostgreSQL journey remains the
later parity gate (`docs/research/profile-baseline.md:376-395`).

## Client projection

1. Derive the generated client from the **same** normalized IR and `HttpItem`
   lookup as generated `http.ts`; do not create another route registry or
   import mono-web source (`packages/compiler/src/generate/{client,http,http-contracts}.ts`).
   Keep generated server routes for all roots. Generate client services and
   operation functions for external roots only. A root whose `Http.Access`
   contracts say `Internal` is excluded from the published client and index.
   Unannotated legacy roots are external by default. A root mixing internal
   and external operations is an error rather than leaking an internal method
   through `HttpApiClient.ForApi<typeof RootApi>`.
2. For each `(root, group, operation)` expose a uniquely named typed function
   over `HttpApiClient.ForApi<typeof RootApi>[group][operation]`. Preserve
   path, query, headers and payload channels from `Http.Contract`; do not
   flatten away headers or rewrite POST payloads as URL query. Different roots
   or groups must not collide. Keep the existing users example callable by
   updating its imports if names change. The installed Effect `HttpApiClient`
   owns request encoding and response decoding (`node_modules/effect/src/http-api/HttpApiClient.ts`).
3. Export `EffectSdkFailure<Root, Group, Operation>` by extracting the actual
   method's Effect error channel. A declared `ProblemContract` problem remains
   a typed member of that channel. Introduce a tagged transport failure class
   carrying the operation ID and original cause for failures that are _not_
   declared problems. The client must not convert a 401 problem into an opaque
   network failure, silently discard a decoding error, or catch defects and
   interruption as domain problems. The branch's `SdkFailure` classification
   (`Credential`, `Denied`, `Transient`, etc.) is an application-level projection,
   not a second inferred endpoint contract (`fix/frontend-http-review-0926:
packages/sdk/src/failure.ts`; `packages/compiler/src/extensions/problem-contract.ts`).
4. Client construction accepts explicit credential options: lazy or literal
   Cookie header, bearer token, or a caller-provided `HttpClient` transform.
   Apply the chosen option to a request through the Effect `HttpClient` API;
   omit absent credentials and keep caller-provided headers. A custom transform
   must retain the native client's typed endpoint decoder and cancellation.
   The caller selects a platform `HttpClient` Layer. An explicit browser/Bun
   convenience Layer MAY provide `FetchHttpClient.layer`, but generated code
   must not call the global `fetch`, read environment variables, or make a
   Promise boundary (`packages/sdk/src/{effect-client,config}.ts`,
   `node_modules/effect/ai-docs/src/50_http-client/`).
5. Export one deterministic `operationIndex: ReadonlyArray<{ group, operationId,
method, path }>` in `client.ts`, sorted by operation ID. Use the declared
   metadata operation ID when present, or the operation's stable ID. Produce
   each entry from the same external `HttpItem` that creates its operation
   function; exclude internal roots and RPC-only exposures. The fixture must
   compare all four fields against an independent expected list. This index
   replaces the separately generated mono-web JSON projection, not the
   `HttpApi` contract (`packages/sdk/scripts/generate-operations.ts:24-58`).

### Stable command identity

`Http.Contract.metadata.commandIdentity?: ExportedFunctionSymbol` is an
optional source declaration and importable `SymbolRef` in `HttpContractData`.
It is valid only for a `Command` with a declared headers schema containing
**both** `idempotency-key` and `if-match`. The frontend records header field
names without evaluating the schema; analysis rejects a missing required
header, a Query, an unexported symbol, or duplicate declaration. Emit a
`commandIdentity(input)` helper for that operation which invokes the supplied
symbol with the typed HTTP request and returns an identity with
`{ key, input, precondition }`; `key` and `precondition` correspond to the
headers used by the request. Its return type must remain assignable to the
request's key/precondition fields. Repeating an unchanged input and
precondition must reuse the application's key; effx does **not** mint keys,
retain an identity in hidden state, retry an Effect, or decide when a lost
answer is `ConfirmedEarlier`. The owning Model/application function manages
state and retry policy (`fix/frontend-http-review-0926:
packages/sdk/src/{command-identity,command-keys}.ts:9-55,99-164`).

## Foldkit projection

1. `@Foldkit.Command({ success: SuccessMsgSymbol,
failure: FailureMsgSymbol })` and builder `.foldkit.command(...)` append
   equivalent `Foldkit.Command` annotations. Both symbols name **exported
   Schema message values** (a tagged Message or an application success union).
   The frontend records references without importing or invoking application
   code. One annotation contributes
   `Extension { extension: "foldkit", tag: "UiCommand", data: { success,
failure } }` plus an `ExtensionOf` edge to its operation. A duplicate,
   missing HTTP exposure, missing external root, or invalid message symbol
   raises a diagnostic before generation. No new generic UI IR node is needed
   (`packages/runtime/src/{decorators,builder}.ts`,
   `packages/compiler/src/extensions/index.ts`).
2. Emit `foldkit.ts` **only** for opted-in operations. Per `(root, group)`, a
   typed `commandsFor(client, messageAdapters)` defines one Foldkit
   `Command.define` per annotated operation. Command args carry a
   `requestId: Schema.Int` and a `request` Schema composed from that operation's
   existing path/query/headers/payload SchemaRefs. `messages` lists exactly
   the annotated success and failure schemas. `execute` calls the matching
   generated client operation once; it maps success and catches typed expected
   failure into the corresponding Message. It must not run an Effect during
   construction, turn an interruption/defect into a Message, or add an
   implicit retry. The Foldkit runtime owns command execution
   (`apps/dashboard/app/foldkit/profile/command.ts:14-25`,
   `apps/dashboard/node_modules/foldkit/dist/command/index.d.ts:54-66,144-174`).
3. Message field shape is owned by the app. The generated binder requires
   typed `success({ requestId, result })` and
   `failure({ requestId, failure })` adapters. A success adapter returns the
   annotated success Message; a failure adapter may return either annotated
   Message. This lets the app map a typed `idempotency.response-expired`
   problem to a `ConfirmedEarlier` success Message, as the unmerged branch
   does, without effx inventing a profile value. For Profile, the app also
   maps HTTP `body`/`headers.etag` to `{ profile, etag }` and other typed
   errors to its bridge failure; neither projection can be inferred from
   `Http.Contract`. Model, update, view,
   request-ID freshness checks, SSR/browser route bridge, and UI labels stay
   hand-written (`apps/dashboard/app/foldkit/profile/{bridge,browser-client,message,model,update}.ts`,
   `apps/dashboard/app/routes/__foldkit.profile.ts`).
4. Generated output imports Foldkit. Neither `@effx/compiler` nor
   `@effx/runtime` has a Foldkit runtime dependency. The fixture-only root
   devDependency is `foldkit@0.165.0`: npm package metadata declares Effect
   `4.0.0` as its peer; mono-web's installed `0.163.0` peers prerelease
   `4.0.0-rc.116` (`apps/dashboard/node_modules/foldkit/package.json:1-5,163-175`).

## Fixture and falsifiers

- Decorator and builder Profile-like GET/PATCH declarations yield identical
  annotations and normalized `UiCommand` IR after erasing only the handler
  source. PATCH declares required `Idempotency-Key`/`If-Match` headers, a
  symbol-based command identity, a 401 problem, and `@Foldkit.Command`.
- `client.ts`, `foldkit.ts`, `http.ts`, and `guards.ts` typecheck through the
  existing generated-file `tsc` harness with real Foldkit types. A wrong
  message constructor, request channel, or failure adapter must fail typecheck.
  Negative fixtures diagnose internal/external root mixing, invalid identity
  metadata, and an unexported Message symbol. The unannotated users example
  and legacy RPC path remain operational.
- Run the emitted HTTP server on an in-process Bun `HttpServer` with a
  test-owned guard and real `HttpClient` Layer. Exercise a successful request,
  a denied request yielding the declared **401** problem rather than a
  transport failure, a transport failure, and request headers on the wire.
  Assert the index's exact external entries and absence of one internal root.
  Construct and discard a Foldkit Command without sending a request; execute
  it through its Effect and assert both success and failure Messages.
- Required gates on the **committed** branch: regenerate the users example,
  `bun run typecheck`, `bun run effect:diagnostics`, `bun run lint`,
  `bun run fmt:check`, `bun run test`. Then fast-forward main and run
  `bun run lint` on main. Record the exercised evidence and unverified
  browser/PostgreSQL boundaries in `STATE.md`.

No full mono-web Profile browser or PostgreSQL journey is claimed in Gate 2A.
The Profile parity suite in `docs/research/profile-baseline.md:376-395` remains
Gate 3's end-to-end acceptance condition.
