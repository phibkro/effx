# ADR 0011: Config is an explicit compiler execution boundary

Status: accepted (2026-10-04)

## Context

ADR 0001 forbids importing application modules to infer source declarations. A TypeScript config can supply executable extension interpreters, analyses, and generators. Obtaining those functions requires evaluating one module; static source collection cannot provide them (`docs/decisions/0001-aot-compilation-is-authoritative.md`; `packages/frontend-ts/src/collect.ts`; `packages/compiler/src/Extension.ts`).

## Decision

The CLI loads `effx.config.ts` only when it is discovered beside the selected tsconfig or explicitly chosen with `--config`. This is the CLI's **only direct import of a user module**. The config author owns the code it imports, including any third-party extension. The CLI does not import application operations, schemas, handlers, or services. The frontend still reads application source with TypeScript's compiler API without running it.

A config is trusted executable build input, **not sandboxed data**. An absent config preserves the no-user-module-execution behavior. Config values and generator switches choose compiler inputs and output policy; they do not enter semantic IR. Custom Extension nodes enter IR only through their interpreters. `@effx/cli/config` exports a pure config authoring helper and does not launch the CLI process.

## Consequences

- A config can execute arbitrary code through its own imports. Project owners review that code as they review build scripts. The compiler promises only that _it_ imports no application module.
- Config import failures become typed CLI failures before output files are written. An invalid extension list never falls back silently to built-ins.
- Tests record one config evaluation and no application-module evaluation during an extension-backed build. A default build imports neither config nor application code when no config exists.
- `@effx/cli/config` imports Extension types from published `@effx/compiler`; extension IR types come from published `@effx/ir`. Neither package is redeclared in the config helper. The TypeScript frontend remains private inside the CLI.
