---
"@effx/cli": minor
"@effx/compiler": minor
---

Add the `effx lift` command group (spec 0019 section 4): `--group`, `--module`, `--form verbose|dense|both`, `--check`, `--emit-patch`, `--write` and `--json` over the selected extension registry, which is required and has no default. Every surface prints the same printer bytes. `--write` creates a new file and refuses an existing one untouched, `--emit-patch` prints a unified diff and applies nothing, and `--json` prints one Schema-encoded report. The default lift runs no application module and writes nothing.

Add the native `--check`. A scoped overlay of the owning project holds the verified refactor results and the printed suggestion. The real frontend collects that text, the compiler generates a contract, and one static witness child reflects the unmodified original group and the generated group, each alone on a fresh root that reuses the original root's identity. Only the closed deltas `ref-suffix`, `explicit-default-identifier` and `endpoint-order` are tolerated. The binding gate compares the original model's complete key set with the generated group's and needs an executed zero-exit typecheck of the generated handler skeleton against the actual original root; missing evidence is never accepted. Inability is `EFFX3103` data, a real wire difference is `EFFX3101`, a binding gap is `EFFX3201`, and exit code 2 means the check did not pass. The check executes application modules in native children and is not a sandbox.

`@effx/compiler` exports the strict `ReflectionPair` and identifier witness, the exact delta normalizers and `wireCompare`, the check outcome surface (`FormOutcome`, `BindingConclusion`, `LiftCheckResult`, `CheckReason`) and the group key reader `checkFactsOf`/`groupKeysOf`. The lift config keeps the explicit `lift` block of `effx.config.ts` and its projection references as inert data.
