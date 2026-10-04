# effx documentation for LLMs

effx is an ahead-of-time (AOT) application compiler for Effect v4. You declare
operations with TC39 decorators or builder chains. A source frontend turns both
into identical annotations, extensions interpret them into a Schema-defined
intermediate representation (IR), analyses check the IR graph, and generators
emit **ordinary Effect** (`HttpApi`, `Rpc`, CLI commands, typed clients,
Foldkit commands, persistence ports and adapter conformance suites).

effx is the on-ramp from enterprise frameworks (NestJS, ASP.NET Core, Laravel) to
full-stack Effect: a familiar declarative surface on top, ordinary inspectable
Effect underneath, no lock-in (ADR 0012). Every annotation maps to a named Effect
construct, generated code stays readable and ejectable, and hand-written Effect
always coexists with declared operations.

```
 decorators / builder  ──►  annotations  ──►  IR (Schema, graph)  ──►  analyses  ──►  generated Effect
 (source syntax only)       (name, args)      (canonical JSON, hash)   (diagnostics)   (ordinary files)
```

## The invariant

**A decorator is a contribution to the IR, never generated behaviour.**
Decorators return `undefined` and never wrap or replace your code. Generated
output is ordinary Effect code you can read and typecheck, and effx has no
runtime dependency-injection layer (ADR 0001, ADR 0008).

## Where to look things up

Look in this order and stop at the first source that answers:

1. This documentation, including the examples (they are typechecked).
2. `node_modules/@effx/runtime/dist/Annotation.d.ts` (shipped declarations) for the exact option types of
   every annotation (`HttpContractOptions`, `HttpGroupOptions`,
   `HttpAccessOptions`, `HttpProblemsOptions`, `FoldkitCommandOptions`, ...), then
   `decorators.d.ts` and `builder.d.ts` beside it.
3. The specs in the effx repository: `docs/specs/NNNN-*.md` (frozen
   contracts) and `docs/decisions/NNNN-*.md` (ADRs). `STATE.md` records which
   slices are implemented; treat anything not marked as built as unavailable.

Effect itself is documented in `node_modules/effect/AGENTS.md` and the
`ai-docs` examples it links, then `node_modules/effect/src/<Module>.ts` for
exact signatures. **Never write Effect from memory**: Effect v4 names differ
from v3 (for example `Context.Service`, `Effect.fn`, `Effect.catch`,
`Schema.TaggedError<X>()("Tag", fields)`).

## effx and Effect

- Write handlers, services and layers as native Effect: `Effect.gen` /
  `Effect.fn`, `Context.Service`, `Layer`, Schema-defined errors. Plain pure
  functions stay plain functions.
- No `async` / `await` and no Promise boundary in effx-facing code. No
  `JSON.parse` outside a Schema codec.
- Handler types drive the contract. `E` and `R` are **inferred** from the
  handler's return type; `@Errors` / `@Requirements` only **assert** them
  (ADR 0005). A declaration-only (`.declare()`) operation is the exception: it
  has no handler, so they are declarations.
- Everything an annotation names (Schemas, services, middleware markers,
  registries, annotators, scope resolvers, message schemas) must be an
  **exported** value. The compiler reads symbols statically and never runs
  your module.
- Provide services with `Layer`s you compose at your application's edge. effx
  does not provide or resolve services for you.
- Use TC39 standard decorators (do not enable `experimentalDecorators`) and
  `.ts` import specifiers.
- effx does not authorize requests. Access annotations are data; your
  application evaluates them (ADR 0007 defers authority evaluation).
- Generated code lands in `.effx/generated/` next to the tsconfig you pass to
  `effx build --project <tsconfig>`. Do not edit it; change the declaration and
  rebuild.

## Commands

| Command                    | Purpose                                              |
| -------------------------- | ---------------------------------------------------- |
| `effx check`               | diagnose without writing                             |
| `effx build`               | write projections (`--emit=contract\|handlers\|all`) |
| `effx inspect <operation>` | show an operation's contract and exposures           |
| `effx graph [name]`        | print a Mermaid graph                                |

Shared flags: `--project <tsconfig>`, `--config <effx.config.ts>`; compile flags: `--strict-access`,
`--target`, `--emit`, `--out-dir` (`packages/cli/src/main.ts`).

## Sections

| Section                     | Covers                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------- |
| Declaring operations        | decorator and builder operations, annotation equivalence                                 |
| Declaration-only operations | `.declare()` and external binding by the application                                     |
| Group defaults              | `Http.group` / `@Http.Group` shared middleware, problems, access                         |
| Problems and access         | `Http.Problems` registries, `Http.Access` capabilities and concealment                   |
| Foldkit commands            | `Foldkit.Command` and command identity                                                   |
| Custom annotations          | `effx.config.ts`, `@Annotate`, and typed `Annotation.define` + `implement` / `extension` |
| Persistence ports           | `Persist.Port`, generated leaf services, adapter Layers and shared conformance scenarios |

**Note**: the examples contain comments for illustration. In practice you
would not include these comments in your code.

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

### Decorator operation

Declare operations as static methods annotated with TC39 decorators from
`@effx/runtime`. A decorator is a contribution to the IR, never generated
behaviour: the method body stays your ordinary Effect code.

```ts
import { Cli, Command, Errors, Http, Query, Requirements, Rpc } from "@effx/runtime";
import { Effect } from "effect";
import {
  ChangeEmailInput,
  EmailTaken,
  GetUserInput,
  UserNotFound,
  UserPublic,
  UserSelf,
  Users,
} from "./fixtures/users.ts";

// Group operations in a class of static methods. Decorators are standard
// (TC39) decorators; do not enable `experimentalDecorators`.
export class UserOperations {
  // `@Query` / `@Command` define the operation: its name, input Schema and
  // success Schema. `@Query` is a semantic claim ("this reads"), not a proof
  // of purity (ADR 0006).
  @Query({ name: "User.Get", input: GetUserInput, success: UserPublic })
  // Exposure decorators say where the operation is reachable. The compiler
  // generates an `HttpApi` route, an `Rpc` and a CLI command from these.
  @Http.Get("/users/:id")
  @Rpc("User.Get")
  @Cli("users get")
  static get(input: typeof GetUserInput.Type) {
    // The body is a normal Effect. The error channel (`UserNotFound`) and the
    // requirement channel (`Users`) are inferred from this return type.
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      // Return the public view: no email leaks through this operation.
      return { id: user.id, displayName: user.displayName };
    });
  }

  @Command({ name: "User.ChangeEmail", input: ChangeEmailInput, success: UserSelf })
  @Http.Patch("/users/:id/email")
  // `@Errors` and `@Requirements` do not add behaviour. They assert what the
  // compiler inferred from the handler; a mismatch is a diagnostic (ADR 0005).
  @Errors(UserNotFound, EmailTaken)
  @Requirements(Users)
  static changeEmail(input: typeof ChangeEmailInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      // Always `return yield*` a failure so TypeScript sees the path end.
      return yield* users.setEmail(input.id, input.email);
    });
  }
}
```

### Builder operation

The builder is the value-level twin of the decorators. Each step appends the
same annotation its decorator would record, so both forms lower to the same IR.

```ts
import { Operation } from "@effx/runtime";
import { Effect } from "effect";
import {
  ChangeEmailInput,
  EmailTaken,
  GetUserInput,
  UserNotFound,
  UserPublic,
  UserSelf,
  Users,
} from "./fixtures/users.ts";

// Export each operation: the compiler resolves declarations from exported
// symbols. `Operation.query(...)` is `@Query(...)`; `.http.get(...)` is
// `@Http.Get(...)`; `.rpc(...)` is `@Rpc(...)`.
export const getUser = Operation.query({
  name: "User.Get",
  input: GetUserInput,
  success: UserPublic,
})
  .http.get("/users/:id")
  .rpc("User.Get")
  .cli("users get")
  // `.handler(...)` ends the chain and keeps your function untouched. The
  // compiler infers the error and requirement channels from its type.
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    }),
  );

export const changeEmail = Operation.command({
  name: "User.ChangeEmail",
  input: ChangeEmailInput,
  success: UserSelf,
})
  .http.patch("/users/:id/email")
  // Assertions, as with `@Errors` / `@Requirements`: they check the inferred
  // channels and never widen or narrow the handler.
  .errors(UserNotFound, EmailTaken)
  .requirements(Users)
  .handler((input: typeof ChangeEmailInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.setEmail(input.id, input.email);
    }),
  );
```

### More examples

- **[Decorator and builder record the same annotations](./ai-docs/src/01_operations/10_annotation-equivalence.ts)**:
  `Reflect.annotationsOf` reads the runtime annotation list. A decorated method
  and a builder chain written in the same order produce equal lists.

## Declaration-only operations and external binding

Use `.declare()` when the contract belongs to effx but the behaviour does not:
the backend already owns its handler, transaction and response bytes. The
builder ends with `.declare()` instead of `.handler(...)`, and effx generates
**wiring only** (spec 0010, `docs/specs/0010-target-profiles-and-emit-modes.md`).

```
 .handler(fn)   → Operation node with `handler: SymbolRef`      (local binding)
 .declare()     → Operation node with `binding: "external"`     (no handler)
```

`.declare()` exists only on the builder (`packages/runtime/src/builder.ts`,
`ExternalOperationValue`). A decorated method always has a body, so there is no
decorator form.

### What the compiler expects

Source: `packages/compiler/src/extensions/{core,http-contract,http-group}.ts`.

| Rule                                                                                         | Diagnostic |
| -------------------------------------------------------------------------------------------- | ---------- |
| External operation has no handler and no signature; local operation requires both            | `EFFX1106` |
| External HTTP operation needs an `Http.Contract` with `metadata.operationId`                 | `EFFX2403` |
| `operationId` is exactly `<group>.<identifier-safe key>`; keys are unique per root and group | `EFFX2403` |
| One group never mixes local and external operations                                          | `EFFX2403` |
| An external group needs an `Http.group` / `@Http.Group` declaration                          | `EFFX2402` |
| That group's `root` is a concrete exported `HttpApi` value, not a string                     | `EFFX2402` |
| External HTTP binding cannot also be exposed as RPC/CLI, or carry `Foldkit.Command`          | `EFFX1107` |

`@Errors` and `@Requirements` on an external operation stay in the IR (as
`ErrorOf` and `Requires` edges) but do not cap the bound implementation: extra
backend-only services are allowed (spec 0010, "Declaration-only operations").

### Emit modes

`effx build --emit=contract|handlers|all` selects which projection is written
(`packages/cli/src/main.ts`, spec 0010). The mode is not an IR input, so both
passes have the same semantic hash.

| Mode       | File (group `invoices`)      | Contents                                                                                  |
| ---------- | ---------------------------- | ----------------------------------------------------------------------------------------- |
| `contract` | `invoices-contract.ts`       | endpoint constants and the `InvoicesApi` `HttpApiGroup`; imports no backend code or root  |
| `handlers` | `invoices-handlers.ts`       | `InvoicesApiHandlers({ raw, guards })`, registered with `handleRaw` on your concrete root |
| `all`      | both, plus local projections | default                                                                                   |

File and export names come from `packages/compiler/src/generate/http-contracts.ts`
(`groupApiName`, `groupApiHandlersName`).

### The application side

The generated handlers factory takes two records keyed by the endpoint key and
the qualified operation id. You write them; effx never invents a handler, a
principal or a response. Shape taken from a generated fixture
(`packages/frontend-ts/test/fixtures/rc116/src/fixture-binding.ts`); the module
path and names below are illustrative and are produced by the build:

```ts
// Illustrative: generated types come from `effx build --emit=handlers`.
import {
  InvoicesApiHandlers,
  type InvoicesGuards,
  type InvoicesRawHandlers,
} from "../.effx/generated/invoices-handlers.ts";

// One lazy guard per qualified operation id. The generated code only calls it
// when your raw handler calls `authorize()`, inside your own transaction.
export const guards = {
  "invoices.get": guardForGet,
  "invoices.void": guardForVoid,
} satisfies InvoicesGuards<Endpoints>;

// One raw handler per endpoint key. You own the body, status and headers.
export const raw = {
  get: (request, authorize) =>
    Effect.gen(function* () {
      /* ... */
    }),
  void: (request, authorize) =>
    Effect.gen(function* () {
      /* ... */
    }),
} satisfies InvoicesRawHandlers<Endpoints, typeof guards>;

export const InvoicesLive = InvoicesApiHandlers({ raw, guards });
```

Missing keys or incompatible error channels fail TypeScript on the generated
file. The compiler proves only that a binding is required and typed, not that
your handler calls `authorize()` at the right point.

### Status

Declaration-only operations, `--emit` modes and raw handlers are implemented
(`STATE.md`: "Gate 3 compiler prerequisites" and the Profile, Schools,
SocialEvents rows). Mono-web migration gates are separate evidence; this
section describes the compiler contract only.

### Declaration-only operation

`.declare()` ends a builder chain without a handler. The operation enters the IR
with `binding: "external"` and your application binds the behaviour itself.

```ts
import { Http, Operation } from "@effx/runtime";
import {
  BillingApi,
  GetInvoiceInput,
  InvoiceNotFound,
  InvoiceResponse,
  VoidInvoiceInput,
  VoidInvoiceParams,
} from "./fixtures/billing.ts";

// An external HTTP operation needs a group declaration with a concrete root
// symbol. The group is a separate exported value and one `HttpGroup` IR node.
export const InvoiceGroup = Http.group({
  root: BillingApi,
  group: "invoices",
  title: "Invoices",
  description: "Read and void invoices.",
  displayName: "Invoices",
});

// `.in(group)` associates the operation with the group: it supplies
// `root` and `group` to `.http.contract(...)` so you do not repeat them.
export const getInvoice = Operation.query({
  name: "invoices.get",
  input: GetInvoiceInput,
  success: InvoiceResponse,
})
  .in(InvoiceGroup)
  .http.get("/api/invoices/:id")
  .http.contract({
    params: GetInvoiceInput,
    // External HTTP operations MUST state `metadata.operationId` as exactly
    // `<group>.<endpointKey>`. The key (`get`) names the endpoint, the raw
    // binding record entry and the guard record entry (EFFX2403 otherwise).
    metadata: { operationId: "invoices.get", summary: "Read an invoice", tags: ["Invoices"] },
  })
  // No handler exists in this file; the backend binds `get` itself.
  .declare();

export const voidInvoice = Operation.command({
  name: "invoices.void",
  input: VoidInvoiceInput,
  success: InvoiceResponse,
})
  .in(InvoiceGroup)
  .http.post("/api/invoices/:id/void")
  .http.contract({
    // The path parameter and the JSON body are separate request channels.
    params: VoidInvoiceParams,
    payload: VoidInvoiceInput,
    metadata: { operationId: "invoices.void", summary: "Void an invoice" },
  })
  // With no handler to infer from, `.errors(...)` is a declaration of the
  // failures the bound implementation may raise (and stays in the IR).
  .errors(InvoiceNotFound)
  .declare();
```

## Group defaults

Operations in one HTTP group usually repeat the same middleware, problem
registry, OpenAPI annotator and access policy. Declare those once on the group.
Spec: `docs/specs/0013-group-defaults.md`; implementation:
`packages/compiler/src/group-defaults.ts`, `extensions/http-group.ts`.

```
 Http.group({ root, group, defaults })      @Http.Group({ root, group, defaults })
        ▲                                          ▲   (decorates the class)
        │ .in(group)                               │ static methods inherit
 Operation.query/command(...)               @Query/@Command(...) static method
```

**Defaults are source syntax.** Before interpretation the compiler expands them
into each operation's ordinary annotations. They are not a new IR node, are not
serialized (`defaults` never reaches the IR), and no application function is
called while compiling. A dense and a fully spelled-out declaration with the
same meaning have the same canonical IR, semantic hash and generated files.

### Options

| Option                                                                                    | Meaning                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `root`                                                                                    | string (local roots) or an exported concrete `HttpApi` value (required for external groups)       |
| `group`                                                                                   | group identifier                                                                                  |
| `title`, `description`, `displayName`                                                     | group OpenAPI metadata                                                                            |
| `defaults.middleware`                                                                     | security/middleware marker classes                                                                |
| `defaults.metadata.annotator`                                                             | exported function `(metadata) => Context` merged onto each endpoint                               |
| `defaults.problems.registry`                                                              | exported `ProblemRegistry`; fills an existing `Http.Problems` that omits `registry`               |
| `defaults.access.{annotator, exposure, acceptedCredentials, principalKinds, concealment}` | fills an existing `Http.Access`; never invents capabilities, requirements, scope or decision time |

Source: `packages/runtime/src/Annotation.ts` (`HttpGroupOptions`).

### Merge and inference rules

- Merging is **per field**. An explicit operation field wins over the same
  group field, even an empty array (`middleware: []`).
- `.in(group)` / the class decorator supplies `root` and `group` to the
  operation's `Http.Contract`. `Http.Contract` is still written on every HTTP
  operation (otherwise `EFFX2405`).
- Defaults fill an annotation that exists. They never create `Http.Problems`
  (it needs its own `codes`) or `Http.Access` (it needs its own capabilities).
- Operation id: when `metadata.operationId` is absent and the operation `name`
  is exactly `<group>.<safe key>`, that name is the operation id. An explicit
  id wins.
- `Http.Contract.success` defaults to the declared `success`.
  `query: true` on a GET `Query` means the declared `input`. The other request
  channels come from `input` too (next section). Incompatible use of
  `query: true` is a diagnostic, never a guessed route shape.
- A group never mixes local and external operations (`EFFX2403`).

### Request channels derived from `input`

Dense or not, an operation's `input` implies which `Http.Contract` channel it
fills. Before interpretation the compiler writes that channel into the contract
arguments (group or no group), so the result equals the spelled-out contract:
same IR, `paramsKeys`/`headersKeys`, hash and generated files. Spec:
`docs/specs/0024-declaration-density.md` §2; implementation:
`packages/compiler/src/request-channels.ts`.

| Step | The input …                                                               | Becomes                                                    |
| ---- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 0    | already is the Schema of an explicit channel                              | nothing derived (`input: X` with `headers: X` stays valid) |
| 1    | is wrapped by `Http.headers(schema)`                                      | `headers` (`EFFX2410` if `headers` is another Schema)      |
| 2    | has no path parameters                                                    | GET/DELETE `query`; POST/PUT/PATCH `payload`               |
| 3    | has exactly the route's path parameters as keys                           | `params`                                                   |
| 4    | has keys, none of them a path parameter                                   | as step 2 (the explicit `params` stay)                     |
| 5    | mixes path parameters and other keys                                      | `EFFX2410`: write `params` and the body channel            |
| 6    | has unknown keys (union, brand, `Void`) and the route has path parameters | POST/PUT/PATCH `payload`; GET/DELETE `EFFX2411`            |

- An explicit channel always wins: a derived channel never replaces one, and an
  ambiguity (5, 6) is a diagnostic only while nothing resolves it (`payload` or
  `query` written for step 5; `params` or `query` for step 6).
- A path parameter name ends before an action suffix: `/items/:id:cancel` has
  one parameter, `id`, when `id` is an input key.
- A GET/DELETE input without keys derives no `query`; a body is still a body.
  A Query over POST keeps its explicit `payload` (ADR 0010).
- `Http.headers` is the identity function at runtime. The compiler recognises
  the wrapper by the brand on the Schema's static type, never by its name or by
  header-looking keys. A marked Schema needs static keys; they are its required
  keys, exactly what `headers:` records.

### Diagnostics

| Code       | Condition                                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| `EFFX2404` | group reference is unresolved, not exported, not a group, repeated or multiple                                          |
| `EFFX2405` | explicit `root`/`group` conflicts with the group; bad `query: true`; missing `Http.Contract`                            |
| `EFFX2406` | two distinct raw group ids normalize to the same generated export name in one root                                      |
| `EFFX2410` | `input` mixes path parameters and other keys, or is a header schema next to a different `headers`                       |
| `EFFX2411` | GET/DELETE with path parameters and an `input` whose keys are not static, while neither `params` nor `query` is written |

An operation with both a class-level `@Http.Group` and `.in(...)` fails with
`EFFX2404`. The reference must resolve statically to one exported group in the
same project; no runtime import happens.

### Status

Implemented (`STATE.md`: Schools, SocialEvents and Profile rows consume it;
spec 0013 is the contract). Group export names derive PascalCase parts at
`-`, `_` and `.` (`social-events` produces `SocialEventsApi`).

### Group defaults with Http.group

State middleware, problem registry, metadata annotator and access policy once on the
group. Operations joined with `.in(group)` inherit them field by field.

```ts
import { Capability, Concealment, Http, Operation } from "@effx/runtime";
import {
  ConditionalReadHeaders,
  CurrentAccount,
  ReadSettingsInput,
  SessionSecurity,
  SettingsApi,
  SettingsPatch,
  SettingsResponse,
  WriteHeaders,
  settingsAccessAnnotations,
  settingsOperationAnnotations,
  settingsProblems,
} from "./fixtures/settings.ts";

// Export the group: operations reference it by symbol and the frontend resolves
// it statically to exactly one exported declaration (EFFX2404 otherwise).
export const SettingsGroup = Http.group({
  root: SettingsApi,
  group: "settings",
  title: "Settings",
  description: "Per-account settings.",
  displayName: "Settings",
  // Defaults are source syntax. They are merged into each operation's own
  // annotations before interpretation and are never serialized in the IR.
  defaults: {
    middleware: [SessionSecurity],
    metadata: { annotator: settingsOperationAnnotations },
    problems: { registry: settingsProblems },
    access: {
      annotator: settingsAccessAnnotations,
      exposure: "External",
      acceptedCredentials: ["BetterAuthCookie"],
      principalKinds: ["Person"],
      concealment: Concealment.reveal,
    },
  },
});

// What stays per operation: route, request channels, problem codes,
// capabilities, requirements, scope resolver and decision time. Defaults never
// invent those.
export const readSettings = Operation.query({
  // A name of the exact shape `<group>.<key>` doubles as the operation id, so
  // no `metadata.operationId` is needed (spec 0013).
  name: "settings.read",
  input: ReadSettingsInput,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.get("/api/settings")
  // `root`, `group` and `success` come from the group and the operation.
  .http.contract({ headers: ConditionalReadHeaders, status: 200 })
  // The registry comes from the group default; the codes stay explicit.
  .http.problems({ codes: ["authority.denied", "settings.not-found"] })
  .http.access({
    capabilities: Capability.one("settings.read"),
    requirements: [],
    canonicalScopeResolver: CurrentAccount,
  })
  .declare();

export const updateSettings = Operation.command({
  name: "settings.update",
  input: SettingsPatch,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.patch("/api/settings")
  // `payload` is omitted: the declared `input` is the body of a PATCH, POST or PUT Command unless
  // it is the params or headers schema (request channels are derived from `input`, see below).
  .http.contract({ headers: WriteHeaders, status: 200 })
  .http.problems({ codes: ["authority.denied", "precondition.failed"] })
  .http.access({
    capabilities: Capability.one("settings.update"),
    requirements: [],
    canonicalScopeResolver: CurrentAccount,
    // `decisionTime` is omitted: a Command decides inside its own transaction and a Query in a
    // read snapshot. Write it only to override the default (spec 0024 §4).
  })
  .declare();
```

### Group defaults with @Http.Group

Decorate the class once. Its static HTTP operations are associated with the group
and inherit the same defaults as builder operations joined with `.in(group)`.

```ts
import { Capability, Command, Concealment, Http, Query } from "@effx/runtime";
import { Effect } from "effect";
import {
  ConditionalReadHeaders,
  CurrentAccount,
  ReadSettingsInput,
  SessionSecurity,
  SettingsPatch,
  SettingsResponse,
  WriteHeaders,
  settingsAccessAnnotations,
  settingsProblems,
} from "./fixtures/settings.ts";

// A local (non-declared) group may use a plain string root. `@Http.Group`
// takes the same options and defaults as `Http.group(...)`.
@Http.Group({
  root: "settings-local",
  group: "settings",
  title: "Settings",
  defaults: {
    middleware: [SessionSecurity],
    problems: { registry: settingsProblems },
    access: {
      annotator: settingsAccessAnnotations,
      exposure: "External",
      acceptedCredentials: ["BetterAuthCookie"],
      principalKinds: ["Person"],
      concealment: Concealment.reveal,
    },
  },
})
export class SettingsOperations {
  @Query({ name: "settings.read", input: ReadSettingsInput, success: SettingsResponse })
  @Http.Get("/api/settings")
  @Http.Contract({ headers: ConditionalReadHeaders })
  @Http.Problems({ codes: ["authority.denied"] })
  @Http.Access({
    capabilities: Capability.one("settings.read"),
    requirements: [],
    canonicalScopeResolver: CurrentAccount,
  })
  // A protected local operation takes a lazy `authorize` thunk as its second
  // argument. Call it at the point your own snapshot or transaction needs it.
  static read(_input: typeof ReadSettingsInput.Type, authorize: () => Effect.Effect<void>) {
    return Effect.gen(function* () {
      yield* authorize();

      return { theme: "light" as const };
    });
  }

  @Command({ name: "settings.update", input: SettingsPatch, success: SettingsResponse })
  @Http.Patch("/api/settings")
  @Http.Contract({ headers: WriteHeaders })
  @Http.Problems({ codes: ["authority.denied"] })
  @Http.Access({
    capabilities: Capability.one("settings.update"),
    requirements: [],
    canonicalScopeResolver: CurrentAccount,
  })
  static update(input: typeof SettingsPatch.Type, authorize: () => Effect.Effect<void>) {
    return Effect.gen(function* () {
      yield* authorize();

      return { theme: input.theme };
    });
  }
}
```

### Request channels derived from `input`

The operation `input` says which request channel it fills; `Http.Contract` only spells what the
input cannot imply. The compiler writes the derived channel into the contract before
interpretation, so the dense and the spelled-out declaration share IR, hash and generated files.

```ts
import { Capability, Operation } from "@effx/runtime";
import {
  AnonymousScope,
  SearchSettingsInput,
  SettingsById,
  SettingsList,
  SettingsRename,
  SettingsResponse,
  VersionHeaders,
} from "./fixtures/settings.ts";
import { SettingsGroup } from "./01_group-builder.ts";

// GET without path parameters: the input is the `query`. No `query: true`, no `query:`.
export const searchSettings = Operation.query({
  name: "settings.search",
  input: SearchSettingsInput,
  success: SettingsList,
})
  .in(SettingsGroup)
  .http.get("/api/settings/search")
  .http.contract({ status: 200 })
  .http.problems({ codes: ["request.malformed"] })
  .http.access({
    capabilities: Capability.one("settings.search"),
    requirements: [],
    canonicalScopeResolver: AnonymousScope,
  })
  .declare();

// An input wrapped by `Http.headers(...)` is the `headers` channel (never a body). The compiler
// detects the wrapper by the static type of the schema, not by its name or its keys.
export const readVersion = Operation.query({
  name: "settings.readVersion",
  input: VersionHeaders,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.get("/api/settings/version")
  .http.contract({ status: 200 })
  .http.problems({ codes: ["request.malformed"] })
  .http.access({
    capabilities: Capability.one("settings.read-version"),
    requirements: [],
    canonicalScopeResolver: AnonymousScope,
  })
  .declare();

// Every input field is a path parameter: the input is the `params` (its keys must be the route's).
export const readById = Operation.query({
  name: "settings.readById",
  input: SettingsById,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.get("/api/settings/:settingsId")
  .http.contract({ status: 200 })
  .http.problems({ codes: ["settings.not-found"] })
  .http.access({
    capabilities: Capability.one("settings.read"),
    requirements: [],
    canonicalScopeResolver: AnonymousScope,
  })
  .declare();

// No input field is a path parameter: the `params` stay explicit (the input does not carry them) and
// the input is the body of a PATCH. An input mixing both kinds is `EFFX2410`: write the channels.
export const renameSettings = Operation.command({
  name: "settings.rename",
  input: SettingsRename,
  success: SettingsResponse,
})
  .in(SettingsGroup)
  .http.patch("/api/settings/:settingsId")
  .http.contract({ params: SettingsById, status: 200 })
  .http.problems({ codes: ["settings.not-found"] })
  .http.access({
    capabilities: Capability.one("settings.rename"),
    requirements: [],
    canonicalScopeResolver: AnonymousScope,
  })
  .declare();
```

### More examples

- **[Overriding group defaults per operation](./ai-docs/src/03_group-defaults/10_overrides.ts)**:
  An explicit operation field wins over the group default, including an empty
  `middleware` array. Defaults merge per field, never object by object.

## Problems and access

Two annotations describe the failure and authority surface of an HTTP
operation. Both are **declarations stored in the IR**. effx does not
authorize a request, resolve a credential or translate a domain error to a
response body at runtime; the application supplies those (specs
`docs/specs/0005-http-contract-extension.md`,
`docs/specs/0006-access-contract-extension.md`).

### `Http.Problems`

`@Http.Problems(opts)` / `.http.problems(opts)`; type `HttpProblemsOptions`
in `packages/runtime/src/Annotation.ts`.

| Field        | Meaning                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| `codes`      | nonempty, unique problem codes; the **single source** of the endpoint's code list                      |
| `registry`   | exported `(identifier, codes) => ReadonlyArray<Schema.Top>`; optional when a group default supplies it |
| `identifier` | optional schema name; default `Registry("<endpointKey>Problem", codes)`                                |
| `map`        | optional `{ DomainErrorTag: code }`; every value must appear in `codes`                                |

The generated endpoint calls your registry for its `error` union. The registry
owns status, body shape and headers; effx keeps no code table. The handler
stays an ordinary Effect, and its domain-error to problem conversion is
application code.

| Code       | Condition                                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| `EFFX2205` | an operation error has no `map` entry and no HTTP status annotation, or a `map` key is not an operation error |
| `EFFX2206` | a `map` value is not in `codes`                                                                               |
| `EFFX2402` | duplicate `Http.Problems`, non-unique `codes`, unsafe `identifier`, or no HTTP exposure                       |

### `Http.Access`

`@Http.Access(opts)` / `.http.access(opts)`; type `HttpAccessOptions`.

| Field                        | Shape                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `annotator`                  | exported `(spec) => Context`; merged onto the endpoint after middleware (group default allowed)   |
| `exposure`                   | `"External"` or `"Internal"`                                                                      |
| `acceptedCredentials`        | nonempty names (`None`, `BetterAuthCookie`, ... application-owned strings)                        |
| `principalKinds`             | nonempty names (`Anonymous`, `Person`, ...)                                                       |
| `capabilities`               | `Capability.one(c)`, `.any(a, ...)`, `.all(a, ...)` or `.none`                                    |
| `requirements`               | `{ id, parameters? }[]` with JSON-only parameters                                                 |
| `canonicalScopeResolver`     | exported symbol; the annotator maps it to the app's resolver id                                   |
| `concealment`                | `Concealment.reveal` or `Concealment.notFound(stage, ...)`                                        |
| `decisionTime`               | optional: `"SnapshotRead"` for a `Query`, `"Transaction"` for a `Command`; an explicit value wins |
| `snapshotDecisionForCommand` | optional `true`; compiler-only claim for a capability-only Command (ADR 0013)                     |

**Decision time defaults from the operation kind** (spec 0024 §4). Leave it out and
the pre-pass writes `SnapshotRead` for a `Query` and `Transaction` for a `Command`
before interpretation, so the IR, hash and generated files equal the spelled-out
declaration. Builder, decorator and group-level access behave alike; a group's
`defaults.access` has no `decisionTime` (it is per operation by nature). Write the
value only to override the default, e.g. a read that decides inside a transaction.
`EFFX2501` and `EFFX2502` check the resolved value, so a default never trips them.

`Capability.make(name, { resource, focus? })` is a different thing: it builds a
**model** capability for `@Authorize` / `.authorize(...)`. The access
constructors above build the capability **expression** stored in `Http.Access`.
Literal tagged objects such as `{ _tag: "One", capability: "x" }` also lower to
the same arguments.

### The guard boundary

For each protected operation the generated code requires an application guard
and passes your handler a **lazy nullary thunk** as its second argument:

```
 handler(input, authorize)   authorize: () => Effect<Principal, Problem, R>
                              │
                              └─ nothing runs until the handler calls it, inside
                                 its own read snapshot or committing transaction
```

A missing or non-Effect `authorize` fails TypeScript on the generated file. A
typed binding does not prove the handler calls it at the right time; that
needs a real end-to-end run.

### Analyses

| Code       | Condition                                                                                             | Severity                              |
| ---------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `EFFX2501` | a `Command` declares `SnapshotRead` without an accepted `snapshotDecisionForCommand` claim            | error                                 |
| `EFFX2502` | a `Query` declares `Transaction`                                                                      | warning                               |
| `EFFX2503` | a credential other than sole `None` is accepted but `Http.Contract.middleware` has no security marker | error                                 |
| `EFFX2504` | an HTTP operation has no `Http.Access`                                                                | warning; error with `--strict-access` |
| `EFFX2500` | duplicate `Http.Access`                                                                               | error                                 |
| `EFFX2506` | `snapshotDecisionForCommand: true` is declared outside the one allowed shape (see below)              | error                                 |
| `EFFX2414` | `decisionTime` omitted on a declaration with no single `Query` or `Command` to default it from        | error                                 |

A **security marker** is an `HttpApiMiddleware.Service` class that carries
Effect's `security` option. Any other middleware does not satisfy `EFFX2503`.

`snapshotDecisionForCommand: true` (ADR 0013) lifts `EFFX2501` for a `Command` only when it also declares
`SnapshotRead`, empty `requirements`, `acceptedCredentials: ["ObjectCapability"]` and
`principalKinds: ["CapabilityHolder"]`. Any other use, including on a `Query` or beside `Transaction`, is
`EFFX2506`. The claim is compiler-only: the annotator never receives it, and `false` is the same as absent.
It asserts a declared shape, not that the resolver only routes or that your guard compares the token
correctly; the application middleware and guard own that.

Read-only queries over POST: `@Http.Contract({ payloadIsQuery: true, payload })`
on a `Query` with `@Http.Post` (ADR 0010); it is rejected unless the operation
is a Query, the method is POST and a payload exists.

### Status

Both are implemented (`STATE.md`: "HTTP contract extension", "AccessContract
and Query POST" rows). Authority evaluation (Cedar, leases, ADR 0007) is
deferred and is not part of effx today.

### Typed problem responses

`Http.Problems` names the closed set of problem codes an endpoint can return. A
registry function you own derives the response schemas from those codes.

```ts
import { Http, Query, Requirements } from "@effx/runtime";
import { Effect } from "effect";
import {
  ReadSettingsInput,
  SettingsResponse,
  SettingsStore,
  settingsProblems,
} from "./fixtures/settings.ts";

export class SettingsReads {
  @Query({ name: "settings.read", input: ReadSettingsInput, success: SettingsResponse })
  @Http.Get("/api/settings")
  @Http.Contract({ group: "settings", success: SettingsResponse })
  @Http.Problems({
    // An exported derivation function. The generated endpoint calls
    // `settingsProblems("<endpointKey>Problem", [...codes])` for its `error`
    // union; effx never calls it while compiling.
    registry: settingsProblems,
    // The single source of the code list. Nonempty and unique. It may list
    // codes no handler raises (for example request-decoding failures).
    codes: ["settings.not-found", "request.malformed"],
    // `map` links domain errors (by their `_tag`) to codes. An error with no
    // map entry and no HTTP status annotation is EFFX2205; a mapped code
    // missing from `codes` is EFFX2206.
    map: { SettingsNotFound: "settings.not-found" },
  })
  @Requirements(SettingsStore)
  static read(_input: typeof ReadSettingsInput.Type) {
    return Effect.gen(function* () {
      // The failure stays an ordinary typed error. The mapping is a contract
      // about it, not a runtime translation that effx generates for you.
      const store = yield* SettingsStore;

      return yield* store.read;
    });
  }
}
```

### Declaring access with Http.Access

`Http.Access` records who may call an endpoint as data. The application owns
evaluation; effx only requires a typed, lazy guard at the handler boundary.

```ts
import { Capability, Command, Concealment, Http, Query } from "@effx/runtime";
import { Effect } from "effect";
import {
  type Authorize,
  CurrentAccount,
  ReadSettingsInput,
  SessionSecurity,
  SettingsPatch,
  SettingsResponse,
  SettingsStore,
  WriteHeaders,
  settingsAccessAnnotations,
} from "./fixtures/settings.ts";

export class SettingsAccessOperations {
  @Query({ name: "settings.read", input: ReadSettingsInput, success: SettingsResponse })
  @Http.Get("/api/settings")
  // A protected operation needs a security marker in `middleware`
  // (EFFX2503 otherwise). A marker is not any middleware: it must carry
  // Effect's HttpApiMiddleware security stamp.
  @Http.Contract({ group: "settings", success: SettingsResponse, middleware: [SessionSecurity] })
  @Http.Access({
    // An exported function `(spec) => Context`. The generated endpoint calls it
    // with the values below and merges the Context onto the endpoint.
    annotator: settingsAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    // Names are application strings. Constructors build the tagged values.
    capabilities: Capability.one("settings.read"),
    requirements: [{ id: "settings.owner" }],
    // An exported symbol the app maps to its own resolver id.
    canonicalScopeResolver: CurrentAccount,
    concealment: Concealment.reveal,
    // No `decisionTime`: a Query decides in a read snapshot, a Command inside its
    // committing transaction. The compiler fills the kind's default.
  })
  static read(_input: typeof ReadSettingsInput.Type, authorize: Authorize) {
    return Effect.gen(function* () {
      // `authorize` is lazy: nothing ran before this line. Call it where your
      // own snapshot (read) or transaction (write) needs the decision.
      yield* authorize();
      const store = yield* SettingsStore;

      return yield* store.read;
    });
  }

  @Command({ name: "settings.update", input: SettingsPatch, success: SettingsResponse })
  @Http.Patch("/api/settings")
  @Http.Contract({
    group: "settings",
    headers: WriteHeaders,
    payload: SettingsPatch,
    success: SettingsResponse,
    middleware: [SessionSecurity],
  })
  @Http.Access({
    annotator: settingsAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: Capability.one("settings.update"),
    requirements: [{ id: "settings.owner" }],
    canonicalScopeResolver: CurrentAccount,
    concealment: Concealment.reveal,
    // A write decides inside the committing transaction (the Command default).
    // Writing `decisionTime: "SnapshotRead"` on a Command is EFFX2501.
  })
  static update(input: typeof SettingsPatch.Type, authorize: Authorize) {
    return Effect.gen(function* () {
      yield* authorize();
      const store = yield* SettingsStore;

      return yield* store.write(input);
    });
  }
}
```

### More examples

- **[Capability and concealment variants](./ai-docs/src/04_problems-and-access/10_access-variants.ts)**:
  Capability expressions (`one`, `any`, `all`, `none`) and concealment policies
  (`reveal`, `notFound`) are plain tagged values. This builder file uses them.

## Foldkit commands

`@Foldkit.Command({ success, failure })` (builder: `.foldkit.command({ success, failure })`)
opts one HTTP operation into a generated Foldkit `Command`. Spec:
`docs/specs/0007-client-and-foldkit.md`; extension:
`packages/compiler/src/extensions/foldkit.ts`, generator:
`packages/compiler/src/generate/foldkit.ts`.

```
 @Foldkit.Command({ success: Saved, failure: SaveFailed })
        │  contribution to the IR: Extension { extension: "foldkit", tag: "UiCommand" }
        ▼                          + ExtensionOf edge to the operation
 effx build (--emit=all)  ──►  foldkit.ts   (imports foldkit; only for opted-in operations)
```

Both arguments are **exported Message Schema values** (`FoldkitCommandOptions`
in `packages/runtime/src/Annotation.ts`). The frontend records references and
never imports or runs your app.

### What is generated

For each opted-in operation the generator emits a Foldkit `Command.define`
whose `execute` calls the generated typed client operation **once**, maps the
success and catches the typed expected failure into a Message. It never runs
at construction, never retries, never turns a defect or interruption into a
Message. The Foldkit runtime owns execution and cancellation.

You supply message adapters when you build the commands. The generated
`<Group>CommandsFor(client, adapters)` takes, per operation:

| Adapter   | Receives                 | Returns                       |
| --------- | ------------------------ | ----------------------------- |
| `success` | `{ requestId, result }`  | the annotated success Message |
| `failure` | `{ requestId, failure }` | either annotated Message      |

The Message field shape stays yours, so the app can map a typed problem (such
as an expired replay) to a success Message. The Model, `update`, `view`,
request-id freshness checks, validation, wording and routing stay hand-written.

### Constraints (diagnostics)

| Code       | Condition                                                                                                   |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| `EFFX2601` | duplicate `Foldkit.Command`, invalid UiCommand data, no or several HTTP exposures, or an internal HTTP root |
| `EFFX1107` | declared (external) operation carries `Foldkit.Command`                                                     |

Also from the generator source: `foldkit.ts` is produced only for emit mode
`all`, and only for local operations on an external root.

### Command identity

`Http.Contract.metadata.commandIdentity` names an exported application
function. It is legal for a `Command` whose `headers` schema has both
`idempotency-key` and `if-match`. The client generator emits a typed
`commandIdentity(input)` helper that calls it and returns
`{ key, input, precondition }`. effx mints no keys, keeps no hidden state and
never decides when a lost answer was already applied; that policy is the
application's (spec 0007, "Stable command identity").

### Status

Implemented for Gate 2A (`STATE.md`: "Client/Foldkit projection", DoD met
locally against a fixture with real Foldkit types). Application-level
acceptance is tracked separately in `STATE.md`.
`@effx/compiler` and `@effx/runtime` have no Foldkit dependency: only the
generated file imports Foldkit.

### Foldkit.Command

Opt an HTTP operation into a generated Foldkit `Command`. You name the success
and failure Message schemas; effx maps the typed client call into them.

```ts
import { Command, Foldkit, Http, Requirements } from "@effx/runtime";
import { Effect } from "effect";
import {
  SettingsPatch,
  SettingsResponse,
  SettingsSaveFailed,
  SettingsSaved,
  SettingsStore,
  WriteHeaders,
} from "./fixtures/settings.ts";

export class SettingsOperations {
  @Command({ name: "Settings.Save", input: SettingsPatch, success: SettingsResponse })
  @Http.Patch("/api/settings")
  @Http.Contract({
    group: "settings",
    headers: WriteHeaders,
    payload: SettingsPatch,
    success: SettingsResponse,
  })
  // Both arguments are exported Message schemas. The annotation is a
  // contribution to the IR; it does not run a Command or touch Foldkit. The
  // generated `foldkit.ts` (only for opted-in operations) imports Foldkit and
  // your Message schemas.
  @Foldkit.Command({ success: SettingsSaved, failure: SettingsSaveFailed })
  @Requirements(SettingsStore)
  static save(input: typeof SettingsPatch.Type) {
    // A Foldkit command needs a local handler: an external (`.declare()`)
    // operation cannot carry `Foldkit.Command` (EFFX1107).
    return Effect.gen(function* () {
      const store = yield* SettingsStore;

      return yield* store.write(input);
    });
  }
}
```

### More examples

- **[Builder form with command identity](./ai-docs/src/05_foldkit/10_builder-and-identity.ts)**:
  `.foldkit.command(...)` is the builder twin of `@Foldkit.Command`. A Command with
  `idempotency-key` and `if-match` headers may also name a `commandIdentity` function.

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
  `Analysis`, `Generator`, `Contribution`, `decodeArgs`, `error`, `warning`, `GeneratedFile`, and
  the typed layer `implement`, `extension`, `dataOf`, `laws`, `LawViolation`), `@effx/runtime` and
  `@effx/ir`. Anything else exported from `@effx/compiler` is marked internal.

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
form (see the linked skeleton) remains valid. The built-in features (core, http, rpc, cli, client,
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

| Part           | Type (`Extension.ts`)                                                       | Rules                                                                   |
| -------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `name`         | `string`                                                                    | identifies the extension                                                |
| `interpreters` | `Record<annotationName, (annotation, declaration, ctx) => Contribution>`    | pure; an annotation name no extension owns is `EFFX1101`                |
| `analyses`     | `(ir, index, { strictAccess }) => Diagnostic[]`                             | pure; reads the graph; an `error` diagnostic stops generation           |
| `generators`   | `(ir, index, generationContext?) => Effect<GeneratedFile[], CompilerFault>` | emit ordinary files; output is sorted by path and must be deterministic |
| `annotations`  | `ReadonlyArray<DefinitionData>?`                                            | the definitions it implements; their plans drive frontend lowering      |
| `expand`       | `(collected) => { declarations, diagnostics }` (optional)                   | pure pre-pass before any interpreter; group defaults use it             |
| `fragments`    | `ReadonlyArray<EndpointFragment>?`                                          | method-call suffixes appended to a generated HTTP endpoint              |

`extension(name, implementations)` fills `annotations`, derives `interpreters`, and derives the
`fragments` of `effect` clauses. A hand-written `Extension` omits all three optional parts.

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

### Using a custom annotation in source

`@Annotate(name, ...args)` (decorator) and `.annotate(name, ...args)` (builder) are the one
generic way to attach a custom annotation. The runtime only records the call; the extension
that owns the name gives it meaning.

```ts
import { Annotate, Command, Operation } from "@effx/runtime";
import { Effect } from "effect";
import { Payments, RefundInput, RefundRejected, RefundResult } from "./fixtures/billing.ts";

// Decorator form. The name must be a string literal and the arguments static literals: the
// compiler reads them from source and never runs this module. A name no registered extension
// owns is EFFX1101, so `Audit` only compiles once `auditExtension` is in `effx.config.ts`.
export class BillingOperations {
  @Command({ name: "Billing.Refund", input: RefundInput, success: RefundResult })
  @Annotate("Audit", { level: "sensitive" })
  static refund(input: typeof RefundInput.Type) {
    return Effect.gen(function* () {
      const payments = yield* Payments;

      return yield* payments.refund(input);
    });
  }
}

// Builder form: the same annotation, so the same kind of IR (spec 0015: for the same operation the
// extension node and its owner edge are identical in both forms; only the authored handler's symbol
// reference differs). It is a different operation here because one project cannot declare the same
// operation name twice (EFFX1001).
export const chargebackBuilder = Operation.command({
  name: "Billing.Chargeback",
  input: RefundInput,
  success: RefundResult,
})
  .annotate("Audit", { level: "sensitive" })
  .errors(RefundRejected)
  .handler((input: typeof RefundInput.Type) =>
    Effect.gen(function* () {
      const payments = yield* Payments;

      return yield* payments.refund(input);
    }),
  );
```

### Registering extensions in effx.config.ts

The CLI evaluates exactly one user module: the selected config. It default-exports
`defineConfig(...)` from `@effx/cli/config`. A hand-written `Extension` and an extension built
from typed definitions register the same way.

```ts
import { defineConfig } from "@effx/cli/config";
import { appExtension } from "./05_implement-annotation.ts";
import { auditExtension } from "./10_hand-written-extension.ts";

// Keep this module, and everything it imports, free of application code: the CLI executes it,
// and spec 0015 forbids evaluating the application modules that declare operations. A definition
// module is a leaf that imports only `effect` and `@effx/runtime`, so it is safe to import here
// (spec 0020, EFFX1306).
export default defineConfig({
  // Optional; relative paths resolve from the directory of this file.
  project: "tsconfig.json",

  // An array APPENDS to the built-in extensions. Pass a callback instead to see the built-ins
  // and return the complete, ordered list: `(builtin) => [...builtin, auditExtension, appExtension]`.
  extensions: [auditExtension, appExtension],

  // File emission only: a toggle never changes interpretation, analyses, the IR or its hash.
  // Omitted means enabled. Generators from custom extensions are never toggled here.
  generators: { foldkit: false },
});
```

### Declaring an annotation

`Annotation.define` declares a user annotation once: its name, where it may attach and the
argument shape. The derived decorator and builder argument are typed from `args`, and the
compiler lowers and decodes the same description. Keep this file a leaf module: it may
import only `effect` and `@effx/runtime` (spec 0020, EFFX1306), so loading it never loads
application code.

```ts
import { A, Annotation } from "@effx/runtime";
import { Context } from "effect";

// An Effect annotation key: the generated HttpApi endpoint carries the value, typed by `tsc`, and a
// hand-written middleware reads it back with `Context.getOption(endpoint.annotations, RateLimitPolicy)`.
// The literal id is what a static lift matches (spec 0020 section 4).
export class RateLimitPolicy extends Context.Service<
  RateLimitPolicy,
  { readonly perMinute: number; readonly burst?: number }
>()("app/RateLimit") {}

export const RateLimit = Annotation.define({
  // Namespaced and unique across all extensions (EFFX1302 on a clash).
  name: "app.RateLimit",
  // v1 user annotations attach to operations only (spec 0020 section 0.4).
  target: "operation",
  // `A.*` is the closed set of argument shapes the TypeScript frontend can read from source
  // without running your code. `tsc` checks the shape at the use site; value constraints such as a
  // minimum are decoded by the compiler (EFFX1102).
  args: { perMinute: A.int, burst: A.optional(A.int) },
  // The compiler rejects a second `@RateLimit` on one operation.
  cardinality: "one",
  // Optional default writer: generated endpoints get `.annotate(RateLimit.effect.key, { ... })`.
  // `tsc` checks the written value against the key's shape in the generated file.
  effect: { target: "endpoint", key: RateLimitPolicy },
});
```

### Using a declared annotation

The value `RateLimit(...)` is both a standard decorator and a builder argument. Both
spellings record the same `{ name, args }` annotation, so the compiler sees one meaning
(spec 0020 section 2.1). The generic `@Annotate(name, ...args)` of spec 0015 reaches the same
definition by its name.

```ts
import { Annotate, Http, Operation, Query } from "@effx/runtime";
import { Effect } from "effect";
import { GetUserInput, UserPublic, Users } from "./fixtures/users.ts";
import { RateLimit } from "./03_define-annotation.ts";

export class LimitedUsers {
  @Query({ name: "Limited.Get", input: GetUserInput, success: UserPublic })
  @Http.Get("/limited/:id")
  // A literal object: the frontend lowers it statically. A variable here would be EFFX1102.
  @RateLimit({ perMinute: 60, burst: 5 })
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    });
  }

  // The untyped floor: the name is a string literal, so `tsc` no longer checks the arguments, but
  // the frontend lowers them by the definition's plan and records the same `{ name, args }`.
  @Query({ name: "Limited.Generic", input: GetUserInput, success: UserPublic })
  @Http.Get("/limited-generic/:id")
  @Annotate("app.RateLimit", { perMinute: 60, burst: 5 })
  static generic(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    });
  }
}

// The builder spelling: `.with(...)` takes the applied annotation.
export const limitedBuilder = Operation.query({
  name: "Limited.Builder",
  input: GetUserInput,
  success: UserPublic,
})
  .http.get("/limited-builder/:id")
  .with(RateLimit({ perMinute: 60, burst: 5 }))
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    }),
  );
```

### Giving a declared annotation meaning

`implement` is the compiler half. With no `read` it records the arguments as a declarative
`Extension` node `ext:<name>/<operation>` linked by `ExtensionOf`; analyses and generators add
checks and files. `extension` bundles implementations into an ordinary `Extension`, the value
you list in `effx.config.ts`.

```ts
import { dataOf, error, extension, implement, warning } from "@effx/compiler";
import { IRGraph } from "@effx/ir";
import { Option } from "effect";
import { RateLimit } from "./03_define-annotation.ts";

const rateLimit = implement(RateLimit, {
  // Analyses read the normalized IR and return diagnostics (data, not failures).
  analyze: (ir, index) =>
    ir.nodes.flatMap((node) => {
      if (node._tag !== "Operation") return [];

      // `dataOf` decodes the declarative node with the same schema the compiler derived from `args`.
      const limit = dataOf(RateLimit, ir, node.id);

      if (Option.isNone(limit)) return [];

      const [options] = limit.value;

      const exposed = IRGraph.outgoing(index, node.id, "ExposedAs").some(
        (edge) => edge.qualifier === "http",
      );

      if (!exposed) {
        return [error("EFFX9101", `${node.name}: @RateLimit needs an HTTP exposure`)];
      }

      return options.perMinute > 10_000
        ? [
            warning(
              "EFFX9102",
              `${node.name}: perMinute ${options.perMinute} is effectively unlimited`,
            ),
          ]
        : [];
    }),
});

// An ordinary `Extension`. List it in `effx.config.ts`: the CLI compiles with the built-ins
// followed by the config's extensions (spec 0015), and lowers `@RateLimit(...)` by the plan of
// the definition it carries (spec 0020).
export const appExtension = extension("app", [rateLimit]);
```

### More examples

- **[Extension skeleton: interpreter, analysis, generator](./ai-docs/src/06_custom-extensions/10_hand-written-extension.ts)**:
  An `Extension` has three parts: interpreters turn annotations into IR
  contributions, analyses read the IR graph, and generators emit ordinary files.

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

### Declaring a persistence port

Persistence methods are declaration-only operations with no transport exposure.
The compiler generates a leaf Context.Service and a typed conformance suite
from the same input, success and error Schema references (spec 0022).

```ts
import { Persist } from "@effx/persistence/syntax";
import { Operation } from "@effx/runtime";
import {
  ChangeEmailInput,
  EmailTaken,
  GetUserInput,
  UserNotFound,
  UserSelf,
} from "../01_operations/fixtures/users.ts";

export const FindUser = Operation.query({
  name: "Users.find",
  input: GetUserInput,
  success: UserSelf,
})
  .errors(UserNotFound)
  .with(Persist.Port({ port: "Users" }))
  .declare();

export const SetEmail = Operation.command({
  name: "Users.setEmail",
  input: ChangeEmailInput,
  success: UserSelf,
})
  .errors(UserNotFound, EmailTaken)
  .with(Persist.Port({ port: "Users" }))
  .declare();
```

### Registering the persistence compiler extension

The syntax module stays runtime-importable. The compiler half is selected by
the one config module the CLI evaluates (specs 0015, 0020 and 0022).

```ts
import { defineConfig } from "@effx/cli/config";
import { persistenceExtension } from "@effx/persistence/compiler";

export default defineConfig({
  project: "tsconfig.json",
  extensions: [persistenceExtension],
});
```
