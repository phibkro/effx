---
"@effx/domain-model": minor
"@effx/compiler": minor
"@effx/cli": minor
"@effx/ir": minor
"@effx/diagnostics": patch
---

Add the `@effx/domain-model` description schema and compiler extension. The extension derives bounded Alloy models and conformance vectors from grants and state machines, with state-bound membership, per-entity stored fields, per-command parameters, a declared clock and warned over-approximations for writes. `effx models check` requires Alloy 6.2.0 and reports counterexamples as diagnostics. Project-level extension roots can own other extension nodes without inventing a source operation.
