# ADR 0009: The TypeScript 6 frontend is a registered exception

Status: accepted (2026-10-03)

## Context

The repository is checked with TypeScript 7.0.2 (Go `tsc`, via `@effect/tsgo`). TS7 has no
JavaScript `Program`/`TypeChecker` API and `@typescript/api` is unpublished. The last
TypeScript with a JS compiler API is `@typescript/typescript6@6.0.2`.

## Decision

| Aspect             | Rule                                                                                                                                                                                                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope              | `packages/frontend-ts` only, behind the `SourceFrontend` service; no `ts.*` leaves it (ADR 0001)                                                                                                                                                                        |
| Dependency         | `@typescript/typescript6@6.0.2`, pinned exactly                                                                                                                                                                                                                         |
| Version skew       | analysis runs at TS 6.0.2; the typecheck gate runs TS 7.0.2. The frontend MUST emit `EFFX0001` (info; warning when majors differ) reporting `ts.version` vs the project's `typescript` pin. tsgo/tsc remains the authoritative gate; effx never claims type correctness |
| Retirement trigger | a Go-backed `SourceFrontend` becomes available (tsgo `--api` server or an effect-tsgo fork exposing program/type queries)                                                                                                                                               |

## Consequences

- TS-API churn is contained to one package; the kernel and generators never change for it.
- A declaration that TS 6 and TS 7 type differently shows up as an `EFFX0001` hint next to the
  kernel's diagnostics, not as silent drift.
