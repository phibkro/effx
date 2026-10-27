---
"@effx/persistence": patch
---

Generated persistence ports and conformance suites spell a schema's decoded type
`Schema.Schema.Type<typeof X>` instead of `typeof X.Type`, which the Effect language
service rewrites to `X` for a class schema (spec 0033). The types are identical.
