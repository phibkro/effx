# Spec 0001 — Compiler kernel (`@effx/ir`, `@effx/compiler`)

Status: **frozen** 2026-10-03. Changes require editing this file explicitly.
Source: `docs/research/2026-10-02-deep-research-report.md` §"Compiler and IR architecture", §"Research suite", §"Roadmap" (gate 1).

## Goal

One vertical proof that annotations become a Schema-defined IR, that the IR has stable laws
(round trip, normalization, canonicalization, graph projection, determinism, syntax
equivalence), and that extensions interpret annotations / analyse the graph / generate
ordinary Effect without touching the core.

Non-goals (other slices): TypeScript frontend, runtime decorators, Cedar, persistence, CLI binary.

## Journey

```
Collected (frontend-neutral declarations + annotations)
   │ interpret: every Extension.interpreters[annotation.name]
   ▼
Contribution* ──merge──▶ ApplicationIR ──normalize──▶ IR₀
                                                      │ toGraph
                                                      ▼
                           analyses(IR₀, GraphIndex) ──▶ Diagnostic[]   (errors block generation)
                                                      │
                           generators(IR₀, GraphIndex) ──▶ GeneratedFile[]
```

## IR vocabulary (`@effx/ir`)

### StableId

Branded string, grammar (one regex, no spaces):

```
StableId   := kind ":" name
kind       := [a-z][a-z0-9-]*
name       := [A-Za-z0-9_$] [A-Za-z0-9_$./:-]*
```

| kind         | example                       | meaning                                              |
| ------------ | ----------------------------- | ---------------------------------------------------- |
| `schema`     | `schema:users/GetUserInput`   | a runtime Effect Schema symbol                       |
| `model`      | `model:User`                  | persistent model                                     |
| `service`    | `service:Users`               | Effect `Context` service                             |
| `operation`  | `operation:User.Get`          | Query/Command                                        |
| `capability` | `capability:User.ChangeEmail` | authority kind                                       |
| `focus`      | `focus:User.email`            | model root + path                                    |
| `exposure`   | `exposure:http:User.Get`      | transport exposure (`name` may contain `:` sub-kind) |
| `ext`        | `ext:<extension>/<name>`      | extension-owned node                                 |

Helpers: `StableId.make(kind, name)`, `kindOf`, `nameOf`.

### References (no source locations, no `ts.*`)

| Type        | Fields                                                         |
| ----------- | -------------------------------------------------------------- |
| `SchemaRef` | `module: string, export: string, symbolId: StableId(schema:…)` |
| `SymbolRef` | `module: string, export: string, member?: string`              |

### Nodes (closed tagged union on `_tag`, plus one escape)

| `_tag`       | Fields                                                                                                                                                                                                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Schema`     | `id, ref: SchemaRef`                                                                                                                                                                                  |
| `Model`      | `id, name, schema: SchemaRef, table?: string, views: [{ name, schema: SchemaRef }]` (set)                                                                                                             |
| `Service`    | `id, name, symbol: SymbolRef`                                                                                                                                                                         |
| `Operation`  | `id, name, kind: "Query"\|"Command", input: SchemaRef, success: SchemaRef, errors: { values: SchemaRef[] (set), inferred }, requirements: { values: StableId[] (set), inferred }, handler: SymbolRef` |
| `Capability` | `id, name, resource: StableId(model), focus?: StableId(focus)`                                                                                                                                        |
| `Focus`      | `id, root: StableId(model), path: string[]` (ordered)                                                                                                                                                 |
| `Exposure`   | `id, operation: StableId, transport: { _tag:"http", method, path } \| { _tag:"rpc", name } \| { _tag:"cli", command: string[] }`                                                                      |
| `Extension`  | `id, extension: string, tag: string, data: Json`                                                                                                                                                      |

Decision: core `Exposure.transport` is a **closed** union (`http`/`rpc`/`cli`) because core
analyses (e.g. "Query exposed via non-GET") must pattern-match exhaustively. Third-party
transports and any other new concept use `Extension` nodes (`ext:` ids) — they survive
normalization, canonical JSON and graph projection without a core schema change. Promotion
into the core union is a versioned IR migration.

### Edges

`{ kind, from: StableId, to: StableId, qualifier?: string }` with
`kind ∈ { InputOf, SuccessOf, ErrorOf, Requires, AuthorizedBy, Focuses, ExposedAs, PersistsAs, ViewOf }`.

| kind                          | from → to                    | qualifier     |
| ----------------------------- | ---------------------------- | ------------- |
| InputOf / SuccessOf / ErrorOf | `schema:` → `operation:`     | —             |
| Requires                      | `operation:` → `service:`    | —             |
| AuthorizedBy                  | `operation:` → `capability:` | —             |
| Focuses                       | `capability:` → `focus:`     | —             |
| ExposedAs                     | `operation:` → `exposure:`   | transport tag |
| PersistsAs                    | `model:` → `schema:`         | table name    |
| ViewOf                        | `schema:` → `model:`         | view name     |

Edges may point at absent nodes; that is data (`missingTargets`), not a decode failure.

### Envelope

`ApplicationIR = { format: "effx-ir", version: 1, nodes: Node[], edges: Edge[] }`, an Effect
`Schema`. Codec, Arbitrary and type are derived from it.

## Normalization (`normalize`)

| What           | Rule                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------ |
| nodes          | sorted by `id`, then by canonical encoding; exact duplicates removed                                                     |
| edges          | sorted by `(kind, from, to, qualifier ?? "")`, then canonical encoding; exact duplicates removed                         |
| set fields     | `Model.views`, `Operation.errors.values`, `Operation.requirements.values`: sorted by canonical element encoding, deduped |
| ordered fields | `Focus.path`, `Exposure.transport.command` untouched                                                                     |
| idempotent     | `normalize(normalize(x)) == normalize(x)`                                                                                |

Duplicate _ids_ with different content are preserved (reported by analysis `EFFX1001`).

## Canonical JSON (`canonical`)

RFC 8785 over `encode(normalize(ir))`: object keys sorted by UTF-16 code units, no whitespace,
primitives via ES6 `JSON.stringify` semantics (strings, finite numbers, booleans, null).
`semanticHash(ir) = hex(sha256(utf8(canonical(ir))))` via the Effect `Crypto` service
(provided by `BunCrypto.layer` at composition roots). `encode`/`decode` are Schema-derived
(`Schema.toCodecJson`, `Schema.fromJsonString`).

## Graph index (`graph`)

`toGraph(ir): GraphIndex { graph: Graph<Node, Edge>, byId: HashMap<StableId, Node>, ids: Trie<StableId>, dangling: Edge[], duplicates: StableId[] }`.
`fromGraph(index): ApplicationIR` (normalized). Helpers: `outgoing(index, id, kind?)`,
`reachable(index, id)`, `cycles(index)`, `missingTargets(index)`, `withPrefix(index, prefix)`.

## Arbitrary adapter (`arbitrary`)

`arbitraryIR()` wraps `effect/Arbitrary` (unstable) and is the only module importing it.

## Compiler contract (`@effx/compiler`)

### Data

| Type             | Shape                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Diagnostic`     | `{ code: "EFFX####", severity: "error"\|"warning"\|"info", message, location?: {file,line,col}, related?: Diagnostic[] }` (Schema) |
| `StageResult<A>` | `{ value: Option<A>, diagnostics: Diagnostic[] }`                                                                                  |
| `CompilerFault`  | `Schema.TaggedError` — IO / invariant breakage only                                                                                |
| `AnnotationArg`  | `string \| number \| boolean \| SymbolRef \| SchemaRef \| record \| array \| { _tag: "Lambda" }`                                   |
| `Annotation`     | `{ name: string, args: AnnotationArg[] }`                                                                                          |
| `TypeRef`        | `Schema(SchemaRef) \| Service(StableId) \| Opaque{ display }`                                                                      |
| `Declaration`    | `{ id: string, kind: "class"\|"staticMethod"\|"builder"\|"model", module, export, member?, annotations, handlerSignature? }`       |
| `Collected`      | `{ declarations: Declaration[], diagnostics: Diagnostic[] }` (frontend diagnostics travel as data; revised by spec 0002)           |

### Services and extensions

```ts
SourceFrontend.analyze(project: ProjectConfig) => Effect<Collected, CompilerFault>

Extension = { name, interpreters: Record<annotationName, Interpreter>, analyses: Analysis[], generators: Generator[] }
Interpreter(annotation, declaration, ctx) => Contribution { nodes, edges, diagnostics }
Analysis(ir, index) => Diagnostic[]
Generator(ir, index) => Effect<GeneratedFile[], CompilerFault>
```

Built-in extensions: `core` (`Query`, `Command`, `Errors`, `Requirements`, `PersistentModel`,
`Authorize`), `http` (`Http.Get/Post/Put/Patch/Delete`), `rpc` (`Rpc`), `cli` (`Cli`), `client`
(generator only). `SchemaRef.module` / `SymbolRef.module` are import specifiers the frontend
guarantees resolvable from the generated directory; generators emit them verbatim.

### Annotation argument shapes (what both decorators and builders lower to)

| Annotation          | `args`                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `Query` / `Command` | `[{ name?: string, input: Schema, success: Schema }]`; operation name defaults to `<export>.<member>`                |
| `Errors`            | `[Schema, …]`                                                                                                        |
| `Requirements`      | `[Symbol, …]` (service classes; id = `service:<export>`)                                                             |
| `PersistentModel`   | `[{ table, schema: Schema, views?: { [name]: Schema }, focus?: { [name]: string[] } }]`; model id = `model:<export>` |
| `Authorize`         | `[{ name, resource: <model name>, focus?: string[] }]`                                                               |
| `Http.<Method>`     | `[path]`                                                                                                             |
| `Rpc`               | `[name]`                                                                                                             |
| `Cli`               | `["words separated by spaces"]`                                                                                      |

`Schema` = `{ _tag: "Schema", ref: SchemaRef }`, `Symbol` = `{ _tag: "Symbol", ref: SymbolRef }`.
The `Query`/`Command` interpreter owns the `Operation` node and its edges and reads sibling
`Errors`/`Requirements` annotations for declared sets; the `Errors`/`Requirements` interpreters
only compare declared vs inferred (they need `handlerSignature`, which is not in the IR), so
EFFX22xx/23xx are produced during _interpret_, not _analyze_.

### Diagnostic codes

| Code     | Severity | Meaning                                                             |
| -------- | -------- | ------------------------------------------------------------------- |
| EFFX1001 | error    | duplicate StableId with differing content                           |
| EFFX1002 | error    | edge references a missing node                                      |
| EFFX1101 | error    | annotation has no interpreter in any extension                      |
| EFFX1102 | error    | annotation arguments malformed                                      |
| EFFX1103 | error    | transport annotation on a declaration that is not an operation      |
| EFFX2201 | error    | handler error not declared in `@Errors`                             |
| EFFX2202 | error    | `@Errors` declares an error the handler cannot fail with            |
| EFFX2302 | error    | handler requirement not declared in `@Requirements`                 |
| EFFX2303 | error    | `@Requirements` declares a stale requirement                        |
| EFFX2401 | error    | Query exposed over non-GET HTTP                                     |
| EFFX2203 | error    | inferred error constituent is not schema-addressable                |
| EFFX2204 | warning  | operation infers no schema-addressable errors                       |
| EFFX2304 | error    | inferred requirement has no stable service identity                 |
| EFFX0001 | info     | frontend TypeScript version differs from the project pin (ADR 0009) |

### Pipeline stages

`collect → interpret → merge → normalize → analyze → generate`; every stage returns
`StageResult`; diagnostics accumulate; any `error` severity → `generate` is skipped
(`value: none`).

## Laws (tests)

| Law                   | Test                                                                       |
| --------------------- | -------------------------------------------------------------------------- |
| round trip            | `decode(encode(normalize(x))) == normalize(x)`                             |
| canonical idempotence | `canonical(decode(canonical(x))) == canonical(x)`                          |
| normalize idempotence | `normalize(normalize(x)) == normalize(x)`                                  |
| graph projection      | `fromGraph(toGraph(x)) == normalize(x)`                                    |
| determinism           | shuffling nodes/edges/set members leaves `semanticHash` unchanged          |
| syntax equivalence    | decorator-style and builder-style `Collected` yield identical canonical IR |
| diagnostics           | EFFX2201/2303 fire on declared≠inferred; EFFX2401 on Query+POST            |
| generator determinism | same IR → byte-identical files                                             |

## Definition of done

- `bun run typecheck`, `bun run lint`, `bun run fmt:check`, `bun --bun vitest run` green.
- User slice fixture compiles to the expected IR and generates `http.ts`, `rpc.ts`, `cli.ts`, `client.ts`.
- All laws above are executable tests (property-based where `Arbitrary` derives).
