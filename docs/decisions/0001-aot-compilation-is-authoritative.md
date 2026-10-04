# ADR 0001: AOT compilation is authoritative

Status: accepted (2026-10-03)

## Context

Runtime decorators cannot recover erased TypeScript types, require executing application
modules, and are hostage to TC39 decorator churn (core decorators Stage 2.7, metadata Stage 3
as of the research report). `E`/`R` inference needs the TypeChecker.

## Decision

| Layer                                            | Role                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------- |
| Source syntax (`@Query`, `Operation.query(...)`) | recognized by the AOT collector; both lower to identical `Annotation`s          |
| Runtime decorators / builders (`@effx/runtime`)  | standards-compatible no-ops or metadata; never the source of truth              |
| Compiler (`@effx/compiler`)                      | interprets annotations into IR; generates separate files, never rewrites bodies |

Rule: **decorator = contribution to semantic IR, never generated behaviour.**

## Consequences

- The frontend is isolated behind `SourceFrontend` (`Collected` is frontend-neutral).
- Methods on classes are the MVP decorator target; `@Service interface` sugar is deferred.
- Decorator-spec changes touch `@effx/runtime` and the collector only.
