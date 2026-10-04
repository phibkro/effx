# Spec 0015 — One typed project config and an extension-authoring path

Status: frozen before implementation. This item precedes diagnostic registry, Cedar projection, and watch mode. The source compiler still does not execute application modules (`docs/decisions/0001-aot-compilation-is-authoritative.md`; `packages/frontend-ts/src/collect.ts`; `packages/compiler/src/pipeline.ts`).

## Observable interface

A project MAY place `effx.config.ts` beside the selected tsconfig. The CLI discovers it for `check`, `build`, `inspect`, and `graph`; `--config <path>` chooses one explicitly. An absent discovered file keeps the current defaults. An explicit missing or invalid file fails before compilation. The config module MUST default-export `defineConfig({ ... })` from `@effx/cli/config`:

```ts
import { defineConfig } from "@effx/cli/config";

export default defineConfig({
  project: "tsconfig.effx.json",
  outDir: ".effx/generated",
  emit: "contract",
  target: "effect-4.0-rc",
  strictAccess: true,
  extensions: (builtin) => [...builtin, myExtension],
  generators: { http: true, rpc: false, cli: false, client: true, foldkit: false },
});
```

`project`, `outDir`, `emit`, `target`, and `strictAccess` are OPTIONAL. `extensions` is `Extension[] | ((builtin: ReadonlyArray<Extension>) => Extension[])`. The array form **appends** to built-ins; the callback receives built-ins and returns the complete ordered list. `generators` has OPTIONAL Boolean `http`, `rpc`, `cli`, `client`, and `foldkit` fields; omission means enabled. `http: false` disables both HTTP and guard file generators, not HTTP annotation interpretation, validation, or semantic IR. Other toggles disable only their matching built-in file generator; custom extension generators remain enabled. No toggle changes semantic hash (`packages/compiler/src/extensions/index.ts`; `packages/compiler/src/Extension.ts`).

`@effx/cli/config` must import without running the CLI executable and export typed `defineConfig`/`EffxConfig`. Its `Extension` type comes from the **public** `@effx/compiler` package; `@effx/ir` is public for extension authors, while `@effx/frontend-ts` stays private and bundled into the CLI. Curate `@effx/compiler`'s root exports to the extension-facing interface (`Extension`, `Interpreter`, `Analysis`, `Generator`, `Contribution`, `Diagnostic` helpers, `GeneratedFile`, `EmitMode`, `TargetProfile`, `ProjectConfig`, `CompilerFault`, `decodeArgs`, `Extensions.builtin`, `compile`); mark other compiler surfaces internal. The CLI MAY import and evaluate **one** user entry module: the selected config. Its own imports execute by operator choice, but the CLI never imports application operations, schemas, handlers, or services. ADR 0011 records this trust boundary.

## Resolution

| Value         | CLI flag, highest                                 | Config                                     | Existing tsconfig `effx` block | Default                          |
| ------------- | ------------------------------------------------- | ------------------------------------------ | ------------------------------ | -------------------------------- |
| tsconfig      | `--project`                                       | `project`                                  | —                              | `tsconfig.json`                  |
| config module | `--config`                                        | discovery beside the CLI-selected tsconfig | —                              | absent                           |
| outDir        | `--out-dir`                                       | `outDir`                                   | `outDir`                       | `<tsconfig dir>/.effx/generated` |
| emit          | `--emit`                                          | `emit`                                     | `emit`                         | `all`                            |
| target        | `--target`                                        | `target`                                   | `target`                       | installed Effect version         |
| strictAccess  | `--strict-access` or `--no-strict-access`         | `strictAccess`                             | `strictAccess`                 | `false`                          |
| projectRoot   | explicit programmatic `ProjectConfig.projectRoot` | —                                          | existing `projectRoot`         | tsconfig directory               |

`--config` resolves from the working directory. Without it, look beside `--project` or `./tsconfig.json`; if a discovered config sets another `project`, do not discover a second config. Config-relative paths resolve from the config directory; tsconfig `effx` paths resolve from its directory; flag paths resolve from the working directory. Preserve existing `tsconfig.effx.json` `effx.projectRoot` support. Resolve these sources once into a single `ProjectConfig` before `SourceFrontend.analyze`; do not leave different defaults in the CLI and frontend. The output context remains outside semantic IR. The CLI must distinguish an absent Boolean flag from an explicit false.

## Proof of extension authoring

`examples/extension-openapi-tags` (or an equally small example under `examples/`) loads its extension through `effx.config.ts`. Provide one generic runtime-sourced method decorator and builder operation, e.g. `@Annotate("example.deprecated", { reason: "..." })` and `.annotate("example.deprecated", { reason: "..." })`. The TypeScript frontend resolves that generic primitive by the `@effx/runtime` symbol, lowers a literal annotation name and static arguments, and does not execute application code. An unregistered custom name keeps `EFFX1101`.

The external `Extension` interprets that annotation into a Schema-valid `Extension` IR node and `ExtensionOf` edge. Its analysis emits one warning; its generator writes deterministic JSDoc `@deprecated` from IR. A warning does not block generation (`packages/compiler/src/pipeline.ts`). Decorator and builder source lower to identical custom annotation arguments and Extension data/owner edge. Their **full** IR hashes may differ in the authored handler `SymbolRef` (`packages/compiler/src/extensions/core.ts:231`; `packages/frontend-ts/src/collect.ts:612-620`); compare an explicit handler-neutral IR projection, not the full hash. Keep the example runnable without importing application source from config or plugin.

## Falsifiers and gates

1. With no config, the existing users and rc.116 projects retain their generated bytes, hashes, diagnostics, and default output locations. All CLI commands use one resolved project choice; library `compile(ProjectConfig, ...)` still honors the tsconfig `effx.projectRoot` fallback.
2. A precedence fixture exercises each override, including explicit `--no-strict-access`, `--out-dir`, config-specified project, and tsconfig `effx.projectRoot`/`emit`/`target`/`strictAccess`. Invalid/missing explicit config and malformed extension lists fail with a typed compiler diagnostic/fault before files are written.
3. A config execution probe records exactly one config evaluation and zero application-module evaluations. The third-party example check reports a warning; `build` produces its IR edge and generated JSDoc. `@Annotate` and `.annotate` have equal custom annotation/extension payloads and a stated handler-neutral projection hash; do not assert equal full semantic hashes for different authored handlers. Disabling one generator preserves contract validation and the same-source IR/hash.
4. Build and install the packed CLI config entry in an isolated fixture; its JavaScript import does not launch the CLI and its declaration resolves `Extension` without a private workspace. Run focused tests, full `bun run check`, and strict Effect diagnostics on a clean committed worktree. Fast-forward main, pack its exact commit, then remove only clean integrated worktrees and branches. Do not deploy or publish.
