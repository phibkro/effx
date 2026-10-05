---
"@effx/diagnostics": minor
"@effx/compiler": minor
"@effx/runtime": minor
"@effx/cli": minor
"@effx/persistence": minor
---

Add a Schema-defined diagnostic registry and typed entry factories, offline `effx explain` with explicit extension config lookup, and a generated diagnostic catalogue shared by the docs site and installed AI guidance. Migrate all compiler and extension emitters to registered entries without changing existing diagnostic bytes or generated application outputs. The public string-code helpers are removed; extension authors register package-qualified entries and typed factories.

Catalogue index links use the site's compiled heading-ID convention, with a regression at the actual compiled-content boundary. Phase-sensitive and strict-access severity outcomes have one registry-owned policy authority for emission and validation.
