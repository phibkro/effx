# ADR 0002: The semantic IR is graph-shaped and Schema-defined

Status: accepted (2026-10-03)

## Context

Analyses (cycles, reachability, missing targets, capability inheritance) are graph problems.
Effect v4 ships `Graph`, `Trie`, `HashMap`. Making one of them the compatibility format would
couple the external contract to a runtime structure.

## Decision

```
ApplicationIR (Effect Schema; nodes + edges)      ← the durable data model
      │ toGraph / fromGraph (law: fromGraph(toGraph(x)) == normalize(x))
      ▼
GraphIndex { graph: Graph, byId: HashMap, names: Trie }   ← working indexes only
```

`nodes` is a closed tagged union of core kinds plus `ExtensionNode { extension, tag, data: Json }`
so third-party extensions can add nodes without forking the core schema. Edges are
`{ kind, from, to, qualifier? }` over `StableId`s.

## Consequences

- Codec and `Arbitrary` generators are derived from the Schema, never hand-written.
- Graph algorithms operate on `GraphIndex`; nothing serializes a `Graph`.
- No `ts.*` or source locations in the IR (they go to the manifest).
