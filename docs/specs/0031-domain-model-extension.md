# Spec 0031 — Domain-model extension: entities, relationships, machines, events, grants and generated formal models

Status: **design accepted 2026-10-26; built in parallel with the Vektorprogrammet information system through slice specs (§7), starting with [spec 0032](0032-domain-model-alloy-grants-machines.md).** The falsifiers in §4 belong to the whole extension; each slice spec freezes the subset it delivers. Builds on [ADR 0002](../decisions/0002-ir-is-graph-shaped-and-schema-defined.md) (Extension nodes), [ADR 0006](../decisions/0006-query-is-a-semantic-claim.md) (Query/Command only), [ADR 0007](../decisions/0007-cedar-authorizes-effx-issues-leases.md), [ADR 0011](../decisions/0011-config-is-an-explicit-execution-boundary.md) (config is the only user-module import), [spec 0015](0015-config-and-extensions.md) (config toggles, public `Extension`), [spec 0017](0017-effx-cedar.md) (projection pattern) and [spec 0020](0020-annotation-definitions.md) (definitions with derived laws).

## 1. Outcome

```
declarations (Schema · Rpc · Entity · Relationship · Machine · Event · Grant · Requirement)
        │  collected into the IR as Extension nodes (no core-schema change)
        ▼
ApplicationIR ──► generated Effect code, SQL constraints, docs        (existing and new generators)
        │
        └─ config toggles ─► Alloy 6 · Quint (→ TLA+) · Cedar ✓ · Context Mapper CML · ArchiMate
                                 │
                                 ▼  checked by the real tool; traces replayed against the handlers
                         EFFX43xx diagnostics, exit 1 iff any error
```

One declaration of the information system yields the runtime, the database constraints, the documentation and the formal models. A model is never written by hand, so it cannot disagree with the code.

Two questions get machine answers:

1. **Are the declarations consistent?** The generated model is checked (Alloy `check`, Quint `verify`) against the declared invariants.
2. **Does the implementation conform?** Traces that the model produces are replayed through the generated command endpoints on a disposable database; a step whose outcome differs from the model's is a diagnostic.

## 2. Why

- The effx IR is operation-centred: `Operation{Query|Command}`, `Capability`, `Focus`, `Model`. It has no entity identity, relationship multiplicity, lifecycle, event, invariant or rule traceability.
- The same domain is already modelled by hand twice in mono-web: `docs/model/contexts.cml` (Context Mapper, 2,128 lines) and `docs/model/authority.als` (Alloy, 2,569 lines, 298 lines opening an `assert` or `check`). Spec 0027 ran that Alloy model (43/43 checks, 53/53 mutants). Each is a second copy of facts that the code also states.
- The Vektorprogrammet reimagined kernel (`packages/domain/src/kernel/`, spec 0006 R1–R4 in that repository) already declares commands (`RpcGroup`), grants (data rows over subject sets), machines (transition tables) and principals, and from R4 guards as native Schema checks. It is the first consumer.

## 3. Concepts

A concept enters the IR only with at least one derivation and at least one check. Names follow Hay (data), DDD (boundaries) and ArchiMate (motivation) where those traditions agree; §6 settles collisions.

### 3.1 New Extension nodes (`extension: "domain-model"`)

Spec 0032 R1 adds optional `root: true` to an Extension node for a project-level root that owns at least one Extension child; absence is the default.

| Node                   | Data (Json)                                                                                                                   | Derivations                                                                                        | Checks                                                                                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `Entity`               | name, identity (`SchemaRef` of the branded id), schema (`SchemaRef`), aggregate root?, personal-data classification per field | `sig`, table, glossary entry                                                                       | every entity has an owner context, a lifetime and a purpose (Zachman who/when/why)                          |
| `Relationship`         | from, to, verb, inverse verb, multiplicity `{ must \| may } × { one \| many }`, arc group?                                    | Alloy multiplicity, FK + NOT NULL + UNIQUE, the Hay sentence "each X must be … one and only one Y" | multiplicity holds in generated instances and in the database                                               |
| `ValueList`            | closed (`Literals`) or open (table)                                                                                           | `enum` / `sig`, CHECK or FK                                                                        | grants and guards name types, not instances                                                                 |
| `Machine`              | entity, states, transitions `{ command, from[], to, guard? }`, calculated transitions `{ from, to, when }`                    | transition predicates, diagram, `Machine.can`                                                      | every state reachable; no state without exit unless terminal; every transition names a command of the group |
| `Guard`                | `SchemaRef` of a check on the machine's context schema; its `representation` id and payload (§5.1)                            | runtime evaluation, Alloy/Quint formula                                                            | revived guard evaluates identically (law)                                                                   |
| `Event`                | name, payload `SchemaRef`, primary key path, kind `domain \| integration`                                                     | outbox message schema, trace step                                                                  | an integration event carries identifiers and closed non-personal values only                                |
| `Invariant`            | scope `entity \| cross-entity`, check `SchemaRef` or relational formula id                                                    | Schema check, SQL CHECK/EXCLUDE where expressible, Alloy `assert`                                  | checked after every replayed step                                                                           |
| `Principal`            | kinds `Anonymous \| Person \| System{job}` (extends `principalKinds` of spec 0006)                                            | `var sig Principal`                                                                                | a job runs only as its own System principal                                                                 |
| `SubjectSet` / `Grant` | subject-set expression over memberships, commands and queries, scope                                                          | `authorize`, Cedar policies (spec 0017 path), Alloy `pred can`                                     | §4 falsifier 3                                                                                              |
| `Job`                  | name, schedule, System principal, commands                                                                                    | job registry, a step that advances time                                                            | every job's commands are granted to its System principal                                                    |
| `Requirement`          | id (e.g. `RULE-022`), kind (requirement, principle, constraint), text ref                                                     | coverage table                                                                                     | every requirement assigned to a released slice has a `RealizedBy` edge                                      |
| `Context`              | bounded context name, upstream/downstream relations (ACL, published language, conformist)                                     | CML context map, package import rules                                                              | no import against the map                                                                                   |

### 3.2 New edges (`ExtensionOf` qualifiers until promoted)

`Holds` (party role → party) · `Within` (role → context party) · `During` (role → time period) · `Writes` / `Reads` (operation → entity) · `Transitions` (command → machine) · `Emits` (command → event) · `Reacts` (event → command, a policy) · `RealizedBy` (requirement → command, invariant or test) · `Owns` (context → entity).

`Writes` and `Reads` let the client generator derive `reactivityKeys` for `effect/reactivity` (`Reactivity.mutation`, `AtomRpc`) instead of hand-written keys.

### 3.3 What stays as is

- `Query` and `Command` remain the only operation kinds. An Alloy/Quint _action_ is a projection of a Command, never a separate declaration (ADR 0006).
- `Capability`/`Focus`/`Lease` (ADR 0007) keep their meaning. Grants are the declaration; Cedar is one more projection (§6).
- Generated code stays ordinary Effect (ADR 0008).

## 4. Falsifiers (definition of done)

1. **Round trip.** `domain-model` nodes encode and decode through the IR codec; `fromGraph(toGraph(x)) == normalize(x)` holds with the new nodes (ADR 0002 law, Arbitrary-generated).
2. **Unchanged without opt-in.** A project that declares no domain-model nodes keeps its IR, `semanticHash` and generated bytes (the 172 fixture cases and 75 generated files of spec 0022).
3. **Grants.** For generated principals and memberships, `authorize` allows exactly the grant rows, and the generated Alloy `pred can` agrees with `authorize` on every instance up to scope 4. Removing one grant row makes both fail (negative control).
4. **Generated Alloy proves what the hand-written model proves.** Every `assert` of `mono-web/docs/model/authority.als` that the reimagined domain still holds is listed with its generated counterpart, and passes on the generated model. Every listed assert that cannot be generated is named with the missing concept. The list is the evidence, not a summary.
5. **Mutants.** Each emitter has negative mutants (wrong principal, missing guard, wrong multiplicity, terminal state left, event with a personal field) that the tool reports.
6. **Trace replay.** Traces from `alloy run` (and `quint run` when enabled) replay through the generated endpoints on PGlite; a deliberately broken handler (skips its guard) is reported at the first diverging step.
7. **Toggles.** Each model output is off by default and enabled per project in `effx.config.ts` (`models: { alloy, quint, tla, cml, archimate }`); a disabled emitter writes nothing and runs no external tool.
8. **Real tools.** Alloy 6.2.0 and Quint run as pinned binaries (Nix), as Cedar does in spec 0017. A missing tool is a diagnostic, not a skipped check.

## 5. Mechanisms

### 5.1 Guards and invariants are native Schema checks

Effect 4.0.5 represents a check as data: `SchemaAST.Filter.annotations.representation = { id, payload: Json }` (77 built-ins, e.g. `effect/schema/isGreaterThan`); `SchemaRepresentation.toRepresentation` serialises a schema with its checks; `fromRepresentation` with `makeReviverFilter` rebuilds them; `toJsonSchema` and `toCode` are per-backend compiler hooks. `Predicate`, `Filter` and `Order` combine opaque functions and are not used for declarations. An emitter compiles representation ids to its language, as the JSON Schema compiler does. Ids that Effect lacks (field-to-field comparison, `not`, `or`) are registered by the application with a reviver; the set is closed per project and an unknown id is a diagnostic.

### 5.2 Emitters

| Toggle      | Output                                                | Tool                          | Notes                                                                                                          |
| ----------- | ----------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `alloy`     | `.effx/models/alloy/*.als`                            | Alloy 6.2.0, headless         | `var` fields for machine state and roles; temporal operators for calculated transitions                        |
| `quint`     | `.effx/models/quint/*.qnt`                            | Quint (`verify` via Apalache) | actions from commands; `tla` produces TLA+ through Quint where its output allows; otherwise a separate emitter |
| `cml`       | `.effx/models/contexts.cml`                           | Context Mapper                | contexts, aggregates, relations                                                                                |
| `archimate` | `.effx/models/model.xml` (Open Group exchange format) | Archi validation              | business actors, processes, application components, requirements                                               |
| `cedar`     | spec 0017                                             | cedar-wasm 4.13.0             | gains grant-derived policies                                                                                   |

## 6. Names

| Word       | effx meaning                           | Other meaning                 | Rule                                              |
| ---------- | -------------------------------------- | ----------------------------- | ------------------------------------------------- |
| Capability | authority token over a resource        | ArchiMate business capability | effx keeps it; the other is "business capability" |
| Role       | Hay party role (membership, placement) | assigned RBAC role            | only the Hay meaning; no assigned roles           |
| Action     | projection of a Command in Quint/TLA+  | —                             | never declared                                    |
| Authority  | Cedar + capability/focus/lease         | grant table                   | grants declare, Cedar projects                    |

## 7. Sequencing

Revised 2026-10-26 (operator): **the library is built in parallel with the Vektorprogrammet information system**, not after it.

1. **One runtime kernel.** `authorize`, `Machine.can` and the guard revivers stay in the Vektorprogrammet kernel until extraction. effx builds the declaration IR, the emitters and the checks; it does not build a second `authorize`.
2. **The contract between them is `DomainDescription`**, a Schema in a new package `@effx/domain-model`: commands, reads, principals, subject sets, grants and machines (with each guard's `representation`), later entities, relationships and events. The Vektorprogrammet kernel exports a value that decodes with it.
3. **Conformance vectors close the loop.** effx emits, per domain, the instances the generated model allows (`can` per principal, command and scope; enabled transitions per state and context). The consumer's own `authorize` and `Machine.can` must agree with them in its test suite.
4. Slices, one spec and one pull request each: 0032 grants and machines → Alloy, checked, with vectors; then entities and relationships; trace replay; Quint (→ TLA+); CML; ArchiMate.
5. When the Vektorprogrammet placement slice (its spec 0011) is the second domain, the runtime kernel moves into `@effx/domain-model`.

## 8. Non-goals

- Event sourcing. Rows stay the source of truth; events are recorded facts.
- Runtime authorization by Cedar or leases (ADR 0007 deferral stands).
- Proof of handler purity; `Writes`/`Reads` are declared claims checked by replay and by the SELECT-only role, as `@Query` is (ADR 0006).
- Unbounded verification. Alloy and Quint checks are bounded; the scope is stated with each result.

## 9. Open decisions

1. **Invariant 5 — decided.** The description reaches the compiler through `effx.config.ts`, the only user-module import (ADR 0011): the config imports the domain declarations and passes their `DomainDescription` to the `domain-model` extension, which contributes Extension nodes. A context schema stays a `SchemaRef`; a guard's `representation` (`{ id, payload: Json }`, produced by `SchemaRepresentation.toRepresentation` when the config is evaluated) enters the node data as derived data. No new execution boundary.
2. **TLA+.** Through Quint's output, or a separate emitter. Decide after Quint's TLA+ output is tried on the teams machine.
3. **Diagnostic range — checked.** `EFFX43xx`. `main` (`055bbbed`), `effx/spec-0029-recruitment`, `effx/spec-0030-kit-lifecycle` and `feat/lift-0019` use only `EFFX41xx` in the `EFFX4xxx` block.
