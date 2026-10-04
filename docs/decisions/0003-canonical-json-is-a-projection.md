# ADR 0003: Canonical JSON is a projection, not compiler state

Status: accepted (2026-10-03)

## Context

The same application graph must yield the same cache key, diff, snapshot and agent input.
RFC 8785 (JCS) fixes object-key order and number formatting but leaves array order meaningful.

## Decision

| Step         | Rule                                                                                                                       |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| normalize    | nodes sorted by `id`; edges by `(kind, from, to, qualifier)`; set-valued fields sorted + deduped; idempotent               |
| canonical    | JCS: UTF-16 code-unit key order, no whitespace, ES6 number formatting, over the Schema-encoded JSON of the _normalized_ IR |
| semanticHash | lowercase hex sha-256 of the canonical UTF-8 bytes                                                                         |
| envelope     | `{ format: "effx-ir", version: 1, nodes, edges }`; migrations are functions `v1 → v2`                                      |

`effx.ir.json` holds only semantics; `effx.manifest.json` holds locations, compiler version,
generated files, diagnostics and the hash.

## Consequences

- Moving a declaration between lines never changes the hash.
- `decode(encode(normalize(x))) == normalize(x)` and `canonical(canonical(x)) == canonical(x)` are tested laws.
