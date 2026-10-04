/**
 * @title Registering the extension in effx.config.ts
 *
 * The CLI evaluates exactly one user module: the selected config. It default-exports
 * `defineConfig(...)` from `@effx/cli/config`.
 */
import { defineConfig } from "@effx/cli/config";
import { auditExtension } from "./01_audit-extension.ts";

// Keep this module, and everything it imports, free of application code: the CLI executes it,
// and spec 0015 forbids evaluating the application modules that declare operations.
export default defineConfig({
  // Optional; relative paths resolve from the directory of this file.
  project: "tsconfig.json",

  // An array APPENDS to the built-in extensions. Pass a callback instead to see the built-ins
  // and return the complete, ordered list: `(builtin) => [...builtin, auditExtension]`.
  extensions: [auditExtension],

  // File emission only: a toggle never changes interpretation, analyses, the IR or its hash.
  // Omitted means enabled. Generators from custom extensions are never toggled here.
  generators: { foldkit: false },
});
