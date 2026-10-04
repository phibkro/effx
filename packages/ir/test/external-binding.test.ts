import { assert, describe, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import { Effect, Schema } from "effect";
import {
  type HttpGroupNode,
  type OperationNode,
  type SymbolRef,
  Node,
  StableId,
  canonical,
  decode,
  encode,
  make,
} from "@effx/ir";

const ref = {
  module: "profile/schemas",
  export: "ProfileInput",
  symbolId: StableId.make("schema", "profile/ProfileInput"),
};

const operation = {
  _tag: "Operation" as const,
  id: StableId.make("operation", "Profile.Read"),
  name: "Profile.Read",
  kind: "Query" as const,
  input: ref,
  success: ref,
  errors: { values: [], inferred: false },
  requirements: { values: [], inferred: false },
};

const group = {
  _tag: "HttpGroup" as const,
  id: StableId.make("group", "effx/profile"),
  root: "effx",
  group: "profile",
  title: "Profile",
  description: "Current person's profile",
  displayName: "Profile",
};

describe("HTTP group and external operation IR", () => {
  it.effect("encodes a group and declared operation without inventing a handler", () =>
    Effect.gen(function* () {
      const external = yield* Schema.decodeEffect(Node)({
        ...operation,
        binding: "external",
      });

      const groupNode = yield* Schema.decodeEffect(Node)(group);
      const ir = make([external, groupNode], []);

      assert.isFalse(Object.hasOwn(external, "handler"));
      assert.deepStrictEqual(yield* decode(encode(ir)), ir);
      assert.strictEqual(canonical(ir), canonical(make([groupNode, external], [])));
      assert.strictEqual(groupNode.id, "group:effx/profile");
    }),
  );
  it.effect("round-trips a concrete root reference without changing group identity", () =>
    Effect.gen(function* () {
      const symbolGroup = yield* Schema.decodeEffect(Node)({
        ...group,
        rootSymbol: { module: "./profile-root", export: "RootApi" },
      });

      const ir = make([symbolGroup], []);
      assert.deepStrictEqual(yield* decode(encode(ir)), ir);
      assert.strictEqual(symbolGroup.id, group.id);
      assert.notStrictEqual(
        canonical(ir),
        canonical(make([yield* Schema.decodeEffect(Node)(group)], [])),
      );

      const invalid = yield* Effect.flip(
        Schema.decodeUnknownEffect(Node)({ ...group, rootSymbol: { module: "./root" } }),
      );

      assert.isTrue(Schema.isSchemaError(invalid));
    }),
  );

  it.effect("requires the external discriminator exactly when no handler is present", () =>
    Effect.gen(function* () {
      const handler = { module: "profile/operations", export: "Profile", member: "read" };
      const local = yield* Schema.decodeEffect(Node)({ ...operation, handler });
      assert.strictEqual(local._tag, "Operation");

      if (local._tag === "Operation") {
        assert.deepStrictEqual(local.handler, handler);
        assert.isUndefined(local.binding);
      }

      for (const malformed of [operation, { ...operation, binding: "external", handler }]) {
        const failure = yield* Effect.flip(Schema.decodeUnknownEffect(Node)(malformed));
        assert.isTrue(Schema.isSchemaError(failure));
      }
    }),
  );

  it.effect("preserves the optional handler and external binding types", () =>
    Effect.sync(() => {
      expectTypeOf<OperationNode["handler"]>().toEqualTypeOf<SymbolRef | undefined>();
      expectTypeOf<OperationNode["binding"]>().toEqualTypeOf<"external" | undefined>();
      expectTypeOf<HttpGroupNode["root"]>().toEqualTypeOf<string>();
      expectTypeOf<HttpGroupNode["rootSymbol"]>().toEqualTypeOf<SymbolRef | undefined>();
    }),
  );
});
