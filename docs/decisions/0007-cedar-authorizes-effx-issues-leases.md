# ADR 0007: Cedar authorizes; effx issues capabilities and leases

Status: accepted, **deferred past MVP kernel** (2026-10-03)

## Context

Authorization must stay a runtime decision (principal/action/resource/context, default deny,
`forbid` overrides `permit`). TypeScript is not a security sandbox.

## Decision

- IR carries `CapabilityNode` (+ `AuthorizedBy` edges) and `FocusNode { root, path }` as
  serializable identities; optics are the runtime mechanism, never the identity.
- Runtime flow (future): Cedar Allow → request-scoped `Lease` → handler → `Lease.modify`.
- Cedar schema is generated from the IR; policy validation becomes `EFFX41xx` diagnostics.

## Consequences

- The kernel only records capability/focus facts; no authorization runtime is built in this slice.
- Lease laws (narrowing, revocation idempotence) are property-test targets for the authority gate.
- Deferred for the mono-web migration: reuse its AccessSpec interpreter with fresh authority
  resolved inside each committing transaction; Cedar and leases stay future work
  (see spec 0004 §3).
