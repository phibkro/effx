---
"@effx/compiler": patch
"@effx/cli": patch
---

Allow cold contract emission when an authored HTTP root imports its not-yet-generated group contract. Prove concrete endpoint inventories only for handler emission; an unresolved leaf rejects its whole root with one EFFX2415 naming that leaf. Contract generation retains root and declaration checks, and all-mode builds remain atomic on failure.
