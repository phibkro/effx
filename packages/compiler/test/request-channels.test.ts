import { assert, describe, it } from "@effect/vitest";
import { BunCrypto } from "@effect/platform-bun";
import { Effect, Option, Schema } from "effect";
import { StableId, canonical, semanticHash } from "@effx/ir";
import { Extensions, compileCollected, type CompileResult } from "@effx/compiler";
import type { AnnotationArg, Collected, Declaration } from "../src/Collected.ts";
import { HttpContractData } from "../src/extensions/http-contract.ts";

/*
 * Spec 0024 §2: the request channels an operation `input` implies are derived into `Http.Contract` by the
 * 0013 pre-pass, in a group or not. Every law below compares a dense declaration (channel omitted) with
 * its verbose twin (channel spelled out): canonical IR, semantic hash and generated files must be equal,
 * and the contract must really carry the channel (equality of two contracts that both lack it proves
 * nothing).
 */

const ref = (name: string) => ({
  module: "orders/schemas",
  export: name,
  symbolId: StableId.make("schema", `orders/${name}`),
});

/** A Schema reference as the frontend lowers it: `fields` where recorded, `marker` for `Http.headers`. */
const schema = (
  name: string,
  fields?: ReadonlyArray<string>,
  marker?: "headers",
): AnnotationArg => {
  const base = { _tag: "Schema" as const, ref: ref(name) };

  if (fields === undefined) return marker === undefined ? base : { ...base, marker };

  return marker === undefined ? { ...base, fields } : { ...base, fields, marker };
};

type Verb = "Get" | "Post" | "Put" | "Patch" | "Delete";

type Kind = "Query" | "Command";

type Options = Readonly<Record<string, AnnotationArg>>;

type Channel = "params" | "query" | "headers" | "payload";

interface Scenario {
  readonly kind: Kind;
  readonly verb: Verb;
  readonly path: string;
  readonly input: AnnotationArg;
  readonly contract: Options;
}

const scenario = (
  kind: Kind,
  verb: Verb,
  path: string,
  input: AnnotationArg,
  contract: Options = {},
): Scenario => ({ kind, verb, path, input, contract });

const params = schema("Params", ["id"]);

// --- bare external operations: the contract names root-less `group: "orders"`, the group is `OrdersGroup`

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

const external = ({ kind, verb, path, input, contract }: Scenario): Declaration => ({
  id: "Orders.op",
  kind: "builder",
  module: "./operations",
  export: "OrdersOp",
  binding: "external",
  location: { file: "orders.effx.ts", line: 7, col: 1 },
  annotations: [
    { name: kind, args: [{ name: "Orders.op", input, success: schema("Success") }] },
    { name: `Http.${verb}`, args: [path] },
    {
      name: "Http.Contract",
      args: [
        {
          group: "orders",
          success: schema("Success"),
          metadata: { operationId: "orders.op" },
          ...contract,
        },
      ],
    },
  ],
});

const project = {
  target: "effect-4.0",
  emit: "contract",
  allowImportingTsExtensions: false,
  canonicalImportBase: ".",
  outputDir: ".effx/generated",
} as const;

const bare = (value: Scenario): Collected => ({
  declarations: [group, external(value)],
  diagnostics: [],
  httpApiGroups: [
    { root: { module: "./root", export: "OrdersApi" }, group: "orders", endpoints: ["op"] },
  ],
  project,
});

// --- local operations of an `Http.group`: builder `.in(Group)` and decorator-class spellings

const localGroup = (kind: "builder" | "class"): Declaration => ({
  id: "OrdersGroup",
  kind,
  module: "orders/operations",
  export: "OrdersGroup",
  annotations: [
    {
      name: "Http.Group",
      args: [
        {
          root: { _tag: "Symbol", ref: { module: "orders/api", export: "Api" }, identifier: "Api" },
          group: "orders",
        },
      ],
    },
  ],
});

/** `dense`: the group supplies root, group and operation id; `contract` is what the author still writes. */
const local = (
  { kind, verb, path, input, contract }: Scenario,
  association: "in" | "class" | "none",
  dense: boolean,
): Declaration => ({
  id: "OrdersGroup.op",
  kind: association === "class" ? "staticMethod" : "builder",
  module: "orders/operations",
  export: "OrdersGroup",
  member: "op",
  location: { file: "orders.effx.ts", line: 7, col: 1 },
  annotations: [
    { name: kind, args: [{ name: "orders.op", input, success: schema("Success") }] },
    { name: `Http.${verb}`, args: [path] },
    ...(dense && association === "in"
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
    {
      name: "Http.Contract",
      args: [
        dense
          ? contract
          : {
              root: "Api",
              group: "orders",
              success: schema("Success"),
              metadata: { operationId: "orders.op" },
              ...contract,
            },
      ],
    },
  ],
  handlerSignature: {
    success: { _tag: "Schema", ref: ref("Success") },
    errors: [],
    requirements: [],
  },
});

const grouped = (
  value: Scenario,
  association: "in" | "class" | "none",
  dense: boolean,
): Collected => ({
  declarations: [
    localGroup(association === "class" ? "class" : "builder"),
    local(value, association, dense),
  ],
  diagnostics: [],
  httpApiGroups: [
    { root: { module: "orders/api", export: "Api" }, group: "orders", endpoints: ["op"] },
  ],
});

/** The author's spelling inside a group: the group supplies root, group and operation id, the channel is omitted. */
const dense = (value: Scenario, association: "in" | "class" = "in"): Collected =>
  grouped(value, association, true);

/** The verbose twin: outside any group, everything written out (`contract` includes the channel). */
const spelled = (value: Scenario, contract: Options = value.contract): Collected =>
  grouped({ ...value, contract }, "none", false);

/**
 * Every place an author can leave a derivable channel out; each knows the verbose twin that spells it out:
 * an external declaration (the mono-web Profile and Directory style) or a local one outside any group,
 * `.in(group)`, and a static method of a `@Http.Group` class.
 */
interface Spelling {
  readonly label: string;
  /** The declaration with `value.contract` as written. */
  readonly omitted: (value: Scenario) => Collected;
  /** The same declaration with everything written out: `contract` replaces `value.contract`. */
  readonly written: (value: Scenario, contract: Options) => Collected;
}

const spellings: ReadonlyArray<Spelling> = [
  {
    label: "external, outside a group",
    omitted: (value) => bare(value),
    written: (value, contract) => bare({ ...value, contract }),
  },
  { label: "local, outside a group", omitted: (value) => spelled(value), written: spelled },
  { label: ".in(group)", omitted: (value) => dense(value, "in"), written: spelled },
  { label: "@Http.Group class", omitted: (value) => dense(value, "class"), written: spelled },
];

// --- observation

const errors = (result: CompileResult) =>
  result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

const codes = (result: CompileResult) => errors(result).map((diagnostic) => diagnostic.code);

const channelNames: ReadonlyArray<Channel> = ["params", "query", "headers", "payload"];

/** The decoded `HttpContract` extension data of the only operation. */
const contractOf = (result: CompileResult): HttpContractData => {
  const ir = Option.getOrThrow(result.ir.value);

  const node = ir.nodes.find(
    (candidate) => candidate._tag === "Extension" && candidate.tag === "HttpContract",
  );

  return Option.getOrThrow(
    Schema.decodeUnknownOption(HttpContractData)(
      node?._tag === "Extension" ? node.data : undefined,
    ),
  );
};

/** Which export fills each channel of the contract; absent channels are omitted. */
const channelsOf = (data: HttpContractData) =>
  Object.fromEntries(
    channelNames.flatMap((name) => {
      const channel = data[name];

      return channel === undefined ? [] : [[name, channel.export]];
    }),
  );

const compiled = (source: Collected) => compileCollected(source, Extensions.builtin);

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

// --- the table of spec 0024 §2.1

interface Row {
  readonly label: string;
  readonly scenario: Scenario;
  /** The channel the pre-pass must add, the Schema reference its verbose spelling writes, its recorded keys. */
  readonly derived: Channel;
  readonly as: AnnotationArg;
  readonly keys?: ReadonlyArray<string>;
  /** Every channel of the resulting contract, by export name. */
  readonly channels: Readonly<Record<string, string>>;
}

const rows: ReadonlyArray<Row> = [
  // 1. A header-marked input is a headers schema.
  {
    label: "1: a header-marked GET input becomes headers",
    scenario: scenario("Query", "Get", "/orders", schema("Input", ["x-token"], "headers")),
    derived: "headers",
    as: schema("Input", ["x-token"], "headers"),
    keys: ["x-token"],
    channels: { headers: "Input" },
  },
  {
    label: "1: a header-marked input of optional headers keeps empty headersKeys",
    scenario: scenario("Query", "Get", "/orders", schema("Input", [], "headers")),
    derived: "headers",
    as: schema("Input", [], "headers"),
    keys: [],
    channels: { headers: "Input" },
  },
  {
    label: "1: a header-marked POST input becomes headers, never a payload",
    scenario: scenario(
      "Command",
      "Post",
      "/orders",
      schema("Input", ["idempotency-key"], "headers"),
    ),
    derived: "headers",
    as: schema("Input", ["idempotency-key"], "headers"),
    keys: ["idempotency-key"],
    channels: { headers: "Input" },
  },
  // 2. No path parameters: the verb decides.
  ...(
    [
      ["Query", "Get"],
      ["Command", "Delete"],
    ] as const
  ).map(([kind, verb]): Row => ({
    label: `2: a ${verb.toUpperCase()} input becomes query`,
    scenario: scenario(kind, verb, "/orders", schema("Input", ["q"])),
    derived: "query",
    as: schema("Input"),
    channels: { query: "Input" },
  })),
  ...(["Post", "Put", "Patch"] as const).map((verb): Row => ({
    label: `2: a ${verb.toUpperCase()} input becomes payload`,
    scenario: scenario("Command", verb, "/orders", schema("Input", ["note"])),
    derived: "payload",
    as: schema("Input"),
    channels: { payload: "Input" },
  })),
  {
    label: "2: a GET input with unknown keys becomes query",
    scenario: scenario("Query", "Get", "/orders", schema("Input")),
    derived: "query",
    as: schema("Input"),
    channels: { query: "Input" },
  },
  {
    label: "2: a POST input with unknown keys becomes payload",
    scenario: scenario("Command", "Post", "/orders", schema("Input")),
    derived: "payload",
    as: schema("Input"),
    channels: { payload: "Input" },
  },
  // 3. Every input field is a path parameter.
  {
    label: "3: a GET input equal to the path parameters becomes params",
    scenario: scenario("Query", "Get", "/orders/:id", schema("Input", ["id"])),
    derived: "params",
    as: schema("Input", ["id"]),
    keys: ["id"],
    channels: { params: "Input" },
  },
  {
    label: "3: several path parameters",
    scenario: scenario(
      "Query",
      "Get",
      "/orders/:order/lines/:line",
      schema("Input", ["line", "order"]),
    ),
    derived: "params",
    as: schema("Input", ["line", "order"]),
    keys: ["line", "order"],
    channels: { params: "Input" },
  },
  {
    label: "3: an action suffix (:id:action) is a literal, not a parameter",
    scenario: scenario("Command", "Post", "/orders/:id:cancel", schema("Input", ["id"])),
    derived: "params",
    as: schema("Input", ["id"]),
    keys: ["id"],
    channels: { params: "Input" },
  },
  {
    label: "3: a DELETE input equal to the path parameters becomes params",
    scenario: scenario("Command", "Delete", "/orders/:id", schema("Input", ["id"])),
    derived: "params",
    as: schema("Input", ["id"]),
    keys: ["id"],
    channels: { params: "Input" },
  },
  // 4. No input field is a path parameter: the verb decides, the explicit params stay.
  ...(
    [
      ["Query", "Get", "query"],
      ["Command", "Delete", "query"],
      ["Command", "Post", "payload"],
      ["Command", "Put", "payload"],
      ["Command", "Patch", "payload"],
    ] as const
  ).map(([kind, verb, channel]): Row => ({
    label: `4: a ${verb.toUpperCase()} input apart from the path parameters becomes ${channel}`,
    scenario: scenario(kind, verb, "/orders/:id", schema("Input", ["note"]), { params }),
    derived: channel,
    as: schema("Input"),
    channels: { params: "Params", [channel]: "Input" },
  })),
  {
    label: "4: an action suffix does not make a body field a parameter",
    scenario: scenario("Command", "Post", "/orders/:id:cancel", schema("Input", ["reason"]), {
      params,
    }),
    derived: "payload",
    as: schema("Input"),
    channels: { params: "Params", payload: "Input" },
  },
  // 6. Path parameters and unknown keys: a body is the 0013 default.
  ...(["Post", "Put", "Patch"] as const).map((verb): Row => ({
    label: `6: a ${verb.toUpperCase()} input with unknown keys becomes payload`,
    scenario: scenario("Command", verb, "/orders/:id", schema("Input"), { params }),
    derived: "payload",
    as: schema("Input"),
    channels: { params: "Params", payload: "Input" },
  })),
];

describe("derived request channels (spec 0024 §2)", () => {
  /** Compiles the declaration in every spelling that leaves its channels to the derivation. */
  const inEverySpelling = (
    value: Scenario,
    check: (result: CompileResult, label: string) => void,
  ) =>
    Effect.forEach(
      spellings,
      (spelling) =>
        Effect.map(compiled(spelling.omitted(value)), (result) => check(result, spelling.label)),
      { discard: true },
    );

  for (const row of rows) {
    it.effect(row.label, () =>
      Effect.gen(function* () {
        const contract = { ...row.scenario.contract, [row.derived]: row.as };

        for (const spelling of spellings) {
          const result = yield* identical(
            spelling.omitted(row.scenario),
            spelling.written(row.scenario, contract),
          );

          const data = contractOf(result);

          assert.deepStrictEqual(channelsOf(data), row.channels, spelling.label);

          if (row.derived === "params") assert.deepStrictEqual(data.paramsKeys, row.keys);

          if (row.derived === "headers") assert.deepStrictEqual(data.headersKeys, row.keys);
        }
      }).pipe(Effect.provide(BunCrypto.layer)),
    );
  }

  describe("explicit channels win", () => {
    it.effect("a derived channel never replaces an explicit one of another schema", () =>
      Effect.gen(function* () {
        for (const value of [
          scenario("Command", "Post", "/orders", schema("Input", ["note"]), {
            payload: schema("Other"),
          }),
          scenario("Query", "Get", "/orders", schema("Input", ["q"]), { query: schema("Other") }),
        ]) {
          const channel = value.verb === "Get" ? "query" : "payload";

          yield* inEverySpelling(value, (result, label) => {
            assert.deepStrictEqual(codes(result), [], label);
            assert.deepStrictEqual(channelsOf(contractOf(result)), { [channel]: "Other" }, label);
          });
        }
      }),
    );

    it.effect("params that name another schema than the input keep the input out of params", () =>
      inEverySpelling(
        scenario("Query", "Get", "/orders/:id", schema("Input", ["id"]), { params }),
        (result, label) => {
          assert.deepStrictEqual(codes(result), [], label);
          assert.deepStrictEqual(channelsOf(contractOf(result)), { params: "Params" }, label);
        },
      ),
    );

    it.effect("an input that already is an explicit channel derives nothing more", () =>
      Effect.gen(function* () {
        const input = (fields: ReadonlyArray<string>) => schema("Input", fields);

        for (const [channel, value] of [
          // A POST input that is also the headers (or the query) schema is not a body as well.
          [
            "headers",
            scenario("Command", "Post", "/orders", input(["x"]), { headers: input(["x"]) }),
          ],
          ["query", scenario("Command", "Post", "/orders", input(["q"]), { query: input(["q"]) })],
          [
            "payload",
            scenario("Command", "Patch", "/orders", input(["n"]), { payload: input(["n"]) }),
          ],
          [
            "params",
            scenario("Query", "Get", "/orders/:id", input(["id"]), { params: input(["id"]) }),
          ],
        ] as const) {
          yield* inEverySpelling(value, (result, label) => {
            assert.deepStrictEqual(codes(result), [], label);
            assert.deepStrictEqual(channelsOf(contractOf(result)), { [channel]: "Input" }, label);
          });
        }
      }),
    );

    it.effect("a header-marked input that is also the explicit headers stays valid", () => {
      const marked = schema("Input", [], "headers");

      return inEverySpelling(
        scenario("Query", "Get", "/orders", marked, { headers: marked }),
        (result, label) => {
          assert.deepStrictEqual(codes(result), [], label);
          assert.deepStrictEqual(channelsOf(contractOf(result)), { headers: "Input" }, label);
          assert.deepStrictEqual(contractOf(result).headersKeys, [], label);
        },
      );
    });
  });

  describe("syntax", () => {
    const query = scenario("Query", "Get", "/orders", schema("Input", ["q"]));

    const body = scenario("Command", "Post", "/orders", schema("Input", ["note"]));

    it.effect("builder and decorator spellings derive the same channels as the verbose twin", () =>
      Effect.gen(function* () {
        for (const [value, channel, verbose] of [
          [query, "query", { query: schema("Input") }],
          [body, "payload", { payload: schema("Input") }],
        ] as const) {
          const twin = grouped({ ...value, contract: verbose }, "none", false);

          for (const association of ["in", "class"] as const) {
            const result = yield* identical(grouped(value, association, true), twin);

            assert.deepStrictEqual(channelsOf(contractOf(result)), { [channel]: "Input" });
          }
        }
      }).pipe(Effect.provide(BunCrypto.layer)),
    );

    it.effect("query: true keeps working and equals the derived and the explicit spelling", () =>
      Effect.gen(function* () {
        const twin = grouped({ ...query, contract: { query: schema("Input") } }, "none", false);

        yield* identical(grouped({ ...query, contract: { query: true } }, "in", true), twin);
        yield* identical(grouped({ ...query, contract: { query: true } }, "class", true), twin);
        yield* identical(grouped(query, "in", true), twin);
      }).pipe(Effect.provide(BunCrypto.layer)),
    );

    it.effect("a PUT Command derives its payload like POST and PATCH", () =>
      Effect.gen(function* () {
        const put = { ...body, verb: "Put" } as const;
        const twin = grouped({ ...put, contract: { payload: schema("Input") } }, "none", false);

        yield* identical(grouped(put, "in", true), twin);
      }).pipe(Effect.provide(BunCrypto.layer)),
    );

    // The 0013 payload default now lives in the derivation, so the table also wins over it in a group.
    it.effect("in a group, a Command input is params, headers or payload by the table", () =>
      Effect.gen(function* () {
        const cancel = scenario("Command", "Post", "/orders/:id:cancel", schema("Input", ["id"]));

        const token = scenario(
          "Command",
          "Post",
          "/orders",
          schema("Input", ["x-token"], "headers"),
        );

        for (const [value, verbose, channel] of [
          [cancel, { params: schema("Input", ["id"]) }, "params"],
          [token, { headers: schema("Input", ["x-token"], "headers") }, "headers"],
        ] as const) {
          const twin = grouped({ ...value, contract: verbose }, "none", false);

          for (const association of ["in", "class"] as const) {
            const result = yield* identical(grouped(value, association, true), twin);

            assert.deepStrictEqual(channelsOf(contractOf(result)), { [channel]: "Input" });
          }
        }
      }).pipe(Effect.provide(BunCrypto.layer)),
    );

    it.effect("a header-marked input is never query: true", () =>
      Effect.gen(function* () {
        const marked = scenario(
          "Query",
          "Get",
          "/orders",
          schema("Input", ["x-token"], "headers"),
          {
            query: true,
          },
        );

        const result = yield* compiled(grouped(marked, "in", true));

        assert.include(codes(result), "EFFX2405");
      }),
    );
  });

  describe("an input without request data, and Queries over POST", () => {
    it.effect("derives no query for GET and DELETE, but a body is still a body", () =>
      Effect.gen(function* () {
        for (const [kind, verb, expected] of [
          ["Query", "Get", {}],
          ["Command", "Delete", {}],
          ["Command", "Post", { payload: "Empty" }],
          ["Command", "Put", { payload: "Empty" }],
          ["Command", "Patch", { payload: "Empty" }],
        ] as const) {
          yield* inEverySpelling(
            scenario(kind, verb, "/orders", schema("Empty", [])),
            (result, label) => {
              assert.deepStrictEqual(codes(result), [], label);
              assert.deepStrictEqual(channelsOf(contractOf(result)), expected, label);
            },
          );
        }
      }),
    );

    it.effect("a Query over POST keeps its explicit payload (ADR 0010)", () =>
      Effect.gen(function* () {
        const flagged = (contract: Options) =>
          scenario("Query", "Post", "/orders", schema("Input", ["q"]), {
            payloadIsQuery: true,
            ...contract,
          });

        // Not derived: the flag still needs its explicit payload, and the Query is still over POST.
        yield* inEverySpelling(flagged({}), (without, label) => {
          assert.includeMembers(codes(without), ["EFFX2401", "EFFX2402"]);
          assert.deepStrictEqual(channelsOf(contractOf(without)), {}, label);
        });

        yield* inEverySpelling(flagged({ payload: schema("Input") }), (explicit, label) => {
          assert.deepStrictEqual(codes(explicit), [], label);
          assert.deepStrictEqual(channelsOf(contractOf(explicit)), { payload: "Input" }, label);
        });
      }),
    );
  });

  describe("ambiguity is a diagnostic, never a guess", () => {
    const failed = (result: CompileResult) => {
      assert.isTrue(Option.isNone(result.files.value));

      return errors(result);
    };

    it.effect("5: an input that mixes path parameters and body fields is EFFX2410", () =>
      Effect.gen(function* () {
        for (const [kind, verb] of [
          ["Command", "Post"],
          ["Command", "Patch"],
          ["Query", "Get"],
        ] as const) {
          yield* inEverySpelling(
            scenario(kind, verb, "/orders/:id", schema("Input", ["id", "note"])),
            (result, label) => {
              const found = failed(result).filter((diagnostic) => diagnostic.code === "EFFX2410");

              assert.strictEqual(found.length, 1, label);
              assert.include(found[0]!.message, "the input mixes path parameters (id)", label);
              assert.include(found[0]!.message, "other fields (note)", label);
              assert.deepStrictEqual(
                found[0]!.location,
                { file: "orders.effx.ts", line: 7, col: 1 },
                label,
              );
            },
          );
        }
      }),
    );

    it.effect("6: GET and DELETE with path parameters and unknown keys are EFFX2411", () =>
      Effect.gen(function* () {
        for (const [kind, verb] of [
          ["Query", "Get"],
          ["Command", "Delete"],
        ] as const) {
          yield* inEverySpelling(
            scenario(kind, verb, "/orders/:id", schema("Input")),
            (result, label) => {
              const found = failed(result).filter((diagnostic) => diagnostic.code === "EFFX2411");

              assert.strictEqual(found.length, 1, label);
              assert.include(found[0]!.message, verb.toUpperCase(), label);
            },
          );
        }
      }),
    );

    it.effect("writing the body channel explicitly resolves the ambiguity", () =>
      Effect.gen(function* () {
        const mixed = schema("Input", ["id", "note"]);

        // Mixed input, params and body both written by hand: the split the diagnostic asks for.
        yield* inEverySpelling(
          scenario("Command", "Post", "/orders/:id", mixed, { params, payload: schema("Body") }),
          (split, label) => {
            assert.deepStrictEqual(codes(split), [], label);
            assert.deepStrictEqual(
              channelsOf(contractOf(split)),
              { params: "Params", payload: "Body" },
              label,
            );
          },
        );

        // Unknown keys on a GET, params and query both written by hand.
        yield* inEverySpelling(
          scenario("Query", "Get", "/orders/:id", schema("Input"), { params, query: schema("Q") }),
          (unknown, label) => {
            assert.deepStrictEqual(codes(unknown), [], label);
            assert.deepStrictEqual(
              channelsOf(contractOf(unknown)),
              { params: "Params", query: "Q" },
              label,
            );
          },
        );

        // The body written, the params forgotten: the existing params check speaks, the derivation adds nothing.
        yield* inEverySpelling(
          scenario("Command", "Post", "/orders/:id", mixed, { payload: schema("Body") }),
          (forgotten, label) => assert.deepStrictEqual(codes(forgotten), ["EFFX2402"], label),
        );
      }),
    );

    it.effect("explicit params resolve unknown keys, but not a mixed input with a free body", () =>
      Effect.gen(function* () {
        // The author declared the path side; nothing says the unknown part of the input is a query.
        yield* inEverySpelling(
          scenario("Query", "Get", "/orders/:id", schema("Input"), { params }),
          (unknown, label) => {
            assert.deepStrictEqual(codes(unknown), [], label);
            assert.deepStrictEqual(channelsOf(contractOf(unknown)), { params: "Params" }, label);
          },
        );

        // Known body fields next to the path ones: where do they go? The 0013 payload default is gone for them.
        yield* inEverySpelling(
          scenario("Command", "Patch", "/orders/:id", schema("Input", ["id", "note"]), { params }),
          (mixed, label) => assert.deepStrictEqual(codes(mixed), ["EFFX2410"], label),
        );
      }),
    );

    it.effect("1: a header-marked input with a conflicting explicit headers is EFFX2410", () =>
      inEverySpelling(
        scenario("Query", "Get", "/orders", schema("Input", ["x-token"], "headers"), {
          headers: schema("Other", ["x-other"], "headers"),
        }),
        (result, label) => {
          const found = failed(result).filter((diagnostic) => diagnostic.code === "EFFX2410");

          assert.strictEqual(found.length, 1, label);
          assert.include(found[0]!.message, "cannot also be a body", label);
        },
      ),
    );

    it.effect("an association that failed gets no derived diagnostic on top of its own", () =>
      Effect.gen(function* () {
        // A mixed input would be EFFX2410; the failed association must be the only report.
        const broken = grouped(
          scenario("Query", "Get", "/orders/:id", schema("Input", ["id", "note"])),
          "in",
          true,
        );

        const result = yield* compiled({
          ...broken,
          declarations: broken.declarations.map((declaration) => ({
            ...declaration,
            annotations: declaration.annotations.map((annotation) =>
              annotation.name === "Http.In"
                ? { ...annotation, args: [{ _tag: "Symbol" as const, ref: ref("Missing") }] }
                : annotation,
            ),
          })),
        });

        assert.include(codes(result), "EFFX2404");
        assert.notInclude(codes(result), "EFFX2410");
      }),
    );
  });
});
