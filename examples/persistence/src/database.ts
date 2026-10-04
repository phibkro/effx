/** @effect-diagnostics unstableApiUsage:off -- EX-0022: spec 0022 pins native Effect SQL/PGlite at this persistence boundary. */
import { PgliteClient } from "@effect/sql-pglite";
import { Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { User } from "@effx-examples/users/user";
import { alice, bob } from "./fixtures.ts";
import { decodeStoredUsers, encodeStoredUsers } from "./storage.ts";

const encodeSnapshot = Schema.encodeEffect(Schema.Array(User));

// Hand-owned DDL, not a compiler projection or a generic repository.
export const setupUsers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE users (
    id text PRIMARY KEY,
    email text NOT NULL,
    display_name text NOT NULL,
    CONSTRAINT users_email_key UNIQUE (email)
  )`;
});

/** Clear every persisted row without reinstalling domain fixtures. */
export const resetUsers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`DELETE FROM users`;
});

export const seedUsers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* resetUsers;
      const rows = yield* encodeStoredUsers([alice, bob]).pipe(Effect.orDie);

      for (const row of rows) {
        yield* sql`INSERT INTO users (id, email, display_name)
        VALUES (${row.id}, ${row.email}, ${row.displayName})`;
      }
    }),
  );
});

export const snapshotUsers = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT id, email, display_name AS "displayName" FROM users ORDER BY id`;
  // Corrupt persisted data is a broken store invariant, never "not found".
  const users = yield* decodeStoredUsers(rows).pipe(Effect.orDie);

  return yield* encodeSnapshot(users).pipe(Effect.orDie);
});

/** One in-memory PostgreSQL WASM instance per layer construction, closed by its scope.
 * Writes are committed facts visible across requests, not durable across process restarts.
 * No delivery/retry or concurrent-connection guarantee is claimed.
 */
export const database = Layer.effectDiscard(setupUsers).pipe(
  Layer.provideMerge(PgliteClient.layer()),
);
