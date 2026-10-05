import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import ts from "@typescript/typescript6";
import { Effect, FileSystem, Path } from "effect";
import { bundledDiagnosticEntries, DiagnosticDefinitions, composeRegistry } from "@effx/compiler";

const root = new URL("../../../", import.meta.url).pathname;

/** Inspect literal identifiers, not comments, snapshots or dynamically rendered messages. */
const literalCodes = (file: string, source: string): ReadonlyArray<string> => {
  const codes: Array<string> = [];

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) && /^EFFX\d{4}$/.test(node.text)) codes.push(node.text);
    ts.forEachChild(node, visit);
  };

  visit(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true));

  return codes;
};

describe("diagnostic registry conformance", () => {
  it.effect("composes all 68 reserved legacy entries plus the bootstrap contract error", () =>
    Effect.gen(function* () {
      const registry = yield* composeRegistry(bundledDiagnosticEntries);
      assert.strictEqual(registry.entries.length, 69);
      const keys = Object.keys(DiagnosticDefinitions).toSorted();
      assert.deepStrictEqual(
        keys,
        registry.entries.map((entry) => entry.code),
      );

      for (const [code, definition] of Object.entries(DiagnosticDefinitions)) {
        assert.strictEqual(definition.entry.code, code);
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
      assert.include(failure.message.toLowerCase(), "duplicate");
    }),
  );

  it.effect("missing documentation cannot enter the composed distribution", () =>
    Effect.gen(function* () {
      const invalid = { ...bundledDiagnosticEntries[0], explanation: "" };
      const failure = yield* composeRegistry([invalid]).pipe(Effect.flip);
      assert.strictEqual(failure._tag, "RegistryError");
    }),
  );

  it.effect("every phase-one legacy producer identifier has a documented entry", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const emitted = new Set<string>();

      for (const name of ["compiler", "frontend-ts", "runtime", "persistence", "cli"]) {
        const directory = path.join(root, "packages", name, "src");

        for (const file of yield* fs.readDirectory(directory, { recursive: true })) {
          if (!file.endsWith(".ts") || file.startsWith("diagnostics/") || file === "diagnostics.ts")
            continue;

          for (const code of literalCodes(
            file,
            yield* fs.readFileString(path.join(directory, file)),
          ))
            emitted.add(code);
        }
      }

      for (const file of [
        "examples/extension-openapi-tags/deprecated-extension.ts",
        "ai-docs/src/06_custom-extensions/05_implement-annotation.ts",
        "ai-docs/src/06_custom-extensions/10_hand-written-extension.ts",
      ]) {
        for (const code of literalCodes(file, yield* fs.readFileString(path.join(root, file))))
          emitted.add(code);
      }

      emitted.delete("EFFX0010");

      const legacy = bundledDiagnosticEntries
        .filter((entry) => entry.code !== "EFFX0010")
        .map((entry) => entry.code)
        .toSorted();

      assert.deepStrictEqual([...emitted].toSorted(), legacy);
    }).pipe(Effect.provide(BunServices.layer)),
  );
});
