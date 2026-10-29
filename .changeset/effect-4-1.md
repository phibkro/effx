---
"@effx/ir": minor
"@effx/compiler": minor
"@effx/domain-model": minor
"@effx/persistence": minor
"@effx/cli": minor
"@effx/diagnostics": patch
---

Move to Effect 4.1.0. `@effx/ir`, `@effx/compiler`, `@effx/domain-model` and `@effx/persistence` now peer `effect >=4.1.0 <4.2.0` (the next minor may break the unstable `Digest`, `Graph` and `Arbitrary` they use, per Effect's stability policy): `semanticHash` and the lift hashing use `Digest` from `effect/crypto`, which replaces the `effect/Crypto` module that 4.1 removed, so a consumer on Effect 4.0.x cannot load them. `@effx/runtime` and `@effx/diagnostics` keep `>=4.0.0 <5`, and the Effect version of an analysed project stays `>=4.0.0 <5`. The generated client declares `TransportFailure` with the `{ readonly brand: unique symbol }` type argument (accepted by Effect 4.0.0). `UnknownName` in `@effx/cli` names its payload field `subject` instead of `name`, which shadowed the error's own `name`. Conformance vectors and every other generated projection are byte-identical.
