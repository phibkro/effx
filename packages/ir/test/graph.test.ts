import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { IRGraph, StableId, make } from "@effx/ir";
import { ids, users, usersWithDangling } from "./fixtures/users.ts";

describe("IRGraph", () => {
  const index = IRGraph.toGraph(users);

  it.effect("indexes nodes by id and by prefix", () =>
    Effect.sync(() => {
      assert.isTrue(Option.isSome(IRGraph.nodeOf(index, ids.get)));
      assert.deepStrictEqual(IRGraph.withPrefix(index, "operation:User.").map(String), [
        "operation:User.ChangeEmail",
        "operation:User.Get",
      ]);
      assert.deepStrictEqual(index.duplicates, []);
    }),
  );

  it.effect("outgoing edges filter by kind", () =>
    Effect.sync(() => {
      const exposures = IRGraph.outgoing(index, ids.get, "ExposedAs");
      assert.deepStrictEqual(
        exposures.map((edge) => edge.qualifier),
        ["cli", "http", "rpc"],
      );
      assert.strictEqual(IRGraph.incoming(index, ids.model, "ViewOf").length, 2);
    }),
  );

  it.effect("reachable follows edge direction", () =>
    Effect.sync(() => {
      const reached = IRGraph.reachable(index, ids.change).map(String);
      assert.includeMembers(reached, [
        "service:Users",
        "service:UserLeases",
        "capability:User.ChangeEmail",
        "focus:User.email",
        "exposure:http:User.ChangeEmail",
      ]);
      assert.notInclude(reached, "operation:User.ChangeEmail");
    }),
  );

  it.effect("missing targets are data, not failures", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(IRGraph.missingTargets(index), []);
      const missing = IRGraph.missingTargets(IRGraph.toGraph(usersWithDangling));
      assert.strictEqual(missing.length, 1);
      assert.deepStrictEqual(missing[0]?.missing.map(String), ["service:Audit"]);
      assert.deepStrictEqual(
        IRGraph.fromGraph(IRGraph.toGraph(usersWithDangling)).edges.length,
        users.edges.length,
      );
    }),
  );

  it.effect("cycles are reported as id lists", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(IRGraph.cycles(index), []);
      const a = StableId.make("service", "A");
      const b = StableId.make("service", "B");

      const cyclic = make(
        [
          { _tag: "Service", id: a, name: "A", symbol: { module: "m", export: "A" } },
          { _tag: "Service", id: b, name: "B", symbol: { module: "m", export: "B" } },
        ],
        [
          { kind: "Requires", from: a, to: b },
          { kind: "Requires", from: b, to: a },
        ],
      );

      assert.deepStrictEqual(
        IRGraph.cycles(IRGraph.toGraph(cyclic)).map((cycle) => cycle.map(String).toSorted()),
        [["service:A", "service:B"]],
      );
    }),
  );

  it.effect("duplicate ids survive projection and are reported", () =>
    Effect.sync(() => {
      const a = StableId.make("service", "A");

      const dup = make(
        [
          { _tag: "Service", id: a, name: "A", symbol: { module: "m", export: "A" } },
          { _tag: "Service", id: a, name: "A2", symbol: { module: "m", export: "A2" } },
        ],
        [],
      );

      const dupIndex = IRGraph.toGraph(dup);
      assert.deepStrictEqual(dupIndex.duplicates.map(String), ["service:A"]);
      assert.strictEqual(IRGraph.fromGraph(dupIndex).nodes.length, 2);
    }),
  );
});
