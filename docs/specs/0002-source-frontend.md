# Spec 0002 — Runtime surface and TypeScript source frontend (`@effx/runtime`, `@effx/frontend-ts`)

Status: **frozen** 2026-10-03 (revised same day: StableId identity is rootDir-relative; EFFX1106 added). Changes require editing this file explicitly.
Depends on: spec 0001 (annotation shapes, `Collected`, diagnostics), ADR 0001, ADR 0009.

## Goal

Real TypeScript using either syntax (decorators or builder chains) is analysed without
execution into the frontend-neutral `Collected` of spec 0001, with `E`/`R` inferred from the
handler's `Effect` type, and the generated Effect code typechecks against the fixture project.

Non-goals: Cedar/leases, runtime behaviour of decorators, `@Service interface` sugar, watch mode.

## Journey

```
users/operations.ts  (decorators)  ─┐
users/operations.builder.ts (chain) ─┼─▶ TsSourceFrontend.analyze ─▶ Collected ─▶ pipeline (spec 0001) ─▶ .effx/generated/*.ts ─▶ tsc --noEmit ✓
users/user.ts (@PersistentModel) ───┘
```

## `@effx/runtime` — one meaning, two syntaxes

### Runtime annotation record

`Annotation = { name: string, args: ReadonlyArray<unknown> }` — same `name`s and the same
argument _structure_ as spec 0001 §"Annotation argument shapes", but holding live values
(the real `Schema`, the real service class). Lowering live values to `AnnotationArg` is the
frontend's job. Decorators return `undefined` and never change behaviour (ADR 0001).

| Decorator                                                    | Builder                                          | Recorded annotation                                      |
| ------------------------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------- |
| `@Query({ name?, input, success })` on a static method       | `Operation.query({ name?, input, success })`     | `Query [{ name?, input, success }]`                      |
| `@Command({...})`                                            | `Operation.command({...})`                       | `Command [{...}]`                                        |
| `@Errors(A, B)`                                              | `.errors(A, B)`                                  | `Errors [A, B]`                                          |
| `@Requirements(Users)`                                       | `.requirements(Users)`                           | `Requirements [Users]`                                   |
| `@Authorize(capability)`                                     | `.authorize(capability)`                         | `Authorize [capability]`                                 |
| `@Http.Get(path)` … `Delete`                                 | `.http.get(path)` … `.http.delete(path)`         | `Http.Get [path]` …                                      |
| `@Rpc(name)`                                                 | `.rpc(name)`                                     | `Rpc [name]`                                             |
| `@Cli("users get")`                                          | `.cli("users get")`                              | `Cli ["users get"]`                                      |
| `@PersistentModel({ table, views?, focus? })` on a class `C` | `Model.persistent(C, { table, views?, focus? })` | `PersistentModel [{ table, views?, focus?, schema: C }]` |

Builder chains end with `.handler(fn)` and evaluate to `{ _tag: "Operation", annotations, handler: fn }`;
`Model.persistent` evaluates to `{ _tag: "Model", annotations, schema: C }`. Annotation order is
source order (decorators: top to bottom as written; chains: root to tip).

Plain values: `Capability.make(name, { resource, focus? })` → `{ _tag: "Capability", name, resource, focus? }`;
`Focus.key(Root, ...path)` → `{ _tag: "Focus", root, path }`.

### Registry

`context.metadata` exists under Bun but `Symbol.metadata` does not, so annotations live in a
module-level `WeakMap<object, Array<Annotation>>` keyed by the decorated value (class or static
method function). `Reflect.annotationsOf(target)` returns them (empty array when none).

### Law (runtime level)

For the same operation written both ways, `Reflect.annotationsOf(Class.method)` deep-equals
`builderValue.annotations` (same names, same argument structure, same live objects).

## `@effx/frontend-ts`

### Contract

```ts
ProjectConfig = { tsconfigPath: string, entry?: string[], outDir?: string }   // spec 0001 Collected.ts (revised)
Collected     = { declarations: Declaration[], diagnostics: Diagnostic[] }     // revised: frontend diagnostics travel as data
TsSourceFrontend.layer : Layer<SourceFrontend, never, FileSystem | Path>
```

| Rule              | Decision                                                                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Program           | `ts.readConfigFile` + `ts.parseJsonConfigFileContent` (via `FileSystem` for the tsconfig bytes), `ts.createProgram(entry ?? parsed.fileNames)` with `ts.createCompilerHost` (ts6 reads source through its own host; this is the registered boundary of ADR 0009) |
| Boundary          | every `ts.*` call that can throw is wrapped in `Effect.try` → `CompilerFault{ stage: "collect" }`; no `ts.*` value crosses `analyze`                                                                                                                             |
| Module specifier  | `module` of every `SchemaRef`/`SymbolRef` = POSIX relative path from `outDir` (default `<dirname(tsconfigPath)>/.effx/generated`) to the declaring file, extension stripped, always starting with `./` or `../`                                                  |
| StableIds         | `schema:<module>/<export>[.<member>]` (member for static schema members like `User.Public`); `service:<export>`                                                                                                                                                  |
| Runtime detection | an identifier/property access "is from runtime" when its aliased symbol's declaration file lies under the directory of `ts.resolveModuleName("@effx/runtime", …)`'s resolved file; never by name string                                                          |

### Recognition

| Source form                                                                         | Declaration                                                                                                        |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `class C { @X(...) static m() }` with ≥1 runtime decorator on `m`                   | `kind: "staticMethod", export: C, member: m, id: "C.m"`, handler = method                                          |
| `@PersistentModel(opts) class C`                                                    | `kind: "model", export: C, id: "C"`; args `[{ ...opts, schema: Schema(C) }]`                                       |
| `export const v = Operation.query(...)…​.handler(fn)` rooted at runtime `Operation` | `kind: "builder", export: v, id: "v"`, handler = `fn`, handler `SymbolRef{ module, export: v, member: "handler" }` |
| `export const v = Model.persistent(C, opts)`                                        | `kind: "model", export: v`; args `[{ ...opts, schema: Schema(C) }]`                                                |
| decorated non-static method, decorated field, chain not ending in `.handler`        | `EFFX1104` error with location; declaration skipped                                                                |

Chain method → annotation: `query/command → Query/Command`, `.http.<get|post|put|patch|delete>(p) → Http.<Get|…>`, `rpc`, `cli`, `authorize`, `errors`, `requirements`.

Model identity is the _schema's_ export (`model:User` for both `@PersistentModel class User` and
`Model.persistent(User, …)`); the core interpreter is revised accordingly.

### Argument lowering (`AnnotationArg`)

| Expression                                                                                              | Lowered                                                                     |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| string / numeric / `true` / `false` literal                                                             | primitive                                                                   |
| object literal of property assignments                                                                  | record                                                                      |
| array literal                                                                                           | array                                                                       |
| arrow / function expression                                                                             | `{ _tag: "Lambda" }`                                                        |
| identifier / property access whose type has property `~effect/Schema/Schema`                            | `{ _tag: "Schema", ref }`                                                   |
| identifier whose static type has `~effect/Context/Service` (or `key` + `~effect/Context/Key`)           | `{ _tag: "Symbol", ref }`                                                   |
| identifier resolving (through its initializer) to runtime `Capability.make(name, { resource, focus? })` | `{ name, resource: <resource export>, focus?: string[] }` (for `Authorize`) |
| `Focus.key(Root, "a", "b")` or array literal of strings                                                 | `["a","b"]` (inside `focus`)                                                |
| anything else                                                                                           | `EFFX1102` error with `location`; the annotation is dropped                 |

`Http.Problems.codes` array spreads resolve through const initializers, imports and re-exports
to readonly string-literal tuples (including nested spreads). The initializer walk owns the
values; the checker tuple must agree in elements and order. Dynamic operands, mutable arrays,
cycles and contradictory assertions are `EFFX1102` at the spread, naming its operand. The
expanded array preserves order and the existing duplicate-code diagnostic. Spread provenance
is optional `Collected.spreads` / manifest `spreads` data, never part of canonical IR or its hash.
Every underlying alias hop and array literal is checked before surrounding assertions,
so casting a mutable array to a readonly tuple cannot make it a static const tuple.

### `E`/`R` inference (technique that works, verified against effect 4.0.0 with ts 6.0.3)

1. `signature = checker.getSignatureFromDeclaration(method)` (or the call signature of
   `checker.getTypeAtLocation(fn)` for builder handlers); `ret = checker.getReturnTypeOfSignature(signature)`.
2. `ret` must be an object type with `ObjectFlags.Reference` whose target symbol is named `Effect`
   and is declared in a file under `effect/`; then `[A, E, R] = checker.getTypeArguments(ret)`.
   Otherwise `EFFX1105` (handler does not return an `Effect`) and no `handlerSignature`.
3. `E`/`R`: `isUnion() ? types : [type]`; `never` → empty. Each constituent:
   static side (`checker.getTypeOfSymbolAtLocation(symbol, valueDeclaration)`) has
   `~effect/Schema/Schema` → `Schema(SchemaRef)`; has `~effect/Context/Service` → `Service(service:<export>, SymbolRef)`;
   else `Opaque{ display: checker.typeToString(type) }`.
4. Known gotcha (documented, not solved here): `Effect.gen` bodies that fail with both a tagged
   error and a plain `Error` infer `E = Error` by common-supertype inference; effx reports that as
   `EFFX2203` (opaque) which is the correct user-facing signal.

### Diagnostics added by this spec

| Code     | Severity                          | Meaning                                                     |
| -------- | --------------------------------- | ----------------------------------------------------------- |
| EFFX0001 | info / warning when majors differ | frontend `ts.version` ≠ project `typescript` pin (ADR 0009) |
| EFFX1104 | error                             | unsupported decorator/builder form                          |
| EFFX1105 | error                             | handler does not return `Effect.Effect<A, E, R>`            |

## Laws / tests

| Law                       | Test                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| runtime equivalence       | `Reflect.annotationsOf(UserOperations.get)` deep-equals `getUser.annotations`                                                                                                            |
| collection                | `analyze(fixture)` yields the expected `Collected` (declarations, annotations, handlerSignature, no error diagnostics)                                                                   |
| syntax equivalence (IR)   | decorator file and builder file compiled separately give identical canonical IR **modulo the handler `SymbolRef`** (`UserOperations.get` vs `getUser.handler` is syntax-bound by nature) |
| assertions                | undeclared error with `@Errors` → EFFX2201; plain `Error` → EFFX2203; structural `R` → EFFX2304                                                                                          |
| generated code typechecks | pipeline output written to a temp dir + a tsconfig including fixture and generated dir → `tsc --noEmit` exit 0                                                                           |

## Definition of done

- `bun --bun node_modules/.bin/tsc --noEmit -p tsconfig.json`, `bun run lint`, `bun run fmt:check`, `bun --bun vitest run` green.
- All laws above are tests; the generated-code typecheck is the proof that generators emit valid Effect 4.0.0.
