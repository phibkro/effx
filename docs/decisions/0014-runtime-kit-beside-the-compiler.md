# ADR 0014: A runtime kit of ordinary Effect constructs sits beside the compiler

Status: proposed, parked (2026-10-10)

Parked by the operator on 2026-10-10: for now mono-web builds with rat-stack as its reference (lifecycle machines, the lint fence, the test method) and keeps the command, receipt, audit and delivery constructs as house constructs. The `@rat-stack/*` packages are not published to npm (404 on 2026-10-10), so rat-stack is a source of patterns, not a dependency. This ADR waits for a second consumer of the same construct (spec 0030 §4 item 4). Nothing below is withdrawn.

## Context

ADR 0012 makes effx the enterprise on-ramp to full-stack Effect. It sets two limits: "effx composes the Effect ecosystem; it does not reimplement it", and no effx runtime that executes requests. Where nothing exists, documentation says "gap", not "planned".

The ranked gaps in `docs/research/effect-fullstack-composition.md` §5 are stability (1), migrations and ORM (2), auth maturity (3), a starter (4), Cloudflare jobs (5), Cedar (6), mail (7), realtime (8), admin and testing scaffolds (9) and uploads (10). Its design constraint is that the core stays small and integrations are packages built on `Annotation.define` (spec 0020).

That list has no row for the constructs a command-heavy backend repeats: a transaction runner with declared locks, one receipt and one audit mechanism, one delivery mechanism, an explicit lifecycle. Only "jobs, queues, scheduling" (5) and "testing harness" (9) touch them. No effx package defines such a construct. A search of effx package source trees on 2026-10-10 for lifecycle, `runCommand`, outbox, unit of work, state machine and `xstate` matches one comment, in `packages/cli/src/lsp-transport.ts`.

mono-web is the first real consumer (spec 0004). It has these constructs as specifications, not as code on `main`: `mono-web/docs/specs/commands-and-concurrency.md` (frozen for implementation 2026-09-26), `mono-web/docs/specs/infrastructure-ports.md` (frozen), `mono-web/docs/specs/architecture-consolidation.md` §8 (draft, not approved) and a lifecycle-machines draft (unlanded). Spec 0030 maps these against NestJS, Spring Boot, Laravel, ASP.NET Core and Phoenix and lists the kit modules.

## Decision

1. **A separate package, working name `@effx/kit`.** It holds ordinary Effect constructs: services, Layers, combinators and Schemas that an application imports. It sits beside `@effx/compiler`, not under it. The operator may rename it.
2. **The kit is a construct library, not a request runtime.** It executes no request, owns no routing and registers nothing globally. A registry (receipt kinds, audit kinds, effect policies) is an explicit immutable value passed to the construct that uses it. Every requirement appears in `R` and is provided by a `Layer` at a composition root (ADR 0005, ADR 0012).
3. **The kit imports no effx package.** Not `@effx/compiler`, `@effx/runtime`, `@effx/ir` or `@effx/diagnostics`. Its runtime dependencies are `effect` (stable `>=4.0.0 <5`, `STATE.md` 2026-10-09) and, for the lifecycle module only, optional peers `xstate` and `@xstate/effect`.
4. **Unstable Effect modules stay behind kit services.** `effect/sql`, `effect/persistence` and `effect/workflow` carry `@stability unstable` in Effect 4.0.0 (checked for `sql/SqlClient.ts`, `persistence/PersistedQueue.ts` and `workflow/Workflow.ts`). The kit reaches each module through one adapter file, so an Effect release changes one place.
5. **effx integrates through an extension package, never through the core.** The extension uses `Annotation.define` and `Annotation.implement` (spec 0020, implemented on `main`) and is registered in `effx.config.ts` (spec 0015). It follows `@effx/persistence`: a `syntax` entry that imports only `@effx/runtime`, and a `compiler` entry that imports `@effx/compiler`. The compiler core imports nothing from the kit or the extension. To recognise a kit construct in a handler signature, the extension uses the rule that the frontend uses for `@effx/runtime` (spec 0002, "Runtime detection"): the declaration file of the resolved symbol, never the name.
6. **Generated code does not import the kit.** Every projection in spec 0030 §3 is plain Effect or plain data that handwritten code passes to a kit construct. ADR 0012 keeps its sentence: generated code is ordinary Effect with no effx import at runtime.

## Consequences

- ADR 0012's "rules out an effx runtime that executes requests" stays true. ADR 0008 stays true: no DI container, no runtime registry, no reflection. A kit registry is a value, not an ambient table.
- Invariant 2 stays true. A kit annotation records a claim in the IR. Behaviour lives in kit code that the application calls explicitly.
- Compiler releases and kit releases are independent. The cost is one more package to version, and a dependence on Effect modules that are marked unstable.
- Generated browser code (client and Foldkit commands, spec 0007) never pulls in a server package such as the kit.
- The lifecycle module depends on prerelease XState packages. mono-web's `AGENTS.md` forbids XState until an approved replacement contract exists. This ADR approves XState nowhere. The lifecycle module waits for that contract (spec 0030 §4).
- Nothing is built or published. Spec 0030 holds the module list, the extension and the order of work.

## Rules out

- A kit that executes requests, owns routing or dispatches by reflection.
- A kit DI container, module system or ambient registry.
- A kit dependency on `@effx/compiler`, `@effx/runtime` or `@effx/ir`, and a compiler dependency on kit code.
- Generated files that import the kit.
- A kit construct that hides `E` or `R` (ADR 0005).

## Alternatives considered

- **Put the constructs in `@effx/runtime`.** Rejected. That package is source syntax only, and spec 0020 gates it to import no compiler (ADR 0001, invariant 2). Executable constructs there would blur a declaration and behaviour.
- **Keep them as mono-web house constructs for good.** This is phase 1 of spec 0030 §4, not the end state, because it gives the next team no reuse. The extraction rule in §4 mirrors the mono-web rule that a shared construct needs two importing modules outside its own.
- **Generated code imports `@effx/kit` where an extension is enabled.** This was the wording of the 2026-10-10 plan. Rejected for now. It needs an amendment of the first consequence of ADR 0012, it puts a server package into generated browser code by default, and spec 0030 names no projection that needs it. A concrete need opens a separate ADR that amends ADR 0012 for that case. Spec 0010 target profiles, which list the Effect modules that generated code may import, would then list the kit module too.
- **Adopt a framework runtime**, with a module system and controllers dispatched at request time. Ruled out by ADR 0012.

## Open for the operator

- The package name `@effx/kit`.
- Decision 6. The plan of 2026-10-10 let generated code import the kit. This draft proposes that it does not, because of ADR 0012. The operator chooses. A different choice amends ADR 0012.
- Whether the kit starts as mono-web house constructs (spec 0030 §4, recommended) or as `packages/kit` here from the first commit.
