import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { BunCrypto } from "@effect/platform-bun";
import { Effect, Option, Order, Schema } from "effect";
import {
  CompilerFault,
  Extensions,
  compileCollected,
  defaultGenerationContext,
  GeneratedImports,
  schemaExpr,
  schemaName,
  type Annotation,
  type Collected,
  type Declaration,
  type GeneratedFile,
} from "@effx/compiler";
import {
  ApplicationIR,
  IRGraph,
  StableId,
  make,
  semanticHash,
  type OperationNode,
  type SchemaRef,
} from "@effx/ir";
import { persistenceExtension } from "@effx/persistence/compiler";
import { Port } from "@effx/persistence/syntax";
import { persistenceGenerator } from "../src/generate.ts";
import { portFile, portsOf } from "../src/ports.ts";

const ref = (name: string): SchemaRef => ({
  module: "schemas",
  export: name.split(".")[0] ?? name,
  symbolId: StableId.make("schema", `schemas/${name}`),
});

const schema = (name: string) => ({ _tag: "Schema" as const, ref: ref(name) });

const declaration = (
  name: string,
  kind: "Query" | "Command" = "Command",
  errors: ReadonlyArray<string> = ["UserNotFound"],
): Declaration => ({
  id: name,
  kind: "builder",
  module: "operations",
  export: name.replaceAll(".", ""),
  binding: "external",
  annotations: [
    {
      name: kind,
      args: [{ name, input: schema(`${name.split(".")[1]}Input`), success: schema("User.Public") }],
    },
    { name: "Errors", args: errors.map(schema) },
    { name: "persistence.Port", args: [{ port: "Users" }] },
  ],
});

const declarations = [
  declaration("Users.setEmail", "Command", ["UserNotFound", "EmailTaken"]),
  declaration("Users.find", "Query"),
  declaration("Users.setDisplayName"),
];

const extensions = [...Extensions.builtin, persistenceExtension];

const collected = (items: ReadonlyArray<Declaration> = declarations): Collected => ({
  declarations: items,
  diagnostics: [],
});

const files = (result: {
  readonly files: { readonly value: Option.Option<ReadonlyArray<GeneratedFile>> };
}) => Option.getOrThrow(result.files.value).filter((file) => file.path.startsWith("users-"));

const annotated = (item: Declaration, annotation: Annotation): Declaration => ({
  ...item,
  annotations: [...item.annotations, annotation],
});

// Each test pins a specific compiler regression, not database adapter behaviour.
describe("persistence compiler", () => {
  it("the port string algebra accepts empty strings independently of core operation StableIds", () => {
    assert.deepStrictEqual(Port({ port: "" }).annotation.args, [{ port: "" }]);
    assert.strictEqual(portFile(""), "");
  });

  it.effect(
    "records Schema-valid Extension/ExtensionOf contributions without introducing a core node kind",
    () =>
      Effect.gen(function* () {
        const result = yield* compileCollected(collected(), extensions);
        assert.deepStrictEqual(result.diagnostics, []);
        const ir = Option.getOrThrow(result.ir.value);
        yield* Schema.decodeEffect(ApplicationIR)(ir);

        const nodes = ir.nodes.filter(
          (node) => node._tag === "Extension" && node.extension === "persistence",
        );

        assert.strictEqual(nodes.length, 3);
        assert.isTrue(
          nodes.every(
            (node) =>
              node._tag === "Extension" &&
              node.tag === "Port" &&
              Schema.is(Schema.Struct({ port: Schema.Literal("Users") }))(node.data),
          ),
        );
        assert.strictEqual(
          ir.edges.filter((edge) => edge.kind === "ExtensionOf" && edge.qualifier === "Port")
            .length,
          3,
        );
        assert.isFalse(ir.nodes.some((node) => node._tag === "Exposure"));
      }),
  );

  it.effect(
    "emits sorted leaf methods and preserves static Schema members and per-method errors",
    () =>
      Effect.gen(function* () {
        const result = yield* compileCollected(collected(), extensions);
        const [suite, port] = files(result);
        assert.isDefined(port);
        assert.isDefined(suite);
        assert.strictEqual(port!.path, "users-port.ts");
        assert.strictEqual(suite!.path, "users-conformance.ts");
        assert.include(
          port!.contents,
          "export class UsersPort extends Context.Service<UsersPort, {",
        );
        assert.include(port!.contents, '}>()("effx/port/Users")');
        assert.include(port!.contents, "typeof UserNotFound.Type");
        assert.include(port!.contents, "typeof EmailTaken.Type");
        assert.isBelow(
          port!.contents.indexOf('readonly "find"'),
          port!.contents.indexOf('readonly "setDisplayName"'),
        );
        assert.isBelow(
          port!.contents.indexOf('readonly "setDisplayName"'),
          port!.contents.indexOf('readonly "setEmail"'),
        );
        assert.notInclude(port!.contents, "SqlClient");
        assert.notInclude(port!.contents, "@effx/");
        assert.include(suite!.contents, "export interface UsersHarness<E, R>");
        assert.include(suite!.contents, "readonly snapshot: Effect.Effect<Schema.Json, E, R>");
        assert.include(
          suite!.contents,
          'readonly "EmailTaken": NonEmpty<DomainCase<typeof setEmailInput.Type, typeof EmailTaken.Type',
        );
        assert.include(suite!.contents, 'readonly "setDisplayName+setEmail"');
        assert.include(suite!.contents, "Layer.fresh(harness.layer)");
        assert.include(suite!.contents, "Effect.scoped(");
        assert.include(suite!.contents, "G1 closed error channel: find");
        assert.include(suite!.contents, "G1 domain error: setEmail.EmailTaken");
        assert.include(suite!.contents, "G2 query purity: find");
        assert.include(suite!.contents, "Schema.toEquivalence(Schema.toType(User.Public))");
        assert.include(suite!.contents, "Schema.toEquivalence(Schema.toType(m0Errors))");
        assert.notInclude(suite!.contents, "encodeUnknownEffect");
        assert.include(suite!.contents, "reasons.every((reason): reason is Cause.Fail<E>");
        assert.include(suite!.contents, "equalFailures(firstValue, secondValue, m0EqualError)");
        assert.include(suite!.contents, "balance !== 0");
        assert.include(suite!.contents, "m2Member0Equal(actual, scenario.expected)");
        assert.include(suite!.contents, "G3 rollback successful command: setEmail");
        assert.include(suite!.contents, "G4 shared transaction rollback: setDisplayName+setEmail");
        assert.include(
          suite!.contents,
          [
            "assertClosed(first, m1Success, m1Error);",
            "          if (Exit.isSuccess(first)) {",
            '            const second = yield* Effect.exit(port["setEmail"](b));',
            "            assertClosed(second, m2Success, m2Error);",
            "          }",
            "          return yield* Effect.fail(rollback);",
          ].join("\n"),
          "G4 must short-circuit the second command on a declared first failure, including an aborted SQL transaction",
        );
        assert.include(suite!.contents, "G4 shared transaction commit: setDisplayName+setEmail");
        assert.include(suite!.contents, "yield* scenario.observe");
        assert.include(
          suite!.contents,
          "scenario.requiresConcurrentConnections === true && !harness.supportsConcurrentConnections",
        );
        assert.notInclude(suite!.contents, "Effect.ignore");
        assert.notInclude(suite!.contents, "Effect.catchCause");
      }),
  );

  it.effect("emits one fresh store root per test, never per arbitrary sample", () =>
    Effect.gen(function* () {
      const result = yield* compileCollected(collected(), extensions);
      const suite = files(result).find((file) => file.path === "users-conformance.ts")!;
      assert.notInclude(
        suite.contents,
        "Effect.provide(",
        "Samples must reuse their test-owned store, not initialize PGlite again",
      );
      assert.include(suite.contents, "readonly reset: Effect.Effect<void, E, R>");
      assert.include(suite.contents, "Effect.scoped(Effect.gen(function* () {");

      const roots = [
        ...suite.contents.matchAll(
          /it\.layer\(Layer\.fresh\(harness\.layer\)\)\(\(it\) => \{([\s\S]*?)^    \}\);/gm,
        ),
      ];

      const registrations = suite.contents.match(/(?:it\.effect\.prop|test)\(/g) ?? [];
      assert.isAbove(roots.length, 1, "Distinct tests require independent store roots");
      assert.strictEqual(
        roots.length,
        registrations.length,
        "Every property and authored scenario must own exactly one fresh root",
      );

      for (const root of roots) {
        assert.strictEqual(
          (root[1]!.match(/(?:it\.effect\.prop|test)\(/g) ?? []).length,
          1,
          "A layer block must not share storage between distinct tests",
        );

        assert.include(
          root[1]!,
          "let emptyStore: Schema.Json | undefined;",
          "The empty baseline belongs to each individual test, never the suite",
        );
        assert.include(
          root[1]!,
          [
            "if (emptyStore === undefined) emptyStore = yield* snapshot;",
            "          yield* harness.reset;",
            '          assert.deepStrictEqual(yield* snapshot, emptyStore, "Conformance reset did not restore the empty store");',
            "          yield* scenarios.seed;",
            "          return yield* program;",
          ].join("\n"),
          "First and later samples must prove empty reset before fixture seeding can hide leftover rows",
        );

        if (root[1]!.includes("it.effect.prop(")) {
          assert.include(
            root[1]!,
            "{ arbitrary: { runs: 10 } }",
            "Store reuse must not reduce sample coverage",
          );
        }
      }
    }),
  );

  it("shared schema imports preserve ordinary bytes and alias module and authored-local collisions", () => {
    const imports = new GeneratedImports();
    const first = { ...ref("User.Public"), module: "first" };
    const second = { ...ref("User.Public"), module: "second" };
    assert.strictEqual(schemaExpr(imports, first), "User.Public");
    assert.deepStrictEqual(imports.render(), ['import { User } from "first";']);
    assert.strictEqual(schemaExpr(imports, first), "User.Public");
    assert.strictEqual(schemaExpr(imports, second), "User_2.Public");
    assert.strictEqual(schemaName(second), "User.Public");
    assert.strictEqual(imports.add("second", "User"), "User_2");
    assert.deepStrictEqual(imports.render(), [
      'import { User } from "first";',
      'import { User as User_2 } from "second";',
    ]);
    imports.reserve("UsersPort", "UsersPort_2");
    assert.strictEqual(schemaExpr(imports, ref("UsersPort")), "UsersPort_3");
    assert.strictEqual(imports.addAliased("third", "User", "ThirdUser"), "ThirdUser");
    assert.strictEqual(imports.add("third", "User"), "ThirdUser");
  });

  it("explicit root aliases do not replace a free legacy schema import binding", () => {
    const imports = new GeneratedImports();
    const schema = { ...ref("Namespace.User"), module: "shared" };
    assert.strictEqual(imports.addAliased("shared", "Namespace", "ApiRoot"), "ApiRoot");
    assert.strictEqual(schemaExpr(imports, schema), "Namespace.User");
    assert.strictEqual(imports.add("shared", "Namespace"), "Namespace");
    assert.deepStrictEqual(imports.render(), [
      'import { Namespace, Namespace as ApiRoot } from "shared";',
    ]);
  });

  it.effect(
    "same error exports from different modules use stable identities, not import aliases, as scenario keys",
    () =>
      Effect.gen(function* () {
        const item = declaration("Users.find", "Query");

        const input = {
          ...ref("User"),
          module: "input",
          symbolId: StableId.make("schema", "input/User"),
        };

        const success = {
          ...ref("User.Public"),
          module: "output",
          symbolId: StableId.make("schema", "output/User.Public"),
        };

        const left = {
          ...ref("Error"),
          module: "left",
          symbolId: StableId.make("schema", "left/Error"),
        };

        const right = {
          ...ref("Error"),
          module: "right",
          symbolId: StableId.make("schema", "right/Error"),
        };

        const result = yield* compileCollected(
          collected([
            {
              ...item,
              annotations: [
                {
                  name: "Query",
                  args: [
                    {
                      name: "Users.find",
                      input: { _tag: "Schema", ref: input },
                      success: { _tag: "Schema", ref: success },
                    },
                  ],
                },
                {
                  name: "Errors",
                  args: [
                    { _tag: "Schema", ref: left },
                    { _tag: "Schema", ref: right },
                  ],
                },
                { name: "persistence.Port", args: [{ port: "Users" }] },
              ],
            },
          ]),
          extensions,
        );

        assert.deepStrictEqual(
          result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
          [],
        );
        const [suite, port] = files(result);
        assert.isDefined(suite);
        assert.isDefined(port);
        assert.include(port!.contents, 'import { User as User_2 } from "output";');
        assert.include(port!.contents, "typeof User_2.Public.Type");
        assert.include(suite!.contents, 'readonly "schema:left/Error": NonEmpty<DomainCase');
        assert.include(suite!.contents, 'readonly "schema:right/Error": NonEmpty<DomainCase');
        assert.include(suite!.contents, 'scenarios.methods["find"].errors["schema:left/Error"]');
        assert.include(suite!.contents, 'scenarios.methods["find"].errors["schema:right/Error"]');
        assert.notInclude(suite!.contents, 'readonly "Error":');
        assert.notInclude(suite!.contents, 'readonly "Error_2":');
      }),
  );

  it.effect("port class and conformance helper names are reserved before schema imports", () =>
    Effect.gen(function* () {
      for (const name of [
        "UsersPort",
        "assertClosed",
        "failureReasons",
        "equalFailures",
        "candidate",
        "balance",
        "m0Input",
        "m0Member0Equal",
        "port",
      ]) {
        const item = declaration("Users.find", "Query", []);

        const result = yield* compileCollected(
          collected([
            {
              ...item,
              annotations: [
                {
                  name: "Query",
                  args: [
                    { name: "Users.find", input: schema(name), success: schema("User.Public") },
                  ],
                },
                { name: "Errors", args: [schema("UserNotFound")] },
                { name: "persistence.Port", args: [{ port: "Users" }] },
              ],
            },
          ]),
          extensions,
        );

        const [suite, port] = files(result);
        assert.isDefined(suite);
        assert.isDefined(port);
        assert.include(suite!.contents, `${name} as ${name}_2`);
        assert.include(suite!.contents, `Schema.toType(${name}_2)`);

        if (name === "UsersPort") {
          assert.include(port!.contents, "UsersPort as UsersPort_2");
          assert.include(port!.contents, "input: typeof UsersPort_2.Type");
          assert.include(
            port!.contents,
            "export class UsersPort extends Context.Service<UsersPort",
          );
        }
      }
    }),
  );

  it.effect("static errors under one exported root retain distinct required scenario keys", () =>
    Effect.gen(function* () {
      const result = yield* compileCollected(
        collected([
          declaration("Users.setEmail", "Command", ["Errors.NotFound", "Errors.EmailTaken"]),
        ]),
        extensions,
      );

      assert.deepStrictEqual(result.diagnostics, []);
      const [suite, port] = files(result);
      assert.isDefined(suite);
      assert.isDefined(port);
      assert.include(port!.contents, "typeof Errors.NotFound.Type");
      assert.include(port!.contents, "typeof Errors.EmailTaken.Type");
      assert.include(
        suite!.contents,
        'readonly "Errors.NotFound": NonEmpty<DomainCase<typeof setEmailInput.Type, typeof Errors.NotFound.Type',
      );
      assert.include(
        suite!.contents,
        'readonly "Errors.EmailTaken": NonEmpty<DomainCase<typeof setEmailInput.Type, typeof Errors.EmailTaken.Type',
      );
      assert.include(suite!.contents, 'scenarios.methods["setEmail"].errors["Errors.NotFound"]');
      assert.include(suite!.contents, 'scenarios.methods["setEmail"].errors["Errors.EmailTaken"]');
      assert.include(suite!.contents, "G1 domain error: setEmail.Errors.NotFound");
      assert.include(suite!.contents, "G1 domain error: setEmail.Errors.EmailTaken");
      assert.notInclude(suite!.contents, 'readonly "Errors":');
    }),
  );

  it.effect(
    "output and semantic hash are independent of declaration ordering, generation mode and target",
    () =>
      Effect.gen(function* () {
        const a = yield* compileCollected(collected(), extensions);
        const b = yield* compileCollected(collected(declarations.toReversed()), extensions);
        assert.deepStrictEqual(files(a), files(b));
        assert.strictEqual(
          yield* semanticHash(Option.getOrThrow(a.ir.value)),
          yield* semanticHash(Option.getOrThrow(b.ir.value)),
        );
        const ir = Option.getOrThrow(a.ir.value);

        const rc = yield* persistenceGenerator(ir, IRGraph.toGraph(ir), {
          ...defaultGenerationContext,
          target: "effect-4.0-rc",
          emit: "contract",
        });

        assert.deepStrictEqual(
          files(a),
          rc.toSorted((a, b) => Order.String(a.path, b.path)),
        );
      }).pipe(Effect.provide(BunCrypto.layer)),
  );

  it.effect("EFFX3401 rejects local handlers and EFFX3402 rejects each exposure transport", () =>
    Effect.gen(function* () {
      const external = declaration("Users.setEmail");
      const { binding: _binding, ...localFields } = external;

      const local: Declaration = {
        ...localFields,
        member: "setEmail",
        handlerSignature: {
          success: { _tag: "Schema", ref: ref("User.Public") },
          errors: [{ _tag: "Schema", ref: ref("UserNotFound") }],
          requirements: [],
        },
      };

      const localResult = yield* compileCollected(collected([local]), extensions);
      assert.include(
        localResult.diagnostics.map((diagnostic) => diagnostic.code),
        "EFFX3401",
      );
      assert.isTrue(Option.isNone(localResult.files.value));

      for (const exposure of [
        { name: "Http.Patch", args: ["/users/:id"] },
        { name: "Rpc", args: ["Users.setEmail"] },
        { name: "Cli", args: ["users set-email"] },
      ] satisfies ReadonlyArray<Annotation>) {
        const result = yield* compileCollected(
          collected([annotated(external, exposure)]),
          extensions,
        );

        assert.include(
          result.diagnostics.map((diagnostic) => diagnostic.code),
          "EFFX3402",
        );
        assert.isTrue(Option.isNone(result.files.value));
      }
    }),
  );

  it.effect(
    "EFFX3403 rejects wrong prefixes, empty method names, duplicate annotations and colliding methods",
    () =>
      Effect.gen(function* () {
        for (const item of [
          declaration("Other.find"),
          declaration("Users."),
          annotated(declaration("Users.find", "Query"), {
            name: "persistence.Port",
            args: [{ port: "Users" }],
          }),
        ]) {
          const result = yield* compileCollected(collected([item]), extensions);
          assert.include(
            result.diagnostics.map((diagnostic) => diagnostic.code),
            "EFFX3403",
          );
          assert.isTrue(Option.isNone(result.files.value));
        }

        const result = yield* compileCollected(collected(), extensions);
        const ir = Option.getOrThrow(result.ir.value);

        const original = ir.nodes.find(
          (node): node is OperationNode => node._tag === "Operation" && node.name === "Users.find",
        );

        assert.isDefined(original);
        const duplicateId = StableId.make("ext", "persistence/duplicate");

        const duplicate = make(
          [
            ...ir.nodes,
            {
              _tag: "Extension",
              id: duplicateId,
              extension: "persistence",
              tag: "Port",
              data: { port: "Users" },
            },
          ],
          [
            ...ir.edges,
            { kind: "ExtensionOf", from: duplicateId, to: original!.id, qualifier: "Port" },
          ],
        );

        assert.include(
          portsOf(duplicate, IRGraph.toGraph(duplicate)).diagnostics.map(
            (diagnostic) => diagnostic.code,
          ),
          "EFFX3403",
        );
      }),
  );

  it.effect(
    "query-only ports warn once without blocking generation; an empty error set stays never",
    () =>
      Effect.gen(function* () {
        const result = yield* compileCollected(
          collected([declaration("Users.find", "Query", [])]),
          extensions,
        );

        assert.deepStrictEqual(
          result.diagnostics.map(({ code, severity }) => ({ code, severity })),
          [{ code: "EFFX3404", severity: "warning" }],
        );
        const [suite, port] = files(result);
        assert.include(port!.contents, "Effect.Effect<typeof User.Public.Type, never>");
        assert.include(suite!.contents, "Schema.Never");
        assert.notInclude(suite!.contents, "G3 rollback");
        assert.notInclude(suite!.contents, "G4 shared transaction");
      }),
  );

  it.effect(
    "generator construction is suspended and keeps its exact success/error/requirement channels",
    () =>
      Effect.gen(function* () {
        const result = yield* compileCollected(collected(), extensions);
        const ir = Option.getOrThrow(result.ir.value);
        const index = IRGraph.toGraph(ir);
        let reads = 0;

        const probe = {
          ...ir,
          get nodes() {
            reads++;

            return ir.nodes;
          },
        };

        const program = persistenceGenerator(probe, index);
        expectTypeOf(program).toEqualTypeOf<
          Effect.Effect<ReadonlyArray<GeneratedFile>, CompilerFault>
        >();
        assert.strictEqual(reads, 0);
        assert.strictEqual((yield* program).length, 2);
        assert.isAbove(reads, 0);
      }),
  );
  it.effect.prop(
    "port filenames are total for all Schema strings and cannot traverse directories",
    [Schema.String],
    ([name]) =>
      Effect.sync(() => {
        assert.match(portFile(name), /^[a-z0-9_-]*$/);
        assert.strictEqual(portFile("Users"), "users");
        assert.strictEqual(portFile("\ud800"), "_d800_");
      }),
  );
});
