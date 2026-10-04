// These programs run only in fresh, scoped copies of examples/persistence and examples/users.
// Keeping them as source lets the acceptance tests exercise the actual emitted imports and suites.
export const conformanceProgram = `
import { usersConformance } from "./.effx/generated/users-conformance.ts";
import { usersSqlHarness, usersDrizzleHarness } from "./src/harness.ts";
import { sharedUsersScenarios } from "./src/scenarios.ts";
usersConformance(usersSqlHarness, sharedUsersScenarios);
usersConformance(usersDrizzleHarness, sharedUsersScenarios);
`;

export const liveJourneyProgram = `
import { BunHttpServer } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Client, UserChangeEmail, UserGet } from "./.effx/generated/client.ts";
import { AppRoutes } from "./.effx/generated/http.ts";
import { OperationsClient } from "./.effx/generated/rpc.ts";
import { Email, UserId } from "../users/src/schemas.ts";
import { Users } from "../users/src/services.ts";
import { persistenceLayer } from "./src/server.ts";

for (const adapter of ["sql", "drizzle"] as const) {
  const TestServer = Layer.mergeAll(AppRoutes, Client.layer, OperationsClient.layerTest).pipe(
    Layer.provideMerge(BunHttpServer.layerTest),
    Layer.provideMerge(persistenceLayer(adapter)),
  );
  it.live(adapter + " generated HTTP and RPC preserve one store across requests", () =>
    Effect.gen(function* () {
      const aliceId = UserId.make("1");
      const bobId = UserId.make("2");
      const alice = { id: aliceId, displayName: "Alice" };
      const newEmail = Email.make("alice+new@example.com");
      assert.deepStrictEqual(yield* UserGet({ id: aliceId }), alice);
      assert.deepStrictEqual(yield* UserGet({ id: bobId }), { id: bobId, displayName: "Bob" });
      assert.deepStrictEqual(yield* UserChangeEmail({ id: aliceId, email: newEmail }), {
        ...alice, email: newEmail,
      });
      assert.deepStrictEqual(yield* UserGet({ id: aliceId }), alice);
      const users = yield* Users;
      assert.strictEqual((yield* users.find(aliceId)).email, newEmail);
      assert.deepStrictEqual(yield* UserChangeEmail({ id: aliceId, email: newEmail }), {
        ...alice, email: newEmail,
      });
      const rpc = yield* OperationsClient.make;
      assert.deepStrictEqual(yield* rpc["User.Get"]({ id: aliceId }), alice);
      const failure = yield* Effect.flip(
        rpc["User.ChangeEmail"]({ id: aliceId, email: Email.make("bob@example.com") }),
      );
      assert.strictEqual(failure._tag, "EmailTaken");
      if (failure._tag === "EmailTaken") assert.strictEqual(failure.email, "bob@example.com");
      assert.strictEqual((yield* users.find(aliceId)).email, newEmail);
      const rpcEmail = Email.make("alice+rpc@example.com");
      yield* rpc["User.ChangeEmail"]({ id: aliceId, email: rpcEmail });
      assert.strictEqual((yield* users.find(aliceId)).email, rpcEmail);
      assert.deepStrictEqual(yield* UserGet({ id: aliceId }), alice);
    }).pipe(Effect.provide(TestServer)),
  );
}
`;

export const mixedTransactionsProgram = `
import { assert, it } from "@effect/vitest";
import { Context, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { UsersPort } from "./.effx/generated/users-port.ts";
import { UserId } from "../users/src/schemas.ts";
import { database, seedUsers, snapshotUsers } from "./src/database.ts";
import { UsersSql } from "./src/UsersSql.ts";
import { UsersDrizzle } from "./src/UsersDrizzle.ts";

class RollbackProbe extends Schema.TaggedError<RollbackProbe>()("RollbackProbe", {}) {}

it.effect("mixed raw SQL and Drizzle join one ambient commit and rollback", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* seedUsers;
    const raw = Context.get(yield* Layer.build(UsersSql), UsersPort);
    const drizzle = Context.get(yield* Layer.build(UsersDrizzle), UsersPort);
    const id = UserId.make("1");
    const before = yield* snapshotUsers;
    const changes = Effect.gen(function* () {
      yield* raw.setEmail({ id, email: "mixed@example.com" });
      yield* drizzle.setDisplayName({ id, displayName: "Mixed" });
    });
    const rollback = yield* Effect.flip(sql.withTransaction(changes.pipe(
      Effect.andThen(Effect.fail(new RollbackProbe())),
    )));
    assert.strictEqual(rollback._tag, "RollbackProbe");
    assert.deepStrictEqual(yield* snapshotUsers, before);
    yield* sql.withTransaction(changes);
    const committed = yield* raw.find({ id });
    assert.strictEqual(committed.email, "mixed@example.com");
    assert.strictEqual(committed.displayName, "Mixed");
    assert.deepStrictEqual(yield* drizzle.find({ id }), committed);
    assert.notDeepStrictEqual(yield* snapshotUsers, before);
  }).pipe(Effect.provide(Layer.fresh(database))),
);
`;

// An observation, not a claim of a predetermined interruption outcome. A Deferred proves the
// statement finished before cancellation. Awaiting the fiber also waits for transaction cleanup.
export const interruptionProgram = `
import { it } from "@effect/vitest";
import { Context, Deferred, Effect, Exit, Fiber, FileSystem, Layer, Schema } from "effect";
import { BunServices } from "@effect/platform-bun";
import { SqlClient } from "effect/sql";
import { UsersPort } from "./.effx/generated/users-port.ts";
import { UserId } from "../users/src/schemas.ts";
import { database, seedUsers, snapshotUsers } from "./src/database.ts";
import { UsersSql } from "./src/UsersSql.ts";
import { UsersDrizzle } from "./src/UsersDrizzle.ts";

const Observation = Schema.fromJsonString(Schema.Struct({
  adapter: Schema.String,
  interrupted: Schema.Boolean,
  rolledBack: Schema.Boolean,
  connectionUsable: Schema.Boolean,
  finalizerCompleted: Schema.Boolean,
  snapshotReadable: Schema.Boolean,
  before: Schema.Json,
  after: Schema.Json,
}));
const encodeObservation = Schema.encodeEffect(Observation);
const encodeSnapshot = Schema.encodeEffect(Schema.fromJsonString(Schema.Json));

for (const [name, adapter] of [["sql", UsersSql], ["drizzle", UsersDrizzle]] as const) {
  it.effect(name + " interruption observation", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const sql = yield* SqlClient.SqlClient;
      yield* seedUsers;
      const users = Context.get(yield* Layer.build(adapter), UsersPort);
      const before = yield* snapshotUsers;
      const written = yield* Deferred.make<void>();
      const finalized = yield* Deferred.make<void>();
      const call = sql.withTransaction(Effect.gen(function* () {
        yield* users.setEmail({ id: UserId.make("1"), email: "interrupted@example.com" });
        yield* Deferred.succeed(written, undefined);
        yield* Effect.never;
      })).pipe(Effect.ensuring(Deferred.succeed(finalized, undefined)));
      const fiber = yield* Effect.forkChild(call);
      yield* Deferred.await(written);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      yield* Deferred.await(finalized);
      const snapshot = yield* Effect.exit(snapshotUsers);
      const after = Exit.isSuccess(snapshot) ? snapshot.value : null;
      const usable = yield* Effect.exit(users.find({ id: UserId.make("1") }));
      const rolledBack = Exit.isSuccess(snapshot) &&
        (yield* encodeSnapshot(before)) === (yield* encodeSnapshot(after));
      const observation = {
        adapter: name,
        interrupted: Exit.hasInterrupts(exit),
        rolledBack,
        connectionUsable: Exit.isSuccess(usable),
        finalizerCompleted: true,
        snapshotReadable: Exit.isSuccess(snapshot),
        before,
        after,
      };
      yield* fs.writeFileString("./interruption-" + name + ".json", yield* encodeObservation(observation));
      yield* Effect.log("persistence interruption observation", observation);
    }).pipe(Effect.provide(Layer.mergeAll(Layer.fresh(database), BunServices.layer))),
  );
}
`;

export const nonAtomicProgram = `
import { usersConformance } from "./.effx/generated/users-conformance.ts";
import { usersSqlHarness } from "./src/harness.ts";
import { sharedUsersScenarios } from "./src/scenarios.ts";
// Deliberately broken adapter transaction owner: statements auto-commit instead of joining
// a transaction. The actual generated G3/G4 assertions, not this program, must reject it.
usersConformance({
  ...usersSqlHarness,
  name: "broken non-atomic",
  transact: (effect) => effect,
}, sharedUsersScenarios);
`;

export const misMappedProgram = `
import { usersConformance } from "./.effx/generated/users-conformance.ts";
import { usersSqlHarness } from "./src/harness.ts";
import { sharedUsersScenarios } from "./src/scenarios.ts";
// The temp copy of UsersSql deliberately lets the real PostgreSQL unique violation defect.
usersConformance({ ...usersSqlHarness, name: "broken unique mapping" }, sharedUsersScenarios);
`;
