---
"@effx/persistence": minor
"@effx/compiler": patch
---

Add the optional persistence extension (spec 0022): `Persist.Port` declaration
syntax, generated leaf `Context.Service` ports, typed adapter conformance suites
for closed errors, query purity, rollback and shared transactions, and
`EFFX3401`–`EFFX3404` diagnostics. Adapters remain application-owned Layers; no
SQL, migrations, ORM schemas or repository implementation is generated.

The root `gate` prepares both users and persistence generated projections before
typechecking a fresh clone.
