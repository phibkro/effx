# Persistence ports — spec 0022 evidence

## Contract and design resolutions

The implementation starts from `origin/main` commit
`179af0890124a4dbccf1d16b15b05cf1b43479f2`, after spec 0020 landed. The binding
contract is `docs/specs/0022-persistence-ports.md` (spec-frozen,
operator-approved). Nothing in this work authorizes a mono-web migration,
production database use, publishing or deployment.

| Ambiguity or conflict | Resolution |
| --- | --- |
| The initial brief requested spawned PostgreSQL, while spec 0022 §5 (`docs/specs/0022-persistence-ports.md:132`, after amendments) explicitly chooses PGlite. | The operator corrected the brief: the spec wins. Use fresh PGlite instances only; do not spawn PostgreSQL. PGlite runs the PostgreSQL engine, not a mock. |
| Spec 0022 §6.9 (`docs/specs/0022-persistence-ports.md:146`, after amendments) includes ff-merge, while the assignment forbids this worker from merging. | The operator clarified that ff-merge is the separate landing step, ordered after review and run by a landing worker. This branch is committed but not merged or pushed. |
| The generated-output sketch says “two files per project” but names files by port (`docs/specs/0022-persistence-ports.md:42–45`). | Emit a port/conformance pair for each declared port; methods are sorted by name, and filenames are determined by the port name. No adapter choice enters that derivation. |
| The schema-expression helpers used by HTTP emission are internal (`packages/compiler/src/generate/emit.ts`), while spec 0022 §3 requires reuse and §7 forbids a core dependency on persistence. | Expose a curated generator-facing subset from the public compiler package and reuse the same helper implementations. The optional persistence package depends on core, never the reverse. |
| The original §3 harness sketch (`docs/specs/0022-persistence-ports.md:61–63` before amendment) left `R` open although a generic `it.effect` must execute a closed program. | The operator approved an explicit dated §3 implementation amendment: the harness Layer exports the port and transaction services, `transact` retains those requirements, and leaf method `R` stays `never`. The separate `docs(specs):` amendment precedes all implementation commits. Generated scenario skips actually branch on `supportsConcurrentConnections`. |
| The original §2 introduction promised decorator declaration-class equivalence, but `packages/frontend-ts/src/collect.ts:363–376` binds decorated static methods locally, and only builder `.declare()` sets external binding (`:647–654`). Decorated fields are rejected (`:378–390`), and TypeScript decorators cannot attach to abstract/`declare` members. | The operator approved the second item in the same dated amendment commit: builder `.declare()` is the supported port declaration spelling; local-body decorators diagnose EFFX3401. Decorator declaration-only ports are explicitly a non-goal, not future work. |
| Original §4 G1 wording said a method fails with “a member”, but native Effect Cause may contain several typed Fail reasons; concurrent order is not deterministic. | The operator approved the third dated amendment item: every Fail reason must match declared schemas, while Die/Interrupt/undeclared reasons reject G1. G2 failure equality is a multiset with multiplicity preserved. Authored error scenarios and rollback sentinel remain single expected failures. |
| Schema encoders may map unequal Type values to the same encoded representation, so comparing encoded query results or domain expectations can certify false equality (`packages/persistence/src/conformance.ts`). | Use native `Schema.toEquivalence(Schema.toType(...))` for Type-side success/error values; do not compare incidental Error traces. The emitted-suite regressions exercise collapsing encoders and compound failure order/multiplicity. |
| A new physical database per arbitrary sample exceeded the original deadline, while the contract assigns fresh storage per test. Reuse without a complete reset could hide sample leakage. | The operator approved per-test ownership only with an explicit reset proof: capture the empty-store snapshot before first seed, compare after every reset, then seed the next sample. Added required harness reset, real SQL reset and an incomplete-reset negative; arbitrary coverage and deadlines remain unchanged. |

The existing annotation definition/implementation API and generator helpers are
reused rather than introducing another annotation convention or SchemaRef
resolver. The original `examples/users/src/operations.ts` remains unchanged; its
package manifest exposes shared schemas/services for the sibling
`examples/persistence`, which includes the original operation source in its project. SQL statements and the Drizzle table belong to
the example adapters, not generated output.

## Drizzle patch provenance

Pinned packages: `effect@4.0.0`, `@effect/sql-pglite@4.0.0`,
`@electric-sql/pglite@0.5.8`, `drizzle-orm@1.0.0-rc.4`.

The patch was generated with
`bunx @yielded/drizzle-effect-v4-patch@0.1.0-beta.14 patch` (exit 0). The tool is
MIT-licensed; spec 0022 §5 identifies upstream `yielded-dev/auth` commit
`68a4679`. The generated file is committed at
`patches/drizzle-orm@1.0.0-rc.4.patch`, registered in `patchedDependencies`, and
resolved in `bun.lock`. It adapts the named prerelease to stable Effect v4.
Retire the patch when Drizzle ships a stable-v4-compatible effect driver;
version changes reopen this compatibility decision.
The generated patch is 38,729 bytes; SHA-256 is
`bfb194db9b8294c35cfdc54a9cf9a56eb62899acbec7771203276030d3e2ac1d`
(`wc -c` and `sha256sum`, exit 0).

## Scope limits

PGlite is single-connection. Concurrent connection scenarios are marked
`requiresConcurrentConnections` and skipped rather than presented as evidence
of row-lock contention or transaction isolation. No Prisma or TypeORM adapter
is shipped. The optional Prisma probe was not run: no PostgreSQL/Prisma/database
URL variable was configured and no `prisma` executable was found in this worker's
environment (the discovery command printed no names or executable path).

## Registered native SQL boundary — EX-0022

- Rules: FX012; `effecttsgo/unstable-api-usage` (`unstableApiUsage` file directive).
- Owner: repository root (`AGENTS.md`), reference adapter slice `examples/persistence/src`.
- Scope: `database.ts`, `UsersSql.ts`, `UsersDrizzle.ts`, `harness.ts`, `scenarios.ts`; only SQL driver, ambient transaction and SQL-typed harness APIs. No generated port/compiler directive.
- Reason and missing capability: spec 0022 mandates real Effect SQL and its PGlite driver, whose installed interfaces retain `@stability unstable` metadata (`@effect/sql-pglite/src/PgliteClient.ts:64–70`). There is no stable-tagged native PGlite SQL API in the pinned cohort.
- Native alternatives examined: `effect/sql/SqlClient` supplies the required shared `withTransaction`; `@effect/sql-pglite/PgliteClient` supplies scoped real PostgreSQL WASM connections. Both are used, not replaced; an in-memory mock would erase the contract boundary. Drizzle effect-pglite delegates to the same ambient SQL transaction.
- Verification contract: the focused persistence acceptance suite exercises generated G1–G4, mixed transactions, typed unique errors, interruption observations and named broken-adapter failures; strict Effect diagnostics covers the remaining code. Observed results are recorded below after the gates run.
- Examined versions: `effect` 4.0.0, `@effect/sql-pglite` 4.0.0, `@effect/tsgo` 0.48.0, `drizzle-orm` 1.0.0-rc.4 with the provenance-pinned patch above.
- Retirement: remove the narrow directives when SQL/PGlite APIs lose unstable annotations; any change to the pinned cohort reopens the decision and reruns the conformance/transaction evidence.

## Exercised preliminary gate

On committed `8269c5ae93f96c5431dd29361c17cd690f788246`, after rebasing
onto local main `39e638a3759e26eeb464fadb190617c7063e520e`, the light command
`bun --bun node_modules/.bin/vitest run packages/persistence/test/compiler.test.ts packages/persistence/test/syntax.test.ts --project persistence-integration`
ran from a fresh `git archive` copy with an EXIT cleanup finalizer. It exited 1:
the compiler suite reported two failures in fourteen tests. One test falsely
claimed `.find` was a valid operation StableId for an empty port; the other
omitted the native Crypto service required by semanticHash. The repairs retain
the frozen String argument algebra and existing StableId rules, test empty
annotation data/total filename handling instead of an invalid source program,
and provide native BunCrypto.layer as the existing IR hash tests do. This failed
run is not runtime evidence for either database adapter.

The director explicitly ordered a confirmation rerun of the same light command
inside granted custody. On committed `169ad91`, it exited 0 with **2 files and
17 tests passed**; both observed failures above were repaired. The fresh archive
copy was removed by its EXIT finalizer.

## First acceptance attempt and process boundary

The serial acceptance command on committed `169ad91` exited 1: thirteen tests,
ten passed and three failed. The generated full conformance child reached the
existing 180-second subprocess deadline (exit 143); mixed transactions failed
their final snapshot assertion; the rc.116 port typecheck resolved RC schemas
against stable-runtime source and failed with incompatible SchemaAST types.
The mixed source assertion used nonexistent Chai `assert.notDeepStrictEqual`;
its supported negative deep comparison is `assert.notDeepEqual`. This source
repair does not change any transaction implementation.

The first full check copy passed docs fences, TypeScript, lint, formatting and
AI-doc drift checks before reaching Vitest. It was then terminated to release
custody on the director's instruction; that attempt is not a passing full check.
No heavy job remains active during source repair.

EX-0023 registers the unstable native process seam at
`packages/persistence/test/process.ts` (owner: repository root, `AGENTS.md`).
Rules: FX003/FX012 and `effecttsgo/unstable-api-usage`. Required capability:
owned, interruptible subprocesses with streamed progress and scope cleanup;
blocking Bun.spawnSync hides child progress and delays cancellation until its
deadline. The native `effect/process` ChildProcess/ChildProcessSpawner path is
used behind this test adapter, not in the compiler or generated files.
Examined versions: Effect/platform-bun 4.0.0 and @effect/tsgo 0.48.0. Verification
is the focused child-cancellation/progress and acceptance tests. Retire the
directive when the process API loses its unstable annotation; cohort upgrades
reopen the decision. No deadline increase or arbitrary-run reduction is
authorized as a substitute for diagnosing the slow child.

## Focused repairs and lifecycle diagnosis

The focused repair command
`bun --bun node_modules/.bin/vitest run packages/persistence/test/acceptance.test.ts --project persistence-integration --silent=false -t "subprocess custody|mixed adapter calls|generated ports typecheck"`
ran from a fresh committed clone with EXIT cleanup, exited 0, and completed in
8.916 seconds including setup. It exercised real subprocess success/nonzero
exit/typed spawn failure, streamed readiness and interruption cleanup, mixed
SQL/Drizzle rollback and commit, and both stable/rc.116 generated port targets.
The supported Chai assertion and explicit whole-cohort target mappings repaired
the two corresponding first-attempt failures.

A separately authorized scalar real-PGlite probe recorded acquisition at
1411.062 ms, query completion at 1413.329 ms, and closed PGlite scope at
1416.016 ms (initial milestone 0.638 ms). TestClock remained zero: measured
startup was about 1.410 seconds, SELECT 1 about 2.27 ms, release about 2.69 ms.
No cleanup hang was observed in this scalar. The disposable probe exited 1
because its outer temp finalizer was incorrectly passed as an Effect instead of
a function; the inner PGlite scope had already closed, and the throwaway was
removed without a confirmation rerun.

Source showed one physical PGlite initialization per arbitrary sample, despite
the contract assigning a fresh store per **test**. [INFERENCE] Repeated startup
can explain the aggregate deadline overrun; this scalar does not measure warm
or total suite cost. The repair uses one native anonymous it.layer block per
individual property/scenario, with exactly one test registration. Physical
storage is never shared across distinct tests; sample seed/reset and scoped
Command resources remain per sample. All ten arbitrary runs and the existing
180-second process deadline remain unchanged.

The authorized one-property follow-up ran the real emitted UsersSql/PGlite
`G1 closed error channel: find` with ten unchanged arbitrary runs: child Vitest
exit 0, one property passed (24 unselected tests skipped), 1512 ms for the test
and 1.92 seconds for Vitest. The complete emitted temporary application and
generic layer callbacks typechecked with exit 0 first. Its disposable runner
exited 1 only after an optional physical-lifetime log-count assertion saw zero
markers because native TestConsole captured Effect.log. This does not establish
runtime acquisition/reset/release counts; the source-level native single-test
scope and the real property/typecheck results are the evidence. No second
property was run to confirm that diagnostic instrumentation error.

## Complete reset falsifier

The focused incomplete-reset command first exited 1 because the deliberately
broken SQL probe used raw id `1` against JSON-encoded storage ids and therefore
accidentally performed a complete reset. The probe was repaired to reuse the
same `encodeId` Schema codec as the adapters, with a parameterized retained id;
no physical encoding literal or production reset special case was added.

On committed `382fb82`, the fresh-copy command
`bun --bun node_modules/.bin/vitest run packages/persistence/test/acceptance.test.ts --project persistence-integration --silent=false -t "generated G1 rejects an incomplete reset"`
exited 0 in 6.946 seconds. Its actual emitted broken-adapter child exited 1 with
one named G1 find failure after **2 runs and 1 shrink**:
`Conformance reset did not restore the empty store`, showing retained Alice
versus the captured empty `[]` baseline before reseeding. The child selected
one property and skipped 24 unrelated tests; the outer negative proof passed.
Both scoped copies were removed by their finalizers.
