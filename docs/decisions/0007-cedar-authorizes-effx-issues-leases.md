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

## Addendum (2026-10-04): schema/policy projection and validation shipped in 0017

[Spec 0017](../specs/0017-effx-cedar.md) implements the "Cedar schema is generated from the IR; policy
validation becomes `EFFX41xx` diagnostics" decision as the opt-in `effx cedar` command: a pure projection of
the IR's capabilities and access contracts to a Cedar schema and policy templates, validated with the real
Cedar validator (`@cedar-policy/cedar-wasm` 4.13.0). It evaluates no request and issues no lease.

**Runtime authorization and leases are still deferred.** The status above is unchanged: no Cedar `Allow`
is consumed by effx code, `decisionTime` (`SnapshotRead` vs `Transaction`) stays a handler obligation
that Cedar cannot express, and mono-web keeps its transaction-time interpreter (see spec 0004 §3).
