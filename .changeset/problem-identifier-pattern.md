---
"@effx/compiler": minor
"@effx/frontend-ts": minor
"@effx/cli": minor
---

Add the data-only `naming.problemIdentifier` policy from spec 0024 §5. The CLI flag `--naming-problem-identifier` overrides `effx.config.ts`, then the tsconfig `effx.naming` block. Patterns accept only `{Group}`, `{Key}`, `{group}` and `{key}` and require a key placeholder. Invalid patterns or unsafe expansions produce EFFX2412. Derived names with different problem code lists produce EFFX2413; equal lists can share a name. Explicit identifiers remain unchanged.

Configured names enter the semantic problem contract before interpretation. Contract and handlers passes must use the same policy. The manifest records the policy; an omitted policy keeps the existing `<endpointKey>Problem` default and canonical IR bytes. The identity snapshot harness now accepts naming as an explicit semantic input.
