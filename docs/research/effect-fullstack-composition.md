# effx in a composed Effect full-stack — research and design notes

Status: research, 2026-10-04. No package change is authorized by this file. Operator direction: keep the core value proposition focused; the closer effx gets to a *composition of existing packages* the better; effx bridges enterprise frameworks and full-stack Effect (§5, §6).

Claims carry a citation key + path (+line). `[INFERENCE]` = my reasoning, not observed. External repos were cloned read-only into `temporary workspace`; nothing was run against Cloudflare, no deploy, no account.

| Key | Source | Pin |
| --- | --- | --- |
| effx | `.` main | `a97a87e` (specs 0015 lives on worktree branch `config-project-0015`, not yet on main) |
| RS | github.com/joelhooks/rat-stack (+ ratstack.sh pages) | `37b8ba9` (2026-10-03); `@rat-stack/capability` `0.1.0`, `"private": true` |
| YA | github.com/yielded-dev/auth | `68a4679`; `@yielded/auth` `0.1.0-beta.14` (npm `beta` tag, 2026-10-02; `latest` tag still `beta.1`) |
| CT | github.com/third774/cloudflare-effect-tracer | `20b7612`; `0.1.3` (2026-10-01) |
| AL | github.com/alchemy-run/alchemy `packages/alchemy` | `ea384f0` (2026-10-02) = `2.0.0-beta.80`, the version installed in `kwyne/node_modules` (adlc-os pins `beta.72`) |
| EF | `effect@4.0.0` (2026-10-01) as installed at `kwyne` | every app-level module below is tagged `@stability unstable` |
| MW | `mw` (read-only) | `f433ea90` |
| DZ | `drizzle-orm@1.0.0-rc.4` tarball (2026-06-27) | unpacked in `temporary workspace` |
| CF | developers.cloudflare.com pages, fetched 2026-10-04 | page "last updated" dates inline |
| npm | registry queries 2026-10-04 | version + `time.modified` inline |

## 0. Conclusions

1. effx should **not** target rat-stack's capability contract (private package, coarser contract, handler shape already identical). It should compete on whole-program diagnostics, non-executing analysis, and HTTP-grade contract fidelity (§1).
2. Of the Cloudflare map, only **HTTP→Worker fetch** and **tracing span names** are derivable from IR today; cron/queue need new annotations; Effect `Workflow`/`Cluster`→CF Workflows/DO has **no bridge anywhere** and stays hand-written (§2). `effx infra` generation is not worth building now; a *manifest + check* is.
3. Auth, tracing, infra integrate as **extension packages on spec 0020's `Annotation.define`**; core depends on none (§3).
4. The #1 enterprise-evaluation blocker is not an effx gap: **every application-level Effect module is `@stability unstable`** (§5). #2 is migrations/ORM familiarity, which §6 answers with a *port + conformance suite*, not ORM adapters.

## 1. Honest comparison with rat-stack

### 1a. Same goal, different mechanism

| Aspect | rat-stack (runtime projection) | effx (AOT compiler) |
| --- | --- | --- |
| Contract | `defineContract(name, {description,input,output,failure,annotations,needsApproval,http})` (RS `packages/capability/src/contract.ts:202`) | decorators/builders → `Annotation` → Schema-defined IR (effx `AGENTS.md`; `packages/ir/src/Node.ts:39-67`) |
| Handler binding | `implement(contract, handler)` (RS `implement.ts:19`) | handler is the user's static method; generated adapters import it (effx `examples/users/src/operations.ts`) |
| E / R | type-level: handler typed `Effect<Output, ContractFailure, R>`, `Capability<Contract, R>`, `RequirementsOf` (RS `implement.ts:19-30`, `contract.ts:94-105,166-172`) | inferred by TypeChecker, stored as `Declared{values, inferred}` in IR; `@Errors/@Requirements` assert (effx ADR 0005; `Node.ts:39-50`) |
| HTTP expressiveness | `HttpRoute = {method, path}` only (`contract.ts:23`); one flat group `"capabilities"` (`to-http-api.ts:35`) | root + groups, problems, access/concealment, headers, status; 108 endpoints/15 groups in the mono-web corpus (effx specs 0005/0006/0013; spec 0004 inventory) |
| Surfaces | CLI, HTTP, MCP, RPC, code mode (`AGENTS.md:25`; ratstack.sh `/systems/capabilities`) | HTTP, RPC, CLI, client, Foldkit (effx `STATE.md`) |
| Build step | none; projections run at startup | TS6 frontend, registered exception (ADR 0009) |
| Reflection | `toCatalog(capabilities)` → JSON Schema catalog (RS `catalog.ts:24`) | canonical JSON IR + sha-256 `semanticHash` (ADR 0003) |
| Infra | Alchemy Worker program evaluated by `alchemy plan` (RS `apps/infra/alchemy.run.ts`; ratstack.sh `/skills/learn-alchemy`) | none |
| Stability | repo "for stealing ideas, not a supported product" (RS `README.md:7`) | pre-1.0, mono-web proving slices (effx `STATE.md`) |

### 1b. What can only a compiler provide?

| Candidate | Only-compiler? | Evidence / honest caveat |
| --- | --- | --- |
| Handler E ⊆ declared errors check | **No** — tsc enforces it through RS generics (`implement.ts:25-30`) | effx's extra is E/R as *queryable data* ("which operations require `Users`", "which can fail with `EmailTaken`") |
| Cross-declaration diagnostics with source locations (group-name collision `EFFX2406`, unprotected endpoint `EFFX2504`, required guard binding) | **Yes, structurally** | effx specs 0013, 0006, `STATE.md` evidence rows. RS's analogue is lint (`AGENTS.md:128` fence) and type-level `RouteParamsCheck` (`contract.ts:42`); I found no cross-file route-collision check in the files read |
| Semantic hash / inspect / graph that does not execute the app | **Yes** | ADR 0001 + spec 0015 (one evaluated module: the config). RS projections need the evaluated registry. A runtime catalog *can* be hashed, but only after importing app modules |
| Contract-only vs handlers-only emit | No — RS reached the same split by hand (`defineContract`/`implement`; ratstack.sh `/lore/one-capability-every-surface`, commit `9a7bea5`) | effx derives both mechanically from one IR (spec 0010) |
| Cedar schema from the program | Partly | RS could emit it from its registry at runtime; the compiler adds only non-execution + source locations. `effx cedar` does **not exist**: ADR 0007 defers it, `grep -ri cedar packages` is empty |
| Infra plan from the whole program | **Weak** | Alchemy's plan *is* the evaluated Stack Effect (§2 F1). Static IR sees annotated facts only, never `Config`/stage values |

Net: the structurally compiler-only value is (i) non-executing analysis and (ii) cross-declaration diagnostics/hash. Everything else is shared or reachable at runtime.

### 1c. What a runtime projection does better

| Win | Evidence |
| --- | --- |
| No build step, no TS6 frontend, no generated files to keep fresh | RS has none; effx pays ADR 0009's registered exception and the "run `effx:build` before typecheck" tax (`STATE.md` Deferred) |
| More surfaces for free (MCP, code mode, devtools) from one registry | RS `to-toolkit.ts`, `to-code-mode.ts`; `devtools(capabilities)` adds dev-only capabilities (`AGENTS.md:146`) |
| Flags that change channels in types: `needsApproval` adds `Approval` to R and `ApprovalDenied` to E | RS `contract.ts:56-60,160-172` |
| Dynamic composition per environment | RS `AGENTS.md:146-147` |

### 1d. Where effx should / should not compete; target rat-stack's shape?

- **Compete**: HTTP-grade contract fidelity; whole-program checks; no-execution `check/inspect/graph`; reviewable generated Effect (ADR 0008).
- **Do not compete**: MCP/code-mode/devtools/approval runtimes; runtime registries.
- **Target `defineContract`/`implement`? No.** (a) `@rat-stack/capability` is `"private": true` (RS `packages/capability/package.json:4`) — generated imports would point at an unpublishable package; (b) its contract is coarser than the IR (`InputSchema = Schema.Struct<…>` `contract.ts:19`; one `failure` schema; `HttpRoute` method+path), so the mapping is lossy; (c) the handler shape already matches — a user can hand-write `implement(defineContract(…), UserOperations.get)` today with zero effx support. If an MCP/code-mode surface is wanted, the neutral artifact is a JSON-Schema *catalog* derived from the IR, consumed in user land.
- **Adopt as ideas**: channel-affecting flags (`needsApproval`) — IR already carries `requirements.inferred`; "cartridge = a Layer carries its infrastructure" (ratstack.sh `/lore/cartridges`) for §2/§3.

## 2. Cloudflare / Alchemy as a target, scoped

Findings that shape the table:

- **F1 — infra and runtime are one Effect.** `Cloudflare.Worker(name, props, Effect.gen(...))`; `Workers.cron(expr, handler)` registers the trigger *and* the handler (AL `src/Cloudflare/Workers/CronEventSource.ts` doc, lines ~40-60); `consumeQueueMessages(queue, props, handler)` yields the `Consumer` resource and the runtime listener (AL `Queues/EventSource.ts:120`). Worker init runs at deploy and at runtime, hence `globalThis.__ALCHEMY_RUNTIME__` guards (RS `apps/mischief/src/worker.ts`; ratstack.sh `/lore/init-runs-twice`). So "derive infra from IR" means *generate a Worker entry module*, not a separate topology. kwyne takes the other road: `infra/topology.ts` is the source and `alchemy.run.ts` derives bindings from it (`kwyne/alchemy.run.ts:47`).
- **F2 — Alchemy ships its own Effect→Workers-tracing Layer** (AL `Workers/CloudflareTracer.ts:72`, `Workers/Telemetry.ts:19`: needs compatibility date ≥ `2026-07-28`). `cloudflare-effect-tracer` is the standalone equivalent for non-Alchemy Workers: `makeCloudflareTracer()` provided as `Tracer.Tracer` per request (CT `README.md`, `src/index.ts:154`); it forwards scalar attributes, records `effect.exit`, and `recordException` needs compat date ≥ `2026-09-25` (CT `README.md`).
- **F3 — no bridge from `effect/workflow` / `effect/cluster` to Cloudflare Workflows / Durable Objects.** `grep -rn "effect/workflow\|effect/cluster\|effect/persistence" alchemy/src` matches only DO chat persistence and a bundler plugin. `Cloudflare.Workflow` uses Alchemy's own `WorkflowStep` API (AL `Workflows/Workflow.ts:30-35`). Only SQL-in-DO exists: `@effect/sql-sqlite-do` `4.0.0`.
- **F4 — two queue models.** CF Queues deliver at-least-once (CF `queues/reference/delivery-guarantees`); Effect `PersistedQueue` is also at-least-once but stored in SQL/Redis/memory (EF `persistence/PersistedQueue.ts:11`). Retry/batch/dead-letter are CF consumer config (AL `Queues/EventSource.ts` `MessagesProps`), not part of the Effect type.

| Construct (effx IR today) | CF primitive | Alchemy v2 API | Static IR knowledge needed | Verdict |
| --- | --- | --- | --- | --- |
| HTTP exposure (`Exposure{http}`, `HttpGroup`) | Worker `fetch` | `Cloudflare.Worker` fetch is an `HttpEffect` (AL `Workers/HttpServer.ts:16`) | the generated `AppRoutes`/group layers exist ✓ | **Derivable**: ~10-line Worker entry that builds the web handler from generated routes. Routes/domains/zone: hand-written |
| RPC (`Exposure{rpc}`) | Worker RPC / service binding / DO RPC | `makeRpcStub` (AL `Workers/Rpc.ts:~25`), `RpcWorker`, `RpcDurableObject` | which ops are RPC ✓; *where* served is deployment config | Hand-written; optional annotation later |
| Schedules | Cron Triggers (also Workflow `schedules`, CF `workflows/build/trigger-workflows`) | `Workers.cron(expr, h)` | **no IR concept** — needs `@Schedule("0 * * * *")` on a Command | **New annotation** (extension pkg); then derivable |
| Jobs/queues (`PersistedQueue`) | Queues + consumer | `Queues.Queue`, `consumeQueueMessages` | queue name, message `SchemaRef` ✓, batch/retry props ✗ | New annotation for consumer props; producer binding is a Service → hand-written Layer. Semantics differ (F4) |
| Workflows (`effect/workflow`) | CF Workflows | `Cloudflare.Workflow` (own step API) | — | **Hand-written** (F3) |
| Entities (`effect/cluster`; report §Cluster, deferred) | Durable Objects | `Cloudflare.DurableObject` (AL `Workers/DurableObject.ts`) | — | **Hand-written** (F3); do not build |
| Persistence (`Model.table`, `PersistsAs`) | D1 / Hyperdrive | `D1.Database` with `migrations` dir applied on deploy (AL `Cloudflare/D1/Database.ts:87-101`), `Hyperdrive.Connection` | vendor choice is deployment (RS `DatabaseVendor`, `/lore/cartridges`) | **Hand-written** Layer; spec 0008 removed 0 lines (§6) |
| Service requirements (`Operation.requirements`) → bindings | Worker bindings | inferred by Alchemy from the consuming code (ratstack.sh `/skills/learn-alchemy` "Why not wrangler") | already in IR | **Nothing to add** — Alchemy already infers |
| Tracing | Workers Traces | Alchemy `Cloudflare.Telemetry`, or CT | operation StableId as span name ✓ | **Derivable & small**: optional `Effect.withSpan(operation.name)` in generated bindings; Layer provided at composition root |
| Config/secrets, R2, KV, Email, RateLimit | bindings | `WorkerConfigProvider` (AL `Workers/ConfigProvider.ts`), `R2.Bucket`, `Email.Send`, `RateLimit` | — | Hand-written |

### Sketch: `effx infra` (opt-in projection, like the deferred `effx cedar`)

```
IR ──▶ analysis: every @Schedule/@Queue op has a matching binding   (rung "test")
   └─▶ generator (opt-in): .effx/generated/worker.ts  = Worker entry that
         · builds fetch from generated AppRoutes
         · yield* Workers.cron(expr, handlerOf(op)) per @Schedule op
         · leaves `provide(layers)` to a user-owned effx.infra.ts
   never: Stack, Zone, DNS, D1/R2 resources, deploy. `alchemy plan` stays the review step.
```

- Rung choice follows the operator's derivation ladder (generate > test > convention, `AGENTS.md`). Start with the **test rung** (a manifest of surfaces + checks against the hand-written `alchemy.run.ts`); generate only the Worker entry, and only after two real Workers repeat the pattern.
- Alchemy is a beta moving weekly (adlc-os `beta.72` vs kwyne `beta.80`; "Alpha and beta APIs drift" — ratstack.sh `/skills/learn-alchemy` Gotchas). Generated Alchemy code must live in an extension package that pins the version, never in core.

## 3. Composition, not reimplementation

Frame (effx spec 0020, `a97a87e`, **proposed**): `Annotation.define({name,target,args,effect?})` in `@effx/runtime` (data only), `Annotation.implement(def,{read?,analyze?,write?,lift?})` in `@effx/compiler`, registered via `defineConfig({extensions})` (spec 0015). Writers may be `Annotation.Fragment` slots (`endpoint|group|root|rpc|command`) appended to the built-in generators (spec 0020 §6). `target` is `operation|class|model|group`.

```
@effx/ir ◀── @effx/compiler ◀── @effx/cli   (loads effx.config.ts)
                 ▲  Annotation.define/implement
     @effx-ext/<x> ──peer dep──▶ <x> (Yielded Auth, Alchemy, …)
core imports nothing to the right; generated output imports <x>, pinned via target profile (spec 0010)
```

| Concern | Package(s), version/date | Integration surface | What the extension package adds | Stays out |
| --- | --- | --- | --- | --- |
| Auth: Yielded | `@yielded/auth` `0.1.0-beta.14`; `AuthContract.make`, `Auth.make`, `Http.layer`; `AuthContract.httpGroup(AuthApi)` joins an existing `HttpApi` (YA `docs/…/http-and-client.mdx:163`); `SessionHttp.RequireSession` is group middleware (`:224-227`) | effx already supports it **today**: app-owned root `.add(effxGroup, AuthContract.httpGroup(AuthApi))` (spec 0013 `Http.group({root})`) and `defaults.middleware` | annotation `@Auth.Session` → IR ext node; analysis: operation requires `CurrentSession` or declares credential `session` but its group has no session middleware; fragment fills group middleware | sign-in routes, sessions, storage (YA owns them; storage Layers per §6) |
| Auth: Better Auth | `better-auth` `1.7.7` (2026-09-30); `@alchemy.run/better-auth` `2.0.0-beta.80` with D1/Hyperdrive (RS `packages/auth/src/auth.ts:1-60`); MW uses `better-auth 1.7.1` over a `pg` Pool (MW `packages/database/package.json:75`, `src/auth-engine.ts`), outside the 108 native routes (spec 0004) | a raw mount, not operations | credential vocabulary only: `Http.Access.acceptedCredentials` default fill + typed guard binding (spec 0006) | the auth server; wrapping its Promise API |
| Authorization | effx `AccessContract` + `Capability/Focus` nodes (ADR 0007); Cedar `@cedar-policy/cedar-wasm` `4.13.0` (2026-09-15) | IR carries capabilities | `@effx-ext/cedar`: schema writer + validator-backed analysis → `EFFX41xx` (report §Cedar). Whether the wasm validator fits the synchronous `Analysis` signature (`Extension.ts:57`) is `[INFERENCE]` unverified | runtime decision stays app-owned (spec 0006) |
| Tracing | CT `0.1.3`; Alchemy `Cloudflare.Telemetry`; `@effect/opentelemetry` `4.0.0` + `effect/observability` Otlp (EF) | a Tracer Layer at the composition root | optional span-name fragment (operation StableId) | the Layer itself; sampling/export config |
| Infra | Alchemy `2.0.0-beta.80` | §2 | manifest/check; optional Worker entry | Stack, resources, state, deploy |

Auth choice: both reach effx identically (group middleware + Service requirement + `AccessContract` credentials). Yielded is Effect-native and contract-first like effx but beta; Better Auth is mature and Promise-based. Neither belongs in core.

## 4. Recommendation (ranked by value to the core proposition ÷ cost)

| # | Do | Why | Cost |
| --- | --- | --- | --- |
| 1 | Ship spec 0015/0020 extension path; document the Yielded join recipe (zero code) | enables every integration below without core growth | already planned |
| 2 | Cross-declaration analyses that use E/R-in-IR: "operation requires `CurrentSession`/`Users` but group/root provides none" | the structural compiler-only value (§1b) | small, per extension |
| 3 | Optional span-name fragment | stable names from StableId; tiny | small |
| 4 | Surface/binding manifest + check for `@Schedule`/queue ops (test rung of `effx infra`) | catches IR↔`alchemy.run.ts` drift without owning Alchemy | medium, after 0020 |
| 5 | Port + conformance suite (§6) | answers "ORM familiarity" without owning ORMs | medium |

**Do NOT**: target `@rat-stack/capability`; add MCP/code-mode surfaces; generate Alchemy Stack/resources or deploy; build Effect-Workflow/Cluster→CF bridges (F3 — nobody has; large, unstable APIs); wrap Better Auth or Yielded; generate migrations or CRUD repositories (§6); make core depend on any integration; claim Cedar exists.

## 5. Enterprise checklist via composition

Design constraint (operator): **effx core stays small; integrations are packages built on spec 0020's `Annotation.define`.** The capability list is the operator's; I make no claim about what ASP.NET Core / NestJS / Laravel ship. "Gap-block rank" = how often the absence would stop a migration decision. It is **my judgment** `[INFERENCE]`, grounded only in mono-web's real inventory (spec 0004: 156 PG tables, 14 Foldkit models, Better Auth, a PersistedQueue migration `0078`) and breadth of need; no evaluator data exists.

| Capability | Effect-ecosystem answer (verified) | effx adds | True remaining gap | Rank |
| --- | --- | --- | --- | --- |
| Auth / identity | Yielded Auth `0.1.0-beta.14`; Better Auth `1.7.7`; `@alchemy.run/better-auth` `2.0.0-beta.80` | group middleware + credential vocab (specs 0013, 0006); optional extension (§3) | no stable (non-beta) Effect-native auth; no user/role admin product | 3 |
| Authorization policies | effx `AccessContract`; mono-web `AccessSpec`; Cedar wasm `4.13.0` | capability/focus IR (strongest effx-native piece) | Cedar projection and policy tests not built (ADR 0007) | 6 |
| ORM + migrations | `effect/sql` `SqlModel`, `SqlSchema`, `Migrator` (EF `sql/*`, unstable); `@effect/sql-pg/d1/sqlite-do` `4.0.0`; Drizzle `1.0.0-rc.4` Effect subpaths (§6) | nothing now (spec 0008: 0 lines removable) | `Migrator` only *runs* migrations (EF `sql/Migrator.ts:1-10`); no schema-diff generator for Effect `Model`; Drizzle's Effect integration needs a patch on stable Effect | **2** |
| Jobs / queues / scheduling | `PersistedQueue`, `DurableQueue`, `Workflow`, `ClusterCron` (EF, unstable); `effect-mq` `0.7.0` (Postgres); `effect-encore` `0.33.0`; CF via Alchemy `Workers.cron`/Queues | `@Schedule` annotation (§2) | no Effect-Workflow↔CF-Workflows bridge (F3) | 5 |
| Caching | `Cache`, `ScopedCache`, `PersistedCache` (unstable), Alchemy `Workers/Cache.ts` | conditional GET/ETag semantics already in `HttpContract` (spec 0010 Profile 200/304) | none blocking | 12 |
| Mail / notifications | Alchemy `Cloudflare.Email.Send`/`SendBinding`; Yielded `EmailDelivery`; RS keeps provider adapters behind job-shaped ports (ratstack.sh `/lore/hexagonal-architecture`). `npm search "effect mail email"` found no Effect-native mail library | nothing | templating + provider adapters are user-land ports | 7 |
| File storage | `FileSystem`, `http/Multipart` (unstable); Alchemy `R2.Bucket`, presign helpers | nothing; grep of `packages/compiler/src` finds no multipart support | upload endpoint declarations in `HttpContract` | 10 |
| Realtime | `effect/socket`, `rpc` over WebSocket, `eventlog` (unstable); Alchemy `Workers/RpcWebSocket.ts`; DOs | RPC generator exists; grep finds no streaming support in generators | channels/presence abstraction not found | 8 |
| Config | `effect/Config`, `ConfigProvider`, `Redacted`; Alchemy `WorkerConfigProvider` | nothing (spec 0015's config is *compiler* config) | none | 13 |
| Observability | `Tracer`/`Metric`/`Logger`, `effect/observability` Otlp, `@effect/opentelemetry` `4.0.0`, CT `0.1.3`, Alchemy Telemetry | span-name fragment | none blocking | 11 |
| Testing harness | `@effect/vitest` `4.0.0`; `effect/testing` (`TestClock`, `TestSchema`), `HttpApiTest`, `RpcTest`, cluster `TestRunner` | `Arbitrary` adapter in `@effx/ir`; conformance suites from IR (§6) | HTTP integration scaffolds | 9 |
| Scaffolding / starters | `create-effect-app` `0.0.6` (2026-09-18); RS (not a supported product) | nothing in core; a template repo is not a compiler job | **no enterprise-style `new` wiring auth+db+infra** | **4** |
| Admin / devtools | `effect/devtools`; `HttpApiScalar/Swagger`; `@effect/language-service` `0.87.3`; Foldkit `0.165.0` (2026-10-03); RS devtools capabilities | `inspect`/`graph` (STATE); Foldkit generator (spec 0007) | no admin/CRUD UI scaffold | 9 |

Ranked gaps (1 = blocks most): **1** stability — all app-level Effect modules are `@stability unstable` (EF `workflow/Workflow.ts:11`, `cluster/Entity.ts`, `persistence/PersistedQueue.ts`, `sql/SqlModel.ts`, `http-api/HttpApi.ts`, `rpc/RpcGroup.ts`); effx can only pin target profiles (spec 0010) and say so. **2** migrations/ORM familiarity (§6). **3** auth maturity. **4** starter. **5** CF jobs/workflows. **6** Cedar. **7** mail. **8** realtime. **9** admin/testing scaffolds. **10** uploads.

## 6. Pluggable persistence via Layers

### 6.1 Prior art on Effect v4 (npm/tarballs, 2026-10-04)

| ORM | Effect integration | Effect line | Transaction model | Verdict |
| --- | --- | --- | --- | --- |
| Effect SQL | `effect/sql` `SqlClient`, `SqlModel.makeRepository` (insert/update/findById/delete, EF `sql/SqlModel.ts:35,222`); drivers `@effect/sql-pg/d1/sqlite-bun` `4.0.0` (2026-10-01) | v4 stable, API `unstable` | ambient: `withTransaction`, `TransactionConnection` in Context, savepoints for nesting (EF `sql/SqlClient.ts:61-68,190-217`) | native |
| Drizzle | `drizzle-orm/effect-{postgres,d1,sqlite-bun,sqlite-do,mysql2,libsql,pglite,…}` + `effect-schema` inside **`1.0.0-rc.4`** (2026-06-27; npm `rc` tag; `latest` is `0.45.3`, 2026-09-21). Built on `@effect/sql-pg` `PgClient` (DZ `effect-postgres/session.d.ts:10`) | peer `effect >=4.0.0-beta.83 \|\| >=4.0.0`, **but** Yielded documents rc.4 uses APIs removed from stable Effect and ships `@yielded/drizzle-effect-v4-patch` (YA `packages/drizzle-effect-v4-patch/README.md`) | `db.transaction(tx => Effect)` delegates to `client.withTransaction` (DZ `effect-postgres/session.js:23-26`) → **shares Effect SQL's ambient transaction** | usable with a pinned patch |
| `@effect/sql-drizzle` `0.51.0` (2026-07-13) | v3 only: peers `effect ^3.22`, `@effect/sql ^0.52`, `drizzle-orm >=0.43.1 <0.50` | v3 | — | **ignore** |
| Prisma | `effect-prisma-generator` `0.10.0` (2026-07-08): generates a service wrapper, typed errors, `$transaction` with nested reuse (its README:197-218); peers `effect ^3 \|\| >=4.0.0-beta`, `prisma ^7`; README calls v4 output "experimental". `@shivaedev/effect-prisma` `0.6.4` (2026-09-26): pinned `effect 4.0.0-rc.112` + Prisma Next `0.15.0`, "may change without a deprecation period". `@prisma/client` `7.10.0`; Prisma CLI `8.0.0-rc.19` (2026-09-29) | v4 beta/rc only | interactive `$transaction(async tx => …)`, `maxWait` 2000 / `timeout` 5000 ms defaults (Prisma docs `transactions.md:65-100`) | community, experimental |
| TypeORM | none: `npm search` for Effect+TypeORM wrappers returned no package that combines them (scoped claim). `typeorm` `1.1.1` (2026-09-01) | — | `dataSource.transaction(async manager => …)`; docs: always use the provided manager (typeorm.io/docs/transactions) | hand-written boundary adapter |
| Kysely | `@effect/sql-kysely` `0.48.0` — v3 only (peers `effect ^3.22`) | v3 | — | **ignore** |

Related multi-ORM prior art: Better Auth ships Prisma, Drizzle, Kysely, Mongo and memory adapters at `1.7.7` (2026-09-30). Its `DBAdapter.transaction` is `false | (cb => Promise)` and "if the database doesn't support transactions, set this to `false` and operations will be executed sequentially" (`@better-auth/core@1.7.7 dist/db/adapter/index.d.mts:128-134`) — silent loss of atomicity is the trap to avoid.

### 6.2 Closest prior art: Yielded Auth's persistence ladder — extracted port shape

1. **A port per storage role = a `Context.Service`** whose methods are *workflow steps with typed domain errors*, explicitly not CRUD: "No generic get/put/upsert" (YA `packages/auth/src/password/methods/PasswordPersistence.ts:36-44`, class at `:45`).
2. **Transactions are context, not arguments.** Methods return a `PreparedCommit`; the commit Effect "resolves its authority from Effect context at execution"; a root service "must reject ambient use it cannot join before writes" (same file). Docs: "Do not put standalone services inside an untracked raw Drizzle transaction" (YA `docs/…/reference/adapters.md:310`).
3. **Three adapter rungs**: `managed` (library defines Drizzle tables you export to drizzle-kit), `map` (your tables + column mapping; the Layer "checks each mapped column and unique key against the database" at startup, `storage.mdx:118`), `custom` (you implement the services).
4. **Adapters are separate packages**: core depends only on Effect; `@yielded/auth-persistence` (Effect SQL) and `-drizzle` with nine driver facades (`packages/auth-persistence-drizzle/src/{D1,Libsql,Mysql2,Pglite,Postgres,SqliteBun,SqliteDo,SqliteNode,SqliteWasm}.ts`). No Prisma/TypeORM adapter exists there.
5. **The ORM tool owns migrations** ("Drizzle owns the migration journal", `adapters.md:99`).
6. **Atomicity needs one owner**: "Splitting account and credential writes across independent backends does not make them atomic" (`storage.mdx:155`).

### 6.3 Proposed effx shape

```
effx declarations                          generated (ordinary Effect)                  user / adapter packages
@PersistentModel(User)  ───────────────▶   nothing (SchemaRef only, ADR 0004)          table defs: ORM-owned
port methods = Operation.query/command
  with NO Exposure, tagged to a port        class UsersPort extends Context.Service<…>   UsersSql     : Layer<UsersPort, never, SqlClient>
  (annotation via spec 0020, target op)        { find: (i) => Effect<A, NotFound>,       UsersDrizzle : Layer<UsersPort, never, PgClient>
                                                 setEmail: (i) => Effect<A, EmailTaken|…>}  UsersPrisma  : Layer<UsersPort, never, PrismaService>
                                            + adapter conformance suite (from IR + Arbitrary)   chosen at the composition root
```

- **No new IR node.** Port methods are Operations (name, kind, input/success `SchemaRef`, `errors`, `requirements` — `Node.ts:39-50`) that simply have no `Exposure`. The generator emits a typed `Context.Service` interface; **never SQL, never a CRUD repository** (spec 0008's boundary; MW `AGENTS.md:234`: "Expose complete business commands through the existing domain service. Avoid generic CRUD and additional repository layers").
- **Transaction boundary is its own port**, not a parameter: `Tx.run(effect)`; adapters read an ambient `CurrentTransaction` key. SQL-client-sharing adapters (Effect SQL, Drizzle-effect) implement it with `SqlClient.withTransaction`. Promise ORMs run the Effect *inside* the `$transaction`/`transaction` callback with the `tx` handle placed in context. The generated HTTP binding does **not** open a transaction: spec 0006 requires the handler to call the guard "inside its own read snapshot or committing transaction".
- **Adapter packages export helpers, not the port** (the port lives in user code): `makeTx`, unique-violation→typed-error mappers, a conformance runner that takes the generated port tag. Adapter choice lives only in Layers, so **semantic hash and generated bytes are independent of ORM** (ADR 0008: no effx DI).
- **Single source for the model mapping — three directions:**

| Direction | Prior art | Fit |
| --- | --- | --- |
| A. effx model → ORM schema (emit Drizzle tables / `.prisma`) | Yielded `managed` (library-owned fixed tables exported to drizzle-kit) | OK for *library-owned* schemas; for app models effx would own DDL — contradicts spec 0008 and MW's 156 hand-authored tables |
| B. ORM schema → Effect Schema → effx references it (`export const User = createSelectSchema(users)`) | `drizzle-orm/effect-schema` `createSelect/Insert/UpdateSchema` (DZ `effect-schema/index.d.ts:6`); `drizzle-zod` `0.8.3`; `prisma-zod-generator` `3.3.1`; `effect-prisma-generator` (service, not Schema) | **fits ADR 0004 with zero compiler change** — `SchemaRef` points at an exported Schema; ORM stays the column source of truth |
| C. Neutral domain Schemas are the contract; each adapter maps rows↔domain (hand-written, or Yielded-style `map` + startup physical check) | Yielded `map` | most portable; drift caught by conformance suite + startup check |

  Recommendation: **C as the contract, B as an opt-in per-adapter helper, A never for application models.**
- **Migrations stay with the ORM's tool** (drizzle-kit, `prisma migrate`, TypeORM migrations). effx generates none. This **supersedes** the report's long-term `effx db diff/generate/migrate` direction (`docs/research/2026-10-02-deep-research-report.md:1236-1245`). MW has a fourth owner: its own checksummed SQL registry (`packages/database/src/migration-registry.ts`; `justfile:69-72` in MW).

### 6.4 Hard parts, with evidence

| Hard part | Evidence | Consequence |
| --- | --- | --- |
| **A port can't hide dialect-level locking.** MW non-test `packages/database/src`: `FOR UPDATE` in 35 files (67 lines), advisory locks in 31 files (89), `RETURNING` in 46, CTE/`WITH` in 13, `ON CONFLICT` in 5, isolation settings in 12. Spec 0008 census: 33 of 39 `SqlSchema` calls are hand-written SQL (DISTINCT ON, UNION CTEs, lateral queries) | ORM-neutral CRUD would cover little. Ports must be *named commands* (`Users.setEmail` including its lock). Inside ORM adapters the heavy part is still raw SQL (`db.execute(sql…)`, `$queryRaw`, `manager.query`): **swapping ORM ≠ swapping database**; ports are Postgres-specific in MW |
| **Authorization inside the committing transaction** (MW `AGENTS.md:235`: "Resolve authority inside the committing transaction"; spec 0006) | Guard reads authority facts; if the authority port and business port sit on different connections the rule breaks | Rule: **one transaction owner per bounded context; every port used inside one `Tx.run` must share it.** Effect SQL + Drizzle-effect share (`session.js:23-26`; Yielded: "use the same Effect SQL client, including Drizzle over it", `adapters.md:139`). Prisma + Drizzle cannot. Enforcing it statically (owner brand on ports; analysis over `Requires` edges) is `[INFERENCE]` — to be proven in the spike |
| **Explicit-handle transactions** (Prisma `tx`, TypeORM `manager`) | Prisma docs; typeorm.io | adapter must put the handle in context and run the Effect inside the callback; nesting must reuse it (effect-prisma-generator does, README:216-218). Prisma's 5 s default `timeout` bounds lock-holding transactions |
| **Interruption** | `Effect.tryPromise` passes an `AbortSignal`, but "the underlying asynchronous operation only stops if it observes that signal" (EF `Effect.ts:1308`). `typeorm@1.1.1` typings (excluding the MongoDB driver) and `@prisma/client@7.10.0` typings contain no `AbortSignal`/`signal` (grep of unpacked tarballs). Effect SQL rolls back on failure *or interruption* under `uninterruptibleMask` (`SqlClient.ts:341-394`) | Lost with Promise ORMs: cancellation of in-flight queries and prompt rollback on request abort/`Effect.timeout`; the fiber stops *waiting* while the DB work and its locks continue until completion or the ORM's own timeout. Mitigation: ORM-level tx timeout shorter than request deadline. MW already bridges one Promise library by forking callbacks into a scope-owned `FiberSet` (`auth-engine.ts:37-41,518`) — the same boundary, other direction |
| **Typed error mapping** | `Schools` slice hit a real SQLSTATE `23001` regression (`STATE.md`); Prisma/TypeORM surface constraint failures differently; effect-prisma-generator lists its own error classes (README:158) | Each adapter must map unique/FK violations to the port's declared errors; the **conformance suite must assert it** |
| **Maturity** | table §6.1 | Drizzle needs rc + patch; Prisma bridges experimental; TypeORM has none; every `effect/sql` module is `unstable` |

### 6.5 Verdict

- **Worth it?** Partly. The valuable, cheap, effx-native part is the **generated port + adapter conformance suite**: typed error channel, the same journey on every adapter, no new IR node, no ORM in core. The expensive, low-leverage part is *owning ORM adapters*; the only real migration corpus (MW) uses raw SQL over Effect SQL, so it provides **zero** evidence for Drizzle/Prisma/TypeORM demand, and spec 0008 removed 0 lines. That ORM familiarity drives switching decisions is the operator's premise; I have no measured data `[INFERENCE]`.
- **Do**: publish the adapter contract (§6.3) and **one reference pair that provably shares a transaction: Effect SQL + Drizzle-effect.** **Do not** publish Prisma or TypeORM adapters; document the Promise-boundary pattern and let the conformance suite certify third-party bridges once a maintained Effect-v4 one exists.
- **Minimal first step (spike on `examples/users`)** — spec first (`0021`, bound to this section), then:
  1. Annotation (spec 0020, `target: "operation"`) marking port methods; generator emits `UsersPort` (+ conformance suite using the `@effx/ir` Arbitrary adapter).
  2. Two hand-written adapters over SQLite: `UsersSql` (`@effect/sql-sqlite-bun` `4.0.0`) and `UsersDrizzle` (`drizzle-orm@1.0.0-rc.4` `effect-sqlite-bun` + the Yielded patch).
  3. **Falsifiers:** (a) the existing live-server e2e (`examples/users/test/e2e.test.ts`: generated HTTP + RPC, persistence, typed failure — `STATE.md`) passes against both Layers; (b) a unique-constraint violation surfaces as typed `EmailTaken` on both; (c) two port calls in one `Tx.run` roll back together on both; (d) an interruption test *records* what happens (no claim beforehand); (e) `semanticHash` and generated bytes are identical across adapter choices; (f) removing the generated port makes `tsc` fail the adapters — i.e. one source of truth.
  4. Only then, a Promise-ORM probe against the same suite (effect-prisma-generator `0.10.0`), reported as evidence, not shipped.
