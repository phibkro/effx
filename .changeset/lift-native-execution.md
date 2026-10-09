---
"@effx/cli": minor
---

Add the root-owned native execution capability for `effx lift --check`: each child receives only explicit arguments/cwd and the reviewed empty environment, both output pipes drain concurrently into bounded captures, typecheck receipts retain stdout and stderr diagnostics, and forced stops wait for process-group escalation and observed exit before returning real partial output/duration facts. The real Bun child custody suite now runs as part of `bun run test`.
