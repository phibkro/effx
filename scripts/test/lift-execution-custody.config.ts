import { defineConfig } from "vitest/config";
import base from "../../vitest.config.ts";

const src = (file: string): string => new URL(`../../${file}`, import.meta.url).pathname;

/** Rollup-ordered alias entry: the first find that matches wins. */
interface AliasEntry {
  readonly find: string;
  readonly replacement: string;
}

// Run explicitly: `bun --bun vitest run --config scripts/test/lift-execution-custody.config.ts`.
// No tests execute during module construction: the suite runs real Bun children only while running.
// Aliases are an ordered array (longest first) because vitest's object form lets `@effx/cli`
// swallow the `@effx/cli/lift-boundaries` prefix.
const aliases: Array<AliasEntry> = [
  { find: "@effx/persistence/compiler", replacement: src("packages/persistence/src/compiler.ts") },
  {
    find: "@effx/cli/lift-boundaries",
    replacement: src("packages/cli/src/lift-boundaries.ts"),
  },
  { find: "@effx/runtime/diagnostics", replacement: src("packages/runtime/src/diagnostics.ts") },
  { find: "@effx/persistence/syntax", replacement: src("packages/persistence/src/syntax.ts") },
  { find: "@effx/cli/config", replacement: src("packages/cli/src/config.ts") },
  { find: "@effx/diagnostics", replacement: src("packages/diagnostics/src/index.ts") },
  { find: "@effx/compiler", replacement: src("packages/compiler/src/index.ts") },
  { find: "@effx/frontend-ts", replacement: src("packages/frontend-ts/src/index.ts") },
  { find: "@effx/persistence", replacement: src("packages/persistence/src/index.ts") },
  { find: "@effx/cli", replacement: src("packages/cli/src/index.ts") },
  { find: "@effx/runtime", replacement: src("packages/runtime/src/index.ts") },
  { find: "@effx/ir", replacement: src("packages/ir/src/index.ts") },
];

export default defineConfig({
  ...base,
  resolve: {
    alias: aliases,
  },
  test: {
    include: [
      "scripts/test/lift-execution-custody.test.ts",
      "scripts/test/lift-check-native.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 60_000,
  },
});
