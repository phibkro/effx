import { assert, describe, it } from "@effect/vitest";
import { BunCrypto } from "@effect/platform-bun";
import { Effect, Schema } from "effect";
import {
  type ApplicationIR,
  type Node,
  IRArbitrary,
  IRGraph,
  JsonCodec,
  canonical,
  decode,
  decodeString,
  encode,
  make,
  normalize,
  semanticHash,
} from "@effx/ir";
import { users } from "./fixtures/users.ts";

const rotate = <A>(xs: ReadonlyArray<A>, by: number): Array<A> => {
  if (xs.length === 0) return [];
  const n = by % xs.length;

  return [...xs.slice(n), ...xs.slice(0, n)];
};

const scrambleNode = (node: Node): Node => {
  switch (node._tag) {
    case "Model":
      return { ...node, views: node.views.toReversed() };
    case "Operation":
      return {
        ...node,
        errors: { ...node.errors, values: node.errors.values.toReversed() },
        requirements: { ...node.requirements, values: rotate(node.requirements.values, 1) },
      };
    default:
      return node;
  }
};

/** Reorders every semantically unordered collection without changing meaning. */
const scramble = (ir: ApplicationIR): ApplicationIR =>
  make(rotate(ir.nodes.toReversed().map(scrambleNode), 1), rotate(ir.edges.toReversed(), 2));

const arbitrary = IRArbitrary.arbitraryIR();

describe("IR laws (property)", () => {
  it.effect.prop("round trip: decode(encode(normalize(x))) == normalize(x)", [arbitrary], ([ir]) =>
    Effect.gen(function* () {
      const normalized = normalize(ir);
      const encoded = encode(normalized);
      const schemaEncoded = yield* Schema.encodeEffect(JsonCodec)(normalized);
      assert.deepStrictEqual(encoded, schemaEncoded);
      assert.deepStrictEqual(yield* decode(encoded), normalized);
    }),
  );

  it.effect.prop("normalize is idempotent", [arbitrary], ([ir]) =>
    Effect.sync(() => {
      assert.deepStrictEqual(normalize(normalize(ir)), normalize(ir));
    }),
  );

  it.effect.prop("canonical is idempotent through decode", [arbitrary], ([ir]) =>
    Effect.gen(function* () {
      const text = canonical(ir);
      assert.strictEqual(canonical(yield* decodeString(text)), text);
    }),
  );

  it.effect.prop("graph projection: fromGraph(toGraph(x)) == normalize(x)", [arbitrary], ([ir]) =>
    Effect.sync(() => {
      assert.deepStrictEqual(IRGraph.fromGraph(IRGraph.toGraph(ir)), normalize(ir));
    }),
  );

  it.effect.prop(
    "determinism: scrambled order gives the same canonical text",
    [arbitrary],
    ([ir]) =>
      Effect.sync(() => {
        assert.strictEqual(canonical(scramble(ir)), canonical(ir));
      }),
  );
});

describe("IR laws (User fixture)", () => {
  it.effect("scrambled fixture hashes identically", () =>
    Effect.gen(function* () {
      const a = yield* semanticHash(users);
      const b = yield* semanticHash(scramble(users));
      assert.strictEqual(a, b);
      assert.match(a, /^[0-9a-f]{64}$/);
    }).pipe(Effect.provide(BunCrypto.layer)),
  );

  it.effect("canonical text has no whitespace and code-unit-sorted keys", () =>
    Effect.sync(() => {
      const text = canonical(users);
      assert.isFalse(/\s/.test(text));
      assert.isTrue(text.startsWith('{"edges":[{"from":'));
      assert.isTrue(text.includes('"format":"effx-ir"'));
    }),
  );

  it.effect("normalize orders nodes by id, then by canonical encoding", () =>
    Effect.sync(() => {
      const ids = normalize(users).nodes.map((node) => node.id);
      assert.deepStrictEqual(ids, ids.toSorted());
    }),
  );

  it.effect("normalize dedupes identical edges and sorts set fields", () =>
    Effect.sync(() => {
      const n = normalize(users);
      assert.strictEqual(n.edges.length, users.edges.length - 1);

      const change = n.nodes.find(
        (node) => node._tag === "Operation" && node.name === "User.ChangeEmail",
      );

      assert.isTrue(change !== undefined && change._tag === "Operation");

      if (change?._tag === "Operation") {
        assert.deepStrictEqual(change.requirements.values.map(String), [
          "service:UserLeases",
          "service:Users",
        ]);
      }
    }),
  );
});
