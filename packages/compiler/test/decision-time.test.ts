import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { BunCrypto } from "@effect/platform-bun";
import { Effect, Option, Schema } from "effect";
import { Builtins, type HttpAccessOptions, type HttpGroupOptions } from "@effx/runtime";
import { StableId, canonical, semanticHash } from "@effx/ir";
import { Extensions, compileCollected, type CompileResult, type ReadArgs } from "@effx/compiler";
import type { AnnotationArg, Collected, Declaration } from "../src/Collected.ts";
import { AccessContractData } from "../src/extensions/access-contract.ts";

/*
 * Spec 0024 §4: `Http.Access.decisionTime` is optional to write. The 0013 pre-pass fills it from the sibling
 * operation annotation (Query -> SnapshotRead, Command -> Transaction), keeps an explicit value, and leaves
 * EFFX2501/EFFX2502 to check the resolved value. Every law compares a dense declaration with its verbose twin.
 */

type Options = Readonly<Record<string, AnnotationArg>>;

type DecisionTime = "SnapshotRead" | "Transaction";

const ref = (name: string) => ({
  module: "orders/schemas",
  export: name,
  symbolId: StableId.make("schema", `orders/${name}`),
});

const schema = (name: string): AnnotationArg => ({ _tag: "Schema", ref: ref(name) });

const symbol = (name: string): AnnotationArg => ({
  _tag: "Symbol",
  ref: { module: "orders/access", export: name },
});

/** An anonymous access policy, which needs no security marker on the contract. */
const access = (extra: Options = {}) => ({
  annotator: symbol("annotate"),
  exposure: "External",
  acceptedCredentials: ["None"],
  principalKinds: ["Anonymous"],
  capabilities: { _tag: "None" },
  requirements: [],
  canonicalScopeResolver: symbol("scope"),
  concealment: { _tag: "Reveal" },
  ...extra,
});

const group: Declaration = {
  id: "OrdersGroup",
  kind: "builder",
  module: "./groups",
  export: "OrdersGroup",
  annotations: [
    {
      name: "Http.Group",
      args: [
        {
          root: {
            _tag: "Symbol",
            ref: { module: "./root", export: "OrdersApi" },
            identifier: "effx",
          },
          group: "orders",
        },
      ],
    },
  ],
};

const project = {
  target: "effect-4.0",
  emit: "contract",
  allowImportingTsExtensions: false,
  canonicalImportBase: ".",
  outputDir: ".effx/generated",
} as const;

/** An external operation of the kind with an `Http.Access` of the given arguments. */
const operation = (
  kind: "Query" | "Command" | undefined,
  accessArgs: AnnotationArg,
  extras: ReadonlyArray<Declaration["annotations"][number]> = [],
): Declaration => ({
  id: "Orders.op",
  kind: "builder",
  module: "./operations",
  export: "OrdersOp",
  binding: "external",
  location: { file: "orders.effx.ts", line: 3, col: 1 },
  annotations: [
    ...(kind === undefined
      ? []
      : [
          {
            name: kind,
            args: [{ name: "Orders.op", input: schema("Input"), success: schema("Success") }],
          },
        ]),
    { name: kind === "Command" ? "Http.Post" : "Http.Get", args: ["/orders"] },
    {
      name: "Http.Contract",
      args: [
        {
          group: "orders",
          success: schema("Success"),
          metadata: { operationId: "orders.op" },
        },
      ],
    },
    { name: "Http.Access", args: [accessArgs] },
    ...extras,
  ],
});

const collected = (...declarations: ReadonlyArray<Declaration>): Collected => ({
  declarations: [group, ...declarations],
  diagnostics: [],
  project,
});

const errors = (result: CompileResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const codes = (result: CompileResult) => errors(result).map((diagnostic) => diagnostic.code);

const warnings = (result: CompileResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");

const compiled = (source: Collected) => compileCollected(source, Extensions.builtin);

/** The resolved decision time recorded in the IR of the only operation. */
const decisionTimeOf = (result: CompileResult): DecisionTime => {
  const ir = Option.getOrThrow(result.ir.value);

  const node = ir.nodes.find(
    (candidate) => candidate._tag === "Extension" && candidate.tag === "AccessContract",
  );

  return Option.getOrThrow(
    Schema.decodeUnknownOption(AccessContractData)(
      node?._tag === "Extension" ? node.data : undefined,
    ),
  ).decisionTime;
};

/** Dense and verbose compile alike: equal canonical IR, hash and generated files, and no errors. */
const identical = Effect.fnUntraced(function* (dense: Collected, verbose: Collected) {
  const a = yield* compiled(dense);
  const b = yield* compiled(verbose);

  assert.deepStrictEqual(codes(a), []);
  assert.deepStrictEqual(codes(b), []);

  const first = Option.getOrThrow(a.ir.value);
  const second = Option.getOrThrow(b.ir.value);

  assert.strictEqual(canonical(first), canonical(second));
  assert.strictEqual(yield* semanticHash(first), yield* semanticHash(second));
  assert.deepStrictEqual(Option.getOrThrow(a.files.value), Option.getOrThrow(b.files.value));

  return a;
});

describe("decisionTime default (spec 0024 §4)", () => {
  it.effect.each([
    ["Query", "SnapshotRead"],
    ["Command", "Transaction"],
  ] as const)("a %s that omits decisionTime decides in %s", ([kind, expected]) =>
    Effect.gen(function* () {
      const result = yield* identical(
        collected(operation(kind, access())),
        collected(operation(kind, access({ decisionTime: expected }))),
      );

      assert.strictEqual(decisionTimeOf(result), expected);
      // A defaulted value never trips the checks that run on the resolved one.
      assert.notInclude(
        warnings(result).map((diagnostic) => diagnostic.code),
        "EFFX2502",
      );
    }).pipe(Effect.provide(BunCrypto.layer)),
  );

  it.effect("an explicit value is kept, and EFFX2502 and EFFX2501 still check it", () =>
    Effect.gen(function* () {
      // A Query that decides in a transaction stays valid, with the existing warning.
      const query = yield* compiled(
        collected(operation("Query", access({ decisionTime: "Transaction" }))),
      );

      assert.strictEqual(decisionTimeOf(query), "Transaction");
      assert.deepStrictEqual(codes(query), []);
      assert.deepStrictEqual(
        warnings(query).map((diagnostic) => diagnostic.code),
        ["EFFX2502"],
      );
      assert.isTrue(Option.isSome(query.files.value));

      // A Command cannot decide in a read snapshot: an error, no files.
      const command = yield* compiled(
        collected(operation("Command", access({ decisionTime: "SnapshotRead" }))),
      );

      assert.deepStrictEqual(codes(command), ["EFFX2501"]);
      assert.isTrue(Option.isNone(command.files.value));
    }),
  );

  it.effect("an Http.Access with no single Query or Command to default from is EFFX2414", () =>
    Effect.gen(function* () {
      const none = yield* compiled(collected(operation(undefined, access())));
      const found = errors(none).filter((diagnostic) => diagnostic.code === "EFFX2414");

      assert.strictEqual(found.length, 1);
      assert.include(found[0]!.message, "Orders.op");
      assert.deepStrictEqual(found[0]!.location, { file: "orders.effx.ts", line: 3, col: 1 });
      assert.isTrue(Option.isNone(none.files.value));

      // Two operation annotations say two things: there is no single kind either.
      const both = yield* compiled(
        collected(
          operation("Query", access(), [
            {
              name: "Command",
              args: [{ name: "Orders.op", input: schema("Input"), success: schema("Success") }],
            },
          ]),
        ),
      );

      assert.include(codes(both), "EFFX2414");

      // Writing the value is the whole fix.
      const written = yield* compiled(
        collected(operation(undefined, access({ decisionTime: "Transaction" }))),
      );

      assert.notInclude(codes(written), "EFFX2414");
    }),
  );

  it.effect("malformed access arguments are reported by the interpreter, not as EFFX2414", () =>
    Effect.gen(function* () {
      const result = yield* compiled(collected(operation("Query", "not options")));

      assert.include(codes(result), "EFFX1102");
      assert.notInclude(codes(result), "EFFX2414");
    }),
  );

  describe("group access defaults", () => {
    // The group's `defaults.access` carries everything but a decision time: it is per operation by nature.
    const groupOf = (kind: "builder" | "class"): Declaration => ({
      id: "OrdersGroup",
      kind,
      module: "orders/operations",
      export: "OrdersGroup",
      annotations: [
        {
          name: "Http.Group",
          args: [
            {
              root: {
                _tag: "Symbol",
                ref: { module: "orders/api", export: "Api" },
                identifier: "Api",
              },
              group: "orders",
              defaults: {
                access: {
                  annotator: symbol("annotate"),
                  exposure: "External",
                  acceptedCredentials: ["None"],
                  principalKinds: ["Anonymous"],
                  concealment: { _tag: "Reveal" },
                },
              },
            },
          ],
        },
      ],
    });

    const local = (
      kind: "Query" | "Command",
      association: "in" | "class" | "none",
      accessArgs: Options,
      contract: Options,
    ): Declaration => ({
      id: "OrdersGroup.op",
      kind: association === "class" ? "staticMethod" : "builder",
      module: "orders/operations",
      export: "OrdersGroup",
      member: "op",
      annotations: [
        {
          name: kind,
          args: [{ name: "orders.op", input: schema("Input"), success: schema("Success") }],
        },
        { name: kind === "Query" ? "Http.Get" : "Http.Post", args: ["/orders"] },
        ...(association === "in"
          ? [
              {
                name: "Http.In",
                args: [
                  {
                    _tag: "Symbol" as const,
                    ref: { module: "orders/operations", export: "OrdersGroup" },
                  },
                ],
              },
            ]
          : []),
        { name: "Http.Contract", args: [contract] },
        { name: "Http.Access", args: [accessArgs] },
      ],
      handlerSignature: {
        success: { _tag: "Schema", ref: ref("Success") },
        errors: [],
        requirements: [],
      },
    });

    const sources = (
      kind: "Query" | "Command",
      association: "in" | "class",
      decisionTime: DecisionTime | undefined,
    ): Collected => ({
      declarations: [
        groupOf(association === "class" ? "class" : "builder"),
        local(
          kind,
          association,
          decisionTime === undefined
            ? {
                capabilities: { _tag: "None" },
                requirements: [],
                canonicalScopeResolver: symbol("scope"),
              }
            : {
                capabilities: { _tag: "None" },
                requirements: [],
                canonicalScopeResolver: symbol("scope"),
                decisionTime,
              },
          {},
        ),
      ],
      diagnostics: [],
    });

    const twin = (kind: "Query" | "Command", expected: DecisionTime): Collected => ({
      declarations: [
        groupOf("builder"),
        local(kind, "none", access({ decisionTime: expected }), {
          root: "Api",
          group: "orders",
          success: schema("Success"),
          metadata: { operationId: "orders.op" },
        }),
      ],
      diagnostics: [],
    });

    it.effect("builder and decorator spellings default alike, and equal the verbose twin", () =>
      Effect.gen(function* () {
        for (const [kind, expected] of [
          ["Query", "SnapshotRead"],
          ["Command", "Transaction"],
        ] as const) {
          for (const association of ["in", "class"] as const) {
            const result = yield* identical(
              sources(kind, association, undefined),
              twin(kind, expected),
            );

            assert.strictEqual(decisionTimeOf(result), expected);
          }
        }
      }).pipe(Effect.provide(BunCrypto.layer)),
    );

    it.effect("an explicit decisionTime next to group defaults wins", () =>
      Effect.gen(function* () {
        const result = yield* compiled(sources("Query", "in", "Transaction"));

        assert.strictEqual(decisionTimeOf(result), "Transaction");
        assert.include(
          warnings(result).map((diagnostic) => diagnostic.code),
          "EFFX2502",
        );
        assert.deepStrictEqual(codes(result), []);
      }),
    );
  });

  describe("types", () => {
    it("decisionTime is optional to write and required to read", () => {
      expectTypeOf<HttpAccessOptions["decisionTime"]>().toEqualTypeOf<DecisionTime | undefined>();
      expectTypeOf<
        ReadArgs<typeof Builtins.HttpAccess>[0]["decisionTime"]
      >().toEqualTypeOf<DecisionTime>();
    });

    it("the group defaults never gain a decisionTime", () => {
      type GroupAccess = NonNullable<NonNullable<HttpGroupOptions["defaults"]>["access"]>;

      expectTypeOf<GroupAccess>().not.toHaveProperty("decisionTime");
    });
  });
});
