---
"@effx/cli": minor
"@effx/compiler": minor
---

Add `effx cedar`, an opt-in command that projects capabilities and access contracts to a Cedar schema and policy templates under `.effx/cedar/` and validates them with the real Cedar validator (spec 0017). `@effx/compiler` exports the pure projection (`cedarOf`, `DEFAULT_CEDAR_NAMESPACE`, `AccessContractProjection`) and the `EFFX4101`–`EFFX4107` diagnostics. `@effx/cli` gains an optional peer dependency on `@cedar-policy/cedar-wasm` 4.13.0, loaded only by `effx cedar`; `check` and `build` never import it. The command evaluates no request and issues no lease.
