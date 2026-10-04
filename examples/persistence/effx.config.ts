import { defineConfig } from "@effx/cli/config";
import { persistenceExtension } from "@effx/persistence/compiler";

export default defineConfig({
  project: "tsconfig.effx.json",
  outDir: ".effx/generated",
  extensions: [persistenceExtension],
  generators: { foldkit: false },
});
