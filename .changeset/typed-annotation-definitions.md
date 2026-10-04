---
"@effx/runtime": minor
"@effx/compiler": minor
"@effx/cli": patch
"@effx/ir": patch
---

Typed annotation definitions (spec 0020) and declaration density (spec 0024, items 1 and 3).

Added: `Annotation.define`, the `A` argument algebra, `A.fromSchema` and `OperationBuilder.with` in `@effx/runtime`; `implement`, `extension`, `dataOf`, `laws`, `Extension.annotations`, `Extension.expand` and `Extension.fragments` in `@effx/compiler`; `Http.headers`; diagnostics `EFFX1301` to `EFFX1304`, `EFFX1306`, `EFFX2410`, `EFFX2411` and `EFFX2414`. The CLI validates the new extension fields; `@effx/ir` extends its Arbitrary adapter.

Breaking (pre-1.0, hence a minor bump): every built-in decorator and builder step is now derived from its definition, and two option types narrow. `Http.Group` `defaults.access` now takes the same value sets as `Http.Access` (non-empty, duplicate-free `acceptedCredentials`, a closed `principalKinds` set, non-empty `NotFound` stages), and `Http.Problems` `codes` is a non-empty tuple. Request channels are derived from an operation's `input` when `Http.Contract` omits them (an ungrouped POST, PUT or PATCH Command without a `payload` now gets one), and `decisionTime` defaults from the operation kind. Generated output, IR and hashes of existing declarations are otherwise unchanged.
