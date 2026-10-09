/**
 * @title Registering extensions in effx.config.ts
 *
 * The CLI evaluates the selected config and its imports. It default-exports
 * `defineConfig(...)` from `@effx/cli/config`. A hand-written `Extension` and an extension built
 * from typed definitions register the same way.
 */
import { defineConfig } from "@effx/cli/config";
import { appExtension } from "./05_implement-annotation.ts";
import { auditExtension } from "./10_hand-written-extension.ts";

// Keep this module, and everything it imports, free of application code: the CLI executes it,
// and spec 0015 forbids evaluating the application modules that declare operations. A definition
// module is a leaf that imports only `effect` and `@effx/runtime`, so it is safe to import here
// (spec 0020, EFFX1306).
export default defineConfig({
  // Optional; relative paths resolve from the directory of this file.
  project: "tsconfig.json",

  // Semantic input (spec 0024 §5): both emit passes must use the same data pattern.
  naming: { problemIdentifier: "{Group}{Key}Problem" },

  // Cover all otherwise-unobserved executable routes, not just dynamic imports.
  // Paths resolve beside this config. Launch declarations add pre-import coverage.
  // This example has local relative extension helpers; package aliases need their own routes.
  executableCoverage: {
    files: ["package.json"],
    directories: [{ path: ".", recursive: false }],
  },
  // An array APPENDS to the built-in extensions. Pass a callback instead to see the built-ins
  // and return the complete, ordered list: `(builtin) => [...builtin, auditExtension, appExtension]`.
  extensions: [auditExtension, appExtension],

  // File emission only: a toggle never changes interpretation, analyses, the IR or its hash.
  // Omitted means enabled. Generators from custom extensions are never toggled here.
  generators: { foldkit: false },
});
