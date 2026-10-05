import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

/** The syntax package may reach Effect and the approved Effect-only diagnostics leaf (spec 0016), never the compiler or IR. */

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

const isAllowed = (specifier: string, diagnostics = false): boolean =>
  specifier === "effect" ||
  specifier.startsWith("effect/") ||
  /^\.\.?\//.test(specifier) ||
  (diagnostics && specifier === "@effx/diagnostics");

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
    assert.isTrue(isAllowed("@effx/diagnostics", true));
    assert.isFalse(isAllowed("@effx/diagnostics"));
    assert.isFalse(isAllowed("@effx/compiler", true));
  });

  it.effect(
    "runtime reaches only the approved diagnostics leaf and the leaf reaches only Effect",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const roots = [
          { name: "runtime", directory: srcRoot, diagnostics: true },
          {
            name: "diagnostics",
            directory: new URL("../../diagnostics/src/", import.meta.url).pathname,
            diagnostics: false,
          },
        ];

        const violations: Array<string> = [];

        for (const root of roots) {
          const files = (yield* fs.readDirectory(root.directory, { recursive: true }))
            .filter((file) => file.endsWith(".ts"))
            .toSorted();

          assert.isAbove(files.length, 0);

          for (const file of files) {
            const source = yield* fs.readFileString(path.join(root.directory, file));

            for (const specifier of specifiersOf(source)) {
              if (!isAllowed(specifier, root.diagnostics))
                violations.push(`${root.name}/${file}: ${specifier}`);
              else if (specifier.startsWith(".")) {
                const target = path.resolve(
                  path.dirname(path.join(root.directory, file)),
                  specifier,
                );

                const inside = path.relative(root.directory, target);
                const ts = target.replace(/\.js$/, ".ts");

                if (inside.startsWith(".."))
                  violations.push(`${root.name}/${file}: ${specifier} leaves src/`);
                else if (!(yield* fs.exists(ts)))
                  violations.push(`${root.name}/${file}: ${specifier} not found`);
              }
            }
          }
        }

        assert.deepStrictEqual(violations, []);
      }).pipe(Effect.provide(BunServices.layer)),
  );
});
