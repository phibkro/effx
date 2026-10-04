/** @effect-diagnostics unstableApiUsage:off -- EX-0022: spec 0022 pins native Effect SQL/PGlite at this persistence boundary. */
import { Effect, Layer } from "effect";
import { SqlClient, SqlError } from "effect/sql";
import type { UsersHarness } from "../.effx/generated/users-conformance.ts";
import { database, snapshotUsers } from "./database.ts";
import { UsersDrizzle } from "./UsersDrizzle.ts";
import { UsersSql } from "./UsersSql.ts";

const transact: UsersHarness<SqlError.SqlError, SqlClient.SqlClient>["transact"] = (effect) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.withTransaction(effect));

// The generated suite constructs a fresh layer per test/sample. PGlite is single connection;
// contention cases must be skipped rather than advertised as multi-connection evidence.
export const usersSqlHarness: UsersHarness<SqlError.SqlError, SqlClient.SqlClient> = {
  name: "UsersSql / PGlite",
  layer: UsersSql.pipe(Layer.provideMerge(database)),
  transact,
  snapshot: snapshotUsers,
  supportsConcurrentConnections: false,
};

export const usersDrizzleHarness: UsersHarness<SqlError.SqlError, SqlClient.SqlClient> = {
  name: "UsersDrizzle / PGlite",
  layer: UsersDrizzle.pipe(Layer.provideMerge(database)),
  transact,
  snapshot: snapshotUsers,
  supportsConcurrentConnections: false,
};
