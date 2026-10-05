## Custom annotations and extensions

An **extension** gives annotations meaning. You register one in `effx.config.ts`; the CLI loads that
single module for `check`, `build`, `inspect` and `graph` (spec 0015, `packages/cli/src/config.ts`).
Two layers attach custom annotations, and both produce the same record, `Annotation { name, args }`:

- **The generic floor** (spec 0015): `@Annotate(name, ...args)` and `.annotate(name, ...args)` from
  `@effx/runtime` attach any literal name. A hand-written `Extension` interprets it. Nothing about the
  arguments is typed.
- **Typed definitions** (spec 0020): `Annotation.define` (`@effx/runtime`) states the name, target
  and argument shape once. The decorator `@RateLimit(...)`, the builder argument
  `.with(RateLimit(...))`, the frontend lowering and the compiler decode all derive from it.
  `implement` + `extension` (`@effx/compiler`) are the compiler half. An applied definition records
  exactly the `{ name, args }` that `@Annotate(name, ...args)` records, so a definition is the typed,
  schema-lowered form of the same annotation.

```
 @Annotate("Audit", {...})    @RateLimit({...})
 .annotate("Audit", {...})    .with(RateLimit({...}))
   untyped floor (0015)         typed by Annotation.define (0020)
              └──────────────┬──────────────┘
                             ▼ the frontend reads a literal name and lowers the arguments
                               (by the definition's plan when the name has one)
                 Annotation { name, args }
                             │ the interpreter registered for that name in effx.config.ts
                             ▼
                 Contribution { nodes, edges, diagnostics }
```

What holds for both (spec 0015; `examples/extension-openapi-tags` in the effx repository is the
tested reference):

- The arguments are static literals and the name given to `@Annotate` is a string literal: the
  compiler reads source and never evaluates your application modules.
- A name no registered extension owns is `EFFX1101`. Registering the extension in `effx.config.ts`
  is what makes it valid.
- An `extensions` array in the config **appends** to the built-ins; a callback
  `(builtin) => [...]` returns the complete ordered list. A hand-written `Extension` and an
  `extension(...)` built from definitions register the same way.
- `generators: { http, rpc, cli, client, foldkit }` toggles built-in file generators only. It never
  changes interpretation, analyses, the IR or its semantic hash, and never toggles a custom
  extension's generator.
- The config module and everything it imports must not import application code that declares
  operations.
- Your extension imports only public packages: `@effx/compiler` (`Extension`, `Interpreter`,
  `Analysis`, `Generator`, `Contribution`, `decodeArgs`, `defineDiagnostic`, `DiagnosticEntry`,
  `CoreDiagnostics`, `GeneratedFile`, and the typed layer `implement`, `extension`, `dataOf`,
  `laws`, `LawViolation`), `@effx/runtime` and `@effx/ir` (public exports in `packages/compiler/src/index.ts`).

Not available: there is no public way to run a custom extension outside the CLI without the private
TypeScript frontend. Use the CLI with a config.

### Typed definitions over the generic floor

A definition module is a leaf: it imports only `effect` and `@effx/runtime`, otherwise `EFFX1306`.
In v1 a user annotation attaches to an operation (`target: "operation"`). `implement` derives the
interpreter, the argument decode and the guards from the definition; with no `read` it records the
arguments as a declarative `Extension` node, and `dataOf(definition, ir, operationId)` reads them
back typed.

How the two spellings meet (spec 0020 section 9, `packages/frontend-ts/src/collect.ts`):

- A name with a registered definition lowers by that definition's plan whichever spelling you use:
  `@Annotate("app.RateLimit", { perMinute: 60 })` and `@RateLimit({ perMinute: 60 })` lower to the
  same `args`, so the default read records the same arguments in its `Extension` node and `dataOf`
  returns them for both. A name with no definition lowers generically. `tsc` checks only the typed
  spelling; the definition's own decode rejects a malformed value of the generic one (`EFFX1102`).
- Only the applied definition records its own export. A definition with an `effect` clause writes
  its annotation into the generated HTTP endpoint through that export, so `@Annotate(name, ...)` of
  an effect-clause name keeps the IR node but writes no `.annotate(key, ...)`. Apply the definition
  when generated output must carry the annotation.

With an `effect` clause the generated HTTP endpoint carries the annotation as an Effect `Context`
annotation (spec 0020 section 4 and 6):

```ts
HttpApiEndpoint.get("Limited.Get", "/limited/:id", { ... })
  .annotate(RateLimit.effect.key, { perMinute: 60, burst: 5 })
```

| Code       | Meaning                                                             |
| ---------- | ------------------------------------------------------------------- |
| `EFFX1301` | `A.fromSchema` met a Schema node the frontend cannot lower          |
| `EFFX1302` | annotation name outside `[A-Za-z][A-Za-z0-9._-]*` or declared twice |
| `EFFX1303` | a definition's target does not fit the declaring syntax             |
| `EFFX1304` | two definitions share an `effect.key` id                            |
| `EFFX1306` | a definition module reaches an application module                   |

### The extension contract

The contract below is what every extension implements. The typed layer derives it; the hand-written
form (see the linked Audit extension) remains valid. The built-in features (core, http, rpc, cli, client,
foldkit, http-contract, http-group, access-contract, problem-contract) are extensions built from
the same contract (`packages/compiler/src/Extension.ts`,
`packages/compiler/src/extensions/index.ts`).

```
 annotation ──interpreter──► Contribution { nodes, edges, diagnostics }
                                   │ merge + normalize
                                   ▼
                              ApplicationIR ──► GraphIndex
                                   │                 │
                          analyses(ir, index, ctx)   generators(ir, index, genCtx)
                                   ▼                 ▼
                              Diagnostic[]      Effect<GeneratedFile[]>
```

| Part                | Type (`Extension.ts`)                                                       | Rules                                                                   |
| ------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `name`              | `string`                                                                    | identifies the extension                                                |
| `interpreters`      | `Record<annotationName, (annotation, declaration, ctx) => Contribution>`    | pure; an annotation name no extension owns is `EFFX1101`                |
| `analyses`          | `(ir, index, { strictAccess }) => Diagnostic[]`                             | pure; reads the graph; an `error` diagnostic stops generation           |
| `generators`        | `(ir, index, generationContext?) => Effect<GeneratedFile[], CompilerFault>` | emit ordinary files; output is sorted by path and must be deterministic |
| `annotations`       | `ReadonlyArray<DefinitionData>?`                                            | the definitions it implements; their plans drive frontend lowering      |
| `expand`            | `(collected) => { declarations, diagnostics }` (optional)                   | pure pre-pass before any interpreter; group defaults use it             |
| `fragments`         | `ReadonlyArray<EndpointFragment>?`                                          | method-call suffixes appended to a generated HTTP endpoint              |
| `diagnosticEntries` | `ReadonlyArray<DiagnosticEntry>?`                                           | registers this package's explanations; duplicates are rejected          |

`extension(name, implementations, options?)` fills `annotations`, derives `interpreters` and
`fragments`, and combines the `diagnosticEntries` supplied to each `implement` with those supplied
in extension options. Register each entry exactly once; identical duplicate entries still fail.
A hand-written `Extension` carries its own `diagnosticEntries` when it emits package-owned codes.

Rules to keep:

- **A decorator (annotation) is a contribution to the IR, never generated
  behaviour.** An interpreter returns data. It has no access to your runtime
  values.
- Generated files are ordinary TypeScript/Effect (ADR 0008). Do not emit a
  runtime library or a dependency-injection layer.
- Diagnostics are data (`Diagnostic` from `@effx/compiler`): return them, do
  not throw. `CompilerFault` is only for I/O and invariant breakage.
- Extension node payloads are `Schema.Json`. Define a Schema for your `data`
  and decode it in analyses and generators.
- An `ExtensionOf` edge goes from the extension node to its owner. Every extension node needs
  one (`EFFX1003` otherwise). `qualifier` is optional in the IR; the built-ins set it to the
  node's `tag` so their analyses can find their own links, and `auditExtension` does the same.
- Use `decodeArgs(schema, annotation, declaration)` to decode annotation
  arguments; a failure is an `EFFX1102` diagnostic.
- No `ts.*` objects in the IR. Source locations live in the manifest.
- Diagnostic codes: new third-party packages use `EFFX[<package>]/####`, for example
  `EFFX[@acme/effx-audit]/0001`. The package must be a canonical lowercase npm name,
  and `owner` must match it. All numeric codes belong to the effx distribution; the six
  shipped example codes are grandfathered reservations, not an authoring range (spec 0016 §3).

### Typed diagnostic entries and factories

Keep entry data, a structured parameter Schema and the message renderer together with
`defineDiagnostic` (spec 0016 §2; `packages/diagnostics/src/definition.ts`). Call its `.emit(params,
{ location, related })` with facts; code, message and severity derive from the definition.
Do not copy a message template into an emitter or retain string-code helpers. Fixed severity
entries accept no resolver. A named policy declares `allowedSeverities` as a readonly nonempty
list of unique outcomes containing the default, documents the decision, and supplies a
resolver whose return type is restricted to those outcomes.

The inlined package-owned audit example below shows a complete entry, factory and meaningful
analysis-only `Extension`. `diagnosticEntries: [missingAudit.entry]` enables both compilation
and explicit-config explain lookup. With `implement`, put the entry in its options; with
`extension`, put additional entries in its third argument. Shared `CoreDiagnostics` factories
are already bundled: the older Audit and RateLimit examples reference those factories without
registering their numeric entries again.

Registry composition decodes selected extension entry arrays and rejects collisions before
frontend analysis. Callback diagnostics, including related diagnostics, are checked before
escaping the compiler; undeclared codes or unauthorized severity produce `EFFX0010` and
stop generation, not a `CompilerFault` (spec 0016 §2). These checks cover JavaScript plugins
too; TypeScript factory references alone are not a security guarantee.

Run `effx explain EFFX1102` offline without a project. For a plugin, quote the full code
and select its config explicitly: `effx explain 'EFFX[@acme/effx-audit]/0001' --config
./effx.config.ts`. Explain does not discover config by default or compile application source
(spec 0016 §4).
