---
name: effx
description: effx declarations (decorators or builder chains) that compile to ordinary Effect. Use when adding or changing an operation, HTTP/RPC/CLI exposure, access or problem declarations, or `effx check`/`effx build` output.
---

effx is an AOT compiler for Effect v4. You declare operations with decorators or builder chains;
`effx build` writes ordinary Effect (`HttpApi`, `Rpc`, CLI commands, client, Foldkit commands) into
`.effx/generated/`. A declaration is a contribution to the compiler's IR, never behaviour.

## Lookup order

Stop at the first source that answers.

1. `node_modules/@effx/runtime/AGENTS.md` (the generated effx guide) and the `ai-docs/src/...` examples it links. They are type-checked.
2. `node_modules/@effx/runtime/dist/Annotation.d.ts`: exact option types for every annotation (the package ships declarations, not sources). Then `decorators.d.ts`, `builder.d.ts` beside it.
3. The effx specs (`docs/specs/NNNN-*.md`) and ADRs (`docs/decisions/NNNN-*.md`). A feature without a spec or a source path is unavailable.
4. Effect itself: `node_modules/effect/AGENTS.md`, then `node_modules/effect/src/<Module>.ts`. Never write Effect from memory.

## Annotation or plain Effect?

| Situation                                                                | Use                                                                   |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| A Query or Command reachable over HTTP, RPC, CLI, or a generated client  | effx declaration (`@Query`/`@Command` + exposure)                     |
| Shared middleware, problems, access across a group of endpoints          | `Http.group` / `@Http.Group` defaults                                 |
| Operation implemented elsewhere (another service, hand-written endpoint) | `.declare()` + external binding                                       |
| Handler bodies, services, layers, schemas, config, persistence           | plain Effect: write them as you always do                             |
| An endpoint shape effx cannot express                                    | hand-written `HttpApi` next to the generated one; raw Effect coexists |

## Rules

- Handlers and services are native Effect. `E` and `R` are inferred from the handler; `@Errors`/`@Requirements` assert them (ADR 0005).
- Everything an annotation names (Schemas, services, registries, annotators) must be an exported value. The compiler reads symbols statically and never runs your module.
- Do not edit `.effx/generated/`. Change the declaration and run `effx build`.
- effx does not authorize requests: `Http.Access` is data your application evaluates (spec 0006, ADR 0007).
- Use standard (TC39) decorators, not `experimentalDecorators`; use `.ts` import specifiers.
- Run `effx check` after every declaration change. Diagnostics are data: read the code (`EFFX####`) and the spec it cites.

## Commands

| Command                    | Purpose                                                     |
| -------------------------- | ----------------------------------------------------------- |
| `effx check`               | diagnose without writing                                    |
| `effx build`               | write projections (`--emit`, `--target`, `--strict-access`) |
| `effx inspect <operation>` | show an operation's contract and exposures                  |
| `effx graph [name]`        | print a Mermaid graph                                       |
