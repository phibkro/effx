import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import { Annotation, Builtins } from "@effx/runtime";
import {
  Extensions,
  SourceFrontend,
  compile,
  extension,
  implement,
  defineDiagnostic,
  type Extension,
} from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";

const tsconfigPath = new URL("./fixtures/users/tsconfig.json", import.meta.url).pathname;

const Services = Layer.mergeAll(
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
  BunServices.layer,
);

// The definition module is a leaf; the test imports it exactly as an extension author would.
const { RateLimit } = await import("./fixtures/users/src/rate-limit.def.ts");

const recorded = defineDiagnostic(
  {
    code: "EFFX[@fixture/frontend-rate-limit]/0001",
    owner: "@fixture/frontend-rate-limit",
    title: "Rate limit annotation recorded",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation: "The test extension records each interpreted app.RateLimit node during analysis.",
    examples: [
      {
        before: "@RateLimit({ perMinute: 60 })",
        after: "// Remove RateLimit when no recorded node is intended.",
        explanation: "This diagnostic is a test probe, not a production validation rule.",
      },
    ],
  },
  Schema.Struct({ subject: Schema.String }),
  ({ subject }) => `${subject}: recorded`,
);

const rateLimit = extension("app", [
  implement(RateLimit, {
    diagnosticEntries: [recorded.entry],
    analyze: (ir) =>
      ir.nodes.flatMap((node) =>
        node._tag === "Extension" && node.tag === "app.RateLimit"
          ? [recorded.emit({ subject: node.id })]
          : [],
      ),
  }),
]);

const withApp: ReadonlyArray<Extension> = [...Extensions.builtin, rateLimit];

const compileEntry = (entry: string, extensions: ReadonlyArray<Extension>) =>
  compile({ tsconfigPath, entry: [`src/${entry}`] }, extensions);

describe("user-declared annotations", () => {
  it.effect("decorator and builder spellings lower to the same annotation and IR node", () =>
    Effect.gen(function* () {
      const result = yield* compileEntry("operations.rate-limit.ts", withApp);
      const collected = Option.getOrThrow(result.collected.value);

      const limits = collected.declarations.flatMap((declaration) =>
        declaration.annotations.filter((annotation) => annotation.name === "app.RateLimit"),
      );

      assert.strictEqual(limits.length, 2);
      assert.deepStrictEqual(limits[0], limits[1]);
      assert.deepStrictEqual(limits[0]?.args, [{ perMinute: 60, burst: 5 }]);
      assert.deepStrictEqual(limits[0]?.definition, {
        module: "../../src/rate-limit.def",
        export: "RateLimit",
      });

      const ir = Option.getOrThrow(result.ir.value);

      const nodes = ir.nodes.filter(
        (node) => node._tag === "Extension" && node.tag === "app.RateLimit",
      );

      assert.deepStrictEqual(nodes.map((node) => node.id).toSorted(), [
        "ext:app.RateLimit/Limited.Builder",
        "ext:app.RateLimit/Limited.Get",
      ]);

      for (const node of nodes) {
        if (node._tag !== "Extension") continue;
        assert.deepStrictEqual(node.data, {
          definition: { module: "../../src/rate-limit.def", export: "RateLimit" },
          args: [{ perMinute: 60, burst: 5 }],
        });
      }

      assert.ok(
        ir.edges.some((edge) => edge.kind === "ExtensionOf" && edge.qualifier === "app.RateLimit"),
      );

      const reports = result.diagnostics.filter(
        (diagnostic) => diagnostic.code === recorded.entry.code,
      );

      assert.strictEqual(reports.length, 2);
      assert.isTrue(reports.every((diagnostic) => diagnostic.severity === "error"));
    }).pipe(Effect.provide(Services)),
  );

  it.effect("an unregistered annotation keeps EFFX1101", () =>
    Effect.gen(function* () {
      const result = yield* compileEntry("operations.rate-limit.ts", Extensions.builtin);

      assert.ok(result.diagnostics.some((d) => d.code === "EFFX1101"));
    }).pipe(Effect.provide(Services)),
  );

  it.effect("cardinality one rejects a repeat, and a name collision is EFFX1302", () =>
    Effect.gen(function* () {
      const twice = yield* compileEntry("operations.rate-limit.duplicate.ts", withApp);

      assert.ok(twice.diagnostics.some((diagnostic) => diagnostic.code === "EFFX2402"));

      const clash = yield* compileEntry("operations.rate-limit.ts", [
        ...withApp,
        extension("other", [implement(RateLimit, {})]),
      ]);

      assert.ok(clash.diagnostics.some((d) => d.code === "EFFX1302"));
    }).pipe(Effect.provide(Services)),
  );

  it.effect("a definition module that reaches an application module is EFFX1306", () =>
    Effect.gen(function* () {
      const { Leaky } = yield* Effect.promise(() => import("./fixtures/users/src/leaky.def.ts"));
      const leaky = extension("leaky", [implement(Leaky, {})]);
      const result = yield* compileEntry("operations.leaky.ts", [...Extensions.builtin, leaky]);

      assert.ok(result.diagnostics.some((diagnostic) => diagnostic.code === "EFFX1306"));

      const clean = yield* compileEntry("operations.rate-limit.ts", withApp);

      assert.ok(!clean.diagnostics.some((d) => d.code === "EFFX1306"));
    }).pipe(Effect.provide(Services)),
  );

  it.effect(
    "an operation-target user annotation on a class is EFFX1303; a built-in one stays EFFX1104",
    () =>
      Effect.gen(function* () {
        const result = yield* compileEntry("operations.target.ts", withApp);
        const collected = Option.getOrThrow(result.collected.value);
        const target = collected.diagnostics.filter((d) => d.code === "EFFX1303");

        assert.strictEqual(target.length, 1);
        assert.strictEqual(target[0]?.severity, "error");
        assert.ok(target[0]?.location !== undefined);

        const generic = collected.diagnostics.filter((d) => d.code === "EFFX1104");

        assert.strictEqual(generic.length, 1);
        assert.strictEqual(generic[0]?.severity, "error");
      }).pipe(Effect.provide(Services)),
  );

  it.effect(".with(...) of a definition whose target is not operation is EFFX1303", () =>
    Effect.gen(function* () {
      const { ClassOnly } = yield* Effect.promise(
        () => import("./fixtures/users/src/class-only.def.ts"),
      );

      const registered = [...Extensions.builtin, extension("app", [implement(ClassOnly, {})])];
      const result = yield* compileEntry("operations.target-with.ts", registered);
      const collected = Option.getOrThrow(result.collected.value);

      const invalidTarget = collected.diagnostics.filter(
        (diagnostic) => diagnostic.code === "EFFX1303",
      );

      assert.strictEqual(invalidTarget.length, 1);
      assert.strictEqual(invalidTarget[0]?.severity, "error");
      assert.deepStrictEqual(
        collected.declarations.filter((d) => d.id === "classOnlyBuilder"),
        [],
        "the rejected chain contributes no declaration",
      );

      // Unregistered, the frontend knows no target: the unknown name keeps EFFX1101.
      const unregistered = yield* compileEntry("operations.target-with.ts", Extensions.builtin);

      assert.ok(!unregistered.diagnostics.some((d) => d.code === "EFFX1303"));
      assert.ok(unregistered.diagnostics.some((d) => d.code === "EFFX1101"));
    }).pipe(Effect.provide(Services)),
  );

  it("is also reachable as a plain frontend input", () => {
    assert.ok(
      Annotation.define !== undefined && Builtins.all.length === 19 && SourceFrontend !== undefined,
    );
  });
});
