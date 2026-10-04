# Persistence ports

`@effx/persistence/syntax` provides `Persist.Port({ port })`, defined with the
same `Annotation.define` API as user annotations. Its compiler half is an
optional extension from `@effx/persistence/compiler`; register it in
`effx.config.ts`. Core packages do not depend on persistence (spec 0022 §§2, 7).

A method is an operation named `<port>.<method>`, ending in `.declare()`, without
HTTP, RPC or CLI exposure. Input, success and declared errors remain references
to exported Schema values, not copied DTOs (ADR 0004). The generated
`<port>-port.ts` service sorts methods by name and gives every method an Effect
with `R = never`. Adapters capture dependencies in their Layer, and the
composition root selects an implementation (spec 0022 §3, ADR 0008).

Builder `.declare()` is the supported declaration-only spelling. A decorator
records equivalent annotation data, but a local-bodied decorated method is a
handler and diagnoses `EFFX3401`. Decorator declaration-only ports are a non-goal:
TypeScript decorators cannot attach to abstract or `declare` members
(spec 0022 §2 and the dated implementation amendment).

The generated `<port>-conformance.ts` suite uses `@effect/vitest` and inputs from
the original Schema. It checks the closed error channel (G1), query purity and
repeatability (G2), command rollback (G3), and shared transactions between pairs
of commands (G4). Domain scenarios supply seed data, expected results, declared
error examples and a commit observer; the IR cannot infer those. The harness
owns fresh-store isolation and the common transaction owner (spec 0022 §4).

The reference example is `examples/persistence`: Effect SQL and patched
`drizzle-orm@1.0.0-rc.4` adapters share the ambient Effect SQL transaction over
PGlite. PGlite runs the PostgreSQL engine in-process; it is not a mock. Its
single-connection limit means concurrency-marked scenarios are skipped, not
certified. Interruption outcomes are observations, not a cancellation guarantee
(spec 0022 §§5–6).

There is no generated SQL, migration, ORM schema, CRUD repository, transaction
around HTTP handlers, or Prisma/TypeORM adapter. Persistence methods declare a
contract; hand-written adapters own storage behaviour. Spec 0022 supersedes the
scope of the parked SQL projection proposal in spec 0008.
