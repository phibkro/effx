# Spec 0010 — target profiles, declarations and split HTTP emit modes

Status: **spec-frozen**. This is the compiler-only prerequisite for the
[Profile proving slice](0009-profile-proving-slice.md). It does not rewrite
mono-web, exercise its browser/PostgreSQL journey, or authorize deployment.
Gate 2A's client/Foldkit contracts remain in force for implemented operations
([spec 0007](0007-client-and-foldkit.md)).

## Observable result

One declaration-only Profile twin compiles twice from the same source:
`effx build --emit=contract` writes a group contract; `--emit=handlers`
writes an external raw-binding factory. Both passes have **identical normalized
IR and semantic hash** even when their tsconfigs and output directories differ.
The generated files typecheck against an isolated Effect `4.0.0-rc.116`
project, not just effx's installed `4.0.0`. The original users example still
builds with the default `--emit=all`.

The target is the same Profile GET/PATCH declaration surface as mono-web's
`packages/http-api/src/profile.ts:72-143`: group `profile`, endpoint keys
`readOwnProfile`/`updateOwnProfile`, paths `/api/profile`, conditional 200/304
GET, merge-patch PATCH, security and problem metadata. Its backend owns the
raw `webHandler` path and committing transaction
(`apps/backend/src/profile/http.ts:202-354`,
`docs/research/profile-baseline.md:45-374`). Effx generates wiring only.

## Project target and module names

- `ProjectConfig.target?: "effect-4.0" | "effect-4.0-rc"` selects the generated
  application API profile. CLI `--target=<value>` or `--target <value>` is
  accepted for `check` and `build`. An explicit target wins. Otherwise resolve
  the **target project's installed** `effect/package.json` from its tsconfig
  module-resolution context and decode its version; stable `4.0.0` selects
  `effect-4.0`, `4.0.0-rc.<n>` selects `effect-4.0-rc`. Do not use the CLI
  bundle's own Effect, catalog declarations, or an installed sibling package.
  Missing/unsupported packages produce `EFFX2701` with location and skip files.
  The parsed target tsconfig decides `allowImportingTsExtensions` (including
  inherited settings). `compileCollected` without a project receives an
  explicit default stable profile and conservative `.js` relative imports.
  Source: `packages/frontend-ts/src/project.ts:60-114`,
  `docs/research/rc116-compat.md:16-43`.
- One import-resolution table covers _every generated file_. Stable
  `effect-4.0` keeps `effect/http`, `effect/http-api`, `effect/rpc`,
  `effect/cli`, `effect/net`, `effect/sql`; rc uses respectively
  `effect/unstable/http`, `effect/unstable/httpapi`,
  `effect/unstable/rpc`, `effect/unstable/cli`,
  `effect/unstable/net`, `effect/unstable/sql`. The root `effect` import
  remains unchanged. An unsupported package subpath is an error, not a guessed
  import. For rc the spelling is `httpapi`, **not** `http-api`
  (`docs/research/rc116-compat.md:32-43`, installed target
  `node_modules/effect/package.json` export map). Emitters, including hand-built
  type-only imports, must use this table instead of each keeping an alias.
- Emit local relative imports with `.js` unless the target tsconfig explicitly
  permits TypeScript extensions; with that option, retain `.ts`. Apply this to
  generated-to-generated imports **and** frontend-derived `SchemaRef` and
  `SymbolRef` imports. Keep package specifiers bare. The IR and StableIds never
  depend on the chosen suffix (`docs/research/rc116-compat.md:26-43`,
  `packages/compiler/src/generate/emit.ts:42-78`).
- The frontend recognizes rc's `HttpApiMiddleware` security type stamp and
  rc's `HttpApiSchema` status annotation at their actual installed paths.
  `EFFX2503` cannot be bypassed because the rc marker was missed; an
  explicit status must not vanish. Only source API differences verified in the
  target installation are rewritten. The CLI may use its own bundled stable
  Effect internally (`packages/frontend-ts/src/{lower,signature}.ts`,
  `docs/research/rc116-compat.md:45`).

### One semantic source identity, two output directories

A project's `tsconfig.effx.json` declares `effx.projectRoot` as a path relative
to that tsconfig. `ProjectConfig.projectRoot?: string` can supply the same
value programmatically. For each pass, resolve that path to the common source
root, and collect the same explicit entry. Its local refs and StableIds use
that source root. Lower local symbol modules relative to the **canonical**
`<projectRoot>/.effx/generated` import base, not the selected artifact
directory. At render time, resolve that source location and rebase its import
specifier against the actual artifact directory. The common base equals the
old default for a single-package project, so its existing IR shape and v1/v2
migration laws remain valid. Do not hash the emit mode, target profile,
absolute checkout path, actual output directory, or file suffix. Both passes
must compare byte-identical canonical IR and `semanticHash`; differences in
source declarations still change the hash (`packages/frontend-ts/src/{project,TsSourceFrontend}.ts`,
`packages/ir/src/{Refs,canonical}.ts`, ADR 0003).

## Declaration-only operations and group metadata

- Builder terminal `.declare()` returns an operation declaration with **no
  callable handler**. It lowers the same `Query`/`Command`, `Http.*`,
  `Errors` and `Requirements` annotations as `.handler(...)`, but records
  `binding: "external"`. The `Operation` IR node has optional `handler` only
  when bound locally; analysis rejects `(external, handler present)` and
  `(local, handler missing)`. External operations do not infer empty `E` or
  `R` from an absent function. `@Errors` and `@Requirements` on an external
  operation remain declarations in the IR, including the `Requires` edge;
  local handlers retain the existing assertion semantics. Generated raw
  callbacks restrict typed failures to endpoint problems but infer their
  requirement channel from the backend binding. A declared external
  `@Requirements` service must never be an upper bound that excludes additional
  backend-only services. An external operation with RPC/CLI exposure but no
  executable binding is an error rather than a
  generated fake call (`packages/runtime/src/builder.ts`,
  `packages/frontend-ts/src/{collect,signature}.ts`,
  `packages/ir/src/Node.ts`, `packages/compiler/src/extensions/core.ts`).
- `@Http.Group({ root: RootApiSymbol, group, title, description, displayName })`
  on an exported class and the exported builder value `Http.group(...)` lower
  to one `Http.Group` declaration. `RootApiSymbol` is an exported, statically
  resolved **concrete full HttpApi value** with a literal `identifier`. The
  frontend records that identifier as `HttpGroup.root` and its canonical
  `SymbolRef` as `HttpGroup.rootSymbol`; neither the import path chosen for an
  output directory nor the emit mode enters the IR/hash. A string `root`
  remains valid for existing local declarations (default `effx`), but an
  external raw-handler group needs a resolvable concrete root symbol instead
  of a guessed second root. The group contributes one Schema-defined
  `HttpGroup` node at `group:<root>/<group>`, independently of its operations.
  A `(root, group)` has at most one compatible definition; conflicting root
  symbols or metadata fail analysis. The root identifier must match the
  operations' `Http.Contract.root` string. Emit `.annotateMerge(OpenApi.annotations({
title, description, override: { "x-displayName": displayName } }))` on the
  generated `HttpApiGroup`, not on the imported root; the contract imports no
  backend root (`mono-web/packages/http-api/src/profile.ts:129-143`,
  `packages/compiler/src/generate/http-contracts.ts`).
- For a named endpoint, `Http.Contract.metadata.operationId` must be exactly
  `<group>.<endpointKey>` with a nonempty identifier-safe key. That key drives
  `HttpApiEndpoint.<verb>(key, ...)`, the raw binding record, the guard record
  (`<group>.<key>`), and every client lookup. The stable IR operation ID remains
  distinct. Duplicate `(root,group,key)`, wrong prefix, empty/invalid suffix,
  or missing ID on an externally bound HTTP operation produces `EFFX2403`.
  Unannotated legacy local operations preserve their existing key (`User.Get`
  etc.); metadata validation does not silently rename them
  (`packages/compiler/src/generate/{http,client}.ts`,
  mono-web `packages/http-api/src/profile.ts:72-76,102-109`).
- Optional `Http.Contract.metadata.annotator` is an application-exported callable
  symbol, lowered to a `SymbolRef` (not evaluated by effx). Its input is the
  present `{ operationId, summary, description, tags }` metadata fields; its
  return value is an Effect `Context` merged onto the generated endpoint
  **after** built-in `OpenApi.annotations`. Absent fields are omitted, not
  emitted as `undefined`. This permits application-owned OpenAPI transforms
  such as operation provenance without embedding application constants in the
  compiler or importing backend code. Invalid, inline, or unexported callables
  fail with `EFFX1102` (mono-web `packages/http-api/src/common.ts:193-222`).
- `Http.Problems.codes` remains the single code-list source. The registry call
  defaults to `Registry("<endpointKey>Problem", [...codes])`. The explicitly
  approved `Http.Problems.identifier?: string` override preserves existing
  schema identity when needed: Profile declares
  `ProfileReadOwnProfileProblem` and `ProfileUpdateOwnProfileProblem`.
  The override changes only the schema name, not endpoint key or operation ID.
  Without it, mono-web's `problemUnion(identifier,codes)` would emit a
  different OpenAPI schema identity. Invalid/empty identifiers fail analysis
  (`docs/specs/0009-profile-proving-slice.md:40`, mono-web
  `packages/http-api/src/{endpoint-problems,http-semantics}.ts`).

## Emit modes and raw bindings

`ProjectConfig.emit?: "contract" | "handlers" | "all"`; CLI
`effx build --emit=contract|handlers|all` defaults to `all`.
`effx check` may accept an emit choice for diagnostics but writes nothing.
Emit mode is a projection choice, **not** an IR annotation or semantic hash
input. The manifest records the selected mode and the exact written files;
when a mode changes, obsolete artifacts in the selected output directory
must not masquerade as this build's output (`packages/cli/src/{main,commands,manifest}.ts`,
`packages/compiler/src/{Extension,pipeline}.ts`).

| Mode       | Exact output for an external-only Profile group                                     | Bound behavior                                                                                                                            |
| ---------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `contract` | `profile-contract.ts` only                                                          | Endpoint constants plus exported `ProfileApi` (`HttpApiGroup`); imports no backend handler, root or `AppRoutes`.                          |
| `handlers` | `profile-handlers.ts` only                                                          | Imports the concrete canonical root symbol; exports `ProfileApiHandlers({ raw, guards })` without backend implementation or partial root. |
| `all`      | Both Profile files plus the existing projections for locally implemented operations | Existing users HTTP/RPC/CLI/client/Foldkit behavior stays callable; no external operation gains an invented handler call.                 |

For equal group names under different roots in one output directory, prefix
both filenames with the root identifier; never overwrite. External-only
groups may not have executable RPC/CLI/Foldkit projections unless explicitly
implemented. A mixed local/external binding for the same `(root,group)` is a
diagnostic until a coherent combined group is specified. No mode emits an
empty placeholder file as a substitute for a missing implementation.

The handler factory imports the **concrete full canonical** root named by the
`HttpGroup.rootSymbol` and accepts exact `raw` and `guards` records, not a
generic `Root` argument. It registers via
`HttpApiBuilder.group(ExternalNativeApi, "profile", ...)` and chains
`.handleRaw("readOwnProfile", ...)` and
`.handleRaw("updateOwnProfile", ...)`; it does not serve a second root.
Only the backend-owned handlers artifact imports that root; the generated
contract never imports it, so the backend-to-http-api dependency has no reverse
edge. Native `HttpApi`/`HttpApiGroup` mark group/endpoint parameters invariant:
a generic full-root factory cannot prove the conditional group identifier or
endpoint-map keys under rc.116 without a cast. No cast is permitted.
The generated per-operation raw types derive the decoded request from
`HttpApiEndpoint.HandlerRawWithIdentifier` on that **concrete** root (including
`HttpServerRequest`, params/query/headers when present, but **no payload**).
Each lazy `authorize: () => Effect<Principal, Problem, RGuard>` uses an explicit
per-operation authorization Effect type. The raw callback returns
`Effect<HttpServerResponse, declared endpoint/middleware problems, RGuard | ROp>`.
Each operation has its own free `ROp` inferred from its raw callback at the
`ProfileApiHandlers({ raw, guards })` binding site. Native `handleRaw` joins
GET/PATCH backend services as request-level `HttpRouter.Request.From<"Requires", R>`
markers in the returned Layer. The fixture extracts their payloads with
`HttpRouter.Request.Only<"Requires", Layer.Services<typeof ProfileBindings>>`.
`@Requirements` remains in the IR/`Requires` graph but does not cap either
channel or force a backend implementation import into the generated handlers.
Each qualified guard receives the **same `HttpServerRequest`** from that raw
request and runs only when the application calls the thunk. Missing raw or
guard keys, incompatible response/error channels, and duplicate bindings fail
target TypeScript. The source backend may call its existing `webHandler` once
and must retain its Web Request, raw body, and transaction ownership; this
compiler fixture does not claim its GET authority check shares a SQL snapshot
or that PATCH has run inside a real transaction
(`docs/specs/0009-profile-proving-slice.md:46-54`, mono-web
`apps/backend/src/profile/http.ts:202-354`, installed rc
`HttpApiEndpoint.HandlerRawWithIdentifier` and `HttpApiBuilder.handleRaw`).

### Amendment: mixed-ownership concrete groups

Effx must never emit a handler module that fails native group completeness,
even when an application imports only its raw or guard types. The frontend
inspects the concrete root's group and endpoint maps statically. The proven
endpoint inventory is compiler generation context only: no TypeScript object
or inventory enters the semantic IR or its hash. An unprovable inventory,
missing group, or declared endpoint key absent from that group is `EFFX2415`
(data diagnostic); generation is skipped, not replaced with an invalid factory.
Generation-only inventory diagnostics are deferred behind earlier fatal
diagnostics, because those already prevent every generated artifact. Once the
earlier defect is fixed, a remaining inventory defect must surface as
`EFFX2415` and still prevent factory emission.

An authored root may import its generated group contract, as in mono-web.
Generate the contract before handlers. A committed fixture contract seed is
checked by regenerate-and-compare alongside the Profile, Directory and Contact
seeds; a changed byte must fail that guard. The seed is never a second authored
endpoint definition, and tests isolate writes in fresh temporary copies.

When every concrete group endpoint is declared in effx, the existing factory
and all generated bytes remain unchanged. When the concrete group also has
application-owned endpoints, only the raw-handler factory changes: binding
the declared `raw` and `guards` records returns a completion continuation.
For onboarding with declared `readBoard`/`command` and manual `claim`:

```ts
const completeOnboarding = OnboardingApiHandlers({ raw, guards });
const OnboardingLive = completeOnboarding((handlers) => handlers.handle("claim", claim));
```

The continuation receives native `HttpApiBuilder.Handlers` after registering
the declared raw callbacks. Those endpoint identifiers are already handled;
the remaining identifiers are still required. Native `Handlers.ValidateReturn`
rejects an incomplete completion, native registration rejects duplicate keys,
and endpoint request/success/error types check the manual callback. Only after
completion does the existing concrete-root `HttpApiBuilder.group` build its
layer. Raw/guard records remain restricted to declared operations. There is no
partial-root cast, alternate root, or fabricated implementation.

Completion may return the fully implemented collection directly or an Effect
that constructs it. Native `Handlers.Error` and `Handlers.Context` determine
the returned layer's startup error and services, excluding native `Scope`.
Generated raw/guard services and manual handler services retain native
request-level markers; effectful completion's startup services/errors remain
visible rather than being erased. Stable Effect `4.0.0` and `4.0.0-rc.116` are
the acceptance targets. Tests use fresh temporary projects, including a
type-only consumer, positive `claim`, negative incomplete/duplicate/wrong
request/wrong error completions, and exact service/startup channel assertions.
Existing closed-group identity snapshots and mono-web's nine complete groups
must remain byte-identical; only a new mixed-group fixture may differ.

## Fixture and required checks

Create `packages/frontend-ts/test/fixtures/rc116/` with its **own**
`package.json` pinning `effect@4.0.0-rc.116` and an rc-target tsconfig without
`allowImportingTsExtensions`. No `@vektorprogrammet/*` source or sibling effx
workspace dependency enters the fixture. The Profile twin declares GET/PATCH
`/api/profile`, `ConditionalReadHeaders`, `IdempotencyIfMatchHeaders`,
merge-patch media type, 200/304 and ETag response headers,
`PersonSecurity`, access and registry-backed problems, one `Http.group`, and
two `.declare()` operations. The test-only **concrete full root** imports
the generated `ProfileApi` group from a checked-in, pre-generated contract
artifact. This real generated seed makes the root source-resolvable on a clean
first pass, without a hand-authored duplicate group or a contract → backend
import. Contract mode regenerates it and checks byte equality before handlers
mode runs. Hand-written raw and guard records exercise the native binding
types. Two fixture-only `Context.Service` dependencies (one GET and one PATCH)
are absent from the shared Profile contract; no casts are needed to infer both
in the resulting handler layer. Generate both modes into distinct fixture
directories, then typecheck
the generated files against rc.116 from its own installed
`node_modules/effect`. Keep the original users example and Gate 2A fixture
typechecks green under stable `4.0.0`.

The rc fixture exports `fixtureOperationAnnotations` through its support
module, declares it for both Profile operations, and applies an `OpenApi`
transform that adds `x-test`. After regenerating the checked-in contract,
the rc runtime test calls `OpenApi.fromApi` on the actual generated Profile
group mounted on the full root and inspects GET and PATCH at `/api/profile`.
It does not accept a source-text assertion as evidence of the transform.

Falsifiers:

1. Two modes of the same source have identical canonical IR/semantic hash,
   group keys/metadata/statuses, source-root-relative references and no fake
   handler symbol. Their manifests list only their selected files and mode.
2. The Profile contract imports no backend module, exports a group but no
   root, and has the exact GET/PATCH keys, declared problem identifier
   overrides, merge-patch media, 200/304 and headers. Handler output imports
   only the concrete canonical root symbol (not its implementation) and
   contains two `handleRaw` registrations on it, lazy guards and no
   `handleAll`/`AppRoutes`/body read. The raw handler factory infers independent
   free requirement channels rather than importing declared backend services;
   `HttpRouter.Request.Only<"Requires", Layer.Services<typeof ProfileBindings>>`
   contains distinct GET and PATCH services without widening to `unknown`.
   Negative rc type witnesses fail for a missing raw/guard key and an
   undeclared raw failure.
3. `EFFX2403` catches wrong ID prefix, empty/duplicate endpoint key and a
   missing external key. Invalid binding/group forms, nonliteral or unexported
   root symbols, and hidden source symbols stop generation. Declared and local
   operations cannot swap behavior without a diagnostic.
4. Both emitted files typecheck under installed rc.116; unchanged users and
   Gate 2A artifacts still typecheck under stable 4.0.0. Relative `.js`
   imports resolve to target TS sources, while profile-mapped `effect/*`
   imports exist on the target. Unknown target modules fail diagnostically.
5. The generated Profile root's rc.116 OpenAPI GET and PATCH operations both
   retain `x-test` with their own operation ID, summary, description and
   tags. An invalid or unexported annotator yields `EFFX1102`; a contract
   without this optional metadata retains its prior projection.
6. On the clean committed branch, regenerate the users example, then run
   `bun run typecheck`, `bun run effect:diagnostics`, `bun run lint`,
   `bun run fmt:check`, `bun run test` and the rc116 fixture tsc harness.
   Fast-forward main only when green. Then run `bun run pack` from **clean
   main**; report `dist-artifacts/manifest.json` commit, tarball names and
   SHA-256. Packaging itself is an external distribution artifact, not proof
   of mono-web's frozen install or browser/PostgreSQL journey.

The rc116 fixture tests compiler output and installed target types. Mono-web's
patched rc116 target, portable tarball install in its repository, unchanged
`just e2e profile`, real transactions, and v0.2 byte parity remain Gate 3
integration work under [spec 0009](0009-profile-proving-slice.md).
