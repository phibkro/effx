import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

/**
 * Spec 0020 §2.1 and §3 gate 5: `@effx/runtime` is the syntax half and application bundles import
 * it, so its import graph may reach `effect` and its own relative modules, never `@effx/compiler`,
 * `@effx/ir` or any other workspace package.
 */

const srcRoot = new URL("../src/", import.meta.url).pathname;

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const specifierPattern =
  /\b(?:import|export)\b[^"'`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

/** Every import/export/dynamic-import specifier of a module, comments excluded. */
export const specifiersOf = (source: string): ReadonlyArray<string> =>
  Array.from(stripComments(source).matchAll(specifierPattern), (match) =>
    String(match[1] ?? match[2] ?? match[3]),
  );

const isAllowed = (specifier: string): boolean =>
  specifier === "effect" || specifier.startsWith("effect/") || /^\.\.?\//.test(specifier);

describe("@effx/runtime import graph", () => {
  it("the scanner finds every specifier form and rejects workspace packages", () => {
    const source = [
      'import { a } from "effect";',
      'import type { B } from "@effx/compiler";',
      'export * from "./x.js";',
      'export { c } from "@effx/ir";',
      'import "node:fs";',
      'const d = await import("@effx/cli");',
      "import {",
      "  e,",
      '} from "effect/Schema";',
      '// import { f } from "@effx/commented";',
      '/* export * from "@effx/blocked"; */',
    ].join("\n");

    assert.deepStrictEqual(specifiersOf(source), [
      "effect",
      "@effx/compiler",
      "./x.js",
      "@effx/ir",
      "node:fs",
      "@effx/cli",
      "effect/Schema",
    ]);
    assert.deepStrictEqual(
      specifiersOf(source).filter((s) => !isAllowed(s)),
      ["@effx/compiler", "@effx/ir", "node:fs", "@effx/cli"],
    );
  });

  it.effect(
    "every module under packages/runtime/src imports only effect and relative modules",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const files = (yield* fs.readDirectory(srcRoot, { recursive: true }))
          .filter((file) => file.endsWith(".ts"))
          .sort();

        assert.isAbove(files.length, 0);

        const violations: Array<string> = [];

        for (const file of files) {
          const source = yield* fs.readFileString(path.join(srcRoot, file));

          for (const specifier of specifiersOf(source)) {
            if (!isAllowed(specifier)) violations.push(`${file}: ${specifier}`);
            else if (specifier.startsWith(".")) {
              const target = path.resolve(path.dirname(path.join(srcRoot, file)), specifier);
              const inside = path.relative(srcRoot, target);
              const ts = target.replace(/\.js$/, ".ts");

              if (inside.startsWith("..")) violations.push(`${file}: ${specifier} leaves src/`);
              else if (!(yield* fs.exists(ts))) violations.push(`${file}: ${specifier} not found`);
            }
          }
        }

        assert.deepStrictEqual(violations, []);
      }).pipe(Effect.provide(BunServices.layer)),
  );
});
