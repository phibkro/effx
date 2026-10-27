import { assert, describe, it } from "@effect/vitest";
import { Effect, Result, Schema, SchemaRepresentation } from "effect";
import { Extensions, analyze } from "@effx/compiler";
import { IRGraph, JsonCodec, Node, decode, make, normalize } from "@effx/ir";
import {
  CheckRepresentation,
  DomainDescription,
  alloyBasename,
  alloyStaticBasename,
  domainModel,
  domainNodes,
  generateAlloy,
  receiptCommandMatches,
  vectorsFromReceipt,
} from "@effx/domain-model";
import { domain } from "../../../examples/domain-model/domain.ts";

const decodeDomain = Schema.decodeUnknownResult(DomainDescription);

const DescriptionInput = Schema.Struct({
  name: Schema.String,
  clock: Schema.Boolean,
  membership: Schema.Boolean,
  choices: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      subject: Schema.Literals(["Self", "Admin", "System", "Membership", "Union"]),
      jobOnly: Schema.Boolean,
      writes: Schema.Boolean,
      terminal: Schema.Boolean,
      active: Schema.Boolean,
      comparison: Schema.Literals(["effx/order/after", "effx/order/same"]),
    }),
  ),
});

const generatedDescription = (input: typeof DescriptionInput.Type): DomainDescription => {
  const subjectName = (index: number) => `Subject${index}:${input.choices[index]!.label}`;

  const subjectExpression = (
    choice: (typeof input.choices)[number],
  ): DomainDescription["subjectSets"][number]["expression"] => {
    switch (choice.subject) {
      case "Self":
        return { _tag: "Self" };
      case "Admin":
        return { _tag: "Admin" };
      case "System":
        return { _tag: "System", job: "worker" };
      case "Membership":
        return {
          _tag: "Membership",
          function: choice.label,
          position: choice.label,
          department: "target",
          term: choice.active ? "active" : "any",
        };
      case "Union":
        return { _tag: "Union", sets: ["BaseSelf", "BaseWorker"] };
    }
  };

  const base = {
    name: input.name,
    commands: input.choices.map((choice, index) => {
      const command = { name: `Command${index}`, kind: "Command" as const };

      const owned = choice.jobOnly ? { ...command, runBy: { job: "worker" } } : command;

      return choice.writes
        ? { ...owned, writes: [{ machine: `Machine${index}:${choice.label}`, path: ["end"] }] }
        : owned;
    }),
    reads: input.choices.map((_, index) => ({ name: `Read${index}` })),
    principals: { Anonymous: {}, Person: {}, System: { jobs: ["worker"] } },
    subjectSets: [
      { name: "BaseSelf", expression: { _tag: "Self" as const } },
      { name: "BaseWorker", expression: { _tag: "System" as const, job: "worker" } },
      ...input.choices.map((choice, index) => ({
        name: subjectName(index),
        expression: subjectExpression(choice),
      })),
    ],
    grants: input.choices.map((_, index) => ({
      subject: subjectName(index),
      permits: [`Command${index}`, `Read${index}`],
      scope: "all" as const,
    })),
    orders: [{ name: "Time" }],
    machines: input.choices.map((choice, index) => {
      const contextName = `Context${index}:${choice.label}`;

      const context = {
        name: contextName,
        fields: [
          {
            path: ["current"],
            order: "Time",
            kind: input.clock ? ("clock" as const) : ("parameter" as const),
          },
          { path: ["end"], order: "Time", kind: "stored" as const },
        ],
      };

      const guard = {
        context: contextName,
        representation: {
          _tag: "FilterGroup" as const,
          checks: [{ id: choice.comparison, payload: { left: ["current"], right: ["end"] } }],
        },
      };

      return {
        name: `Machine${index}:${choice.label}`,
        states: ["Draft", "Done"],
        terminal: choice.terminal ? ["Done"] : [],
        context: input.clock ? { ...context, clockPath: ["current"] } : context,
        transitions: [{ command: `Command${index}`, from: ["[*]", "Draft"], to: "Done", guard }],
        calculated: [{ from: "Draft", to: "Done", when: guard }],
      };
    }),
  };

  const clocked = input.clock ? { ...base, clock: { order: "Time" } } : base;

  return input.membership && input.choices.length > 0
    ? {
        ...clocked,
        memberships: { machine: `Machine0:${input.choices[0]!.label}`, grantingStates: ["Done"] },
      }
    : clocked;
};

describe("domain-model IR and schema", () => {
  it.effect.prop(
    "generated descriptions round-trip through IR and graph normalization",
    [DescriptionInput],
    ([input]) =>
      Effect.gen(function* () {
        const decoded = yield* Schema.decodeEffect(DomainDescription)(generatedDescription(input));

        const contribution = domainModel(decoded).contribute!({
          declarations: [],
          diagnostics: [],
        });

        assert.isFalse(
          contribution.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
        );
        const ir = make(contribution.nodes, contribution.edges);
        const expected = normalize(ir);
        assert.deepStrictEqual(
          yield* decode(yield* Schema.encodeEffect(JsonCodec)(expected)),
          expected,
        );
        assert.deepStrictEqual(IRGraph.fromGraph(IRGraph.toGraph(ir)), expected);
      }),
  );

  it.effect.prop(
    "generated filenames are safe and injective",
    [Schema.String, Schema.String],
    ([left, right]) =>
      Effect.sync(() => {
        const primary = alloyBasename(left);
        assert.notInclude(primary, "/");
        assert.notInclude(primary, "\\");
        assert.notInclude(primary, "..");
        assert.notStrictEqual(primary, alloyStaticBasename(right));

        if (left !== right) assert.notStrictEqual(primary, alloyBasename(right));
      }),
  );

  it.effect("unknown permissions, subjects, states, jobs, orders and paths fail decoding", () =>
    Effect.sync(() => {
      const review = domain.machines[0];

      const variants: ReadonlyArray<Schema.Json> = [
        {
          ...domain,
          grants: [...domain.grants, { subject: "missing", permits: ["ReadReview"], scope: "all" }],
        },
        {
          ...domain,
          grants: [...domain.grants, { subject: "Self", permits: ["missing"], scope: "all" }],
        },
        {
          ...domain,
          machines: [
            { ...review, transitions: [{ command: "missing", from: ["Draft"], to: "Open" }] },
          ],
        },
        {
          ...domain,
          machines: [
            {
              ...review,
              transitions: [{ command: "AdvanceReview", from: ["missing"], to: "Open" }],
            },
          ],
        },
        {
          ...domain,
          commands: [
            ...domain.commands,
            { name: "BadJob", kind: "Command", runBy: { job: "missing" } },
          ],
        },
        {
          ...domain,
          commands: [
            ...domain.commands,
            {
              name: "BadWrite",
              kind: "Command",
              writes: [{ machine: "missing", path: ["review", "end"] }],
            },
          ],
        },
        {
          ...domain,
          commands: [
            ...domain.commands,
            {
              name: "BadWrite",
              kind: "Command",
              writes: [{ machine: "Review", path: ["missing"] }],
            },
          ],
        },
        {
          ...domain,
          commands: [
            ...domain.commands,
            {
              name: "BadWrite",
              kind: "Command",
              writes: [{ machine: "Review", path: ["current"] }],
            },
          ],
        },
        {
          ...domain,
          machines: [
            {
              ...review,
              context: {
                ...review.context,
                fields: review.context.fields.map((field) =>
                  field.kind === "clock" ? { ...field, kind: "stored" } : field,
                ),
              },
            },
          ],
        },
        { ...domain, machines: [{ ...review, states: [...review.states, "[*]"] }] },
        { ...domain, memberships: { machine: "missing", grantingStates: ["Open"] } },
        { ...domain, memberships: { machine: "Review", grantingStates: ["missing"] } },
        { ...domain, adminList: { grant: "missing", revoke: "RevokeAdmin" } },
        {
          ...domain,
          machines: [
            {
              ...review,
              context: {
                ...review.context,
                fields: [{ path: ["x"], order: "missing", kind: "stored" }],
              },
            },
          ],
        },
        {
          ...domain,
          machines: [
            {
              ...review,
              transitions: [
                {
                  command: "AdvanceReview",
                  from: ["Draft"],
                  to: "Open",
                  guard: {
                    context: "ReviewContext",
                    representation: {
                      id: "effx/order/after",
                      payload: { left: ["missing"], right: ["review", "start"] },
                    },
                  },
                },
              ],
            },
          ],
        },
        { ...domain, clock: { order: "missing" } },
        {
          ...domain,
          machines: [{ ...review, context: { ...review.context, clockPath: ["missing"] } }],
        },
        {
          ...domain,
          orders: [...domain.orders, { name: "Other" }],
          machines: [
            {
              ...review,
              context: {
                ...review.context,
                fields: review.context.fields.map((field) =>
                  field.path[0] === "current" ? { ...field, order: "Other" } : field,
                ),
              },
            },
          ],
        },
        {
          ...domain,
          adminList: {
            ...domain.adminList,
            expiry: { ...domain.adminList.expiry, context: "missing" },
          },
        },
      ];

      for (const input of variants) {
        assert.isTrue(Result.isFailure(decodeDomain(input)));
        const contribution = domainModel(input).contribute!({ declarations: [], diagnostics: [] });
        assert.deepStrictEqual(
          contribution.diagnostics.map((item) => item.code),
          ["EFFX4301"],
        );
      }
    }),
  );

  it.effect("project roots must own a distinct child and false is not an encoded value", () =>
    Effect.sync(() => {
      const [root, child] = domainNodes(domain);
      assert.isDefined(root);
      assert.isDefined(child);
      const empty = make([root!], []);
      assert.include(
        analyze(empty, IRGraph.toGraph(empty), Extensions.builtin).map((item) => item.code),
        "EFFX1004",
      );
      const self = make([root!], [{ kind: "ExtensionOf", from: root!.id, to: root!.id }]);
      assert.include(
        analyze(self, IRGraph.toGraph(self), Extensions.builtin).map((item) => item.code),
        "EFFX1004",
      );

      const attached = make(
        [root!, child!],
        [{ kind: "ExtensionOf", from: child!.id, to: root!.id }],
      );

      const codes = analyze(attached, IRGraph.toGraph(attached), Extensions.builtin).map(
        (item) => item.code,
      );

      assert.notInclude(codes, "EFFX1003");
      assert.notInclude(codes, "EFFX1004");
      assert.isTrue(Result.isFailure(Schema.decodeUnknownResult(Node)({ ...root, root: false })));
      const unmarked = { ...child! };
      assert.isFalse("root" in normalize(make([unmarked], [])).nodes[0]!);
    }),
  );

  it.effect(
    "native FilterGroup representations revive and compile without losing comparisons",
    () =>
      Effect.gen(function* () {
        const payload = { left: ["review", "end"], right: ["review", "start"] };

        const filter = Schema.makeFilter<number>(() => true, {
          representation: { id: "effx/order/after", payload },
        });

        const schema = Schema.Finite.check(Schema.makeFilterGroup([filter, filter]));
        const document = SchemaRepresentation.toRepresentation(schema.ast);
        const persisted = SchemaRepresentation.toJson(document);
        const restored = SchemaRepresentation.fromJson(persisted);

        const reviver = SchemaRepresentation.makeReviverFilter(
          "effx/order/after",
          Schema.Struct({ left: Schema.Array(Schema.String), right: Schema.Array(Schema.String) }),
          ({ payload: value, annotations }) =>
            Schema.makeFilter<number>(() => true, {
              ...annotations,
              representation: { id: "effx/order/after", payload: value },
            }),
        );

        const revived = SchemaRepresentation.fromRepresentation(restored, {
          revivers: [SchemaRepresentation.isFiniteReviver, reviver],
        });

        const value = yield* Schema.decodeEffect(Schema.make<Schema.Codec<number>>(revived.ast))(1);
        assert.strictEqual(value, 1);

        const documentData = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ representation: Schema.Struct({ checks: Schema.Array(Schema.Json) }) }),
        )(persisted);

        const checks = yield* Schema.decodeUnknownEffect(Schema.Array(CheckRepresentation))(
          documentData.representation.checks,
        );

        const representation = checks.find(
          (check) => "_tag" in check && check._tag === "FilterGroup",
        );

        if (representation === undefined) return assert.fail("missing FilterGroup representation");

        const review = domain.machines[0];

        const description = {
          ...domain,
          machines: [
            {
              ...review,
              transitions: [
                { ...review.transitions[1], guard: { context: "ReviewContext", representation } },
              ],
            },
          ],
        };

        const parsed = decodeDomain(description);
        assert.isTrue(Result.isSuccess(parsed));

        if (Result.isSuccess(parsed)) {
          const model = generateAlloy(parsed.success);
          assert.deepStrictEqual(model.unknownGuards, []);
          assert.include(model.source, "Ordering0/lt");
          assert.include(model.staticSource, "Ordering0/lt");
        }
      }),
  );

  it.effect("unknown representation ids are warnings and never guessed", () =>
    Effect.sync(() => {
      const review = domain.machines[0];

      const changed = {
        ...domain,
        machines: [
          {
            ...review,
            transitions: [
              {
                ...review.transitions[1],
                guard: {
                  context: "ReviewContext",
                  representation: { id: "application/unregistered", payload: null },
                },
              },
            ],
          },
        ],
      };

      const parsed = decodeDomain(changed);
      assert.isTrue(Result.isSuccess(parsed));

      if (Result.isSuccess(parsed)) {
        const model = generateAlloy(parsed.success);
        assert.deepStrictEqual(model.unknownGuards, ["application/unregistered"]);
        assert.include(
          domainModel(changed).contribute!({ declarations: [], diagnostics: [] }).diagnostics.map(
            (item) => item.code,
          ),
          "EFFX4302",
        );

        const registered = generateAlloy(parsed.success, {
          guardCompilers: {
            "application/unregistered": ({ field }) =>
              `${field(["review", "end"])!.value} = ${field(["review", "start"])!.value}`,
          },
        });

        assert.deepStrictEqual(registered.unknownGuards, []);
        assert.include(registered.source, "ctx.entity0.stored0f1 = ctx.entity0.stored0f0");
        assert.include(registered.staticSource, "ctx.entity0.stored0f1 = ctx.entity0.stored0f0");

        const nested = {
          ...changed,
          machines: [
            {
              ...changed.machines[0]!,
              transitions: [
                {
                  ...changed.machines[0]!.transitions[0]!,
                  guard: {
                    context: "ReviewContext",
                    representation: {
                      id: "effx/guard/not",
                      payload: { id: "application/unregistered", payload: null },
                    },
                  },
                },
              ],
            },
          ],
        };

        const nestedDomain = decodeDomain(nested);
        assert.isTrue(Result.isSuccess(nestedDomain));

        if (Result.isSuccess(nestedDomain)) {
          const generated = generateAlloy(nestedDomain.success);
          assert.deepStrictEqual(generated.unknownGuards, ["application/unregistered"]);

          const transition = generated.source
            .split("\n")
            .find((line) => line.startsWith("pred transition0_0"));

          assert.isDefined(transition);
          assert.notInclude(
            transition!,
            "not (no none)",
            "an unknown nested guard must be omitted, not inverted into false",
          );
        }
      }
    }),
  );

  it.effect("declared stored writes warn and remain nondeterministic", () =>
    Effect.sync(() => {
      const input = {
        ...domain,
        commands: domain.commands.map((command) =>
          command.name === "AdvanceReview"
            ? { ...command, writes: [{ machine: "Review", path: ["review", "end"] }] }
            : command,
        ),
      };

      const contribution = domainModel(input).contribute!({ declarations: [], diagnostics: [] });
      const warning = contribution.diagnostics.find((entry) => entry.code === "EFFX4313");
      assert.isDefined(warning);
      assert.include(warning!.message, "effect on Review.review.end not modelled precisely");
    }),
  );

  it.effect("missing clock-bound calculated and expiry guards produce warnings", () =>
    Effect.sync(() => {
      const review = domain.machines[0];

      const input = {
        ...domain,
        adminList: { grant: "GrantAdmin", revoke: "RevokeAdmin" },
        machines: [{ ...review, calculated: [{ from: "Draft", to: "Closed" }] }],
      };

      const decoded = decodeDomain(input);
      assert.isTrue(Result.isSuccess(decoded));

      if (Result.isSuccess(decoded)) {
        const model = generateAlloy(decoded.success);
        assert.lengthOf(model.symbols.nondeterministic, 2);

        const diagnostics = domainModel(input).contribute!({
          declarations: [],
          diagnostics: [],
        }).diagnostics;

        assert.strictEqual(diagnostics.filter((entry) => entry.code === "EFFX4311").length, 2);
      }
    }),
  );

  it.effect("calculated guards cannot silently depend on caller parameters", () =>
    Effect.sync(() => {
      const review = domain.machines[0];

      const input = {
        ...domain,
        machines: [
          {
            ...review,
            context: {
              ...review.context,
              fields: [
                ...review.context.fields,
                { path: ["requested"], order: "ReviewTime", kind: "parameter" as const },
              ],
            },
            calculated: [
              {
                from: "Draft",
                to: "Closed",
                when: {
                  context: "ReviewContext",
                  representation: {
                    id: "effx/order/same",
                    payload: { left: ["current"], right: ["requested"] },
                  },
                },
              },
            ],
          },
        ],
      };

      const result = domainModel(input).contribute!({ declarations: [], diagnostics: [] });
      assert.strictEqual(result.diagnostics.filter((entry) => entry.code === "EFFX4311").length, 1);
    }),
  );

  it.effect("all-of, not and or compile nested native representations", () =>
    Effect.sync(() => {
      const comparison = {
        id: "effx/order/same",
        payload: { left: ["review", "start"], right: ["review", "end"] },
      };

      const representation = {
        _tag: "FilterGroup",
        checks: [
          { id: "effx/guard/not", payload: comparison },
          {
            id: "effx/guard/or",
            payload: [comparison, { id: "effx/order/after", payload: comparison.payload }],
          },
        ],
      };

      const review = domain.machines[0];

      const input = {
        ...domain,
        machines: [
          {
            ...review,
            transitions: [
              { ...review.transitions[1], guard: { context: "ReviewContext", representation } },
            ],
          },
        ],
      };

      const decoded = decodeDomain(input);
      assert.isTrue(Result.isSuccess(decoded));

      if (Result.isSuccess(decoded)) {
        const model = generateAlloy(decoded.success);
        assert.deepStrictEqual(model.unknownGuards, []);
        assert.include(model.staticSource, "not (");
        assert.include(model.staticSource, " or ");
        assert.include(model.staticSource, "Ordering0/lt");
      }
    }),
  );
  it.effect("receipt checks reject missing projections and changed scope or step bounds", () =>
    Effect.sync(() => {
      const symbols = generateAlloy(domain).symbols;

      const command = {
        name: "A2_NonterminalExit",
        type: "check" as const,
        source: "check A2_NonterminalExit for 1",
        overall: 1,
        minprefix: 1,
        maxprefix: symbols.steps,
        scopes: symbols.scopeParts,
      };

      assert.isTrue(receiptCommandMatches(command, "A2_NonterminalExit", symbols, "check"));
      assert.isFalse(
        receiptCommandMatches({ ...command, overall: 2 }, "A2_NonterminalExit", symbols, "check"),
      );
      assert.isFalse(
        receiptCommandMatches(
          { ...command, maxprefix: symbols.steps + 1 },
          "A2_NonterminalExit",
          symbols,
          "check",
        ),
      );
      assert.isFalse(
        receiptCommandMatches({ ...command, scopes: [] }, "A2_NonterminalExit", symbols, "check"),
      );

      const reach = {
        ...command,
        name: "Reach0_0",
        type: "run" as const,
        source: "run Reach0_0 for 1",
      };

      assert.isTrue(receiptCommandMatches(reach, "Reach0_0", symbols, "temporal-run"));

      const vector = {
        ...command,
        name: "Vectors",
        type: "run" as const,
        source: "run Vectors for 1",
        minprefix: -1,
        maxprefix: -1,
        solution: [{ instances: [{ values: {} }] as const }],
      };

      assert.isTrue(
        Result.isFailure(vectorsFromReceipt({ commands: { Vectors: vector } }, symbols)),
      );
    }),
  );
});
