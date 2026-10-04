# effx documentation for LLMs

effx is an ahead-of-time (AOT) application compiler for Effect v4. You declare
operations with TC39 decorators or builder chains. A source frontend turns both
into identical annotations, extensions interpret them into a Schema-defined
intermediate representation (IR), analyses check the IR graph, and generators
emit **ordinary Effect** (`HttpApi`, `Rpc`, CLI commands, typed clients,
Foldkit commands).

effx is the on-ramp from enterprise frameworks (NestJS, ASP.NET Core, Laravel) to
full-stack Effect: a familiar declarative surface on top, ordinary inspectable
Effect underneath, no lock-in (ADR 0012). Every annotation maps to a named Effect
construct, generated code stays readable and ejectable, and hand-written Effect
always coexists with declared operations.

```
 decorators / builder  ──►  annotations  ──►  IR (Schema, graph)  ──►  analyses  ──►  generated Effect
 (source syntax only)       (name, args)      (canonical JSON, hash)   (diagnostics)   (ordinary files)
```

## The invariant

**A decorator is a contribution to the IR, never generated behaviour.**
Decorators return `undefined` and never wrap or replace your code. Generated
output is ordinary Effect code you can read and typecheck, and effx has no
runtime dependency-injection layer (ADR 0001, ADR 0008).

## Where to look things up

Look in this order and stop at the first source that answers:

1. This documentation, including the examples (they are typechecked).
2. `node_modules/@effx/runtime/dist/Annotation.d.ts` (shipped declarations) for the exact option types of
   every annotation (`HttpContractOptions`, `HttpGroupOptions`,
   `HttpAccessOptions`, `HttpProblemsOptions`, `FoldkitCommandOptions`, ...), then
   `decorators.d.ts` and `builder.d.ts` beside it.
3. The specs in the effx repository: `docs/specs/NNNN-*.md` (frozen
   contracts) and `docs/decisions/NNNN-*.md` (ADRs). `STATE.md` records which
   slices are implemented; treat anything not marked as built as unavailable.

Effect itself is documented in `node_modules/effect/AGENTS.md` and the
`ai-docs` examples it links, then `node_modules/effect/src/<Module>.ts` for
exact signatures. **Never write Effect from memory**: Effect v4 names differ
from v3 (for example `Context.Service`, `Effect.fn`, `Effect.catch`,
`Schema.TaggedError<X>()("Tag", fields)`).

## effx and Effect

- Write handlers, services and layers as native Effect: `Effect.gen` /
  `Effect.fn`, `Context.Service`, `Layer`, Schema-defined errors. Plain pure
  functions stay plain functions.
- No `async` / `await` and no Promise boundary in effx-facing code. No
  `JSON.parse` outside a Schema codec.
- Handler types drive the contract. `E` and `R` are **inferred** from the
  handler's return type; `@Errors` / `@Requirements` only **assert** them
  (ADR 0005). A declaration-only (`.declare()`) operation is the exception: it
  has no handler, so they are declarations.
- Everything an annotation names (Schemas, services, middleware markers,
  registries, annotators, scope resolvers, message schemas) must be an
  **exported** value. The compiler reads symbols statically and never runs
  your module.
- Provide services with `Layer`s you compose at your application's edge. effx
  does not provide or resolve services for you.
- Use TC39 standard decorators (do not enable `experimentalDecorators`) and
  `.ts` import specifiers.
- effx does not authorize requests. Access annotations are data; your
  application evaluates them (ADR 0007 defers authority evaluation).
- Generated code lands in `.effx/generated/` next to the tsconfig you pass to
  `effx build --project <tsconfig>`. Do not edit it; change the declaration and
  rebuild.

## Commands

| Command                    | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `effx check`               | diagnose without writing                             |
| `effx build`               | write projections (`--emit=contract\|handlers\|all`) |
| `effx inspect <operation>` | show an operation's contract and exposures           |
| `effx graph [name]`        | print a Mermaid graph                                |

Shared flags: `--project <tsconfig>`; compile flags: `--strict-access`,
`--target`, `--emit` (`packages/cli/src/main.ts`).

## Sections

| Section                     | Covers                                                                 |
| --------------------------- | ---------------------------------------------------------------------- |
| Declaring operations        | decorator and builder operations, annotation equivalence               |
| Declaration-only operations | `.declare()` and external binding by the application                   |
| Group defaults              | `Http.group` / `@Http.Group` shared middleware, problems, access       |
| Problems and access         | `Http.Problems` registries, `Http.Access` capabilities and concealment |
| Foldkit commands            | `Foldkit.Command` and command identity                                 |
| Custom extensions           | the `Extension` contract (config loading is not landed)                |

**Note**: the examples contain comments for illustration. In practice you
would not include these comments in your code.
