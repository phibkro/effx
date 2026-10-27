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
