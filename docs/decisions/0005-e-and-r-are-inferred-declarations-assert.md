# ADR 0005: E and R are inferred; declarations assert them

Status: accepted (2026-10-03)

## Context

`Effect<A, E, R>` already carries failures and requirements. Re-declaring them would duplicate
a fact the type checker owns.

## Decision

| Source                                | IR                                            | Check                                                |
| ------------------------------------- | --------------------------------------------- | ---------------------------------------------------- |
| handler return type only              | `errors`/`requirements` with `inferred: true` | opaque constituent → diagnostic asking for a mapping |
| `@Errors(...)` / `@Requirements(...)` | `inferred: false`                             | exact set equality against the inferred set          |

Mismatch diagnostics: `EFFX2201` undeclared error, `EFFX2202` declared-but-absent error,
`EFFX2303` stale requirement, `EFFX2302` undeclared requirement.
Errors are schema-addressable (resolve to a runtime Schema); requirements resolve to stable
`service:` ids. Otherwise the compiler diagnoses rather than inventing an id.

## Consequences

- Optional declarations work as assertions; dropping one never silently changes a contract.
- The kernel treats `handlerSignature` as data from the frontend; inference itself lives in `frontend-ts`.
