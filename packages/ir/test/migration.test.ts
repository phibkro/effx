import { assert, describe, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import { Effect, Schema } from "effect";
import {
  type ApplicationIR,
  ApplicationIRV1,
  type Edge,
  IRArbitrary,
  IRGraph,
  StableId,
  VERSION,
  canonical,
  decode,
  decodeString,
  empty,
  encode,
  make,
  migrate,
  normalize,
} from "@effx/ir";
import { legacyV1 } from "./fixtures/legacy-v1.ts";

const legacyText = Schema.encodeEffect(Schema.fromJsonString(Schema.toCodecJson(ApplicationIRV1)))(
  legacyV1,
);

const extensionId = StableId.make("ext", "http-contract/Legacy.Get");

const operationId = StableId.make("operation", "Legacy.Get");

const extensionNode = {
  _tag: "Extension" as const,
  id: extensionId,
  extension: "http-contract",
  tag: "HttpContract",
  data: { group: "legacy" },
};

const ownership: Edge = {
  kind: "ExtensionOf",
  from: extensionId,
  to: operationId,
  qualifier: "HttpContract",
};

/** The new edge must survive every projection, not merely pass the schema decoder. */
const extended = make([...legacyV1.nodes, extensionNode], [...legacyV1.edges, ownership]);

const arbitrary = IRArbitrary.arbitraryIR();

describe("IR version migration", () => {
  it.effect("v2 builders and empty envelope have the current version", () =>
    Effect.sync(() => {
      assert.strictEqual(empty.version, 2);
      assert.strictEqual(extended.version, 2);
    }),
  );

  it.effect("migration preserves v1 data and is idempotent", () =>
    Effect.sync(() => {
      const upgraded = migrate(legacyV1);
      assert.strictEqual(upgraded.version, VERSION);
      assert.deepStrictEqual(upgraded.nodes, legacyV1.nodes);
      assert.deepStrictEqual(upgraded.edges, legacyV1.edges);
      assert.deepStrictEqual(migrate(upgraded), upgraded);
      assert.deepStrictEqual(legacyV1.version, 1);
    }),
  );

  it.effect("frozen v1 fixture decodes through both entry points, and writes v2 only", () =>
    Effect.gen(function* () {
      const fromObject = yield* decode(legacyV1);
      const fromString = yield* decodeString(yield* legacyText);
      assert.deepStrictEqual(fromObject, migrate(legacyV1));
      assert.deepStrictEqual(fromString, fromObject);
      assert.deepStrictEqual(yield* decode(encode(fromObject)), fromObject);
      assert.deepStrictEqual(yield* decodeString(canonical(fromObject)), normalize(fromObject));
      assert.strictEqual(
        fromObject.nodes.find((node) => node._tag === "Extension")?.id,
        legacyV1.nodes[1]?.id,
      );
      assert.isTrue(canonical(fromObject).includes('"version":2'));
    }),
  );

  it.effect("does not reinterpret a missing legacy handler as an external binding", () =>
    Effect.gen(function* () {
      const malformed = {
        ...legacyV1,
        nodes: legacyV1.nodes.map((node) =>
          node._tag === "Operation" ? { ...node, handler: undefined } : node,
        ),
      };

      const failure = yield* Effect.flip(decode(malformed));
      assert.isTrue(Schema.isSchemaError(failure));
    }),
  );

  it.effect.prop("v2 migration is identity and round trips", [arbitrary], ([ir]) =>
    Effect.gen(function* () {
      assert.strictEqual(migrate(ir), ir);
      assert.deepStrictEqual(migrate(migrate(ir)), ir);
      assert.deepStrictEqual(yield* decode(encode(ir)), ir);
    }),
  );

  it.effect("rejects unknown versions and a v2-only edge in v1", () =>
    Effect.gen(function* () {
      const wrongVersion = yield* Effect.flip(decode({ ...legacyV1, version: 3 }));

      const wrongEdge = yield* Effect.flip(
        decode({
          ...legacyV1,
          edges: [...legacyV1.edges, ownership],
        }),
      );

      const wrongString = yield* Effect.flip(
        decodeString('{"format":"effx-ir","version":3,"nodes":[],"edges":[]}'),
      );

      assert.isTrue(Schema.isSchemaError(wrongVersion));
      assert.isTrue(Schema.isSchemaError(wrongEdge));
      assert.isTrue(Schema.isSchemaError(wrongString));
    }),
  );

  it.effect("retains the ownership edge across v2 encode, normalization and graph projection", () =>
    Effect.gen(function* () {
      const decoded = yield* decode(encode(extended));
      assert.deepStrictEqual(decoded, extended);
      const index = IRGraph.toGraph(decoded);
      assert.deepStrictEqual(IRGraph.outgoing(index, extensionId, "ExtensionOf"), [ownership]);
      assert.deepStrictEqual(IRGraph.incoming(index, operationId, "ExtensionOf"), [ownership]);
      assert.deepStrictEqual(IRGraph.fromGraph(IRGraph.toGraph(decoded)), normalize(decoded));
      assert.deepStrictEqual(yield* decodeString(canonical(decoded)), normalize(decoded));
    }),
  );

  it.effect("keeps typed success, schema failures and no service requirements", () =>
    Effect.sync(() => {
      const decoded = decode(legacyV1);
      const decodedText = decodeString("");
      expectTypeOf<Effect.Success<typeof decoded>>().toEqualTypeOf<ApplicationIR>();
      expectTypeOf<Effect.Error<typeof decoded>>().toEqualTypeOf<Schema.SchemaError>();
      expectTypeOf<Effect.Services<typeof decoded>>().toEqualTypeOf<never>();
      expectTypeOf<Effect.Success<typeof decodedText>>().toEqualTypeOf<ApplicationIR>();
      expectTypeOf<Effect.Error<typeof decodedText>>().toEqualTypeOf<Schema.SchemaError>();
      expectTypeOf<Effect.Services<typeof decodedText>>().toEqualTypeOf<never>();
      assert.strictEqual(VERSION, 2);
    }),
  );
});
