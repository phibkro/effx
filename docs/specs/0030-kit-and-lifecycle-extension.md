# Spec 0030 — Effect kit and lifecycle extension

Status: draft (2026-10-10); pending operator approval. No implementation or publication is authorized by this document.

Depends on: proposed ADR 0014; ADRs 0001, 0005, 0008, 0012; specs 0002, 0003, 0005, 0006, 0007, 0010, 0015, 0016, 0020, 0022. Mono-web sources below are read-only references. Paths prefixed `mono-web/` are relative to the mono-web repository root.

## 1. Framework map

The NestJS, Laravel and ASP.NET Core vocabulary below follows this repository's coming-from pages: `apps/docs/content/docs/coming-from/nestjs.mdx`, `laravel.mdx` and `aspnet-core.mdx`. A cell marked `not covered` is not asserted by those pages. The Spring Boot and Phoenix columns are the plan author's mapping, not an effx comparison; there is no comparison page for either framework. Their entries are orientation labels, not a verified feature comparison.

| Concept                         | NestJS                                            | Spring Boot (plan author's mapping)    | Laravel                                                       | ASP.NET Core                               | Phoenix (plan author's mapping)   |
| ------------------------------- | ------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------- | ------------------------------------------ | --------------------------------- |
| Module / DI container           | Modules, providers                                | ApplicationContext, beans              | Service container, providers                                  | IServiceProvider                           | OTP supervision tree, Plug        |
| Controller / router             | Controllers, routes                               | MVC controllers, Spring MVC            | Controllers, routes                                           | Controllers, minimal APIs                  | Router, Plug                      |
| Validation                      | Pipes, class-validator                            | Bean Validation                        | Form Requests, validation                                     | Model binding, validation                  | Ecto changesets                   |
| Guard / policy                  | Guards                                            | Spring Security                        | Gates, policies                                               | Authorization policies                     | Plug; policy is application-owned |
| Interceptor / middleware        | Middleware, interceptors                          | Filter, HandlerInterceptor             | Middleware                                                    | Middleware, filters                        | Plug pipeline                     |
| Repository / ORM and migrations | TypeORM, Prisma, MikroORM                         | Spring Data JPA, Flyway                | Eloquent, migrations                                          | EF Core, migrations                        | Ecto Repo, migrations             |
| Transaction / unit of work      | Not covered by comparison page                    | `@Transactional`                       | `DB::transaction`                                             | `Database.BeginTransaction`                | `Ecto.Multi`                      |
| Domain events                   | Not covered by comparison page                    | Application events                     | Events and listeners                                          | Not covered by comparison page             | PubSub                            |
| Queue / job / scheduler         | Bull/BullMQ, `@nestjs/schedule`                   | `@Scheduled`, Spring Batch             | Queues, Task Scheduling                                       | Hosted services                            | Oban (third-party), OTP processes |
| Mailer                          | Not covered by comparison page                    | JavaMailSender                         | Mail                                                          | Not covered by comparison page             | Swoosh integration                |
| File storage                    | Not covered by comparison page                    | Resource, MultipartFile                | Storage / filesystem                                          | IFormFile                                  | Plug.Upload                       |
| Configuration                   | ConfigModule                                      | ConfigurationProperties                | Configuration                                                 | Configuration, options                     | Application config                |
| State machine / workflow        | Not covered by comparison page                    | Spring Statemachine (separate project) | Not covered by comparison page                                | Not covered by comparison page             | OTP `gen_statem`                  |
| CLI scaffolding                 | `nest generate`                                   | Spring Initializr                      | Artisan                                                       | `dotnet new`, code generators              | `mix phx.new`, generators         |
| Test harness                    | `Test.createTestingModule`                        | `@SpringBootTest`, MockMvc             | HTTP tests, Pest or PHPUnit                                   | WebApplicationFactory                      | ConnTest, ExUnit                  |
| OpenAPI / client                | Swagger integration; client tools consume OpenAPI | springdoc-openapi (third-party)        | No first-party OpenAPI/client generator stated                | Microsoft.AspNetCore.OpenApi, NSwag, Kiota | open_api_spex (third-party)       |
| Admin / operations              | Not covered by comparison page                    | Actuator; admin UI is separate         | Telescope and Pulse (observability, not an admin-panel claim) | Health checks; no admin UI claim           | LiveDashboard                     |
| Realtime                        | WebSocket gateways, SSE                           | WebSocket / STOMP                      | Broadcasting, Reverb                                          | SignalR                                    | Channels, PubSub, LiveView        |

The table below uses exactly four statuses: `exists` means an effx construct or Effect module is present; `spec` means an approved/frozen effx contract without an implementation claim; `proposed here` means this draft proposes it; `gap` means no such construct is present or proposed here. A qualified cell narrows the claim; it does not turn a gap into support. Effect module names were checked in the installed `effect@4.0.0` source and export map. Application-facing modules such as `effect/http-api`, `effect/sql`, `effect/persistence`, `effect/workflow`, `effect/cluster`, `effect/rpc` and `effect/cli` are marked `@stability unstable` there; module existence is not a stability guarantee.

| Concept                         | Effect v4 construct                                                                                                                        | effx today                                                                                                        | Kit proposal                                                                        | Status                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Module / DI container           | `Context.Service`, `Layer`                                                                                                                 | `@Requirements` asserts inferred `R`; no container (ADR 0005, ADR 0012)                                           | No container; explicit Layers only                                                  | exists                                                      |
| Controller / router             | `effect/http-api` `HttpApi`, `HttpApiEndpoint`, `HttpApiGroup`                                                                             | HTTP operation declarations and generated wiring (spec 0005)                                                      | No router                                                                           | exists                                                      |
| Validation                      | `Schema`; endpoint decoding in `effect/http-api`                                                                                           | Input and contract schemas (spec 0005)                                                                            | Reuse schemas; no second validator                                                  | exists                                                      |
| Guard / policy                  | `effect/http-api` `HttpApiMiddleware`, `HttpApiSecurity`                                                                                   | Access declaration and typed guard binding; no policy evaluation (spec 0006, ADR 0007)                            | No authorization engine                                                             | exists (declaration only); evaluation gap                   |
| Interceptor / middleware        | `effect/http-api` `HttpApiMiddleware`; `effect/http` `HttpMiddleware`                                                                      | Contract and group middleware markers (specs 0005, 0013)                                                          | No separate interceptor system                                                      | exists (attachment); app behavior remains application-owned |
| Repository / ORM and migrations | `effect/sql` `SqlClient`, `SqlSchema`, `SqlModel`, `Migrator`                                                                              | `@effx/persistence` ports and conformance suites; no SQL or migration generation (spec 0022)                      | No ORM or migration generator                                                       | exists (ports); SQL generation gap                          |
| Transaction / unit of work      | `effect/sql` `SqlClient.withTransaction`                                                                                                   | No generic command transaction runner (`mono-web/docs/specs/commands-and-concurrency.md`; consolidation draft §8) | `Command.runCommand` with `Tx` and declared `LockSet`                               | proposed here                                               |
| Domain events                   | `PubSub`; `effect/eventlog` journal                                                                                                        | No domain-event construct                                                                                         | Audit facts and transactional outbox, not an in-process event bus                   | gap (in-process domain event bus)                           |
| Queue / job / scheduler         | `effect/persistence` `PersistedQueue`; `effect/workflow` `Workflow` and `DurableQueue`; `effect/cluster` `ClusterCron`; `Schedule`, `Cron` | No queue or schedule declaration (research §2)                                                                    | `Delivery` envelopes and policy-as-data; no `@Schedule` in this spec                | proposed here (delivery); scheduling declaration gap        |
| Mailer                          | No mail module found in installed `effect@4.0.0` source                                                                                    | No mail construct                                                                                                 | Application-owned `Mail` service only where a delivery kind needs it                | gap                                                         |
| File storage                    | `FileSystem`; `effect/http` multipart                                                                                                      | No object-storage or upload construct (research §5)                                                               | Application-owned file-store port; no provider implementation                       | gap                                                         |
| Configuration                   | `Config`, `ConfigProvider`, `Redacted`                                                                                                     | Compiler config only (spec 0015)                                                                                  | No application config system                                                        | exists (Effect); effx application config gap                |
| State machine / workflow        | `effect/workflow` `Workflow`, `Activity`, `DurableClock`, `DurableDeferred`; no in-process lifecycle machine verified                      | No lifecycle construct                                                                                            | `Lifecycle` using the mono-web-approved `@xstate/effect` actor-per-command contract | proposed here, gated on lifecycle approval and spike        |
| CLI scaffolding                 | `effect/cli` `Command`, `Flag`                                                                                                             | `@Cli` operation projection; no project scaffolder (spec 0003)                                                    | No scaffolder                                                                       | exists (CLI projection); scaffolding gap                    |
| Test harness                    | `@effect/vitest`, `effect/testing` `TestClock`, `effect/http-api` `HttpApiTest`, `effect/rpc` `RpcTest`                                    | Persistence adapter conformance suites (spec 0022); no general module-override harness                            | `Testing` equivalence and `xstate/graph` model-test helpers                         | proposed here (lifecycle helpers); general harness gap      |
| OpenAPI / client                | `effect/http-api` `OpenApi`, `HttpApiClient`                                                                                               | HTTP metadata and generated client (specs 0005, 0007)                                                             | No second generator                                                                 | exists                                                      |
| Admin / operations              | `effect/devtools`, `HttpApiScalar`, `HttpApiSwagger`                                                                                       | `inspect`, `graph`, and Foldkit projection; no admin/CRUD UI (research §5, spec 0007)                             | No admin surface                                                                    | gap                                                         |
| Realtime                        | `effect/socket`, `effect/rpc`, `effect/encoding` `Sse`                                                                                     | Generated RPC uses HTTP; no streaming declaration (research §5)                                                   | No channel or presence layer                                                        | gap (application-level channels / presence)                 |

The comparison pages give the effx status vocabulary `supported`, `via ecosystem package` and `gap` (NestJS, Laravel, ASP.NET Core pages above). This spec's four-status column answers a different question: whether the named Effect/effx/kit construct is present or contracted. The vocabulary table's Spring Boot and Phoenix cells are the plan author's mapping throughout, including where their names are conventional orientation rather than verified product claims.

## 2. Kit modules

All signatures below are TypeScript sketches, not implemented exports. Types are explanatory shapes, not a frozen API. Each module names its first consumer and the mono-web source it generalises. The database, delivery and security adapter details remain owned by the application.

### Command

Purpose: one transaction boundary for a command. It takes the declared lock set, checks the command receipt digest, resolves current authority, calls a pure decision, persists owner tables, records the receipt and audit facts, enqueues effects, then commits. The command's requirements cannot include provider I/O. `Tx` is provided only by `runCommand`.

```ts
export type LockSet = ReadonlyArray<LockKey>;
export interface CommandContext {
  readonly commandId: CommandId;
  readonly actor: Actor;
}
export interface Tx {
  readonly execute: <A>(statement: Statement<A>) => Effect.Effect<A, SqlError>;
}
export declare const runCommand: <A, E, R extends TxScoped>(
  spec: CommandSpec<A, E, R>,
) => Effect.Effect<A, E | CommandFailure, Exclude<R, Tx> | SqlClient.SqlClient>;
```

First consumer: mono-web Placements pilot, after its frozen command contract's prerequisites. Generalises `mono-web/docs/specs/commands-and-concurrency.md` and `mono-web/docs/specs/architecture-consolidation.md` §8. The generic statement shape and how `TxScoped` is branded are open implementation questions; this sketch does not claim that arbitrary `R` subtraction is implemented.

### Receipt and Audit

Purpose: use one domain receipt table keyed by command id, storing canonical command JSON, SHA-256 digest, stored result and actor; use one append-only audit-fact table keyed by command id and ordinal. Kind registries are explicit schema-bearing values. The security audit remains separate. This is distinct from the HTTP transport receipt.

```ts
export interface ReceiptKind<A> {
  readonly kind: string;
  readonly result: Schema.Codec<A>;
}
export interface AuditKind<A> {
  readonly kind: string;
  readonly payload: Schema.Codec<A>;
  readonly retention: RetentionClass;
}
export declare const makeReceiptKinds: <Kinds extends ReadonlyArray<ReceiptKind<unknown>>>(
  ...kinds: Kinds
) => ReceiptKinds<Kinds>;
export declare const makeAuditKinds: <Kinds extends ReadonlyArray<AuditKind<unknown>>>(
  ...kinds: Kinds
) => AuditKinds<Kinds>;
```

First consumer: mono-web command runner and the Receipt pilot. Generalises the table and cutover proposal in `mono-web/docs/specs/architecture-consolidation.md` §8. Retention for some audit kinds remains an operator decision in that draft.

### Delivery

Purpose: persist immutable effect envelopes in the same command transaction and deliver only after commit. Per-kind ordering, envelope mode, secret handling, retries, quarantine, cancellation, provider port and idempotency key are explicit data. It exposes a bounded drain unit, not a provider SDK or a resident worker policy.

```ts
export interface EffectPolicy {
  readonly ordering: OrderingPolicy;
  readonly retry: RetryPolicy;
  readonly secret: SecretPolicy;
  readonly quarantine: QuarantinePolicy;
}
export interface OutboxDrain {
  readonly drainOnce: (
    aggregate: AggregateId,
    budget: DrainBudget,
  ) => Effect.Effect<DrainResult, DeliveryFailure>;
}
export declare const pollingLayer: (
  options: PollingOptions,
) => Layer.Layer<never, DeliveryFailure, OutboxDrain>;
```

First consumer: mono-web's existing `OutboxDrain` port and, after the Workers S2 branch lands, its `waitUntil` tail and minutely Cron trigger. Generalises `mono-web/docs/specs/infrastructure-ports.md` and the policy table in `mono-web/docs/specs/architecture-consolidation.md` §8; the trigger reference is unlanded mono-web branch `feat/workers-s2-delivery`, spec `mono-web/docs/specs/workers-s2-delivery.md`. These are design references, not evidence that the code is integrated.

### Lifecycle

Purpose: make the owning domain's legal state transitions explicit; run one Effect actor for one command inside the transaction scope. The machine owns transition legality; declared `fromEffect` actors perform only transaction-scoped work. It does not perform mail, HTTP or file I/O. The row remains authoritative; persisted XState snapshots are not part of this proposal.

```ts
export type LifecycleOutcome<Decision, Failure> =
  | { readonly _tag: "Decided"; readonly decision: Decision }
  | { readonly _tag: "Refused"; readonly failure: Failure };
export declare const runLifecycleCommand: <
  Machine,
  Hydrated,
  Event,
  Decision,
  Failure,
  R extends TxScoped,
>(
  machine: Machine,
  hydrate: Effect.Effect<Hydrated, Failure, R>,
  event: Event,
) => Effect.Effect<LifecycleOutcome<Decision, Failure>, Failure, R | Tx>;
```

First consumer: mono-web receipt lifecycle pilot, only after the lifecycle-machines contract is approved and its actor-per-command spike has completed. Both are still in progress/unlanded; this spec records no spike result or cost. Generalises `mono-web/packages/domain/src/receipt/update.ts` `decideReceipt`, its consumer `mono-web/apps/backend/src/http-api/receipt-transaction.ts`, and an unlanded lifecycle-spec branch whose draft file was not present when checked on 2026-10-10. XState pins are prerelease: `xstate` 6.0.0-alpha.65 and `@xstate/effect` 0.1.0-alpha.7. mono-web's compatibility and approval gates remain controlling.

### Testing

Purpose: share lifecycle equivalence, reachability and derived-set checks rather than making each application invent them. Property generation stays behind the testing adapter; Effect `Arbitrary` is unstable.

```ts
export declare const assertEquivalent: <Input, Output, Failure>(
  legacy: (input: Input) => Result.Result<Output, Failure>,
  machine: (input: Input) => Effect.Effect<Output, Failure>,
  inputs: Schema.Schema<Input>,
) => Effect.Effect<void, TestFailure>;
export declare const assertReachable: <Machine>(
  machine: Machine,
) => Effect.Effect<void, TestFailure>;
export declare const assertDerivedStates: (
  states: ReadonlyArray<string>,
  sqlCheck: ReadonlyArray<string>,
) => Effect.Effect<void, TestFailure>;
```

First consumer: mono-web receipt pilot. Generalises `mono-web/packages/domain/src/receipt/update.property.test.ts` and the state-machine coverage falsifiers in the lifecycle draft. Checks compare failures as well as decisions, and model-test every reachable state and both final outcomes.

## 3. effx lifecycle extension

The extension is a separate package, shaped like `@effx/persistence` with `syntax` and `compiler` entry points. It builds on spec 0020's public `target: "operation"` only. It does not add a compiler-core dependency, execute application modules or change generated runtime behavior.

The built-in operation annotation is already named `Command`; the extension must not claim that name. Use a namespaced declaration such as `Kit.Lifecycle` and `Kit.Locks`, both applied only to a `Command` operation.

```ts
export const Lifecycle = Annotation.define({
  name: "kit.Lifecycle",
  target: "operation",
  args: { machine: A.symbol({ check: "exported-value" }), event: A.string },
  cardinality: "one",
});
export const Locks = Annotation.define({
  name: "kit.Locks",
  target: "operation",
  args: { keys: A.array(A.string) },
  cardinality: "one",
});
```

The `machine` symbol is an exported value. The frontend cannot execute it or enumerate its event set (ADR 0001). Therefore the extension cannot truthfully claim that IR analysis alone proves the machine's event set. The proposed derivation is: collect machine symbol plus literal event pairs from operation annotations; reject duplicate operation bindings for the same pair; emit a plain generated event tuple keyed by resolved module and export; have the kit compare that tuple with the machine's typed event union so TypeScript rejects missing or extra events. This type-level contract must be proved in the spike/implementation before the extension claims bidirectional coverage. No generated file imports `@effx/kit`.

Analyses and projections:

- Every `kit.Lifecycle` and `kit.Locks` annotation belongs to a command operation; a Query binding is diagnosed.
- Each `(machine symbol, event)` pair has exactly one operation. Use an extension-owned diagnostic family assigned through spec 0016's registry; the 35xx family is not reserved here and must not be assumed available.
- For operations with handlers, the extension can inspect the inferred service references (`service:` ids plus `SymbolRef`, spec 0002) and reject configured provider requirements on the command path. It does not assert that every handler requirement contains `Tx`: `runCommand` discharges `Tx` from the result requirements. Declaration-only operations without an inferred handler signature cannot receive this analysis.
- The generated event tuple is plain data for the kit's type-level check. OpenAPI state enums come from the lifecycle state schema supplied by the application; no effx status-enum projection is needed. A Foldkit allowed-action projection is a later HTTP contract change, not part of v1.

## 4. Sequencing

1. Approve the mono-web lifecycle-machines contract and complete its spike. This spec makes no claim about equivalence, coverage, performance or compatibility.
2. Wait for mono-web's stable Effect v4 branch (`feat/effect-stable-v4`) to land before adopting `@xstate/effect`; stable `effect@4.0.0` is required by its peer range, while mono-web `main` was on rc.116 at the measured baseline.
3. Build the house constructs in mono-web on the `runCommand` and receipt lifecycle pilots. Keep provider I/O outside the transaction and preserve the old decider as the equivalence oracle until each lifecycle passes its falsifiers.
4. Extract to `@effx/kit` only after a second real consumer uses the same construct. Extraction moves the proven construct; it does not redesign it. The extension package follows once the event-set type derivation works against a real lifecycle machine.
5. Delivery unification comes last, together with mono-web consolidation step 4/5 and the Workers S2 triggers. Do not replace queues or outboxes independently of immutable envelopes, claim fencing, predecessor order, retry, cancellation and secret cleanup.
6. Spec 0020 is implemented on effx `main` at `055bbbed`; it is not a pending merge prerequisite. Spec 0022 remains the persistence boundary: ports and adapter conformance, not generated SQL or migrations.

## 5. Falsifiers

1. A package import-graph check proves `@effx/kit` imports no `@effx/*` package and generated files import no `@effx/kit` package.
2. A type test accepts a command requiring only `TxScoped` services and rejects one requiring `Mail`, HTTP or file storage. `Tx` is absent from the returned requirement set of `runCommand`.
3. For each annotated command, an effx fixture checks `Kit.Lifecycle`/`Kit.Locks` are rejected on Query operations and duplicate `(machine, event)` bindings are diagnosed. Declaration-only operations are reported as uncheckable where no handler signature exists.
4. A type-level event-set test rejects a missing and an extra machine event. If TypeScript cannot derive the machine event union through the proposed generated tuple, this design is falsified and the annotation contract must change before implementation.
5. Until the legacy decider is deleted, generated reachable command sequences produce equal decisions and typed failures. State-model tests reach every machine state and both final outcomes; SQL CHECK literals equal the machine state set. Record a mutation check per lifecycle.
6. Against PostgreSQL, stale revisions and concurrent commands preserve the current typed failures and locking behavior. These checks require the mono-web `runCommand` real transaction implementation; effx compiler tests alone cannot prove them.
7. Each unstable Effect adapter has one owner module and a test of its Layer boundary. No SQL, provider SDK, HTTP or file service crosses the transaction boundary.
8. A generated event tuple is byte-stable for identical IR. A changed machine symbol or event changes the tuple deterministically and the type test identifies the mismatch.

## Non-claims

- This is a draft. `@effx/kit` and the lifecycle extension do not exist as packages and are not published.
- No ORM, schema-diff or migration generation is proposed (spec 0022).
- No Cedar runtime or policy evaluator is proposed.
- No XState spike result, equivalence result, model coverage or cost is claimed. The mono-web lifecycle contract and spike are still in progress.
- The Spring Boot and Phoenix mappings are the plan author's mapping, not source-verified comparisons. Several NestJS, Laravel and ASP.NET concepts are marked `not covered` because the existing pages do not compare them.
- Effect module presence in version 4.0.0 does not establish stability, production suitability or API compatibility with mono-web's rc.116 baseline.
