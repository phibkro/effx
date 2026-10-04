## Declaring operations

An **operation** is one `Query` (reads) or `Command` (writes) with an input
Schema and a success Schema. You declare it in one of two equivalent syntaxes.
Both produce the same `Annotation` list (`{ name, args }`), the compiler lowers
that list to the same IR, and the same generators emit ordinary Effect
(`HttpApi`, `Rpc`, CLI command, client).

```
 decorators (static methods)        builder (exported values)
 ───────────────────────────        ─────────────────────────
 @Query({...})                      Operation.query({...})
 @Http.Get("/users/:id")            .http.get("/users/:id")
 @Errors(A, B)                      .errors(A, B)
 @Requirements(S)                   .requirements(S)
 static get(input) { ... }          .handler((input) => ...)
```

Rules that hold for both syntaxes:

- **A decorator or builder step is a contribution to the IR, never generated
  behaviour.** Decorators return `undefined`; they never wrap or replace your
  method (`packages/runtime/src/decorators.ts`).
- Order is source order. Decorators run bottom-up, but the runtime registry
  prepends, so `Reflect.annotationsOf(Class.method)` lists them top-down, the
  same order a builder chain appends (`packages/runtime/src/Annotation.ts`).
- The handler's error channel (`E`) and requirement channel (`R`) are
  **inferred** from its type. `@Errors` / `.errors(...)` and `@Requirements` /
  `.requirements(...)` only **assert** that inference; a mismatch is a
  diagnostic (ADR 0005). Exception: on a `.declare()` operation there is no
  handler to infer from, so they are declarations (see external binding).
- Use `@Http.Get/Post/Put/Patch/Delete`, `@Rpc(name)` and `@Cli(words)` (or
  `.http.*`, `.rpc(name)`, `.cli(words)`) to choose exposures. More HTTP detail
  goes in `@Http.Contract` (`.http.contract`), see the other sections.
- Annotation argument values (Schemas, services, functions) must be **exported
  symbols** or literals. The source frontend reads them statically and never
  runs your module.

### Annotation surface (from `packages/runtime/src`)

| Decorator              | Builder step              | Meaning                                      |
| ---------------------- | ------------------------- | -------------------------------------------- |
| `@Query(opts)`         | `Operation.query(opts)`   | read operation (`name?`, `input`, `success`) |
| `@Command(opts)`       | `Operation.command(opts)` | write operation                              |
| `@Errors(...schemas)`  | `.errors(...schemas)`     | assert (local) or declare (external) `E`     |
| `@Requirements(...S)`  | `.requirements(...S)`     | assert (local) or declare (external) `R`     |
| `@Http.Get(path)` etc. | `.http.get(path)` etc.    | HTTP exposure                                |
| `@Rpc(name)`           | `.rpc(name)`              | RPC exposure                                 |
| `@Cli(words)`          | `.cli(words)`             | CLI exposure                                 |
| `@Authorize(cap)`      | `.authorize(cap)`         | model capability link (`Capability.make`)    |

Not every decorator has a builder twin: class decorators `@Http.Group` and
`@PersistentModel` pair with `Http.group(...)` and `Model.persistent(...)`.

Never write a decorator or builder step from memory. Check
`node_modules/@effx/runtime/dist/Annotation.d.ts` for the exact option types.
