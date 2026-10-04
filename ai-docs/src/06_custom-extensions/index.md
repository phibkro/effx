## Custom extensions

An **extension** gives annotations meaning. You register one in `effx.config.ts`; the CLI loads
that single module for `check`, `build`, `inspect` and `graph` (spec 0015,
`packages/cli/src/config.ts`). The full path from source to files:

```
 @Annotate("Audit", {...})        effx.config.ts
 .annotate("Audit", {...})        defineConfig({ extensions: [auditExtension] })
        │                                   │
        ▼ frontend lowers a literal name    ▼ registered next to the built-ins
   Annotation { name, args } ──interpreter──► Contribution { nodes, edges, diagnostics }
```

What holds (spec 0015; the examples below were run through the CLI, and
`examples/extension-openapi-tags` in the effx repository is the tested reference):

- `@Annotate(name, ...args)` and `.annotate(name, ...args)` from `@effx/runtime` are the generic way
  to attach a custom annotation. The name must be a string literal and the arguments static
  literals: the compiler reads source and never evaluates your application modules.
- A name no registered extension owns is `EFFX1101`. Registering the extension in `effx.config.ts`
  is what makes it valid.
- An `extensions` array in the config **appends** to the built-ins; a callback
  `(builtin) => [...]` returns the complete ordered list.
- `generators: { http, rpc, cli, client, foldkit }` toggles built-in file generators only. It never
  changes interpretation, analyses, the IR or its semantic hash, and never toggles a custom
  extension's generator.
- The config module and everything it imports must not import application code that declares
  operations.
- Your extension imports only public packages: `@effx/compiler` (`Extension`, `Interpreter`,
  `Analysis`, `Generator`, `Contribution`, `decodeArgs`, `error`, `warning`, `GeneratedFile`) and
  `@effx/ir`. Anything else exported from `@effx/compiler` is marked internal.

Not available: there is no public way to run a custom extension outside the CLI without the private
TypeScript frontend. Use the CLI with a config.

The contract below is what every extension implements. The built-in
features (core, http, rpc, cli, client, foldkit, http-contract, http-group,
access-contract, problem-contract) are extensions built from the same
contract (`packages/compiler/src/Extension.ts`,
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

| Part           | Type (`Extension.ts`)                                                       | Rules                                                                   |
| -------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `name`         | `string`                                                                    | identifies the extension                                                |
| `interpreters` | `Record<annotationName, (annotation, declaration, ctx) => Contribution>`    | pure; an annotation name no extension owns is `EFFX1101`                |
| `analyses`     | `(ir, index, { strictAccess }) => Diagnostic[]`                             | pure; reads the graph; an `error` diagnostic stops generation           |
| `generators`   | `(ir, index, generationContext?) => Effect<GeneratedFile[], CompilerFault>` | emit ordinary files; output is sorted by path and must be deterministic |

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
- Diagnostic codes: choose codes that do not collide with the built-ins. No range is reserved
  for third-party extensions in the sources read, so the examples use `EFFX9xxx`.
