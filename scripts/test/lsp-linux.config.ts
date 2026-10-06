import { defineConfig } from "vitest/config";
import base from "../../vitest.config.ts";

// Run explicitly after the portable and asset slices are integrated. No tests
// execute during module construction, building, or native-asset installation.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: undefined,
    include: [
      "scripts/test/lsp-linux.test.ts",
      "scripts/test/lsp-linux-extra.test.ts",
      "scripts/test/lsp-linux-sigpipe.test.ts",
    ],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
