# Spec 0033 — Every default-on Effect diagnostic is an error

Status: **frozen 2026-10-27.** Operator decision: "all effect tsgo/lsp warnings should be raised to errors". The same policy as Vektorprogrammet spec 0006a, applied to effx's own configuration.

## 1. Problem

`tsconfig.effect-stability.json`, the base every project extends, carried `"diagnostics": false` for the `@effect/language-service` plugin. The language service reported nothing, so `bun run typecheck` (the patched `tsc`) and `bun run effect:diagnostics` could not fail on a diagnostic. The rules reached the gate only through Oxlint, as the `recommended` and `correctness` presets of `@effect/tsgo`, and nothing asserted that this set covers every rule that is on by default.

Measured on `ce9c164d` (Effect 4.0.6, `@effect/tsgo` 0.48.0) with the plugin on and every default-on rule at `error` (82 of 118 rules: 13 `error`, 19 `warning`, 50 `suggestion` by default):

| Project                                                                                                                      | Findings                                           |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| root `tsconfig.json` (510 files), `tools`                                                                                    | 0                                                  |
| generated `.effx/` output of `examples/users` and `examples/persistence`, and the tracked golden `client-foldkit-generated/` | 109 `unstableApiUsage`, 14 `unnecessaryTypeofType` |

The patched `tsc` reaches the generated files through imports (`examples/persistence/src/server.ts`, `client-foldkit.test.ts`), so `bun run typecheck` failed with 123 errors the moment the plugin was on.

## 2. Contract

1. **The language service is on and every default-on diagnostic is an error.** The `diagnosticSeverity` map of the plugin entry in `tsconfig.effect-stability.json` lists exactly the diagnostics whose installed default is not `off`, each at `error`. `tools/conventions/effect-diagnostics.ts` derives the list from `node_modules/@effect/tsgo/schema.json`; `bun run effect:sync` writes the map; a test fails when the file differs. A default-off rule stays unlisted.
2. **Oxlint agrees.** `oxlint.config.ts` spreads the same set, under its `effecttsgo/<kebab-name>` names (matched against `oxlint-schema.json`; a diagnostic without a rule throws at load), after the `effectNative` switch-off, so `effecttsgo/abort-controller-in-effect`, which both lists contain, is an error in every file. No override lowers one.
3. **`bun run effect:diagnostics` covers every project that carries the policy:** the root, `tools`, `examples/users`, `examples/persistence`, `examples/domain-model` and `examples/extension-openapi-tags` (which now extends the policy file). `--strict` fails on a warning or message too.
4. **Source is fixed, not allowed.** Findings in hand-written source: none. One finding class in generated output is a generator defect, fixed there: the persistence port and conformance suite emitted `typeof X.Type`, which the language service rewrites to `X` when `X` is a class, and the generator cannot tell a class from a struct. It now emits `Schema.Schema.Type<typeof X>`, correct for both.
5. **Generated output may use the unstable modules it is made of (EX-0039).** Generated projections are ordinary Effect (ADR 0008): `HttpApi`, `Rpc`, `HttpClient`, `effect/cli`. One scoped override, `include: ["**/.effx/**/*.ts", ".*/**/.effx/**/*.ts"]` (the second pattern is for generated output in a dot-directory sandbox such as the persistence acceptance workspace `.persistence-acceptance-*`, which `**` does not enter), extends the allowlist with `effect/cli`, `effect/http`, `effect/http-api`, `effect/net` and `effect/rpc`. Hand-written source keeps the allowlist of EX-0037, and the override does not lower any severity.

## 3. Falsifiers

1. `bun run gate` exits 0 on the committed head.
2. **Rule coverage, editor:** lowering one default-on rule in `tsconfig.effect-stability.json` fails `tools/conventions/tests/effect-diagnostics.test.ts`.
3. **Rule coverage, lint:** a lower setting for one default-on rule in `oxlint.config.ts`, top level or in an override, fails the same test.
4. **New rules:** the test reads the installed schema itself and compares it with the derivation and with both configurations, so a rule that an upgrade turns on fails until `bun run effect:sync` runs.
5. **Unstable scope:** an unlisted unstable module used in `packages/ir/src` fails `bun run typecheck`; removing it passes.
6. The persistence generator tests assert the new type form, and the generated files of `examples/persistence` pass `bun run effect:diagnostics`.

## 4. Out of scope

- Default-off rules. `effectNative` keeps its present lint scope, and the editor config does not mirror it.
- Emitting a `@effect-diagnostics` directive in generated headers. It would change the generated bytes of every consumer. A consumer that runs the language service sees the unstable modules of generated files until it allows them; EX-0039 names this as its retirement path.

## Revisions

- R1 (2026-10-27, PR review). Supersedes §2 items 1, 3 and 5 and the first bullet of §4 where they differ.
  1. **Editor set equals lint set.** The editor map holds every default-on diagnostic plus the rules the `recommended` and `correctness` presets enable (`anyUnknownInErrorContext`, `unsafeEffectTypeAssertion`, which are default-off), as Vektorprogrammet 0006a R5 does. The `effectNative` rules that are not already in it go in the `diagnosticSeverity` of one override, `packages/**`, `examples/**`, `ai-docs/**`, the scope of `oxlint.config.ts`. `bun run effect:sync` writes both maps; the test compares both. The two remaining differences are Oxlint's per-group rule selection of the `@phibkro/oxlint-effect-plugin` (`effect/*` rules, not `effecttsgo/*`) and rules that exist only in one tool.
  2. **No project may replace the policy.** `plugins` arrays do not merge across `extends`, so a tsconfig that declares its own `@effect/language-service` entry drops the severity map and the allowlists. The conventions test fails for any tsconfig outside fixtures and `apps/docs` that declares `compilerOptions.plugins`, other than the policy file, and for any project in `scripts/effect-diagnostic-projects.txt` whose `extends` chain does not reach the policy file.
  3. **A disabled run cannot look clean.** `bun run effect:diagnostics` builds the example projections, then runs every project in `scripts/effect-diagnostic-projects.txt` (a failure does not stop the later projects) and, for each, a scratch project that extends it and holds `scripts/effect-canary.txt`. The canary uses `effect/process`, whose rule `unstableApiUsage` is `warning` by default, and must be reported as an `error`. A language service that is off, a lost severity map or an allowlist that admits `effect/process` fails the gate. The conventions test also covers the derivation's failures with schema fixtures (a default-on diagnostic with no Oxlint rule, a preset rule with no diagnostic).
  4. **EX-0039 lists modules, not subtrees:** the 24 modules the generators emit (`effect/rpc` as a subtree would admit `RpcTest`). A new module a generator emits fails the gate until it is added to the record and the override.
  5. `packages/cli/src/lsp-transport.ts` carries a file-level `@effect-diagnostics newPromise:off` naming EX-0030: the editor rule, now on, reports its two `new Promise` sites. Oxlint's `effecttsgo/new-promise` honours the same directive, so the two per-line `effecttsgo/new-promise` suppressions became unused and were removed.
  - Falsifiers added: a tsconfig with its own plugin entry fails the conventions test; `diagnostics: false` in the policy, a widened allowlist (`effect/process`) and `unstableApiUsage` lowered to `warning` each fail `bun run effect:diagnostics` through the canary; lowering a preset rule in the editor map fails the test.
