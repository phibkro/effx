/**
 * @title Registering the persistence compiler extension
 *
 * The syntax module stays runtime-importable. The compiler half is selected by
 * the one config module the CLI evaluates (specs 0015, 0020 and 0022).
 */
import { defineConfig } from "@effx/cli/config";
import { persistenceExtension } from "@effx/persistence/compiler";

export default defineConfig({
  project: "tsconfig.json",
  extensions: [persistenceExtension],
});
