# Spec 0022 — Persistence ports and the adapter conformance suite

Status: **spec-frozen** 2026-10-04 (operator-approved from `docs/research/effect-fullstack-composition.md` §6). **Implementation starts only after spec 0020 (`Annotation.define`) merges to main**; until then this file is the contract and nothing in `packages/` changes. Builds on 0020, 0015 (config registration), 0008 (parked SQL projection — superseded in scope by this spec, see §1), ADR 0004/0005/0008.

## 1. Outcome

A project declares **persistence port methods** as ordinary effx operations with no exposure; the compiler emits (a) a typed **port** — a `Context.Service` whose methods are Effects with Schema-typed inputs, outputs and typed errors, never SQL — and (b) a typed **adapter conformance suite** every adapter must pass. Adapters (Effect SQL, drizzle-effect) are ordinary Layers in separate packages/modules chosen at the composition root. effx generates no SQL, no migrations, no CRUD repository, no ORM schema (spec 0008's boundary; mono-web `AGENTS.md:234`: "Avoid generic CRUD and additional repository layers").

Why a port + suite and not ORM adapters: ORM familiarity is an adoption factor (operator premise; no measured data), but mono-web's corpus is 33 hand-written-SQL calls of 39, `FOR UPDATE` in 35 files and advisory locks in 31 (research §6.4). What _does_ generalize across adapters is the typed contract, the typed error mapping and atomicity — and that is exactly what a generated suite can certify.

Non-goals: a Prisma or TypeORM adapter (none shipped; an optional probe is recorded as evidence only, §6); migrations (the ORM's tool owns them — drizzle-kit, `prisma migrate`, TypeORM; supersedes the report's `effx db diff/generate`); a repository/CRUD layer; transactions opened by generated HTTP bindings (spec 0006: the handler owns the transaction and the guard call); decorator declaration-only ports (TypeScript decorators cannot attach to abstract or `declare` members, so no valid body-less, externally bound decorated method form exists).

## 2. Declaration (no new IR node)

Source (builder `.declare()` is the supported declaration-only port spelling; decorators are annotation-equivalent per 0020, but a decorated method with a local body is a handler and diagnoses EFFX3401):

```ts
import { Operation } from "@effx/runtime";
import { Persist } from "@effx/persistence/syntax"; // Annotation.define half; imports only @effx/runtime

export const FindUser = Operation.query({ name: "Users.find", input: FindUserInput, success: User })
  .errors(UserNotFound)
  .with(Persist.Port({ port: "Users" }))
  .declare();

export const SetEmail = Operation.command({
  name: "Users.setEmail",
  input: SetEmailInput,
  success: User,
})
  .errors(UserNotFound, EmailTaken)
  .with(Persist.Port({ port: "Users" }))
  .declare();
```

- `Persist.Port` is defined with `Annotation.define({ name: "persistence.Port", target: "operation", args: { port: A.string }, cardinality: "one" })` (0020 §2.1); its compiler half is `Annotation.implement(Port, { read, analyze, write })` registered through `defineConfig({ extensions })` (0015). Its IR contribution is one `Extension` node (`extension: "persistence"`, `tag: "Port"`, `data: { port }`) plus one `ExtensionOf` edge to the operation — **no new `Node` kind** (the `Operation` node already carries `kind`, `input`, `success`, `errors: Declared<SchemaRef>`, `binding: "external"`).
- A port method is a **declaration-only** operation (`binding: "external"`) with **no `Exposure`**: it is not on any transport. The method name is the operation name after the `<port>.` prefix (`Users.find` → `find`).
- Diagnostics (plain codes; range `EFFX34xx` reserved here for later registration in the 0016 registry, which has not landed): **EFFX3401** error — a port method has a local handler; **EFFX3402** error — a port method has an HTTP/RPC/CLI exposure; **EFFX3403** error — operation name lacks the `<port>.` prefix or two methods of one port collide; **EFFX3404** warning — a port declares only Queries (its conformance rollback/atomicity properties are vacuous).

## 3. Generated output (ordinary Effect, ADR 0008)

Two files per project in the output directory (names deterministic from the port name; no effx import; no runtime DI):

```ts
// <port>-port.ts  — the port
export class UsersPort extends Context.Service<
  UsersPort,
  {
    readonly find: (
      input: typeof FindUserInput.Type,
    ) => Effect.Effect<typeof User.Type, typeof UserNotFound.Type>;
    readonly setEmail: (
      input: typeof SetEmailInput.Type,
    ) => Effect.Effect<typeof User.Type, typeof UserNotFound.Type | typeof EmailTaken.Type>;
  }
>()("effx/port/Users") {}

// <port>-conformance.ts  — the suite (imports only effect, @effect/vitest, the port, the declared schemas)
export interface UsersHarness<E, R> {
  readonly name: string;
  readonly layer: Layer.Layer<UsersPort | R, E>; // closed root: fresh store and transaction services per test
  readonly transact: <A, X, Rx>(eff: Effect.Effect<A, X, Rx>) => Effect.Effect<A, X | E, Rx | R>; // the shared transaction owner
  readonly snapshot: Effect.Effect<Schema.Json, E, R>; // canonical store content (rollback/purity)
  readonly reset: Effect.Effect<void, E, R>; // restores empty-store content between arbitrary samples
  readonly supportsConcurrentConnections: boolean; // generated scenarios branch on this capability
}
export interface UsersScenarios {
  /* typed from the port: named domain scenarios */
}
export const usersConformance = <E, R>(
  harness: UsersHarness<E, R>,
  scenarios: UsersScenarios,
): void => {
  /* it.effect / it.effect.prop */
};
```

Methods are emitted sorted by name; the port types come from the same `SchemaRef`s and `errorsExpr`/`schemaExpr` helpers the HTTP generators use. The **R channel of every method is `never`**: a port is a leaf; adapters hold their own requirements in the Layer.

### Amendment (implementation) — 2026-10-04

1. **§3 harness typing.** Operator-approved correction to the harness sketch
   above: `layer` is a closed `Layer<UsersPort | R, E>` root, `transact` returns
   `Effect<A, X | E, Rx | R>`, and `snapshot` is `Effect<Json, E, R>`.
   The original open `Layer<UsersPort, E, R>` cannot run in a generic `it.effect`;
   a closed harness root owns isolation and transaction services while every
   port method retains `R = never`. `supportsConcurrentConnections` is allowed
   only when a generated scenario/property actually branches on it.
2. **§2 supported spelling.** Builder `.declare()` is the supported
   declaration-only port spelling. Decorator application is annotation-equivalent,
   but a decorated method with a local body remains a handler and diagnoses
   EFFX3401. Decorator declaration-only ports are a non-goal, not future work:
   decorators cannot attach to abstract or `declare` members, so TypeScript has
   no valid body-less, externally bound decorated method form.
3. **§4 native failure laws.** G1 checks every `Fail` reason against the declared
   error schemas. Several declared failures in one `Cause` are legitimate
   Effect; any `Die`, `Interrupt`, or undeclared failure rejects conformance.
   G2 compares typed failures as a multiset, preserving duplicate multiplicity
   but ignoring concurrent failure order, using Type-side schema equality.
   Authored error scenarios and the intentional rollback sentinel remain
   single expected failures.
4. **§4 per-test storage and complete reset.** One fresh physical PGlite/store
   is owned by each individual test; arbitrary samples within that test reuse
   it only after an explicit harness reset. Capture the empty-store snapshot
   before seeding the first sample, and assert after every reset that harness
   snapshot equals that empty baseline before applying domain seed data.
   This must reject incomplete resets so one sample cannot leak into the next.
   The root must never be shared across distinct tests; sample resource scopes
   and arbitrary-run counts remain unchanged.

## 4. The conformance suite

What the IR can derive, and therefore what is _generated_ (all with `@effect/vitest` `it.effect` / `it.effect.prop`, inputs from the method's own Schema; verified present in `@effect/vitest@4.0.0`):

| Property                             | Derived from    | Statement                                                                                                                                                                                                                                                              |
| ------------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1 closed error channel**          | `errors` set    | for arbitrary inputs, each method succeeds with a value that decodes under its success Type schema, or every Fail reason decodes under a declared error Type schema; several declared failures are valid; any Die, Interrupt or undeclared failure rejects conformance |
| **G2 query purity claim** (ADR 0006) | `kind: Query`   | snapshot before = after any Query; two identical Queries return equal Type-side results; typed failures compare as a multiset with duplicate multiplicity preserved and concurrent order ignored                                                                       |
| **G3 rollback atomicity**            | `kind: Command` | for each Command and arbitrary input, `transact(command >> fail)` leaves `snapshot` equal to its pre-state                                                                                                                                                             |
| **G4 shared-transaction**            | ≥ 2 Commands    | for each pair of Commands, `transact(a >> b >> fail)` rolls both back; `transact(a >> b)` commits both (checked by a scenario-supplied observer)                                                                                                                       |

What is **not** derivable and stays user-written, once, shared by all adapters: **domain scenarios** (`UsersScenarios`): seed data, expected results, and _which input raises which declared error_ (e.g. a duplicate email → `EmailTaken`). The generated types make a scenario for a method that does not exist, or an expected error outside the declared set, a **type error** — that is the single-source property. Concurrency/lock-contention properties are marked `requiresConcurrentConnections` and skipped for single-connection drivers (§5).

The suite must be able to fail: the gate includes two **deliberately broken adapters** (non-atomic: ignores the transaction; mis-mapping: unique violation escapes as a defect) and asserts the suite rejects each with a named failing property (falsifier 7).

## 5. Reference adapters and the database

- **Effect SQL**: `effect/sql` `SqlClient` (`withTransaction`, ambient `TransactionConnection`, `uninterruptibleMask`-guarded rollback on failure _and_ interruption — `effect@4.0.0` `sql/SqlClient.ts:61-68,341-394`) over `@effect/sql-pglite@4.0.0`.
- **drizzle-effect**: `drizzle-orm@1.0.0-rc.4` `effect-pglite` (a Drizzle database that **requires** the Effect SQL `PgliteClient`; `db.transaction` delegates to `client.withTransaction`, so Effect SQL and Drizzle share one ambient transaction — verified, below).
- **Version/patch facts (observed 2026-10-04 in `temporary workspace`, `effect@4.0.0`, bun 1.3.13)**: importing `drizzle-orm@1.0.0-rc.4/effect-pglite` against stable Effect throws `TypeError: Schema$1.TaggedErrorClass is not a function` at `drizzle-orm/cache/core/cache-effect.js:97`. Applying `bunx @yielded/drizzle-effect-v4-patch@beta patch` (`@yielded/drizzle-effect-v4-patch@0.1.0-beta.14`, MIT, from `yielded-dev/auth` `68a4679`) writes a Bun `patchedDependencies` entry and `patches/drizzle-orm@1.0.0-rc.4.patch` (38,729 bytes); after it the import succeeds. The patch targets exactly `1.0.0-rc.4` and rejects other builds (its README). The repo commits the generated patch file with this provenance; **removing the patch is a follow-up when Drizzle ships a stable-Effect-compatible release** (peer ranges already allow `effect >=4.0.0`; the incompatibility is in the rc.4 code, not the declared peer). `@effect/sql-drizzle@0.51.0` is v3-only (peers `effect ^3.22`) and is not used.
- **Observed behaviour on PGlite with the patch** (same spike): (1) a Drizzle insert + a raw Effect SQL insert inside one `sql.withTransaction` that then fails leave **0 rows**; the same without failure leaves 2; (2) a nested `db.transaction(...)` inside the outer failing `sql.withTransaction` is also rolled back; (3) a unique violation surfaces from Effect SQL as `SqlError` with `reason._tag = "UniqueViolation"` and `constraint = users_email_key` (SQLSTATE `23505`), and from Drizzle as `EffectDrizzleQueryError` whose `cause` is an Effect `Cause` that `Cause.squash` unwraps to that same `SqlError` — so adapters map **one** error shape, after unwrapping the Drizzle cause.
- **Database: PGlite, not a spawned PostgreSQL.** PGlite is PostgreSQL itself compiled to WASM (`@electric-sql/pglite@0.5.8` reports `PostgreSQL 18.3 … wasm32-unknown-emscripten`), in-process, hermetic (no `initdb`, port reservation, sentinel or teardown — the machinery mono-web's `startDisposablePostgres` owns, `tools/postgres/index.ts`, used here as reference only; nothing is imported from mono-web), and both reference drivers exist for stable Effect (`@effect/sql-pglite@4.0.0`, 2026-10-01). It gives real SQLSTATE codes, real constraints and real transactions, which is what G1-G4 and the error-mapping falsifier need. **Its limit** (README: "PGlite is single user/connection"): no concurrent connections, so lock contention, `FOR UPDATE` blocking and isolation anomalies cannot be exercised; those properties are `requiresConcurrentConnections`, skipped on PGlite, and runnable against a pool-capable driver (`@effect/sql-pg`) when a PostgreSQL URL is supplied — an opt-in job, **not** part of the default gate.

## 6. Falsifiers / acceptance (all on a clean committed worktree)

Fixture: `examples/users`'s operations reused verbatim, plus a sibling example (or in-place extension, whichever does not collide with 0015/0020 owners at implementation time) that adds the declaration-only port methods, two adapters, the shared scenarios and the existing live-server journey.

1. **Same journey on both**: the live-server e2e (generated HTTP + RPC, persistence across requests, typed failure — `STATE.md`, spec 0003) passes against `UsersSql` **and** `UsersDrizzle`, each on its own fresh PGlite.
2. **Typed unique violation**: a duplicate email surfaces as the declared `EmailTaken` (not a defect, not `SqlError`) on both adapters, asserted by the shared scenario.
3. **Atomicity**: G3 and G4 pass on both adapters; plus **mixed** shared transaction — one `UsersSql` call and one `UsersDrizzle` call inside a single `sql.withTransaction` roll back together and commit together.
4. **Interruption is recorded, not claimed**: a test interrupts a running call on each adapter and **records** whether the transaction rolled back and the connection stayed usable; the observed outcome is written into the evidence doc. No expected value is asserted beforehand.
5. **Adapter choice is invisible to the compiler**: `semanticHash` and every generated byte are identical regardless of which adapter module the project imports.
6. **Single source**: deleting a port method from the declarations, or adding one, makes `tsc` fail both adapters (excess/missing property of the `Layer.succeed(UsersPort, …)` literal); a scenario naming a missing method or an undeclared error fails `tsc`.
7. **The suite can fail**: the two deliberately broken adapters (§4) fail named properties.
8. **Optional probe, evidence only**: if a PostgreSQL URL and `effect-prisma-generator@0.10.0` + `prisma ^7` are available, run the same suite once against a Prisma-backed adapter and record pass/fail and any interruption/transaction findings in `docs/research/`; if unavailable, record "not run". Not shipped, not gated.
9. Gates: focused tests, `bun run check`, `effect:diagnostics`, the rc.116 fixture typecheck (generated port files must typecheck against both Effect families through the existing target-profile mapping), ff-merge, pack the exact commit, remove clean worktrees. No deploy, no production DB, no network at test time (PGlite is a local dependency).

## 7. Seams, ownership, coordination

- New package `packages/persistence` (`@effx/persistence`): `syntax` (the `Annotation.define` half, runtime-importable) and `compiler` (implement/read/analyze/write); depends on `@effx/compiler`, `@effx/runtime`, `@effx/ir`; **core imports nothing from it**. Adapter helper packages (`makeTx`-style helpers, error mappers) are separate and out of the compiler's dependency graph.
- It needs from 0020: `Annotation.define` with `target: "operation"` accepting a declaration-only builder operation via `.with(...)`; `Annotation.implement` with a free `write: Generator`; `Annotation.extension` for `defineConfig` registration. Start is coordinated with the 0020 owner (`lift-design`) and the 0015 config owner (`monoweb-gap`); no file owned by them is edited before their merge.
- Update `docs/specs/0008-sql-projection-extension.md` status to _superseded in scope by 0022_ at implementation time.
