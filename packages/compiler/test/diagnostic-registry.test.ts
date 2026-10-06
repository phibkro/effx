import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  bundledDiagnosticEntries,
  DiagnosticDefinitions,
  CoreDiagnostics,
  HttpDiagnostics,
  composeRegistry,
} from "@effx/compiler";

describe("diagnostic registry conformance", () => {
  it.effect("shares declaration identity between factories and the composed registry", () =>
    Effect.gen(function* () {
      const registry = yield* composeRegistry(bundledDiagnosticEntries);
      const keys = Object.keys(DiagnosticDefinitions).toSorted();
      assert.deepStrictEqual(
        keys,
        registry.entries.map((entry) => entry.code),
      );

      for (const [code, definition] of Object.entries(DiagnosticDefinitions)) {
        assert.strictEqual(definition.entry.code, code);
        assert.strictEqual(
          bundledDiagnosticEntries.filter((entry) => entry.code === code).length,
          1,
        );
        assert.strictEqual(
          bundledDiagnosticEntries.find((entry) => entry.code === code),
          definition.entry,
        );
        assert.deepStrictEqual(
          registry.entries.find((entry) => entry.code === code),
          definition.entry,
        );
      }

      for (const [code, definition] of Object.entries({ ...CoreDiagnostics, ...HttpDiagnostics })) {
        assert.strictEqual(
          Object.entries(DiagnosticDefinitions).find(([key]) => key === code)?.[1],
          definition,
        );
      }
    }),
  );
  it.effect("duplicate roots fail before a keyed projection can overwrite them", () =>
    Effect.gen(function* () {
      const duplicate = bundledDiagnosticEntries[0];
      assert.isDefined(duplicate);

      const failure = yield* composeRegistry([...bundledDiagnosticEntries, duplicate]).pipe(
        Effect.flip,
      );

      assert.strictEqual(failure._tag, "RegistryError");
    }),
  );
  it.effect("missing documentation cannot enter the composed distribution", () =>
    Effect.gen(function* () {
      const invalid = { ...bundledDiagnosticEntries[0], explanation: "" };
      const failure = yield* composeRegistry([invalid]).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "RegistryError");
    }),
  );
});
