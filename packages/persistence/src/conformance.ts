import {
  errorsExpr,
  generatedIdentifier,
  schemaExpr,
  schemaName,
  type GeneratedImports,
} from "@effx/compiler";
import type { PersistencePort, PortMethod } from "./ports.ts";

const quote = JSON.stringify;

const typeOf = (expression: string): string => `typeof ${expression}.Type`;

const pairsOf = (
  commands: ReadonlyArray<PortMethod>,
): ReadonlyArray<readonly [PortMethod, PortMethod]> =>
  commands.flatMap((first, index) =>
    commands.slice(index + 1).map((second) => [first, second] as const),
  );

/** Scenarios are derived method by method, including a required case for every declared error. */
export const conformanceBody = (
  port: PersistencePort,
  imports: GeneratedImports,
): ReadonlyArray<string> => {
  const base = generatedIdentifier(port.name);
  const service = `${base}Port`;
  const fn = `${base[0]!.toLowerCase()}${base.slice(1)}Conformance`;
  const commands = port.methods.filter((method) => method.operation.kind === "Command");
  const pairs = pairsOf(commands);
  imports.reserve(
    `${base}Harness`,
    `${base}Scenarios`,
    fn,
    "NonEmpty",
    "DomainCase",
    "TransactionCase",
    "failureValue",
    "failureReasons",
    "equalFailures",
    "reasons",
    "candidate",
    "balance",
    "equivalent",
    "assertClosed",
    "rollback",
    "assertRollback",
    "harness",
    "scenarios",
    "snapshot",
    "isolated",
    "emptyStore",
    "program",
    "port",
    "input",
    "result",
    "before",
    "first",
    "second",
    "firstValue",
    "secondValue",
    "rolledBack",
    "scenario",
    "test",
    "actual",
    "pair",
    "a",
    "b",
    "exit",
    "reason",
    "success",
    "error",
    "value",
    ...port.methods.flatMap((method, index) => [
      `m${index}Input`,
      `m${index}Success`,
      `m${index}Errors`,
      `m${index}Error`,
      `m${index}EqualSuccess`,
      `m${index}EqualError`,
      ...method.operation.errors.values.flatMap((_, member) => [
        `m${index}Member${member}Error`,
        `m${index}Member${member}Equal`,
      ]),
    ]),
  );

  const methodSchemas = port.methods.map(({ name, operation }, index) => {
    const counts = new Map<string, number>();

    const members = operation.errors.values.map((ref, member) => {
      const key = schemaName(ref);
      counts.set(key, (counts.get(key) ?? 0) + 1);

      return {
        key,
        symbolId: ref.symbolId,
        expression: schemaExpr(imports, ref),
        local: `m${index}Member${member}`,
      };
    });

    for (const member of members) {
      if ((counts.get(member.key) ?? 0) > 1) member.key = member.symbolId;
    }

    return {
      name,
      operation,
      local: `m${index}`,
      input: schemaExpr(imports, operation.input),
      success: schemaExpr(imports, operation.success),
      errors: errorsExpr(imports, operation.errors.values),
      members,
    };
  });

  const methodTypes = methodSchemas.flatMap((method) => [
    `    readonly ${quote(method.name)}: {`,
    `      readonly success: NonEmpty<DomainCase<${typeOf(method.input)}, ${typeOf(method.success)}, E, ${service} | R>>;`,
    "      readonly errors: {",
    ...method.members.map(
      (error) =>
        `        readonly ${quote(error.key)}: NonEmpty<DomainCase<${typeOf(method.input)}, ${typeOf(error.expression)}, E, ${service} | R>>;`,
    ),
    "      };",
    "    };",
  ]);

  const pairTypes = pairs.map(([first, second]) => {
    const a = schemaExpr(imports, first.operation.input);
    const b = schemaExpr(imports, second.operation.input);

    return `    readonly ${quote(`${first.name}+${second.name}`)}: NonEmpty<TransactionCase<${typeOf(a)}, ${typeOf(b)}, E, ${service} | R>>;`;
  });

  const constants = methodSchemas.flatMap((method) => [
    `const ${method.local}Input = Schema.toType(${method.input});`,
    `const ${method.local}Success = Schema.is(Schema.toType(${method.success}));`,
    `const ${method.local}Errors = ${method.errors};`,
    `const ${method.local}Error = Schema.is(Schema.toType(${method.local}Errors));`,
    `const ${method.local}EqualSuccess = Schema.toEquivalence(Schema.toType(${method.success}));`,
    ...(method.operation.kind === "Query"
      ? [
          `const ${method.local}EqualError = Schema.toEquivalence(Schema.toType(${method.local}Errors));`,
        ]
      : []),
    ...method.members.flatMap((member) => [
      `const ${member.local}Error = Schema.is(Schema.toType(${member.expression}));`,
      `const ${member.local}Equal = Schema.toEquivalence(Schema.toType(${member.expression}));`,
    ]),
    "",
  ]);

  const testRoot = [
    "    it.layer(Layer.fresh(harness.layer))((it) => {",
    "      let emptyStore: Schema.Json | undefined;",
    `      const isolated = <A, X>(program: Effect.Effect<A, X, ${service} | R>) =>`,
    "        Effect.scoped(Effect.gen(function* () {",
    "          if (emptyStore === undefined) emptyStore = yield* snapshot;",
    "          yield* harness.reset;",
    '          assert.deepStrictEqual(yield* snapshot, emptyStore, "Conformance reset did not restore the empty store");',
    "          yield* scenarios.seed;",
    "          return yield* program;",
    "        }));",
  ];

  const tests: Array<string> = [];

  for (const method of methodSchemas) {
    const key = quote(method.name);
    const call = `port[${key}](input)`;
    const closed = `assertClosed(result, ${method.local}Success, ${method.local}Error);`;
    tests.push(
      ...testRoot,
      `    it.effect.prop(${quote(`G1 closed error channel: ${method.name}`)}, [${method.local}Input], ([input]) =>`,
      "      isolated(Effect.gen(function* () {",
      `        const port = yield* ${service};`,
      `        const result = yield* Effect.exit(${call});`,
      `        ${closed}`,
      "      })),",
      "      { arbitrary: { runs: 10 } },",
      "    );",
      "    });",
      "",
    );

    if (method.operation.kind === "Query") {
      tests.push(
        ...testRoot,
        `    it.effect.prop(${quote(`G2 query purity: ${method.name}`)}, [${method.local}Input], ([input]) =>`,
        "      isolated(Effect.gen(function* () {",
        `        const port = yield* ${service};`,
        "        const before = yield* snapshot;",
        `        const first = yield* Effect.exit(${call});`,
        `        assertClosed(first, ${method.local}Success, ${method.local}Error);`,
        "        assert.deepStrictEqual(yield* snapshot, before);",
        `        const second = yield* Effect.exit(${call});`,
        `        assertClosed(second, ${method.local}Success, ${method.local}Error);`,
        "        assert.deepStrictEqual(yield* snapshot, before);",
        "        assert.strictEqual(first._tag, second._tag);",
        "        if (Exit.isSuccess(first) && Exit.isSuccess(second)) {",
        `          assert.isTrue(${method.local}EqualSuccess(first.value, second.value), "Identical Queries returned unequal success values");`,
        "        } else {",
        `          const firstValue = failureReasons(first, ${method.local}Error);`,
        `          const secondValue = failureReasons(second, ${method.local}Error);`,
        `          assert.isTrue(equalFailures(firstValue, secondValue, ${method.local}EqualError), "Identical Queries returned unequal error multisets");`,
        "        }",
        "      })),",
        "      { arbitrary: { runs: 10 } },",
        "    );",
        "    });",
        "",
      );
    } else {
      tests.push(
        ...testRoot,
        `    it.effect.prop(${quote(`G3 rollback atomicity: ${method.name}`)}, [${method.local}Input], ([input]) =>`,
        "      isolated(Effect.gen(function* () {",
        `        const port = yield* ${service};`,
        "        const before = yield* snapshot;",
        "        const rolledBack = yield* Effect.exit(harness.transact(Effect.gen(function* () {",
        `          const result = yield* Effect.exit(${call});`,
        `          ${closed}`,
        "          return yield* Effect.fail(rollback);",
        "        })));",
        "        assertRollback(rolledBack);",
        "        assert.deepStrictEqual(yield* snapshot, before);",
        "      })),",
        "      { arbitrary: { runs: 10 } },",
        "    );",
        "    });",
        "",
      );
    }

    tests.push(
      `    for (const scenario of scenarios.methods[${key}].success) {`,
      ...testRoot,
      "      const test = it.effect.skipIf(scenario.requiresConcurrentConnections === true && !harness.supportsConcurrentConnections);",
      `      test(${quote(`G1 domain success: ${method.name} / `)} + scenario.name, () =>`,
      "        isolated(Effect.gen(function* () {",
      "          if (scenario.seed !== undefined) yield* scenario.seed;",
      `          assert.isTrue(Schema.is(${method.local}Input)(scenario.input));`,
      `          const port = yield* ${service};`,
      `          const actual = yield* port[${key}](scenario.input);`,
      `          assert.isTrue(${method.local}Success(actual));`,
      `          assert.isTrue(${method.local}EqualSuccess(actual, scenario.expected), "Success differs from the expected Type value");`,
      "        })),",
      "      );",
      "    });",
    );

    if (method.operation.kind === "Command") {
      tests.push(
        ...testRoot,
        "      const test = it.effect.skipIf(scenario.requiresConcurrentConnections === true && !harness.supportsConcurrentConnections);",
        `      test(${quote(`G3 rollback successful command: ${method.name} / `)} + scenario.name, () =>`,
        "        isolated(Effect.gen(function* () {",
        "          if (scenario.seed !== undefined) yield* scenario.seed;",
        `          const port = yield* ${service};`,
        "          const before = yield* snapshot;",
        "          const rolledBack = yield* Effect.exit(harness.transact(Effect.gen(function* () {",
        `            const actual = yield* port[${key}](scenario.input);`,
        `            assert.isTrue(${method.local}Success(actual));`,
        "            return yield* Effect.fail(rollback);",
        "          })));",
        "          assertRollback(rolledBack);",
        "          assert.deepStrictEqual(yield* snapshot, before);",
        "        })),",
        "      );",
        "    });",
      );
    }

    tests.push("    }", "");

    for (const member of method.members) {
      tests.push(
        `    for (const scenario of scenarios.methods[${key}].errors[${quote(member.key)}]) {`,
        ...testRoot,
        "      const test = it.effect.skipIf(scenario.requiresConcurrentConnections === true && !harness.supportsConcurrentConnections);",
        `      test(${quote(`G1 domain error: ${method.name}.${member.key} / `)} + scenario.name, () =>`,
        "        isolated(Effect.gen(function* () {",
        "          if (scenario.seed !== undefined) yield* scenario.seed;",
        `          assert.isTrue(Schema.is(${method.local}Input)(scenario.input));`,
        `          const port = yield* ${service};`,
        `          const result = yield* Effect.exit(port[${key}](scenario.input));`,
        `          ${closed}`,
        "          const actual = failureValue(result);",
        `          if (!${member.local}Error(actual)) assert.fail("Failure does not satisfy the expected error Schema");`,
        `          assert.isTrue(${member.local}Equal(actual, scenario.expected), "Error differs from the expected Type value");`,
        "        })),",
        "      );",
        "    });",
        "    }",
        "",
      );
    }
  }

  for (const [first, second] of pairs) {
    const a = methodSchemas.find((method) => method.name === first.name)!;
    const b = methodSchemas.find((method) => method.name === second.name)!;
    const key = `${first.name}+${second.name}`;
    tests.push(
      ...testRoot,
      `    it.effect.prop(${quote(`G4 shared transaction rollback: ${key}`)}, [${a.local}Input, ${b.local}Input], ([a, b]) =>`,
      "      isolated(Effect.gen(function* () {",
      `        const port = yield* ${service};`,
      "        const before = yield* snapshot;",
      "        const rolledBack = yield* Effect.exit(harness.transact(Effect.gen(function* () {",
      `          const first = yield* Effect.exit(port[${quote(first.name)}](a));`,
      `          assertClosed(first, ${a.local}Success, ${a.local}Error);`,
      "          if (Exit.isSuccess(first)) {",
      `            const second = yield* Effect.exit(port[${quote(second.name)}](b));`,
      `            assertClosed(second, ${b.local}Success, ${b.local}Error);`,
      "          }",
      "          return yield* Effect.fail(rollback);",
      "        })));",
      "        assertRollback(rolledBack);",
      "        assert.deepStrictEqual(yield* snapshot, before);",
      "      })),",
      "      { arbitrary: { runs: 10 } },",
      "    );",
      "    });",
      "",
      `    for (const scenario of scenarios.sharedTransactions[${quote(key)}]) {`,
      "      const pair = Effect.gen(function* () {",
      `        const port = yield* ${service};`,
      `        const first = yield* port[${quote(first.name)}](scenario.inputs[0]);`,
      `        assert.isTrue(${a.local}Success(first));`,
      `        const second = yield* port[${quote(second.name)}](scenario.inputs[1]);`,
      `        assert.isTrue(${b.local}Success(second));`,
      "      });",
      ...testRoot,
      "      const test = it.effect.skipIf(scenario.requiresConcurrentConnections === true && !harness.supportsConcurrentConnections);",
      `      test(${quote(`G4 shared transaction rollback scenario: ${key} / `)} + scenario.name, () =>`,
      "        isolated(Effect.gen(function* () {",
      "          if (scenario.seed !== undefined) yield* scenario.seed;",
      "          const before = yield* snapshot;",
      "          const rolledBack = yield* Effect.exit(harness.transact(pair.pipe(Effect.andThen(Effect.fail(rollback)))));",
      "          assertRollback(rolledBack);",
      "          assert.deepStrictEqual(yield* snapshot, before);",
      "        })),",
      "      );",
      "    });",
      ...testRoot,
      "      const test = it.effect.skipIf(scenario.requiresConcurrentConnections === true && !harness.supportsConcurrentConnections);",
      `      test(${quote(`G4 shared transaction commit: ${key} / `)} + scenario.name, () =>`,
      "        isolated(Effect.gen(function* () {",
      "          if (scenario.seed !== undefined) yield* scenario.seed;",
      "          yield* harness.transact(pair);",
      "          yield* scenario.observe;",
      "        })),",
      "      );",
      "    });",
      "    }",
      "",
    );
  }

  return [
    "/** Each test owns initially empty storage. Every sample resets and proves emptiness before seeding its fixtures. */",
    `export interface ${base}Harness<E, R> {`,
    "  readonly name: string;",
    `  readonly layer: Layer.Layer<${service} | R, E>;`,
    "  readonly reset: Effect.Effect<void, E, R>;",
    "  readonly transact: <A, X, Rx>(effect: Effect.Effect<A, X, Rx>) => Effect.Effect<A, X | E, Rx | R>;",
    "  readonly snapshot: Effect.Effect<Schema.Json, E, R>;",
    "  readonly supportsConcurrentConnections: boolean;",
    "}",
    "",
    "type NonEmpty<A> = readonly [A, ...A[]];",
    "interface DomainCase<I, A, E, R> {",
    "  readonly name: string;",
    "  readonly input: I;",
    "  readonly expected: A;",
    "  readonly seed?: Effect.Effect<void, E, R>;",
    "  readonly requiresConcurrentConnections?: boolean;",
    "}",
    ...(pairs.length === 0
      ? []
      : [
          "interface TransactionCase<A, B, E, R> {",
          "  readonly name: string;",
          "  readonly inputs: readonly [A, B];",
          "  readonly seed?: Effect.Effect<void, E, R>;",
          "  /** Runs outside the committed transaction; must assert both writes are visible. */",
          "  readonly observe: Effect.Effect<void, E, R>;",
          "  readonly requiresConcurrentConnections?: boolean;",
          "}",
        ]),
    "",
    `export interface ${base}Scenarios<E = never, R = never> {`,
    `  readonly seed: Effect.Effect<void, E, ${service} | R>;`,
    "  readonly methods: {",
    ...methodTypes,
    "  };",
    "  readonly sharedTransactions: {",
    ...pairTypes,
    "  };",
    "}",
    "",
    ...constants,
    ...(commands.length === 0 && methodSchemas.every((method) => method.members.length === 0)
      ? []
      : [
          "const failureValue = (exit: Exit.Exit<unknown, unknown>): unknown => {",
          '  if (Exit.isSuccess(exit)) assert.fail("Expected a declared failure, not success");',
          '  assert.strictEqual(exit.cause.reasons.length, 1, "Expected one typed failure, never a defect or interruption");',
          "  const reason = exit.cause.reasons[0];",
          '  if (reason === undefined || !Cause.isFailReason(reason)) assert.fail("Defect or interruption escaped the port");',
          "  return reason.error;",
          "};",
          "",
        ]),
    "const failureReasons = <E>(exit: Exit.Exit<unknown, unknown>, error: (value: unknown) => value is E): ReadonlyArray<Cause.Fail<E>> => {",
    '  if (Exit.isSuccess(exit)) assert.fail("Expected declared failures, not success");',
    "  const reasons = exit.cause.reasons;",
    '  assert.isAbove(reasons.length, 0, "Expected at least one typed failure");',
    "  if (!reasons.every((reason): reason is Cause.Fail<E> => Cause.isFailReason(reason) && error(reason.error)))",
    '    assert.fail("Defect, interruption or undeclared error escaped the port");',
    "  return reasons;",
    "};",
    "",
    ...(methodSchemas.some((method) => method.operation.kind === "Query")
      ? [
          "const equalFailures = <E>(first: ReadonlyArray<Cause.Fail<E>>, second: ReadonlyArray<Cause.Fail<E>>, equivalent: (a: E, b: E) => boolean): boolean => {",
          "  if (first.length !== second.length) return false;",
          "  for (const reason of first) {",
          "    let balance = 0;",
          "    for (const candidate of first) if (equivalent(reason.error, candidate.error)) balance++;",
          "    for (const candidate of second) if (equivalent(reason.error, candidate.error)) balance--;",
          "    if (balance !== 0) return false;",
          "  }",
          "  return true;",
          "};",
          "",
        ]
      : []),
    "const assertClosed = <E>(exit: Exit.Exit<unknown, unknown>, success: (value: unknown) => boolean, error: (value: unknown) => value is E): void => {",
    '  if (Exit.isSuccess(exit)) assert.isTrue(success(exit.value), "Value does not satisfy the declared success Schema");',
    "  else failureReasons(exit, error);",
    "};",
    ...(commands.length === 0
      ? []
      : [
          "",
          'const rollback = { _tag: "ConformanceRollback" } as const;',
          "const assertRollback = (exit: Exit.Exit<unknown, unknown>): void => {",
          '  assert.strictEqual(failureValue(exit), rollback, "Transaction did not preserve the intentional rollback failure");',
          "};",
        ]),
    "",
    `export const ${fn} = <E, R>(harness: ${base}Harness<E, R>, scenarios: ${base}Scenarios<E, R>): void => {`,
    "  const snapshot = harness.snapshot.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)));",
    "",
    `  describe(${quote(`${port.name} adapter conformance / `)} + harness.name, () => {`,
    ...tests,
    "  });",
    "};",
  ];
};
