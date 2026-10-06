---
"@effx/runtime": patch
"@effx/compiler": patch
"@effx/cli": patch
---

Use omitted default-200 status in dense group documentation and separate rc.116 consumer declarations. Keep explicit statuses when overriding a schema annotation (including 200 over 201). Removing redundant 200 changes only the IR status field and semantic hash, not OpenAPI or SDK operation projections; emitted contracts differ only in their status expression and any required import. Preserve the existing explicit-status/verbose identity fixtures and tracked goldens as independent witnesses. No generator behavior changes.
