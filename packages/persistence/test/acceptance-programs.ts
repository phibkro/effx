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

// The generated G2 law must compare Type values even when a codec normalizes both to one encoding.
export const equalityDeclarations = `
import { Operation } from "@effx/runtime";
import { Persist } from "@effx/persistence/syntax";
import { Schema, SchemaGetter } from "effect";
export const EmptyInput = Schema.Struct({ fail: Schema.Boolean });
export const CollapsedSuccess = Schema.Int.pipe(Schema.decodeTo(Schema.Int, {
  decode: SchemaGetter.passthrough(),
  encode: SchemaGetter.transform(() => 0),
}));
const ErrorShape = Schema.Struct({ _tag: Schema.Literal("CollapsedError"), value: Schema.Int });
export const CollapsedError = ErrorShape.pipe(Schema.decodeTo(ErrorShape, {
  decode: SchemaGetter.passthrough(),
  encode: SchemaGetter.transform((error) => ({ ...error, value: 0 })),
}));
export const SuccessQuery = Operation.query({
  name: "Equality.success", input: EmptyInput, success: CollapsedSuccess,
}).with(Persist.Port({ port: "Equality" })).declare();
export const ErrorQuery = Operation.query({
  name: "Equality.failure", input: EmptyInput, success: CollapsedSuccess,
}).errors(CollapsedError).with(Persist.Port({ port: "Equality" })).declare();

export const CompoundInput = Schema.Struct({});
export const ProbeError = Schema.Struct({ _tag: Schema.Literal("ProbeError"), value: Schema.Int });
export const CompoundQuery = Operation.query({
  name: "Compound.probe", input: CompoundInput, success: Schema.Int,
}).errors(ProbeError).with(Persist.Port({ port: "Compound" })).declare();
export const CompoundCommand = Operation.command({
  name: "Compound.write", input: CompoundInput, success: Schema.Int,
}).with(Persist.Port({ port: "Compound" })).declare();
`;

export const equalityProgram = `
import { assert, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { EqualityPort } from "./.effx/generated/equality-port.ts";
import { equalityConformance, type EqualityHarness, type EqualityScenarios } from "./.effx/generated/equality-conformance.ts";
import { CollapsedError, CollapsedSuccess } from "./src/equality.ts";

it.effect("distinct Type values collapse to identical encodings", () => Effect.gen(function* () {
  const success = Schema.encodeEffect(CollapsedSuccess);
  const error = Schema.encodeEffect(CollapsedError);
  assert.strictEqual(yield* success(1), yield* success(2));
  assert.deepStrictEqual(
    yield* error({ _tag: "CollapsedError", value: 1 }),
    yield* error({ _tag: "CollapsedError", value: 2 }),
  );
}));
const scenarios: EqualityScenarios = {
  seed: Effect.void,
  methods: {
    success: { success: [{ name: "first value", input: { fail: false }, expected: 1 }], errors: {} },
    failure: {
      success: [{ name: "successful alternate input", input: { fail: false }, expected: 1 }],
      errors: { CollapsedError: [{ name: "first error", input: { fail: true }, expected: { _tag: "CollapsedError", value: 1 } }] },
    },
  },
  sharedTransactions: {},
};
for (const mode of ["stable", "changing", "wrong-expected"] as const) {
  const changing = mode === "changing";
  const expected = mode === "wrong-expected" ? 2 : 1;
  const harness: EqualityHarness<never, never> = {
    name: mode,
    layer: Layer.effect(EqualityPort, Effect.sync(() => {
      let successes = 0;
      let failures = 0;
      let alternateSuccesses = 0;
      return EqualityPort.of({
        success: () => Effect.sync(() => changing ? ++successes : expected),
        failure: (input) => input.fail
          ? Effect.fail({ _tag: "CollapsedError" as const, value: changing ? ++failures : expected })
          : Effect.sync(() => changing ? ++alternateSuccesses : expected),
      });
    })),
    transact: (effect) => effect,
    snapshot: Effect.succeed([]),
    supportsConcurrentConnections: false,
  };
  equalityConformance(harness, scenarios);
}
`;

export const compoundProgram = `

import { Cause, Context, Effect, Layer, Ref } from "effect";
import { CompoundPort } from "./.effx/generated/compound-port.ts";
import { compoundConformance, type CompoundHarness, type CompoundScenarios } from "./.effx/generated/compound-conformance.ts";

class ProbeState extends Context.Service<ProbeState, Ref.Ref<"compound" | "success" | "single">>()("test/compound/ProbeState") {}
const select = (mode: "success" | "single") => Effect.flatMap(ProbeState, (state) => Ref.set(state, mode));
const scenarios: CompoundScenarios<never, ProbeState> = {
  seed: Effect.void,
  methods: {
    probe: {
      success: [{ name: "one success", input: {}, expected: 1, seed: select("success") }],
      errors: { ProbeError: [{
        name: "one domain error", input: {}, expected: { _tag: "ProbeError", value: 1 }, seed: select("single"),
      }] },
    },
    write: { success: [{ name: "one command", input: {}, expected: 1 }], errors: {} },
  },
  sharedTransactions: {},
};
for (const mode of [
  "reversed", "changed-member", "changed-multiplicity", "changed-length",
  "mixed-defect", "mixed-interrupt", "undeclared", "compound-domain", "compound-rollback",
] as const) {
  const state = Layer.effect(ProbeState, Ref.make<"compound" | "success" | "single">("compound"));
  const layer = Layer.effect(CompoundPort, Effect.gen(function* () {
    const state = yield* ProbeState;
    let calls = 0;
    const error = (value: number) => Cause.makeFailReason({ _tag: "ProbeError" as const, value });
    return CompoundPort.of({
      write: () => Effect.succeed(1),
      probe: () => Effect.gen(function* () {
        const selected = yield* Ref.get(state);
        if (selected === "success") return 1;
        if (selected === "single" && mode !== "compound-domain")
          return yield* Effect.fail({ _tag: "ProbeError" as const, value: 1 });
        const second = ++calls % 2 === 0;
        let reasons: ReadonlyArray<Cause.Reason<unknown>> = second
          ? [error(2), error(1), error(1)]
          : [error(1), error(2), error(1)];
        if (mode === "changed-member" && second) reasons = [error(2), error(1), error(3)];
        if (mode === "changed-multiplicity" && second) reasons = [error(2), error(1), error(2)];
        if (mode === "changed-length" && second) reasons = [error(2), error(1)];
        if (mode === "mixed-defect") reasons = [error(1), Cause.makeDieReason("probe defect")];
        if (mode === "mixed-interrupt") reasons = [error(1), Cause.makeInterruptReason(123)];
        if (mode === "undeclared") reasons = [error(1), Cause.makeFailReason({ _tag: "Undeclared", value: 1 })];
        return yield* Effect.failCause(Cause.fromReasons(reasons));
      }),
    });
  })).pipe(Layer.provideMerge(state));
  const harness: CompoundHarness<never, ProbeState> = {
    name: mode,
    layer,
    transact: (effect) => mode === "compound-rollback"
      ? effect.pipe(Effect.catchCause((cause) => Effect.failCause(Cause.fromReasons([
          ...cause.reasons, Cause.makeFailReason({ _tag: "ExtraRollbackFailure" }),
        ]))))
      : effect,
    snapshot: Effect.succeed([]),
    supportsConcurrentConnections: false,
  };
  compoundConformance(harness, scenarios);
}

`;
