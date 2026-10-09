import { defineConfig } from "vitest/config";
import base from "../../vitest.config.ts";

const { projects: _projects, ...test } = base.test ?? {};

// Run explicitly after the portable and asset slices are integrated. No tests
// execute during module construction, building, or native-asset installation.
export default defineConfig({
  ...base,
  test: {
    ...test,
    include: [
      "scripts/test/lsp-linux.test.ts",
      "scripts/test/lsp-linux-extra.test.ts",
      "scripts/test/lsp-linux-sigpipe.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
