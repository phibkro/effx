import { assert, describe, it } from "@effect/vitest";
import { Effect, Exit, Option, Schema } from "effect";
import { composeRegistry, DiagnosticCode, DiagnosticEntry } from "../src/index.ts";

const entry = {
  code: "EFFX1001",
  owner: "kernel",
  title: "Missing capability",
  severity: "error",
  severityPolicy: { kind: "fixed" },
  explanation: "Declare the capability the handler requires.",
  examples: [
    {
      before: "handler",
      after: "handler.requires(Capability)",
      explanation: "Declare the requirement.",
    },
  ],
} as const satisfies DiagnosticEntry;

const plugin = { ...entry, code: "EFFX[@acme/effx-plugin]/0001", owner: "@acme/effx-plugin" };

describe("diagnostic registry", () => {
  it.effect("does not decode while constructed or discarded", () =>
    Effect.sync(() => {
      let reads = 0;

      const untrusted = {
        get code() {
          reads++;

          return "EFFX1001";
        },
      };

      const discarded = composeRegistry([untrusted]);
      assert.isDefined(discarded);
      assert.strictEqual(reads, 0);
    }),
  );

  it.effect("sorts by full code, preserves declarations and looks up exact identifiers", () =>
    Effect.gen(function* () {
      const inputs = [entry, plugin];
      const registry = yield* composeRegistry(inputs);
      assert.deepStrictEqual(
        registry.entries.map((value) => value.code),
        [entry.code, plugin.code],
      );
      assert.deepStrictEqual(inputs, [entry, plugin]);
      assert.deepStrictEqual(registry.get(entry.code), Option.some(entry));
      assert.isTrue(Option.isNone(registry.get("effx1001")));
      const reverse = yield* composeRegistry(inputs.toReversed());
      assert.deepStrictEqual(reverse.entries, registry.entries);
      const empty = yield* composeRegistry([]);
      assert.deepStrictEqual(empty.entries, []);
    }),
  );

  it.effect("rejects identical duplicates, including array spread inputs", () =>
    Effect.gen(function* () {
      const declarations = [entry];

      const error = yield* Effect.flip(composeRegistry([...declarations, ...declarations]));
      assert.strictEqual(error._tag, "RegistryError");
      assert.strictEqual(error.message, "Duplicate diagnostic EFFX1001: owners kernel and kernel");
    }),
  );

  it.effect.each([
    { ...entry, title: " " },
    { ...entry, explanation: "" },
    { ...entry, examples: [] },
    { ...entry, examples: [{ before: "", after: "fixed", explanation: "repair" }] },
    { ...entry, examples: [{ before: "bad", after: " ", explanation: "repair" }] },
    { ...entry, examples: [{ before: "bad", after: "fixed", explanation: "" }] },
    { ...entry, severity: "fatal" },
    { ...entry, severityPolicy: { kind: "named", name: "", description: "policy" } },
    { ...entry, severityPolicy: { kind: "named", name: "policy", description: "" } },
    { ...entry, owner: "@acme/effx-plugin" },
    { ...plugin, owner: "@other/effx-plugin" },
    { ...entry, code: "EFFX9999" },
    { ...entry, code: "EFFX2903", owner: "example.deprecated" },
    { ...entry, code: "EFFX9003", owner: "ai-docs" },
  ])("rejects invalid documentation, policy or ownership %#", (invalid) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(composeRegistry([invalid]));
      assert.strictEqual(error._tag, "RegistryError");
      assert.include(error.message, "Invalid diagnostic registry:");
    }),
  );

  it.effect.each([
    ["EFFX2901", "example.deprecated"],
    ["EFFX2902", "example.deprecated"],
    ["EFFX9001", "ai-docs"],
    ["EFFX9002", "ai-docs"],
    ["EFFX9101", "ai-docs"],
    ["EFFX9102", "ai-docs"],
  ])("accepts only each specific grandfathered reservation %#", ([code, owner]) =>
    Effect.gen(function* () {
      const registry = yield* composeRegistry([{ ...entry, code, owner }]);
      assert.strictEqual(registry.entries.length, 1);

      const error = yield* Effect.flip(
        composeRegistry([{ ...entry, code, owner: "@acme/plugin" }]),
      );

      assert.include(error.message, "does not match reserved owner");
    }),
  );

  it.effect("native decoding and composition agree on valid entry data", () =>
    Effect.gen(function* () {
      const decoded = yield* Schema.decodeEffect(Schema.Array(DiagnosticEntry))([entry, plugin]);

      const registry = yield* composeRegistry(decoded);
      assert.deepStrictEqual(registry.entries, decoded);
    }),
  );

  it.effect("leaves caller cleanup and interruption semantics intact", () =>
    Effect.gen(function* () {
      let finalizers = 0;

      const finalize = Effect.sync(() => {
        finalizers++;
      });

      yield* composeRegistry([entry]).pipe(Effect.ensuring(finalize));
      yield* Effect.flip(composeRegistry([entry, entry]).pipe(Effect.ensuring(finalize)));

      const cancelled = yield* Effect.exit(
        Effect.gen(function* () {
          yield* composeRegistry([entry]);

          return yield* Effect.interrupt;
        }).pipe(Effect.ensuring(finalize)),
      );

      assert.isTrue(Exit.hasInterrupts(cancelled));
      assert.strictEqual(finalizers, 3);
    }),
  );
});

describe("DiagnosticCode grammar", () => {
  it.effect.each([
    "EFFX0000",
    "EFFX9999",
    "EFFX[effx-plugin]/0001",
    "EFFX[@acme/effx-rate-limit]/0001",
  ])("accepts %s", (code) => Effect.sync(() => assert.isTrue(Schema.is(DiagnosticCode)(code))));
  it.effect.each([
    "EFFX12",
    "effx1001",
    "1001",
    "EFFX1001\n",
    "EFFX[@ACME/plugin]/0001",
    "EFFX[@acme/plugin]/1",
    "EFFX[@acme/plugin@1]/0001",
    "EFFX[_plugin]/0001",
    "EFFX[.plugin]/0001",
    "EFFX[../plugin]/0001",
    "EFFX[node_modules]/0001",
    "EFFX[favicon.ico]/0001",
    `EFFX[${"x".repeat(215)}]/0001`,
  ])("rejects %s", (code) => Effect.sync(() => assert.isFalse(Schema.is(DiagnosticCode)(code))));
});
