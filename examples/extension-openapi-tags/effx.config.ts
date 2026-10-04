import { defineConfig } from "@effx/cli/config";
import { deprecatedExtension } from "./deprecated-extension.ts";

// Only the selected config and its extension are evaluated by the CLI.
// Neither imports src/operations.ts or its handler.
export default defineConfig({
  project: "tsconfig.json",
  extensions: [deprecatedExtension],
  generators: { http: false, rpc: false, cli: false, client: false, foldkit: false },
});
