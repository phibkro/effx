---
"@effx/compiler": patch
"@effx/cli": patch
---

Apply explicit HTTP response statuses to existing WithHeaders envelopes instead of cloning their body schemas. Header-bearing 200 and 201 responses can now share one OpenAPI component; redundant status-only `_1` components disappear and their references point to the shared component. Statuses, response headers, body JSON, bare responses, canonical IR and semantic hashes are unchanged.
