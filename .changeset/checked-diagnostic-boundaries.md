---
"@effx/compiler": patch
---

Replace string-code diagnostic helpers with typed entry factories. Compiler entry points now reject malformed, duplicate and reserved custom registry declarations before frontend analysis, and recursively check callback diagnostics against their registered severity policies before reporting or generation. Extension annotation duplicate overrides now accept a typed diagnostic callback instead of a code string. Existing diagnostic wire fields and manifest versions are unchanged.
