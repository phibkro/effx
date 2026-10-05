import { assert, describe, it } from "@effect/vitest";
import { expectTypeOf } from "vitest";
import { Deferred, Effect, Exit, Fiber, Layer, Option, Schema } from "effect";
import {
  type Collected,
  type CompileResult,
  CompilerFault,
  Contribution,
  CoreDiagnostics,
  type Diagnostic,
  type DiagnosticEntry,
  type Extension,
  HttpDiagnostics,
  SourceFrontend,
  StageResult,
  analyze,
  compile,
  compileCollected,
  defineDiagnostic,
  extension,
  implement,
  interpret,
} from "@effx/compiler";
import { A, Annotation } from "@effx/runtime";
import { IRGraph, StableId, make } from "@effx/ir";

const notice = defineDiagnostic(
  {
    code: "EFFX[@fixture/compiler-boundary]/0001",
    owner: "@fixture/compiler-boundary",
    title: "Fixture notice",
    severity: "warning",
    severityPolicy: { kind: "fixed" },
    explanation:
      "Names the source occurrence used to prove preservation across compiler boundaries.",
    examples: [{ before: "notice", after: "repaired", explanation: "Repair the fixture subject." }],
  },
  Schema.Struct({ subject: Schema.String }),
  ({ subject }) => `notice: ${subject}`,
);

const promoted = defineDiagnostic(
  {
    code: "EFFX[@fixture/compiler-boundary]/0002",
    owner: "@fixture/compiler-boundary",
    title: "Fixture promotion",
    severity: "warning",
    severityPolicy: {
      kind: "named",
      name: "fixture-strict",
      description: "Strict fixture mode promotes the notice.",
      allowedSeverities: ["warning", "error"],
    },
    explanation:
      "Only the declared named-policy outcomes are legal at a JavaScript callback boundary.",
    examples: [{ before: "strict", after: "repair", explanation: "Repair the fixture subject." }],
  },
  Schema.Struct({ strict: Schema.Boolean }),
  () => "fixture promotion",
  ({ strict }) => (strict ? "error" : "warning"),
);

const location = { file: "source.ts", line: 7, col: 3 };

const otherLocation = { file: "related.ts", line: 2, col: 1 };

const source: Collected = {
  declarations: [
    {
      id: "Fixture",
      kind: "class",
      module: "./fixture",
      export: "Fixture",
      location,
      annotations: [{ name: "Fixture", args: [] }],
    },
  ],
  diagnostics: [],
};

const empty: Collected = { declarations: [], diagnostics: [] };

const project = { tsconfigPath: "fixture/tsconfig.json" };

const contractCode = CoreDiagnostics["EFFX0010"].entry.code;

// Deliberate untyped JavaScript payloads: these assertions are inputs to the checked boundary, not decoders.
// SAFETY: intentionally forged JavaScript fixture; compilation must decode it and reject invalid data.
const forged = <T>(input: T): ReadonlyArray<Diagnostic> => input as ReadonlyArray<Diagnostic>;

// SAFETY: intentionally forged entry fixture; compilation must decode it before frontend analysis.
const registrations = <T>(input: T): ReadonlyArray<DiagnosticEntry> =>
  input as ReadonlyArray<DiagnosticEntry>;

const plugin = (rest: Partial<Extension> = {}): Extension => ({
  name: "fixture",
  diagnosticEntries: [notice.entry, promoted.entry],
  interpreters: {},
  analyses: [],
  generators: [],
  ...rest,
});

const countLayer = (collected: Collected, calls: { analyze: number }) =>
  Layer.succeed(SourceFrontend, {
    analyze: Effect.fnUntraced(function* () {
      yield* Effect.sync(() => {
        calls.analyze++;
      });

      return collected;
    }),
  });

const containsContract = (diagnostics: ReadonlyArray<Diagnostic>): boolean =>
  diagnostics.some(
    (diagnostic) =>
      diagnostic.code === contractCode ||
      (diagnostic.related !== undefined && containsContract(diagnostic.related)),
  );

const invalidRegistrations: ReadonlyArray<readonly [string, unknown]> = [
  ["malformed array", {}],
  ["malformed entry", [{ code: notice.entry.code }]],
  ["identical duplicate", [notice.entry, notice.entry]],
  ["bundled shadow", [CoreDiagnostics["EFFX1101"].entry]],
  ["reserved numeric allocation", [{ ...notice.entry, code: "EFFX1199", owner: "annotation" }]],
  [
    "named empty outcomes",
    [
      {
        ...promoted.entry,
        severityPolicy: { ...promoted.entry.severityPolicy, allowedSeverities: [] },
      },
    ],
  ],
  [
    "named duplicate outcomes",
    [
      {
        ...promoted.entry,
        severityPolicy: {
          ...promoted.entry.severityPolicy,
          allowedSeverities: ["warning", "warning"],
        },
      },
    ],
  ],
  [
    "named default absent",
    [
      {
        ...promoted.entry,
        severityPolicy: { ...promoted.entry.severityPolicy, allowedSeverities: ["error"] },
      },
    ],
  ],
];

const invalidOccurrences: ReadonlyArray<readonly [string, unknown]> = [
  [
    "unregistered numeric",
    [{ code: "EFFX1199", severity: "warning", message: "forged", location }],
  ],
  [
    "unregistered namespaced",
    [{ code: "EFFX[@fixture/unknown]/0001", severity: "warning", message: "forged", location }],
  ],
  ["malformed message", [{ ...notice.emit({ subject: "x" }), message: 1, location }]],
  ["malformed severity", [{ ...notice.emit({ subject: "x" }), severity: "fatal", location }]],
  ["fixed mismatch", [{ ...notice.emit({ subject: "x" }), severity: "info", location }]],
  [
    "named undeclared outcome",
    [{ ...promoted.emit({ strict: false }), severity: "info", location }],
  ],
  ["malformed list", { diagnostic: notice.emit({ subject: "x" }) }],
  [
    "unregistered related",
    [
      notice.emit(
        { subject: "parent" },
        {
          location,
          related: forged([
            { code: "EFFX1199", severity: "warning", message: "child", location: otherLocation },
          ]),
        },
      ),
    ],
  ],
  [
    "malformed related",
    [notice.emit({ subject: "parent" }, { location, related: forged([null]) })],
  ],
];

describe("checked diagnostic contract", () => {
  it.effect.each(invalidRegistrations)("%s rejects before SourceFrontend analysis", ([, entries]) =>
    Effect.gen(function* () {
      const calls = { analyze: 0 };

      let generated = 0;

      const selected = plugin({
        diagnosticEntries: registrations(entries),
        generators: [
          Effect.fnUntraced(function* () {
            yield* Effect.sync(() => {
              generated++;
            });

            return [{ path: "fixture.ts", contents: "export const fixture = true;\n" }];
          }),
        ],
      });

      const result = yield* compile(project, [selected]).pipe(
        Effect.provide(countLayer(empty, calls)),
      );

      assert.strictEqual(calls.analyze, 0);

      assert.strictEqual(generated, 0);

      assert.deepStrictEqual(
        result.diagnostics.map((diagnostic) => diagnostic.code),
        [contractCode],
      );

      assert.isTrue(Option.isNone(result.collected.value));

      assert.isTrue(Option.isNone(result.ir.value));

      assert.isTrue(Option.isNone(result.files.value));

      const cached = yield* compileCollected(empty, [selected]);

      assert.deepStrictEqual(cached.diagnostics, result.diagnostics);

      assert.strictEqual(generated, 0);
    }),
  );

  it.effect("duplicates between selected owners cannot be hidden by load order", () =>
    Effect.gen(function* () {
      const first = plugin({ name: "first" });

      const second = plugin({ name: "second" });

      const result = yield* compileCollected(empty, [first, second]);

      assert.strictEqual(result.diagnostics[0]?.code, contractCode);

      assert.include(result.diagnostics[0]!.message, notice.entry.owner);

      assert.include(result.diagnostics[0]!.message, notice.entry.code);

      assert.isTrue(Option.isNone(result.files.value));
    }),
  );

  it.effect.each(invalidOccurrences)(
    "%s is checked at collection, expansion, interpretation and analysis",
    ([, payload]) =>
      Effect.gen(function* () {
        for (const stage of ["collect", "expand", "interpret", "analyze"] as const) {
          let generated = 0;

          const selected = plugin({
            expand: (collected: Collected) => ({
              declarations: collected.declarations,
              diagnostics: stage === "expand" ? forged(payload) : [],
            }),
            interpreters: {
              Fixture: () =>
                Contribution.make([], [], stage === "interpret" ? forged(payload) : []),
            },
            analyses: stage === "analyze" ? [() => forged(payload)] : [],
            generators: [
              Effect.fnUntraced(function* () {
                yield* Effect.sync(() => {
                  generated++;
                });

                return [{ path: "fixture.ts", contents: "export const fixture = true;\n" }];
              }),
            ],
          });

          const collected =
            stage === "collect" ? { ...source, diagnostics: forged(payload) } : source;

          const result = yield* compileCollected(collected, [selected]);

          assert.isTrue(containsContract(result.diagnostics), stage);

          assert.strictEqual(generated, 0, stage);

          assert.isTrue(Option.isNone(result.files.value), stage);

          const direct =
            stage === "interpret" || stage === "expand"
              ? interpret(source, [selected]).diagnostics
              : stage === "analyze"
                ? analyze(make([], []), IRGraph.toGraph(make([], [])), [selected])
                : result.diagnostics;

          assert.isTrue(containsContract(direct), `direct ${stage}`);
        }
      }),
  );

  it.effect("preserves valid diagnostic order, source locations and related occurrence bytes", () =>
    Effect.gen(function* () {
      const related = notice.emit({ subject: "related" }, { location: otherLocation });

      const collect = notice.emit({ subject: "collect" }, { location, related: [related] });

      const expand = notice.emit({ subject: "expand" }, { location });

      const interpreted = notice.emit({ subject: "interpret" }, { related: [related] });

      const analysis = notice.emit({ subject: "analyze" }, { location: otherLocation });

      const selected = plugin({
        expand: (collected) => ({ declarations: collected.declarations, diagnostics: [expand] }),
        interpreters: { Fixture: () => Contribution.diagnostics(interpreted) },
        analyses: [() => [analysis]],
      });

      const collected = { ...source, diagnostics: [collect] };

      const direct = yield* compileCollected(collected, [selected]);

      const substituted = yield* compile(project, [selected]).pipe(
        Effect.provide(SourceFrontend.fromCollected(collected)),
      );

      assert.deepStrictEqual(direct, substituted);

      assert.deepStrictEqual(direct.diagnostics, [
        collect,
        expand,
        { ...interpreted, location },
        analysis,
      ]);

      assert.isTrue(Option.isSome(direct.files.value));
    }),
  );

  it.effect(
    "retains valid related occurrences and location under undeclared or malformed parents",
    () =>
      Effect.gen(function* () {
        const related = notice.emit({ subject: "valid child" }, { location: otherLocation });

        const parents = [
          {
            code: "EFFX1199",
            severity: "warning",
            message: "invalid parent",
            location,
            related: [related],
          },
          {
            ...notice.emit({ subject: "malformed parent" }, { location, related: [related] }),
            message: 1,
          },
        ];

        for (const parent of parents) {
          const result = yield* compileCollected({ ...empty, diagnostics: forged([parent]) }, [
            plugin(),
          ]);

          assert.strictEqual(result.diagnostics[0]?.code, contractCode);
          assert.deepStrictEqual(result.diagnostics[0]?.related, [related]);
          assert.deepStrictEqual(result.diagnostics[0]?.location, location);
          assert.isTrue(Option.isNone(result.files.value));
        }
      }),
  );

  it.effect(
    "cyclic JavaScript related data becomes a contract diagnostic rather than recursion failure",
    () =>
      Effect.gen(function* () {
        const related: Array<Diagnostic> = [];

        const cyclic = notice.emit({ subject: "cycle" }, { related });

        related.push(cyclic);

        const result = yield* compileCollected({ ...empty, diagnostics: forged([cyclic]) }, [
          plugin(),
        ]);

        assert.strictEqual(result.diagnostics[0]?.related?.[0]?.code, contractCode);
        assert.isTrue(Option.isNone(result.files.value));
      }),
  );

  it.effect(
    "named policies admit declared outcomes but cannot emit an arbitrary third severity",
    () =>
      Effect.gen(function* () {
        for (const strict of [false, true]) {
          const diagnostic = promoted.emit({ strict });

          const result = yield* compileCollected(empty, [
            plugin({ analyses: [() => [diagnostic]] }),
          ]);

          assert.deepStrictEqual(result.diagnostics, [diagnostic]);
          assert.strictEqual(Option.isSome(result.files.value), !strict);
        }

        for (const projectPin of ["6.1.0", "7.0.2"]) {
          const diagnostic = CoreDiagnostics["EFFX0001"].emit({
            analysisVersion: "6.0.2",
            projectPin,
          });

          const result = yield* compileCollected({ ...empty, diagnostics: [diagnostic] }, []);
          assert.deepStrictEqual(result.diagnostics, [diagnostic]);
          assert.isTrue(Option.isSome(result.files.value));
        }

        const diagnostic = CoreDiagnostics["EFFX0001"].emit({
          analysisVersion: "6.0.2",
          projectPin: "6.1.0",
        });

        const result = yield* compileCollected(
          { ...empty, diagnostics: forged([{ ...diagnostic, severity: "error" }]) },
          [],
        );

        assert.isTrue(containsContract(result.diagnostics));
      }),
  );

  it.effect("EFFX1106 collect warning differs from interpret/analyze contract error", () =>
    Effect.gen(function* () {
      const warning = CoreDiagnostics["EFFX1106"].emit({
        _tag: "RuntimeResolution",
        from: "fixture",
      });

      const error = CoreDiagnostics["EFFX1106"].emit({ _tag: "LocalSource", subject: "Fixture" });
      const validCollect = yield* compileCollected({ ...empty, diagnostics: [warning] }, []);
      assert.deepStrictEqual(validCollect.diagnostics, [warning]);
      const invalidCollect = yield* compileCollected({ ...empty, diagnostics: [error] }, []);
      assert.isTrue(containsContract(invalidCollect.diagnostics));

      for (const stage of ["interpret", "analyze"] as const) {
        const selected = plugin({
          interpreters: { Fixture: () => Contribution.diagnostics(warning) },
          analyses: stage === "analyze" ? [() => [warning]] : [],
        });

        const result =
          stage === "interpret"
            ? interpret(source, [selected]).diagnostics
            : analyze(make([], []), IRGraph.toGraph(make([], [])), [selected]);

        assert.isTrue(containsContract(result));

        const valid = plugin({
          interpreters: { Fixture: () => Contribution.diagnostics(error) },
          analyses: [() => [error]],
        });

        const validResult =
          stage === "interpret"
            ? interpret(source, [valid]).diagnostics
            : analyze(make([], []), IRGraph.toGraph(make([], [])), [valid]);

        assert.isFalse(containsContract(validResult));
      }
    }),
  );

  it.effect.each([false, true])("EFFX2504 must match actual strictAccess=%s", (strictAccess) =>
    Effect.gen(function* () {
      for (const emittedStrict of [false, true]) {
        const diagnostic = HttpDiagnostics["EFFX2504"].emit({
          subject: "Fixture",
          strictAccess: emittedStrict,
        });

        const result = yield* compileCollected(
          empty,
          [plugin({ analyses: [() => [diagnostic]] })],
          { strictAccess },
        );

        assert.strictEqual(containsContract(result.diagnostics), strictAccess !== emittedStrict);

        if (strictAccess === emittedStrict)
          assert.deepStrictEqual(result.diagnostics, [diagnostic]);
      }
    }),
  );

  it.effect(
    "annotation guard, target, duplicate and read callback diagnostics cannot bypass interpretation checks",
    () =>
      Effect.gen(function* () {
        const definition = Annotation.define({
          name: "Fixture",
          target: "operation",
          cardinality: "one",
          args: { value: A.string },
        });

        const bad = forged([
          { code: "EFFX1199", severity: "warning", message: "forged callback" },
        ])[0]!;

        const cases = [
          { options: { before: () => bad }, annotations: [{ name: "Fixture", args: ["ok"] }] },
          {
            options: { notOperation: () => bad },
            annotations: [{ name: "Fixture", args: ["ok"] }],
          },
          {
            options: { duplicate: () => bad },
            annotations: [
              { name: "Query", args: [] },
              { name: "Fixture", args: ["ok"] },
              { name: "Fixture", args: ["ok"] },
            ],
          },
          {
            options: { read: () => Contribution.diagnostics(bad) },
            annotations: [
              { name: "Query", args: [] },
              { name: "Fixture", args: ["ok"] },
            ],
          },
        ];

        for (const test of cases) {
          const selected = extension("fixture", [implement(definition, test.options)]);

          const result = yield* compileCollected(
            {
              ...source,
              declarations: [{ ...source.declarations[0]!, annotations: test.annotations }],
            },
            [selected],
          );

          assert.isTrue(containsContract(result.diagnostics));
          assert.isTrue(Option.isNone(result.files.value));
        }
      }),
  );

  it.effect(
    "HTTP inventory callback diagnostics are recursively checked before generator admission",
    () =>
      Effect.gen(function* () {
        const root = { module: "./root", export: "NativeApi" };

        const schema = {
          module: "./fixture",
          export: "FixtureSchema",
          symbolId: StableId.make("schema", "FixtureSchema"),
        };

        const operationId = StableId.make("operation", "Fixture.Read");
        const exposureId = StableId.make("exposure", "http:Fixture.Read");
        let proofCalls = 0;
        let generated = 0;

        const selected = plugin({
          interpreters: {
            Fixture: () =>
              Contribution.make(
                [
                  {
                    _tag: "Operation",
                    id: operationId,
                    name: "Fixture.Read",
                    kind: "Query",
                    input: schema,
                    success: schema,
                    binding: "external",
                    errors: { values: [], inferred: false },
                    requirements: { values: [], inferred: false },
                  },
                  {
                    _tag: "Exposure",
                    id: exposureId,
                    operation: operationId,
                    transport: { _tag: "http", method: "GET", path: "/fixture" },
                  },
                  {
                    _tag: "HttpGroup",
                    id: StableId.make("group", "effx/operations"),
                    root: "effx",
                    group: "operations",
                    rootSymbol: root,
                  },
                ],
                [{ kind: "ExposedAs", from: operationId, to: exposureId, qualifier: "http" }],
              ),
          },
          generators: [
            Effect.fnUntraced(function* () {
              yield* Effect.sync(() => {
                generated++;
              });

              return [{ path: "fixture.ts", contents: "export const fixture = true;\n" }];
            }),
          ],
        });

        const collected = {
          ...source,
          resolveHttpApiInventory: Effect.fnUntraced(function* () {
            yield* Effect.sync(() => {
              proofCalls++;
            });

            return StageResult.succeed(
              [{ root, group: "operations", endpoints: ["Read"] }],
              [
                notice.emit(
                  { subject: "inventory" },
                  {
                    related: forged([
                      { code: "EFFX1199", severity: "warning", message: "forged inventory" },
                    ]),
                  },
                ),
              ],
            );
          }),
        };

        const result = yield* compileCollected(collected, [selected]);
        assert.strictEqual(proofCalls, 1);
        assert.strictEqual(generated, 0);
        assert.isTrue(containsContract(result.diagnostics));
        assert.isTrue(Option.isNone(result.files.value));
      }),
  );

  it.effect("constructing compilation does not evaluate the frontend or generators", () =>
    Effect.sync(() => {
      const calls = { analyze: 0 };
      const layer = countLayer(empty, calls);
      const program = compile(project, [plugin()]);
      const cached = compileCollected(empty, [plugin()]);
      const built = program.pipe(Effect.provide(layer));
      void built;
      void cached;
      assert.strictEqual(calls.analyze, 0);
      expectTypeOf<Effect.Success<typeof program>>().toEqualTypeOf<CompileResult>();
      expectTypeOf<Effect.Error<typeof program>>().toEqualTypeOf<CompilerFault>();
      expectTypeOf<Effect.Services<typeof program>>().toEqualTypeOf<SourceFrontend>();
      expectTypeOf<Effect.Error<typeof cached>>().toEqualTypeOf<CompilerFault>();
      expectTypeOf<Effect.Services<typeof cached>>().toEqualTypeOf<never>();
    }),
  );

  it.effect("frontend interruption propagates and runs its finalizer exactly once", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      let finalized = 0;

      const layer = Layer.succeed(SourceFrontend, {
        analyze: Effect.fnUntraced(
          function* () {
            yield* Deferred.succeed(entered, undefined);

            return yield* Effect.never;
          },
          Effect.ensuring(
            Effect.sync(() => {
              finalized++;
            }),
          ),
        ),
      });

      const fiber = yield* Effect.forkChild(
        compile(project, [plugin()]).pipe(Effect.provide(layer)),
      );

      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      assert.isTrue(Exit.hasInterrupts(exit));
      assert.strictEqual(finalized, 1);
    }),
  );
});
