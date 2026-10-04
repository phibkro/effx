import ts from "@typescript/typescript6";
import { defineConfig } from "vitest/config";

/**
 * Vite's oxc transform cannot lower TC39 (non-legacy) decorators yet, and vitest evaluates
 * modules through vm, which bypasses Bun's transpiler. Files that use decorators are lowered
 * with TypeScript 6's transpileModule (ES2022 output, standard decorator semantics).
 */
const standardDecorators = {
  name: "effx:standard-decorators",
  enforce: "pre" as const,
  transform(code: string, id: string) {
    if (!id.endsWith(".ts") || id.includes("/node_modules/") || !/^\s*@[A-Za-z_$]/m.test(code)) {
      return null;
    }

    const output = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        experimentalDecorators: false,
        verbatimModuleSyntax: true,
        sourceMap: true,
      },
    });

    return { code: output.outputText, map: output.sourceMapText ?? null };
  },
};

export default defineConfig({
  plugins: [standardDecorators],
  test: {
    // Source-frontends and rc target tests compile large TypeScript programs and share generated
    // fixture directories; running their files together can overrun the real-server test deadline.
    fileParallelism: false,
    projects: [
      {
        extends: true,
        test: {
          name: "compiler-integration",
          include: [
            "packages/frontend-ts/test/**/*.test.ts",
            "packages/cli/test/**/*.test.ts",
            "examples/extension-openapi-tags/test/extension.test.ts",
          ],
          testTimeout: 60_000,
        },
      },
      {
        extends: true,
        test: {
          name: "default",
          include: [
            "packages/*/test/**/*.test.ts",
            "examples/*/test/**/*.test.ts",
            "tools/conventions/tests/**/*.test.ts",
          ],
          exclude: [
            "packages/frontend-ts/test/**/*.test.ts",
            "packages/cli/test/**/*.test.ts",
            "examples/extension-openapi-tags/test/extension.test.ts",
          ],
          testTimeout: 5_000,
        },
      },
    ],
    alias: {
      "@effx/ir": new URL("./packages/ir/src/index.ts", import.meta.url).pathname,
      "@effx/compiler": new URL("./packages/compiler/src/index.ts", import.meta.url).pathname,
      "@effx/frontend-ts": new URL("./packages/frontend-ts/src/index.ts", import.meta.url).pathname,
      "@effx/runtime": new URL("./packages/runtime/src/index.ts", import.meta.url).pathname,
      "@effx/cli/config": new URL("./packages/cli/src/config.ts", import.meta.url).pathname,
      "@effx/cli": new URL("./packages/cli/src/index.ts", import.meta.url).pathname,
    },
  },
});
