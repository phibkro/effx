# Persistence ports — spec 0022 evidence

## Contract and design resolutions

The implementation starts from `origin/main` commit
`179af0890124a4dbccf1d16b15b05cf1b43479f2`, after spec 0020 landed. The binding
contract is `docs/specs/0022-persistence-ports.md` (spec-frozen,
operator-approved). Nothing in this work authorizes a mono-web migration,
production database use, publishing or deployment.

| Ambiguity or conflict | Resolution |
| --- | --- |
| The initial brief requested spawned PostgreSQL, while spec 0022 §5 (`docs/specs/0022-persistence-ports.md:99`) explicitly chooses PGlite. | The operator corrected the brief: the spec wins. Use fresh PGlite instances only; do not spawn PostgreSQL. PGlite runs the PostgreSQL engine, not a mock. |
| Spec 0022 §6.9 (`docs/specs/0022-persistence-ports.md:113`) includes ff-merge, while the assignment forbids this worker from merging. | The operator clarified that ff-merge is the separate landing step, ordered after review and run by a landing worker. This branch is committed but not merged or pushed. |
| The generated-output sketch says “two files per project” but names files by port (`docs/specs/0022-persistence-ports.md:42–45`). | Emit a port/conformance pair for each declared port; methods are sorted by name, and filenames are determined by the port name. No adapter choice enters that derivation. |
| The schema-expression helpers used by HTTP emission are internal (`packages/compiler/src/generate/emit.ts`), while spec 0022 §3 requires reuse and §7 forbids a core dependency on persistence. | Expose a curated generator-facing subset from the public compiler package and reuse the same helper implementations. The optional persistence package depends on core, never the reverse. |

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
