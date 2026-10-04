---
"@effx/compiler": minor
"@effx/cli": minor
---

Resolve readonly const string-tuple spreads in HTTP problem code lists through imports, re-exports and nested spreads. Runtime initializers supply the codes; contradictory tuple assertions, dynamic operands and cycles produce EFFX1102 diagnostics. Preserve spread locations in manifest-only provenance without changing canonical IR or semantic hashes.

Check every underlying alias hop and tuple literal before surrounding assertions; casting a mutable array to a readonly tuple does not make it a resolvable const tuple.
