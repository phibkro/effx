# ADR 0012: effx is the enterprise on-ramp to full-stack Effect

Status: accepted (2026-10-04)

## Context

Teams that run on NestJS, ASP.NET Core or Laravel know a declarative surface: controllers, routes,
validation, guards, problem responses, generated clients. Full-stack Effect gives stronger
guarantees (typed errors and requirements, explicit layers, one schema language) but asks a team to
learn a new vocabulary before it ships anything. That cost makes the switch hard to start and hard
to pitch.

## Decision

effx bridges the two. The author writes a familiar declarative surface (decorators or builder
chains). The compiler reads it ahead of time and writes ordinary, inspectable Effect. The author
loses none of Effect's power and is not locked in: the generated files are the contract and can be
kept, edited by hand, or replaced.

| Layer       | What the author sees                              | What exists underneath                                   |
| ----------- | ------------------------------------------------- | -------------------------------------------------------- |
| Declaration | `@Query`, `@Http.Patch`, `@Http.Access`, builders | annotations that contribute to the IR (ADR 0001)         |
| Generated   | readable files in `.effx/generated`               | `HttpApi`, `Rpc`, CLI commands, client, Foldkit commands |
| Application | handlers, services, layers                        | native Effect, written and owned by the application      |

## Consequences

- **Generated code stays readable and ejectable.** It is ordinary Effect with no effx import at
  runtime (ADR 0008). A team can stop running the compiler and keep the output.
- **Every annotation has a documented relationship to Effect.** Documentation names the construct
  it generates (`HttpApiEndpoint`, `HttpApiMiddleware`, `Rpc`, `Schema`, `Context.Service`, ...). An
  annotation that generates nothing and only feeds analysis or application code (`@Requirements`,
  `@Authorize`, `@PersistentModel`) is labelled as such, with the spec that defines it. An annotation
  with neither a generated construct nor a stated analysis role is not added.
- **Raw Effect always coexists.** An application can mix declared operations with hand-written
  `HttpApi` groups and handlers in the same program.
- **effx composes the Effect ecosystem; it does not reimplement it.** Authentication, authorization
  evaluation, persistence, jobs, caching, and infrastructure come from existing Effect packages and
  application layers. Where none exists, documentation says "gap", not "planned".
- **Positioning is documented honestly.** Framework comparison pages mark each concept as supported,
  via an ecosystem package, or a gap, and cite a spec or source file for every effx claim.

## Rules out

- An effx runtime that executes requests, or runtime reflection that changes behaviour.
- Hidden dependency injection. Requirements `R` stay visible in types and in `Layer`s (ADR 0005).
- Hiding `E` or `R` behind framework-style exceptions or ambient context.
- A generated-code format only the compiler can read.
