# ADR 0006: `@Query` is a semantic claim, not a purity proof

Status: accepted (2026-10-03)

## Context

Two handlers can share `A`, `E`, `R` while one reads and one writes. Types cannot prove
read-only semantics.

## Decision

`Query` and `Command` are the only MVP operation kinds. `Query` means "the developer declares
observational semantics". The compiler checks only what it can know:

| Query doing …                                                       | Result            |
| ------------------------------------------------------------------- | ----------------- |
| exposed over non-GET HTTP                                           | `EFFX2401` error  |
| calling a Command / write-classified service / write lease (future) | error/warn        |
| arbitrary raw Effect                                                | unknown; no claim |

## Consequences

- No `Mutation`/`Action` enum members; client-side mutation is a projection of `Command`.
- Query checks are analyses over the IR, added without touching interpreters.
