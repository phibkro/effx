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

### Backend-owned group binding

Use `Binding.group(Group, { handlers, guards })` in a backend binding file,
not the shared contract declaration. Alternatively supply `guardFor` instead
of `guards`. Every reference must be explicit and exported. Add the binding
file to the handlers pass entries. A contract pass ignores it even when listed.
The runtime call returns the supplied options unchanged and invokes nothing;
the frontend reads symbol identities without executing application modules.
The references stay in `Collected.bindings` and generation context, never the
IR or semantic hash (spec 0024 §6; runtime `src/Binding.ts`, frontend
`src/bindings.ts`, compiler `src/bindings.ts`).

The bound projection exports:

- `ProfileApiHandlers(...ctx)`: calls the referenced raw and guard factories.
  Both factories must accept the same context tuple. Context is application
  data, not an Effect service or an effx runtime dependency container.
- `ProfileApiHandlersWith({ raw, guards })`: the explicit injection seam, with
  the same endpoint, failure and service constraints as the unbound factory.
- `ProfileRaw` and `ProfileEndpoints`: pre-applied types for the backend's
  `satisfies ProfileRaw` and guard typing. Import them with `import type`;
  the generated module imports backend values in the other direction.

For `guardFor`, generated guards reference each declared endpoint on the
concrete root, not a guessed name or separately imported endpoint constant.
The pre-applied authorizer has an unknown principal and preserves guard errors
and requirements. Every guard's failure must belong to that endpoint's declared
errors. Raw callbacks own request-body parsing, authorization timing, transactions
and response bytes. effx adds no execution, retry or resource owner.
Native handwritten remainder endpoints still require the existing completion
callback. Binding does not change the finite root inventory proof or cold
contract bootstrap ordering (spec 0010; compiler `generate/http.ts`).
An unbound group retains its existing factory name, signature and generated bytes.

Runnable target witnesses are in
`packages/frontend-ts/test/fixtures/rc116/src/{profile,content}.bind.ts`,
`profile-bound-http.ts`, `content-bound-http.ts` and `bound-witnesses.ts`.
They keep backend imports out of contract projections and exercise both record
spread injection styles through `…With`. The fixture's `bun run typecheck`
includes these generated cycles under its installed rc.116 compiler environment.
The native HTTP behavior program is shared by `bound-runtime.spec.ts` and the outer
Vitest bridge. The bridge decodes real observations, verifies the installed
Effect version and canonical module origin, and forwards its AbortSignal into
the target program's Scope. Copied fixtures and every HTTP host are scoped;
no subprocess runner is needed (`bound-behaviors.ts`).
`EFFX2420` rejects a non-group reference; `2421` rejects an unexported or
non-callable function; `2422` rejects duplicate canonical group bindings;
`2423` requires handlers and exactly one guard mode; `2424` requires an
external-operation group without local effx ownership. The registered factories
in `compiler/src/diagnostics/http.ts` define their full messages (spec 0016).

### Compiled-copy density measurement

Spec 0024 §8 owns acceptance, not the estimates in its §1. In two isolated
copies of the pinned mono-web baseline, keep the original declarations and
backend modules in the before copy. In the after copy:

1. Export the existing Profile raw factory and guard-record factory, preserving
   their common context tuple. Add `profile.bind.ts` referencing ProfileGroup,
   handlers and guards. Use generated `ProfileRaw` and `ProfileEndpoints`
   instead of re-deriving native group endpoint types.
2. Export Content's raw factory and endpoint guard factory. Add
   `content.bind.ts` with `guardFor`. Remove only the replaced per-endpoint
   guard record, local guard type, endpoint-value imports and factory wrapper;
   keep all application handlers, adapters and transaction logic.
3. Add only those backend binding files to handlers-pass entries. Keep contract
   entries backend-free. Bootstrap every contract imported by the concrete root,
   generate the bound handlers, run the copied project's own typecheck and both
   existing guard-injection test typechecks using `…ApiHandlersWith`.
4. Apply the other approved density items to the copied declaration files. Format
   both copies consistently, compile both with their own project commands and
   compare contract bytes, operation index and emit-pass semantic hashes.

Only after both copies compile, run `wc -l` separately for
`apps/backend/src/profile/{http.ts,profile.bind.ts}` and
`apps/backend/src/content/{http.ts,content.bind.ts}` (omit absent before
binding files), and for
`packages/http-api/src/{profile,content}.effx.ts`. Report the four before/after
rows, including per-file counts and backend totals, beside §1's estimates:
Profile backend 407→approximately 407; Content backend 162→125; Profile
contract 107→85; Content contract 316→269. Record disagreements, rather than
editing an estimate to match a measurement. No fixture line count substitutes
for this compiled mono-web evidence; the integration lead owns that run.

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
same expanded fields have the same canonical IR, semantic hash and generated files.
Dropping an explicit success status is a separate transformation (see below).

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

### Success status: write only an override

Leave `status` out for an unannotated or 200 success schema. Native Effect uses
200 in both cases. Keep an explicit `status: 201` for a created response, and
keep `status: 200` when overriding a success schema annotated with another status.
Omission inherits that schema annotation; it does not force 200. Spec:
`docs/specs/0024-declaration-density.md` §3; implementation:
`packages/compiler/src/generate/http.ts` (`contractSuccess`).

Absent status and explicit 200 remain different `HttpContractData.status` values:
removing the field changes canonical IR and semantic hash, only at that field.
For schemas whose effective status is already 200, complete OpenAPI documents and
SDK operation projections stay equal; contract source differs only by the status
expression and its required imports. Bare explicit 200 uses S5's conditional
expression to avoid cloning a 200 schema. Header-bearing responses apply the
override to the `WithHeaders` envelope, not its body schema.

The rc.116 fixtures distinguish two witnesses. `profile.effx.ts` and
`directory-dense.effx.ts` retain explicit 200 to prove exact canonical IR, hash
and generated-byte identity with their verbose twins and tracked goldens.
`profile-consumer.effx.ts` and `directory-consumer.effx.ts` are the actual
post-0024 item-2 consumer spellings: unnecessary 200 fields are absent, while
Directory's override of its 201-annotated patch result stays explicit.
Content's action fixture likewise keeps its original explicit-status witness;
`content-consumer.effx.ts` is its omitted-status consumer twin.
`packages/frontend-ts/test/dense-status.test.ts` compares those independent
spellings without rewriting the identity witnesses or their goldens.
Both runtime runners use the shared `dense-status-reflection.ts`
fixture helper, which reports its installed Effect version and resolved HttpApi
module origin. The tests check rc.116 resolution rather than accepting a stable
Effect fallback; OpenAPI and operation indexes are compared without normalization.

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
  .http.contract({ headers: ConditionalReadHeaders })
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
  .http.contract({ headers: WriteHeaders })
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
interpretation, so spelling out just the derived channels preserves IR, hash and generated files.
Omitting an explicit 200 preserves the default wire status, not the IR (spec 0024 §3).

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
  .http.contract({})
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
  .http.contract({})
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
  .http.contract({})
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
  .http.contract({ params: SettingsById })
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

Problem schema names can follow a declared `naming.problemIdentifier` pattern in
`effx.config.ts`, the tsconfig `effx.naming` block, or the
`--naming-problem-identifier` flag (highest precedence). Only `{Group}`, `{Key}`,
`{group}` and `{key}` are supported; include `{Key}` or `{key}`. `Group` treats
`-`, `_` and `.` as PascalCase boundaries, `Key` uppercases the first letter,
and lowercase placeholders preserve the raw values. Unsafe patterns or expansions
raise `EFFX2412`; distinct derived unions sharing a name raise `EFFX2413`. Equal
code lists may share a name. Explicit `identifier` overrides always win. Without
a pattern, the existing `<endpointKey>Problem` default and IR bytes stay unchanged.
A configured name is semantic input: it enters the problem contract exactly like
an explicit identifier, and the manifest records the pattern. Use the same policy
in contract and handlers passes (spec `docs/specs/0024-declaration-density.md` §5).

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

const SharedProblems = ["request.malformed"] as const;

const SettingsProblems = ["settings.not-found"] as const;

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
    codes: [...SettingsProblems, ...SharedProblems] as const,
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

  // Semantic input (spec 0024 §5): both emit passes must use the same data pattern.
  naming: { problemIdentifier: "{Group}{Key}Problem" },

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
import { CoreDiagnostics, type Diagnostic, dataOf, extension, implement } from "@effx/compiler";
import { IRGraph } from "@effx/ir";
import { Option } from "effect";
import { RateLimit } from "./03_define-annotation.ts";

const rateLimit = implement(RateLimit, {
  // Analyses read the normalized IR and return diagnostics (data, not failures).
  analyze: (ir, index) =>
    ir.nodes.flatMap((node): ReadonlyArray<Diagnostic> => {
      if (node._tag !== "Operation") return [];

      // `dataOf` decodes the declarative node with the same schema the compiler derived from `args`.
      const limit = dataOf(RateLimit, ir, node.id);

      if (Option.isNone(limit)) return [];

      const [options] = limit.value;

      const exposed = IRGraph.outgoing(index, node.id, "ExposedAs").some(
        (edge) => edge.qualifier === "http",
      );

      if (!exposed) {
        return [CoreDiagnostics["EFFX9101"].emit({ subject: node.name })];
      }

      return options.perMinute > 10_000
        ? [CoreDiagnostics["EFFX9102"].emit({ subject: node.name, perMinute: options.perMinute })]
        : [];
    }),
});

// An ordinary `Extension`. List it in `effx.config.ts`: the CLI compiles with the built-ins
// followed by the config's extensions (spec 0015), and lowers `@RateLimit(...)` by the plan of
// the definition it carries (spec 0020).
export const appExtension = extension("app", [rateLimit]);
```

### Registering a package-owned diagnostic

New extension packages own namespaced codes, not unused numeric codes (spec 0016 §3).
This analysis requires every Command to have an AuditPolicy contribution, without adding IR
or generated files. Select `auditRequired` in `effx.config.ts` alongside the Audit interpreter.

```ts
import { defineDiagnostic, type DiagnosticEntry, type Extension } from "@effx/compiler";
import { IRGraph } from "@effx/ir";
import { Schema } from "effect";

export const missingAudit = defineDiagnostic(
  {
    code: "EFFX[@acme/effx-audit]/0001",
    owner: "@acme/effx-audit",
    title: "Command lacks an audit policy",
    severity: "error",
    severityPolicy: { kind: "fixed" },
    explanation:
      "Every Command must carry an AuditPolicy ExtensionOf contribution. Queries are exempt. Register the Audit interpreter and annotate each Command before generating the application.",
    examples: [
      {
        before: '@Command("Billing.Charge")',
        after: '@Command("Billing.Charge")\n@Annotate("Audit", { level: "sensitive" })',
        explanation:
          "Attach the audit policy and register the Audit interpreter in effx.config.ts.",
        language: "ts",
      },
    ],
  } as const satisfies DiagnosticEntry,
  Schema.Struct({ operation: Schema.String }),
  ({ operation }) => `${operation}: Command needs an AuditPolicy contribution`,
);

export const auditRequired: Extension = {
  name: "@acme/effx-audit/required",
  diagnosticEntries: [missingAudit.entry],
  interpreters: {},
  analyses: [
    (ir, index) =>
      ir.nodes.flatMap((node) => {
        if (node._tag !== "Operation" || node.kind !== "Command") return [];

        const audited = IRGraph.incoming(index, node.id, "ExtensionOf").some(
          (edge) => edge.qualifier === "AuditPolicy",
        );

        return audited ? [] : [missingAudit.emit({ operation: node.name })];
      }),
  ],
  generators: [],
};

// Offline lookup does not compile a project. Explicit config opts in to loading plugin entries:
// effx explain 'EFFX[@acme/effx-audit]/0001' --config ./effx.config.ts
```

### More examples

- **[Audit extension: interpreter, analysis, generator](./ai-docs/src/06_custom-extensions/10_hand-written-extension.ts)**:
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
Each test owns a fresh physical store. Its harness `reset` runs between samples;
the generated assertion compares the resulting snapshot to the empty-store
baseline captured before the first seed, then installs domain fixtures. A reset
that leaves prior rows fails conformance (spec 0022 §4 amendment).

G1 validates every typed failure reason: several declared failures are valid,
but defects, interruptions and undeclared failures reject conformance. G2 uses
Type-side schema equality and compares failures as a multiset, preserving
duplicate counts but ignoring concurrent order. Domain error scenarios and the
rollback sentinel still expect one failure (spec 0022 §4 amendment).

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

# Diagnostic catalogue

| Code | Title | Default severity |
| --- | --- | --- |
| [EFFX0001](#EFFX0001) | Analysis and project TypeScript versions differ | info |
| [EFFX0010](#EFFX0010) | Diagnostic registry contract violated | error |
| [EFFX1001](#EFFX1001) | Stable identity has conflicting content | error |
| [EFFX1002](#EFFX1002) | Graph edge references an absent node | error |
| [EFFX1003](#EFFX1003) | Extension node has no owner | error |
| [EFFX1101](#EFFX1101) | No interpreter for annotation | error |
| [EFFX1102](#EFFX1102) | Malformed or unlowerable annotation arguments | error |
| [EFFX1103](#EFFX1103) | Annotation needs an operation | error |
| [EFFX1104](#EFFX1104) | Unsupported declaration syntax | error |
| [EFFX1105](#EFFX1105) | Handler return type is not Effect | error |
| [EFFX1106](#EFFX1106) | Runtime resolution or handler binding mismatch | error |
| [EFFX1107](#EFFX1107) | External binding cannot implement an executable projection | error |
| [EFFX1301](#EFFX1301) | Schema argument cannot be lowered from source | error |
| [EFFX1302](#EFFX1302) | Annotation name invalid or declared twice | error |
| [EFFX1303](#EFFX1303) | Annotation target does not fit syntax | error |
| [EFFX1304](#EFFX1304) | Annotation effect key identity collision | error |
| [EFFX1306](#EFFX1306) | Definition module reaches application code | error |
| [EFFX2201](#EFFX2201) | Inferred error missing from assertion | error |
| [EFFX2202](#EFFX2202) | Declared error no longer inferred | error |
| [EFFX2203](#EFFX2203) | Inferred error lacks a Schema address | error |
| [EFFX2204](#EFFX2204) | Boundary has no inferred addressable errors | warning |
| [EFFX2205](#EFFX2205) | Problem mapping does not cover operation errors | error |
| [EFFX2206](#EFFX2206) | Problem mapping points outside declared codes | error |
| [EFFX2302](#EFFX2302) | Inferred requirement missing from assertion | error |
| [EFFX2303](#EFFX2303) | Declared requirement no longer inferred | error |
| [EFFX2304](#EFFX2304) | Requirement has no stable identity | error |
| [EFFX2401](#EFFX2401) | Query uses a mutating HTTP verb | error |
| [EFFX2402](#EFFX2402) | Invalid HTTP contract or group | error |
| [EFFX2403](#EFFX2403) | Invalid external HTTP binding | error |
| [EFFX2404](#EFFX2404) | Invalid HTTP group association | error |
| [EFFX2405](#EFFX2405) | Conflicting HTTP group defaults | error |
| [EFFX2406](#EFFX2406) | Generated HTTP export collision | error |
| [EFFX2410](#EFFX2410) | Ambiguous or conflicting request channels | error |
| [EFFX2411](#EFFX2411) | Unknown request input field keys | error |
| [EFFX2412](#EFFX2412) | Invalid problem identifier naming pattern | error |
| [EFFX2413](#EFFX2413) | Derived problem identifiers collide | error |
| [EFFX2414](#EFFX2414) | Access decision time cannot be inferred | error |
| [EFFX2415](#EFFX2415) | Concrete HTTP endpoint inventory unavailable | error |
| [EFFX2420](#EFFX2420) | Invalid binding group | error |
| [EFFX2421](#EFFX2421) | Invalid binding function | error |
| [EFFX2422](#EFFX2422) | Duplicate group binding | error |
| [EFFX2423](#EFFX2423) | Invalid binding choices | error |
| [EFFX2424](#EFFX2424) | Invalid binding ownership | error |
| [EFFX2500](#EFFX2500) | Malformed or duplicate access contract | error |
| [EFFX2501](#EFFX2501) | Command access decides in a read snapshot | error |
| [EFFX2502](#EFFX2502) | Query declares a transaction decision | warning |
| [EFFX2503](#EFFX2503) | Protected access lacks security middleware | error |
| [EFFX2504](#EFFX2504) | HTTP exposure lacks access declaration | warning |
| [EFFX2505](#EFFX2505) | HTTP root mixes visibility modes | error |
| [EFFX2506](#EFFX2506) | Invalid command snapshot decision claim | error |
| [EFFX2601](#EFFX2601) | Foldkit command or tagged Message contract invalid | error |
| [EFFX2701](#EFFX2701) | Project target or Effect installation unsupported | error |
| [EFFX2801](#EFFX2801) | Deployment entry does not reach a Worker | error |
| [EFFX2802](#EFFX2802) | Required generated wiring is not referenced | error |
| [EFFX2803](#EFFX2803) | Deployment references obsolete generated wiring | error |
| [EFFX2804](#EFFX2804) | Surface comparison entry cannot be read | error |
| [EFFX2805](#EFFX2805) | Persisted surface differs from current IR | warning |
| [EFFX2806](#EFFX2806) | Wiring cannot be decided statically | warning |
| [EFFX2807](#EFFX2807) | Emit mode has no wiring to check | info |
| [EFFX2901](#EFFX2901) | Example operation is deprecated | warning |
| [EFFX2902](#EFFX2902) | Example deprecated annotation is malformed | error |
| [EFFX3001](#EFFX3001) | Unsupported Effect construct | error |
| [EFFX3002](#EFFX3002) | Channel schema must be an exported named schema | error |
| [EFFX3003](#EFFX3003) | Response header schema must be an exported named schema | error |
| [EFFX3004](#EFFX3004) | Problem codes must be an exported const tuple | error |
| [EFFX3005](#EFFX3005) | Access annotation is not a registered builder call with literal arguments | error |
| [EFFX3006](#EFFX3006) | No lifter rule for callee | error |
| [EFFX3007](#EFFX3007) | Success has no schema | error |
| [EFFX3008](#EFFX3008) | Group not found, or not in exactly one root | error |
| [EFFX3009](#EFFX3009) | No request channel to serve as operation input | error |
| [EFFX3010](#EFFX3010) | Lift decision requires review | warning |
| [EFFX3101](#EFFX3101) | Wire contracts differ | error |
| [EFFX3102](#EFFX3102) | Check passed | info |
| [EFFX3103](#EFFX3103) | Check could not run | error |
| [EFFX3201](#EFFX3201) | Binding keys differ from the group's endpoint keys | error |
| [EFFX3202](#EFFX3202) | Binding needs hand adaptation | error |
| [EFFX3401](#EFFX3401) | Persistence method must be declaration-only | error |
| [EFFX3402](#EFFX3402) | Persistence port method has transport exposure | error |
| [EFFX3403](#EFFX3403) | Persistence port shape or identity invalid | error |
| [EFFX3404](#EFFX3404) | Query-only port has vacuous transaction laws | warning |
| [EFFX4101](#EFFX4101) | Cedar projection identity invalid or ambiguous | error |
| [EFFX4102](#EFFX4102) | Application Cedar policy validation error | error |
| [EFFX4103](#EFFX4103) | Parameterized requirement projected by id only | warning |
| [EFFX4104](#EFFX4104) | All capabilities cannot be one Cedar request | warning |
| [EFFX4105](#EFFX4105) | Capability uses generic Cedar principal | info |
| [EFFX4106](#EFFX4106) | Application Cedar policy validation warning | warning |
| [EFFX4107](#EFFX4107) | No authorization facts to project | info |
| [EFFX9001](#EFFX9001) | Example Command lacks Audit annotation | warning |
| [EFFX9002](#EFFX9002) | Example Audit annotation needs an operation | error |
| [EFFX9101](#EFFX9101) | Example RateLimit requires HTTP exposure | error |
| [EFFX9102](#EFFX9102) | Example rate limit is effectively unlimited | warning |

## EFFX0001 — Analysis and project TypeScript versions differ [#EFFX0001]

Owner: frontend

Default severity: info

Severity policy: typescript-major-skew — Same-major skew is info; different-major skew is warning.

Allowed severities: info, warning

The frontend analyses with its bundled TypeScript version while the project pins another. tsc/tsgo remains authoritative. Same-major skew is informational; different-major skew warns. A package range is compared using its first numeric major, not by resolving that range.

### Example 1

Before:

```ts
effx TypeScript 6.0.2; project typescript 7.0.2
```

After:

```ts
effx TypeScript 6.0.2; project typescript 6.0.2
```

Align the project's pin with the analysis version when practical, and always run the project's type gate.

## EFFX0010 — Diagnostic registry contract violated [#EFFX0010]

Owner: registry

Default severity: error

Severity policy: Fixed

Registry data must decode as DiagnosticEntry, codes must be unique across owners, and reported diagnostics (including related diagnostics) must have a registered code and a permitted severity. Invalid registry data, duplicate codes, undeclared emissions and severity-policy mismatches stop generation; they are user or extension contract diagnostics, not CompilerFault.

### Example 1

Before:

```ts
extensions: [firstCopy, secondCopy]
```

After:

```ts
extensions: [firstCopy]
```

Load each owner once, declare every emitted code, and emit severity using its named policy.

## EFFX1001 — Stable identity has conflicting content [#EFFX1001]

Owner: kernel

Default severity: error

Severity policy: Fixed

Two nodes with the same StableId have different semantic content. Equivalent duplicate contributions can normalize together, but differing nodes cannot share an identity.

### Example 1

Before:

```ts
Operation.query({ name: "User.Get", input: A, success: A }); Operation.query({ name: "User.Get", input: B, success: B });
```

After:

```ts
Operation.query({ name: "User.GetA", input: A, success: A }); Operation.query({ name: "User.GetB", input: B, success: B });
```

Give distinct operations distinct names, or make duplicate contributions identical.

## EFFX1002 — Graph edge references an absent node [#EFFX1002]

Owner: kernel

Default severity: error

Severity policy: Fixed

An IR edge names a source or target that is absent from the node set. This covers either or both endpoints and every edge kind.

### Example 1

Before:

```ts
{ nodes: [operation], edges: [{ kind: "Requires", from: operation.id, to: missingService.id }] }
```

After:

```ts
{ nodes: [operation, service], edges: [{ kind: "Requires", from: operation.id, to: service.id }] }
```

Contribute each referenced node, or remove the edge when removing its node.

## EFFX1003 — Extension node has no owner [#EFFX1003]

Owner: kernel

Default severity: error

Severity policy: Fixed

Every Extension node needs an outgoing ExtensionOf edge to its semantic owner. An orphan extension cannot be safely interpreted or generated.

### Example 1

Before:

```ts
Contribution.make([extensionNode], [])
```

After:

```ts
Contribution.make([extensionNode], [{ kind: "ExtensionOf", from: extensionNode.id, to: operationId }])
```

Contribute the owner edge with the extension node.

## EFFX1101 — No interpreter for annotation [#EFFX1101]

Owner: annotation

Default severity: error

Severity policy: Fixed

The frontend collected an annotation name, but no selected extension owns an interpreter for it. This includes generic Annotate and extension-defined spellings.

### Example 1

Before:

```ts
@Annotate("Audit", { level: "sensitive" })
```

After:

```ts
extensions: [...builtin, auditExtension]
```

Register the interpreter through the selected config, and check the exact case-sensitive annotation name.

## EFFX1102 — Malformed or unlowerable annotation arguments [#EFFX1102]

Owner: annotation

Default severity: error

Severity policy: Fixed

An annotation argument does not decode against its definition, cannot be represented by source lowering, or cannot be printed for an effect clause. Source lowering accepts supported literals, object properties and exported Schema/service/runtime references, not arbitrary evaluation. It rejects computed keys, unsupported expressions and runtime calls, unresolved or unexported symbols, invalid capability/focus construction, invalid Schema/HTTP root shapes and tuple spreads whose readonly const runtime initializers disagree with their types, cycle or contain non-string elements. Definition-specific symbol checks retain the declared expectation; Schema issue text retains the decoder detail. Effect clauses additionally reject lambdas and non-finite numbers that the writer cannot print.

### Example 1

Before:

```ts
@RateLimit({ perMinute: "many" })
```

After:

```ts
@RateLimit({ perMinute: 60 })
```

Match the argument Schema, use literal source data and exported references, repair readonly tuple initializers, and replace unprintable effect-clause arguments.

## EFFX1103 — Annotation needs an operation [#EFFX1103]

Owner: annotation

Default severity: error

Severity policy: Fixed

An operation-target built-in annotation was applied to a declaration without Query or Command. There is no operation node to own the contribution.

### Example 1

Before:

```ts
@Http.Get("/users") static get() { return handler(); }
```

After:

```ts
@Query({ input: Input, success: User }) @Http.Get("/users") static get() { return handler(); }
```

Add the operation declaration, or remove the operation-target annotation.

## EFFX1104 — Unsupported declaration syntax [#EFFX1104]

Owner: annotation

Default severity: error

Severity policy: Fixed

Source collection requires called decorators on static methods in exported classes, exported group/model classes and exported builder values. Persistent models need one options object; group/model builders need their defined constructor forms. Operation chains must terminate with handler(fn) or declare(), with a callable handler and recognized steps. with(...) accepts one applied annotation call. Class-only decorators cannot decorate methods and operation decorators cannot decorate arbitrary class members.

### Example 1

Before:

```ts
class UserOps { @Query(options) get() { return handler(); } }
```

After:

```ts
export class UserOps { @Query(options) static get() { return handler(); } }
```

Export the declaration, use the supported decorator target and call shape, and terminate the builder chain correctly.

## EFFX1105 — Handler return type is not Effect [#EFFX1105]

Owner: annotation

Default severity: error

Severity policy: Fixed

Handler signature inference requires Effect.Effect<A, E, R>. Promise, plain values and other return types do not expose the required success/error/service channels.

### Example 1

Before:

```ts
handler: () => Promise.resolve(user)
```

After:

```ts
handler: () => Effect.succeed(user)
```

Return an Effect with the intended channels.

## EFFX1106 — Runtime resolution or handler binding mismatch [#EFFX1106]

Owner: annotation

Default severity: error

Severity policy: frontend-resolution-versus-core-contract — Frontend runtime resolution is warning; source and IR binding contract violations are error.

Allowed severities: error, warning

Frontend resolution warns when @effx/runtime cannot be resolved, because no effx declarations can be recognized. Core interpretation rejects an external operation carrying a local handler or signature, or a local operation lacking an authored typed handler. IR analysis also rejects either invalid binding/handler pair. These are phase-specific policies under one legacy code, not interchangeable severities.

### Example 1

Before:

```ts
Operation.query(options).declare() /* local handler intended */
```

After:

```ts
Operation.query(options).handler(handler)
```

Install and resolve @effx/runtime for frontend warnings; use declare() for external bindings and a typed handler for local operations.

## EFFX1107 — External binding cannot implement an executable projection [#EFFX1107]

Owner: annotation

Default severity: error

Severity policy: Fixed

An external HTTP operation has no local implementation for RPC, CLI or Foldkit.Command. Each unsupported transport and Foldkit contribution is diagnosed separately.

### Example 1

Before:

```ts
Operation.query(options).rpc.expose().declare()
```

After:

```ts
Operation.query(options).rpc.expose().handler(handler)
```

Supply a local typed handler for executable projections, or keep the declaration HTTP-only.

## EFFX1301 — Schema argument cannot be lowered from source [#EFFX1301]

Owner: annotation

Default severity: error

Severity policy: Fixed

A.fromSchema encountered an unsupported Schema AST node. Each invalid leaf is reported with its path in the annotation argument list, including object fields, arrays, records and union cases. Definition construction remains total; the compiler reports these recorded problems before interpreting uses. Replace the unsupported node with an argument-algebra description or a Schema shape the frontend can lower; a runtime transformation cannot be evaluated during source collection.

### Example 1

Before:

```ts
args: { value: A.fromSchema(Schema.DateTimeUtcFromString) }
```

After:

```ts
args: { value: A.string }
```

Keep the source argument a string and perform the date conversion in the interpreter, rather than asking source lowering to run a Schema transformation.

## EFFX1302 — Annotation name invalid or declared twice [#EFFX1302]

Owner: annotation

Default severity: error

Severity policy: Fixed

Annotation names must match [A-Za-z][A-Za-z0-9._-]* and have exactly one selected definition owner. Both invalid grammar and duplicate definitions share this code.

### Example 1

Before:

```ts
Annotation.define({ name: "bad name", target: "operation", args: {} })
```

After:

```ts
Annotation.define({ name: "app.Valid", target: "operation", args: {} })
```

Choose a valid namespaced name and register only one definition for it.

## EFFX1303 — Annotation target does not fit syntax [#EFFX1303]

Owner: annotation

Default severity: error

Severity policy: Fixed

An operation-target user annotation cannot decorate a class. A builder with(...) application must also target operation, not another declared target. This guard is based on the definition, not the spelling of the use.

### Example 1

Before:

```ts
@RateLimit({ perMinute: 60 }) export class UserOps {}
```

After:

```ts
export class UserOps { @Query(options) @RateLimit({ perMinute: 60 }) static get() { return handler(); } }
```

Apply the annotation to an operation, or declare the target that fits the intended syntax.

## EFFX1304 — Annotation effect key identity collision [#EFFX1304]

Owner: annotation

Default severity: error

Severity policy: Fixed

Two selected annotation definitions use the same effect.key id. That id is the runtime identity, so one contribution would overwrite another on an endpoint. Key ids must be literal source identities; the currently emitted form reports duplicate owners.

### Example 1

Before:

```ts
const first = Context.Reference("app/key", { defaultValue: () => 0 }); const second = Context.Reference("app/key", { defaultValue: () => 0 });
```

After:

```ts
const first = Context.Reference("app/first", { defaultValue: () => 0 }); const second = Context.Reference("app/second", { defaultValue: () => 0 });
```

Give each distinct annotation a unique literal key id, or share one annotation definition instead of duplicating it.

## EFFX1306 — Definition module reaches application code [#EFFX1306]

Owner: annotation

Default severity: error

Severity policy: Fixed

Config evaluation loads definition modules, so their runtime import closure must not reach a module declaring application operations or groups. Transitive imports count; external Effect/@effx modules and definition modules form the safe boundary.

### Example 1

Before:

```ts
// rate-limit.ts
import { UserOperations } from "./users.ts";
```

After:

```ts
// rate-limit.ts
import { A, Annotation } from "@effx/runtime";
```

Move shared argument definitions into a leaf module without application imports, and keep operation modules downstream.

## EFFX2201 — Inferred error missing from assertion [#EFFX2201]

Owner: contracts

Default severity: error

Severity policy: Fixed

A local handler can fail with an inferred Schema error absent from @Errors. The assertion must exactly match the handler error channel.

### Example 1

Before:

```ts
@Errors(NotFound) // handler also fails with Conflict
```

After:

```ts
@Errors(NotFound, Conflict)
```

Add the inferred error Schema or remove that handler failure.

## EFFX2202 — Declared error no longer inferred [#EFFX2202]

Owner: contracts

Default severity: error

Severity policy: Fixed

@Errors declares a Schema that the local handler cannot fail with. It is an exact assertion, not permission to expose extra errors.

### Example 1

Before:

```ts
@Errors(NotFound, Conflict) // handler fails only with NotFound
```

After:

```ts
@Errors(NotFound)
```

Remove the stale declaration or restore the intentional typed handler failure.

## EFFX2203 — Inferred error lacks a Schema address [#EFFX2203]

Owner: contracts

Default severity: error

Severity policy: Fixed

An inferred opaque error cannot become a stable exported Schema reference for generation. This is not the same as a missing @Errors member.

### Example 1

Before:

```ts
handler: (): Effect.Effect<User, string> => effect
```

After:

```ts
@Errors(NotFound) // map the handler error to the exported Schema
```

Map the opaque error to an exported Schema and declare it with @Errors.

## EFFX2204 — Boundary has no inferred addressable errors [#EFFX2204]

Owner: contracts

Default severity: warning

Severity policy: Fixed

The operation uses inferred errors, but no Schema-addressable errors survived inference. The generated boundary exposes none; this warning does not invent a response contract.

### Example 1

Before:

```ts
Operation.query(options).handler(opaqueErrorHandler)
```

After:

```ts
Operation.query(options).errors(NotFound).handler(schemaErrorHandler)
```

Use an exported error Schema when the boundary must expose a failure, or accept that it exposes none.

## EFFX2205 — Problem mapping does not cover operation errors [#EFFX2205]

Owner: contracts

Default severity: error

Severity policy: Fixed

Http.Problems either maps a tag that is not an operation error, or leaves an operation error without a mapping or sourced HTTP status. Tags use the sourced _tag where available, not necessarily the Schema export name.

### Example 1

Before:

```ts
@Http.Problems({ registry: Problems, codes: ["user.not-found"], map: {} })
```

After:

```ts
@Http.Problems({ registry: Problems, codes: ["user.not-found"], map: { UserNotFound: "user.not-found" } })
```

Remove map keys outside the error set and map every unsourced-status error tag.

## EFFX2206 — Problem mapping points outside declared codes [#EFFX2206]

Owner: contracts

Default severity: error

Severity policy: Fixed

A Http.Problems map value is absent from its codes list. The map associates an operation error tag with a code already declared by that contract.

### Example 1

Before:

```ts
codes: ["user.not-found"], map: { Conflict: "user.conflict" }
```

After:

```ts
codes: ["user.not-found", "user.conflict"], map: { Conflict: "user.conflict" }
```

Add the mapped code to codes or point the tag at an existing declared code.

## EFFX2302 — Inferred requirement missing from assertion [#EFFX2302]

Owner: contracts

Default severity: error

Severity policy: Fixed

A local handler requires a service absent from @Requirements. The assertion must exactly match its inferred requirement channel.

### Example 1

Before:

```ts
@Requirements(Store) // handler also requires ClockService
```

After:

```ts
@Requirements(Store, ClockService)
```

Add the required service or remove its use from the handler.

## EFFX2303 — Declared requirement no longer inferred [#EFFX2303]

Owner: contracts

Default severity: error

Severity policy: Fixed

@Requirements names a service the local handler no longer requires. External declarations have different semantics; this is a local exact-assertion mismatch.

### Example 1

Before:

```ts
@Requirements(Store, ClockService) // handler only uses Store
```

After:

```ts
@Requirements(Store)
```

Remove the stale assertion or restore the intended service use.

## EFFX2304 — Requirement has no stable identity [#EFFX2304]

Owner: contracts

Default severity: error

Severity policy: Fixed

An opaque inferred requirement cannot be assigned a stable effx service identity. Declare or register an exported service so the graph can address it.

### Example 1

Before:

```ts
handler: (): Effect.Effect<User, never, AnonymousRequirement> => effect
```

After:

```ts
export class Store extends Context.Service<Store, StoreApi>()("app/Store") {}
```

Use or register an exported service with a stable key and source reference.

## EFFX2401 — Query uses a mutating HTTP verb [#EFFX2401]

Owner: http

Default severity: error

Severity policy: Fixed

A Query normally uses GET. A Query over POST needs the explicit payloadIsQuery contract; other verbs require a Command.

### Example 1

Before:

```text
@Query(...)
@Http.Put("/users")
```

After:

```text
@Query(...)
@Http.Get("/users")
```

Use GET for reads, or declare a Command for mutation.

## EFFX2402 — Invalid HTTP contract or group [#EFFX2402]

Owner: http

Default severity: error

Severity policy: Fixed

This umbrella covers annotation target/cardinality, malformed contract data or ownership edges, missing or repeated exposures, unsafe group/root identifiers, conflicting group definitions, repeated contracts on one operation, colliding root exports, missing external group/root declarations, request and response channel constraints, status bounds, and command identity headers. Match path parameters exactly; GET cannot carry payload. conditional requires GET and responseHeaders; mediaType requires payload. payloadIsQuery requires a POST Query with explicit payload. commandIdentity belongs to a Command and requires idempotency-key and if-match headers. Http.Problems variants cover duplicate contracts, missing HTTP exposure, malformed ProblemContract data with validator detail, unsafe or empty identifier overrides, and repeated problem codes.

### Example 1

Before:

```text
@Http.Get("/users/:id")
@Http.Contract({ group: "users", success: User })
```

After:

```text
@Http.Get("/users/:id")
@Http.Contract({ group: "users", params: UserId, success: User })
```

Declare params with exactly the id field. For other variants, correct the named contract constraint; attach a single contract to one operation, export one valid group and supply its concrete root when external.

### Example 2

Before:

```text
@Http.Problems({ registry: Problems, codes: ["NotFound", "NotFound"] })
```

After:

```text
@Http.Problems({ registry: Problems, codes: ["NotFound"] })
```

Keep one Problems contract on an HTTP-exposed operation. Remove duplicate codes, use a nonempty identifier-safe identifier when overriding schema identity, and correct fields named by the ProblemContract validator.

## EFFX2403 — Invalid external HTTP binding [#EFFX2403]

Owner: http

Default severity: error

Severity policy: Fixed

Externally bound operations need a contract and metadata.operationId of the form group.endpointKey. Endpoint keys are identifier-safe and unique. A root/group cannot mix local and external bindings.

### Example 1

Before:

```text
metadata: { operationId: "get-user" }
```

After:

```text
metadata: { operationId: "users.getUser" }
```

Use the declared group prefix and a unique identifier-safe endpoint key; keep every binding in a group consistently local or external.

## EFFX2404 — Invalid HTTP group association [#EFFX2404]

Owner: http

Default severity: error

Severity policy: Fixed

Group associations require an operation and exactly one exported Http.group value or @Http.Group class. Multiple group declarations, repeated .in(Group), unresolved references and malformed associations are rejected.

### Example 1

Before:

```text
Operation.query({ input: Input, output: Output }).in(Users).in(Users)
```

After:

```text
Operation.query({ input: Input, output: Output }).in(Users)
```

Associate the operation once with one exported group; remove duplicate decorators and ensure the reference resolves to the group itself.

## EFFX2405 — Conflicting HTTP group defaults [#EFFX2405]

Owner: http

Default severity: error

Severity policy: Fixed

An associated HTTP operation still requires an explicit Http.Contract. Its explicit root/group must agree with its group. query: true only derives a GET Query input not already assigned to another channel.

### Example 1

Before:

```text
@Http.Contract({ root: "other", group: "users", success: User })
```

After:

```text
@Http.Contract({ root: "api", group: "users", success: User })
```

Align the contract with the associated group whose root is api; remove an invalid query default or specify its channel explicitly.

## EFFX2406 — Generated HTTP export collision [#EFFX2406]

Owner: http

Default severity: error

Severity policy: Fixed

Different root/group identities can normalize to the same generated class, API or handler export. Empty groups are checked too.

### Example 1

Before:

```text
Http.group({ root: "api", group: "user-list" })
Http.group({ root: "api", group: "user_list" })
```

After:

```text
Http.group({ root: "api", group: "user-list" })
Http.group({ root: "api", group: "accounts" })
```

Rename one group so its generated export names no longer collide.

## EFFX2410 — Ambiguous or conflicting request channels [#EFFX2410]

Owner: http

Default severity: error

Severity policy: Fixed

An input marked Http.headers cannot also be a body or compete with another headers schema. When input fields mix route parameters and other fields, the compiler will not invent split schemas: explicitly declare params and query or payload.

### Example 1

Before:

```text
@Http.Get("/users/:id")
@Http.Contract({ group: "users", success: User })
```

After:

```text
@Http.Get("/users/:id")
@Http.Contract({ group: "users", params: UserId, query: Search, success: User })
```

Split id into UserId and search fields into Search; for mutating verbs declare payload instead of query. A headers-marked input must use the same headers channel.

## EFFX2411 — Unknown request input field keys [#EFFX2411]

Owner: http

Default severity: error

Severity policy: Fixed

GET or DELETE with path parameters and input keys unavailable to static analysis cannot distinguish params from query. Either explicit channel resolves this ambiguity.

### Example 1

Before:

```text
@Http.Get("/users/:id")
@Http.Contract({ group: "users", success: User })
```

After:

```text
@Http.Get("/users/:id")
@Http.Contract({ group: "users", params: UserId, query: Search, success: User })
```

Declare the request channels explicitly rather than relying on inaccessible input keys.

## EFFX2412 — Invalid problem identifier naming pattern [#EFFX2412]

Owner: http

Default severity: error

Severity policy: Fixed

naming.problemIdentifier is data, not a function. Only {Group}, {Key}, {group} and {key} are allowed, at least one Key/key placeholder is required, and each expansion must be a safe identifier. Explicit problem identifiers still override a valid naming policy.

### Example 1

Before:

```text
defineConfig({ naming: { problemIdentifier: "{Group}Problem" } })
```

After:

```text
defineConfig({ naming: { problemIdentifier: "{Group}{Key}Problem" } })
```

Include the endpoint key and use only supported placeholders and identifier characters.

## EFFX2413 — Derived problem identifiers collide [#EFFX2413]

Owner: http

Default severity: error

Severity policy: Fixed

Two operations derive the same problem identifier but declare different problem code lists. Equal code lists may share a name. Explicit identifier overrides are not derived collisions and remain caller-owned.

### Example 1

Before:

```text
defineConfig({ naming: { problemIdentifier: "{Key}Problem" } })
```

After:

```text
defineConfig({ naming: { problemIdentifier: "{Group}{Key}Problem" } })
```

Disambiguate the pattern or explicitly name a deliberately shared problem union.

## EFFX2414 — Access decision time cannot be inferred [#EFFX2414]

Owner: http

Default severity: error

Severity policy: Fixed

Http.Access omits decisionTime, but its declaration has no single Query or Command from which to infer SnapshotRead or Transaction.

### Example 1

Before:

```text
@Http.Access({ ...accessOptions })
```

After:

```text
@Http.Access({ ...accessOptions, decisionTime: "Transaction" })
```

Write decisionTime explicitly, or attach access to exactly one operation of the intended kind.

## EFFX2415 — Concrete HTTP endpoint inventory unavailable [#EFFX2415]

Owner: http

Default severity: error

Severity policy: Fixed

Endpoint inventory is a handler-factory generation precondition, never a declaration-lowering check: contract-only emission never reports EFFX2415. A concrete HttpApi root must prove finite required group and endpoint keys with matching literal identifiers; only groups whose handler factories are being emitted need their declared endpoints checked. An unresolved root leaf rejects the whole root because its unknown identifier may replace a healthy group. Report one root-level diagnostic naming the unresolved leaf, not cascading group diagnostics, and emit no factory using that root. Earlier fatal diagnostics defer inventory proof. Generate every contract imported by the authored root before handler generation, including groups outside the current invocation. Cold --emit=all is atomic and writes nothing, including no contract or manifest: contract-first is required. A failed build preserves previously owned handler outputs and publishes no partial ownership record.

### Example 1

Before:

```text
effx build --emit=all  // cold: authored root imports missing generated contracts
```

After:

```text
effx build --emit=contract  // every group imported by the root
effx build --emit=handlers
```

Bootstrap every imported group contract before proving handlers. Full-root contracts support full-root or healthy-only handlers; healthy-only contracts cannot bootstrap a missing unrelated group. Fix the unresolved leaf named by the root diagnostic before emitting any factory for that root.

## EFFX2420 — Invalid binding group [#EFFX2420]

Owner: http

Default severity: error

Severity policy: Fixed

The first argument must resolve to an exported Http.group value or @Http.Group class.

### Example 1

Before:

```text
Binding.group(value, options)
```

After:

```text
Binding.group(Group, { handlers, guards })
```

Bind an exported group declaration.

## EFFX2421 — Invalid binding function [#EFFX2421]

Owner: http

Default severity: error

Severity policy: Fixed

Handlers, guards and guardFor must resolve to exported functions. Inline callbacks and unexported values cannot be imported by generated code.

### Example 1

Before:

```text
Binding.group(value, options)
```

After:

```text
Binding.group(Group, { handlers, guards })
```

Export the function and reference its symbol.

## EFFX2422 — Duplicate group binding [#EFFX2422]

Owner: http

Default severity: error

Severity policy: Fixed

A canonical group symbol may have only one backend binding.

### Example 1

Before:

```text
Binding.group(value, options)
```

After:

```text
Binding.group(Group, { handlers, guards })
```

Keep one binding for this group.

## EFFX2423 — Invalid binding choices [#EFFX2423]

Owner: http

Default severity: error

Severity policy: Fixed

A binding requires handlers and exactly one of guards or guardFor.

### Example 1

Before:

```text
Binding.group(value, options)
```

After:

```text
Binding.group(Group, { handlers, guards })
```

Supply handlers and one guard factory.

## EFFX2424 — Invalid binding ownership [#EFFX2424]

Owner: http

Default severity: error

Severity policy: Fixed

A bound group must own at least one external operation and no locally implemented operation. Native endpoints outside effx remain supported by native mixed completion.

### Example 1

Before:

```text
Binding.group(value, options)
```

After:

```text
Binding.group(Group, { handlers, guards })
```

Bind a wholly external effx group.

## EFFX2500 — Malformed or duplicate access contract [#EFFX2500]

Owner: access

Default severity: error

Severity policy: Fixed

Access annotations and semantic contracts must be singular. Malformed AccessContract data includes the Schema validator detail after the stable prefix.

### Example 1

Before:

```text
@Http.Access(accessOptions)
@Http.Access(accessOptions)
```

After:

```text
@Http.Access(accessOptions)
```

Remove the duplicate. For malformed data, correct the fields named by the validator; extension producers must conform to AccessContractData.

## EFFX2501 — Command access decides in a read snapshot [#EFFX2501]

Owner: access

Default severity: error

Severity policy: Fixed

A Command cannot authorize from a read snapshot unless it makes the constrained snapshotDecisionForCommand claim. Ordinary command decisions belong in its transaction.

### Example 1

Before:

```text
decisionTime: "SnapshotRead"
```

After:

```text
decisionTime: "Transaction"
```

Decide access inside the mutation transaction, so the decision and write share the relevant state.

## EFFX2502 — Query declares a transaction decision [#EFFX2502]

Owner: access

Default severity: warning

Severity policy: Fixed

A Query with decisionTime Transaction is accepted with a warning: the usual read-only access decision uses SnapshotRead.

### Example 1

Before:

```text
decisionTime: "Transaction"
```

After:

```text
decisionTime: "SnapshotRead"
```

Use a snapshot read decision unless the query intentionally needs transactional decision semantics.

## EFFX2503 — Protected access lacks security middleware [#EFFX2503]

Owner: access

Default severity: error

Severity policy: Fixed

Protected HTTP access needs a security middleware marker in Http.Contract. Declaring capabilities alone does not authenticate requests.

### Example 1

Before:

```text
@Http.Contract({ group: "users", success: User })
```

After:

```text
@Http.Contract({ group: "users", success: User, middleware: [Security] })
```

Include the exported middleware marker declared with security: true, whose application implementation authenticates the accepted credentials.

## EFFX2504 — HTTP exposure lacks access declaration [#EFFX2504]

Owner: access

Default severity: warning

Severity policy: strictAccess — Warning by default; error when strictAccess is true.

Allowed severities: error, warning

HTTP exposure requires an explicit @Http.Access contract. This is a warning by default and an error under strictAccess (including --strict-access). Declare public access explicitly too; absence is not a public-access contract.

### Example 1

Before:

```text
@Query(...)
@Http.Get("/users")
```

After:

```text
@Query(...)
@Http.Get("/users")
@Http.Access(accessOptions)
```

Declare an access contract with the intended credentials, principal kinds, capabilities, scope resolver and decision time. Do not disable strict mode to hide missing access.

## EFFX2505 — HTTP root mixes visibility modes [#EFFX2505]

Owner: access

Default severity: error

Severity policy: Fixed

A generated ForApi client exposes its entire root. Internal and External operations cannot share a root; visibility must be uniform.

### Example 1

Before:

```text
root: "api", exposure: "Internal"
root: "api", exposure: "External"
```

After:

```text
root: "internalApi", exposure: "Internal"
root: "api", exposure: "External"
```

Separate internal and external operations into different roots, or align their intended visibility.

## EFFX2506 — Invalid command snapshot decision claim [#EFFX2506]

Owner: access

Default severity: error

Severity policy: Fixed

snapshotDecisionForCommand requires a Command, SnapshotRead decision time, no requirements, exactly ObjectCapability credentials and exactly CapabilityHolder principals. All violated conditions are reported in their original order. An accepted shape is a reviewable assertion, not proof of resolver or guard behavior.

### Example 1

Before:

```text
snapshotDecisionForCommand: true, decisionTime: "Transaction"
```

After:

```text
snapshotDecisionForCommand: false, decisionTime: "Transaction"
```

Remove the claim and use transactional command authorization. Only retain a snapshot claim when every narrow capability-only condition holds and the resolver/guard have been reviewed.

## EFFX2601 — Foldkit command or tagged Message contract invalid [#EFFX2601]

Owner: foldkit

Default severity: error

Severity policy: Fixed

This legacy code covers both Foldkit IR validation and frontend Message-schema lowering. Foldkit.Command needs valid UiCommand data, exactly one qualified owner edge to an operation, one command contribution, exactly one HTTP exposure and an external (not Internal) HTTP root. The interpreter also rejects duplicate annotations. Independently, frontend success/failure Message fields must reference exported tagged Schemas whose Type has a literal-union _tag. Preserve both meanings; this number is not a new target-only diagnostic.

### Example 1

Before:

```ts
@Foldkit.Command({ success: Schema.String, failure: Schema.String })
```

After:

```ts
@Foldkit.Command({ success: Saved, failure: SaveFailed }) // exported tagged Message Schemas
```

Use exported tagged Messages, attach one command to one operation and one external HTTP exposure, and repair malformed IR ownership/data.

## EFFX2701 — Project target or Effect installation unsupported [#EFFX2701]

Owner: project

Default severity: error

Severity policy: Fixed

The tsconfig effx settings may be invalid, effect/package.json may be unresolved or invalid, the installed Effect version may not select a supported target, or a generated source module may be unsupported for the selected target. These are configuration/target diagnostics, not arbitrary generator failures.

### Example 1

Before:

```ts
"effx": { "target": "unknown" }
```

After:

```ts
"effx": { "target": "effect-4.0" }
```

Select a supported target, install a supported Effect cohort, resolve its package from the project and use source modules available in that target.

## EFFX2801 — Deployment entry does not reach a Worker [#EFFX2801]

Owner: surface

Default severity: error

Severity policy: Fixed

The against entry neither is nor reaches a recognized Alchemy Worker program: recognition is a call of Cloudflare.Worker imported from alchemy/Cloudflare. Arbitrary similarly named functions do not count.

### Example 1

Before:

```ts
effx surface check --against src/schema.ts
```

After:

```ts
effx surface check --against alchemy.run.ts
```

Point --against at the deployment program that reaches the recognized Worker call.

## EFFX2802 — Required generated wiring is not referenced [#EFFX2802]

Owner: surface

Default severity: error

Severity policy: Fixed

The current surface requires a generated wiring export, but the selected deployment entry never references that export. A type-only import does not wire runtime behavior. The message uses the generated file basename.

### Example 1

Before:

```ts
import type { AppRoutes } from "./.effx/generated/http.ts";
```

After:

```ts
import { AppRoutes } from "./.effx/generated/http.ts"; // use in Worker wiring
```

Reference the generated runtime wiring from the deployment entry.

## EFFX2803 — Deployment references obsolete generated wiring [#EFFX2803]

Owner: surface

Default severity: error

Severity policy: Fixed

The deployment references a generated wiring export that the current build does not produce. This includes removed groups and stale modules. The message uses the generated file basename.

### Example 1

Before:

```ts
import { RemovedApiHandlers } from "./.effx/generated/removed.ts";
```

After:

```ts
import { UsersApiHandlers } from "./.effx/generated/users.ts";
```

Remove obsolete wiring or replace it with the current generated export.

## EFFX2804 — Surface comparison entry cannot be read [#EFFX2804]

Owner: surface

Default severity: error

Severity policy: Fixed

The file selected with --against does not exist at the resolved path. This data diagnostic covers the existence check; other filesystem failures retain their existing failure taxonomy.

### Example 1

Before:

```ts
effx surface check --against missing.ts
```

After:

```ts
effx surface check --against alchemy.run.ts
```

Supply an existing deployment entry and resolve its path from the command directory.

## EFFX2805 — Persisted surface differs from current IR [#EFFX2805]

Owner: surface

Default severity: warning

Severity policy: Fixed

The existing .effx/surface.json contents differ from the current normalized IR projection. Surface checking does not write or repair that file itself.

### Example 1

Before:

```ts
// .effx/surface.json from before operation changes
```

After:

```ts
effx build
```

Regenerate the persisted surface with effx build and review the updated wiring.

## EFFX2806 — Wiring cannot be decided statically [#EFFX2806]

Owner: surface

Default severity: warning

Severity policy: Fixed

A dynamic import with a non-literal specifier or computed namespace access into a generated module prevents static wiring analysis. The source location belongs to the undecidable expression; the warning does not claim the wiring is absent.

### Example 1

Before:

```ts
const routes = generated[key];
```

After:

```ts
const routes = generated.AppRoutes;
```

Use a literal module specifier and a statically named export so the checker can follow runtime references.

## EFFX2807 — Emit mode has no wiring to check [#EFFX2807]

Owner: surface

Default severity: info

Severity policy: Fixed

The selected emit mode generates no AppRoutes or group ApiHandlers exports. Surface checking has nothing to compare for wiring in this mode.

### Example 1

Before:

```ts
effx surface check --emit contract
```

After:

```ts
effx surface check --emit all
```

Use a wiring-producing emit mode when deployment wiring verification is intended.

## EFFX2901 — Example operation is deprecated [#EFFX2901]

Owner: example.deprecated

Default severity: warning

Severity policy: Fixed

The shipped example.deprecated extension found a deprecated annotation and reports its authored reason for each operation owner. This numeric code is a grandfathered example reservation, not a general third-party range.

### Example 1

Before:

```ts
@Annotate("example.deprecated", { reason: "Use User.GetV2" })
```

After:

```ts
// switch callers to User.GetV2 and remove the obsolete operation
```

Follow the authored replacement reason before removing the deprecated operation.

## EFFX2902 — Example deprecated annotation is malformed [#EFFX2902]

Owner: example.deprecated

Default severity: error

Severity policy: Fixed

The deprecated example requires one argument shaped { reason: string } and an operation declaration to own it. Both malformed arguments and missing operation ownership are diagnosed.

### Example 1

Before:

```ts
@Annotate("example.deprecated", { reason: 42 })
```

After:

```ts
@Query(options) @Annotate("example.deprecated", { reason: "Use User.GetV2" })
```

Supply a string reason and apply the annotation to a Query or Command.

## EFFX3001 — Unsupported Effect construct [#EFFX3001]

Owner: lift

Default severity: error

Severity policy: Fixed

Lift reads only the exact declaration grammar of the spec: literal keys, paths and option objects; registered application wrappers; registered metadata calls with literal arguments; registered annotation keys. A computed key, path or option object, a spread, an unknown endpoint step, an unknown pipe step, an unregistered annotation key, a form-encoded inline payload, a group prefix, group middleware or group addError, and a registered metadata call with a non-literal argument are all reported with the construct named. The endpoint is omitted from every suggestion: lift never guesses and never evaluates source.

### Example 1

Before:

```text
HttpApiEndpoint.get("list", "/items", { success: ItemsResponse }).setHeaders(CustomHeaders)
```

After:

```text
HttpApiEndpoint.get("list", "/items", { success: ItemsResponse })
```

Remove the unsupported step or move the behavior into a registered wrapper; lift reports the construct instead of dropping it.

## EFFX3002 — Channel schema must be an exported named schema [#EFFX3002]

Owner: lift

Default severity: error

Severity policy: Fixed

A request channel or the success of an endpoint is written as inline fields, as the bare fields of another schema, or as an inline Schema expression, so it has no exported name. An effx declaration references schemas by exported name, so lift suggests a wire-preserving refactor that exports a named schema and points the channel at it. The diagnostic carries the source edits; it blocks --check unless the overlay applies it.

### Example 1

Before:

```text
query: ScopeQuery.fields
```

After:

```text
export const ScopeQuerySchema = Schema.Struct(ScopeQuery.fields);
// query: ScopeQuerySchema
```

The bare fields are not the schema itself, because the named schema carries an identifier annotation that would add an OpenAPI component.

## EFFX3003 — Response header schema must be an exported named schema [#EFFX3003]

Owner: lift

Default severity: error

Severity policy: Fixed

A registered success wrapper builds its response headers inline, so no exported schema names them. Lift suggests exporting the header schema from the wrapper's module and making the wrapper use it, a wire-preserving refactor that the overlay check proves. The diagnostic carries the source edits.

### Example 1

Before:

```text
export const privateRead = (success) => HttpApiSchema.WithHeaders(success, { cache: Cache })
```

After:

```text
export const PrivateReadHeaders = Schema.Struct({ cache: Cache });
export const privateRead = (success) => HttpApiSchema.WithHeaders(success, PrivateReadHeaders)
```

Export the headers once and reference the export from the wrapper.

## EFFX3004 — Problem codes must be an exported const tuple [#EFFX3004]

Owner: lift

Default severity: error

Severity policy: Fixed

The code list of a problem union is written inline, so the effx declaration would duplicate it. Lift suggests extracting the list into an exported const tuple that both the union and the declaration reference. A list that is not a literal array of string literals cannot be read without evaluating source and is unliftable until it is named.

### Example 1

Before:

```text
problemUnion("ReadProblem", ["not-found", "forbidden"])
```

After:

```text
export const ReadProblemCodes = ["not-found", "forbidden"] as const;
problemUnion("ReadProblem", ReadProblemCodes)
```

One exported tuple is the single source of truth for the codes.

## EFFX3005 — Access annotation is not a registered builder call with literal arguments [#EFFX3005]

Owner: lift

Default severity: error

Severity policy: Fixed

Access is lifted only from a registered access builder called with literal arguments. A local closure, a named constant, a spread or a non-literal builder argument would require partial evaluation, which lift never performs. The endpoint is omitted from every suggestion.

### Example 1

Before:

```text
.pipe((endpoint) => annotateAccessSpec(endpoint, access(true)))
```

After:

```text
.pipe((endpoint) => annotateAccessSpec(endpoint, personNativeAccess({ capability: "profile.read-self", canonicalScopeResolver: "profile.current-person", decisionTime: "SnapshotRead" })))
```

Write the access with a registered builder and literal arguments.

## EFFX3006 — No lifter rule for callee [#EFFX3006]

Owner: lift

Default severity: error

Severity policy: Fixed

An application helper is used as a success wrapper, metadata, access or problem helper, but no lifter rule registers it. Rules are data supplied through the definition-owned lift hook; lift never guesses a helper's meaning and never unfolds its body as authority.

### Example 1

Before:

```text
success: customResponse(UserResponse)
```

After:

```text
// register customResponse as a SuccessWrapper rule, or write the schema directly
success: UserResponse
```

Register the helper with a lift rule so lift can map it.

## EFFX3007 — Success has no schema [#EFFX3007]

Owner: lift

Default severity: error

Severity policy: Fixed

The success of the endpoint is a document body of a runtime content type, or another construct with no Schema. effx declares a success only by a schema, so the endpoint is not liftable. A body-less success such as HttpApiSchema.NoContent is liftable and does not produce this diagnostic.

### Example 1

Before:

```text
success: documentMutationResponse("application/pdf")
```

After:

```text
success: ReceiptResponse
```

Declare the response with a schema, or keep the endpoint as handwritten Effect.

## EFFX3008 — Group not found, or not in exactly one root [#EFFX3008]

Owner: lift

Default severity: error

Severity policy: Fixed

The requested group id matches no HttpApiGroup.make declaration, or the group is not added to exactly one HttpApi root. The root is the unique HttpApi.make value whose .add contains the group; zero or several roots cannot select a unique root identity.

### Example 1

Before:

```text
effx lift --group profile  // the group is added to two roots
```

After:

```text
effx lift --group profile  // the group is added to one root
```

Add the group to exactly one root declaration.

## EFFX3009 — No request channel to serve as operation input [#EFFX3009]

Owner: lift

Default severity: error

Severity policy: Fixed

An effx operation requires a fully resolved input. The endpoint declares no params, query, headers or payload schema, and no emptyInput schema is configured, so lift cannot choose an input without inventing one. Configure a real exported emptyInput schema.

### Example 1

Before:

```text
HttpApiEndpoint.get("health", "/health", { success: Health })
```

After:

```text
// configure emptyInput: an exported Schema for no input
```

Name a real exported schema as the lifter's emptyInput.

## EFFX3010 — Lift decision requires review [#EFFX3010]

Owner: lift

Default severity: warning

Severity policy: Fixed

The effx IR contains facts with no Effect twin: the operation kind, the operation input and the real names of new exports. They cannot be validated by comparing wire contracts, so lift prints them as decisions to review and never reports them as verified.

### Example 1

Before:

```text
POST /search  // lifted as a Command
```

After:

```text
// review: the read-only POST may be a Query with payloadIsQuery
```

Review each decision before accepting the suggestion.

## EFFX3101 — Wire contracts differ [#EFFX3101]

Owner: lift

Default severity: error

Severity policy: Fixed

The check built the Reflection of the untouched original group and of the generated group and found a difference outside the closed set of tolerated deltas. The difference is the payload of the report.

### Example 1

Before:

```text
original summary: Read own profile
```

After:

```text
generated summary: Read my profile
```

Any difference in a wire-visible field fails the check.

## EFFX3102 — Check passed [#EFFX3102]

Owner: lift

Default severity: info

Severity policy: Fixed

The Reflections of the original and the generated group are equal after the closed set of delta normalizers. The applied delta classes are listed.

### Example 1

Before:

```text
effx lift --check --group profile
```

After:

```text
PASS(ref-suffix)
```

The only tolerated differences were the named deltas.

## EFFX3103 — Check could not run [#EFFX3103]

Owner: lift

Default severity: error

Severity policy: Fixed

The overlay does not compile, a root cannot be built, a registered projection hook threw, or a trusted lifter-rule hook raised an exception. Lift stays total: a rule exception becomes this diagnostic and never an exit by exception. It is not a pass.

### Example 1

Before:

```text
effx lift --check  // the overlay has a type error
```

After:

```text
effx lift --check  // the overlay compiles
```

Fix the overlay or the hook, then run the check again.

## EFFX3201 — Binding keys differ from the group's endpoint keys [#EFFX3201]

Owner: lift

Default severity: error

Severity policy: Fixed

The handler keys registered by the application's HttpApiBuilder.group call are not exactly the endpoint keys of the group. The key sets are compared statically without executing source.

### Example 1

Before:

```text
h.handleRaw("read", fn)  // the group also declares update
```

After:

```text
h.handleRaw("read", fn).handleRaw("update", fn)
```

Register exactly the group's endpoint keys.

## EFFX3202 — Binding needs hand adaptation [#EFFX3202]

Owner: lift

Default severity: error

Severity policy: Fixed

A handler calls the application's authorization function directly, decodes the payload itself, or registers with .handle instead of .handleRaw. Moving an authorization call behind the lazy authorize callback cannot be mechanical. Lift lists each site and never invents handler code.

### Example 1

Before:

```text
yield* authorize(request)  // inside the handler
```

After:

```text
(input, authorize) => ... // lazy authorize callback
```

Adapt the site by hand; the binding report stays unverified until then.

## EFFX3401 — Persistence method must be declaration-only [#EFFX3401]

Owner: persistence

Default severity: error

Severity policy: Fixed

A persistence port method has a local handler or local binding. Ports describe an adapter capability and must not embed an application implementation.

### Example 1

Before:

```ts
Operation.query({ name: "Store.Get", input: Input, success: User }).with(Port({ port: "Store" })).handler(handler)
```

After:

```ts
Operation.query({ name: "Store.Get", input: Input, success: User }).with(Port({ port: "Store" })).declare()
```

Use declare() and place implementation in the adapter, not the port definition.

## EFFX3402 — Persistence port method has transport exposure [#EFFX3402]

Owner: persistence

Default severity: error

Severity policy: Fixed

Persistence port methods cannot have HTTP, RPC or CLI exposures. They are an internal adapter interface, not an application transport boundary.

### Example 1

Before:

```ts
Operation.query(options).with(Port({ port: "Store" })).http.get("/users").declare()
```

After:

```ts
Operation.query(options).with(Port({ port: "Store" })).declare()
```

Expose a separate application operation that calls the port.

## EFFX3403 — Persistence port shape or identity invalid [#EFFX3403]

Owner: persistence

Default severity: error

Severity policy: Fixed

A Port contribution needs one operation owner and { port: string }. Methods must have the port-name prefix and a nonempty method name, without duplicates. Different port names cannot collapse to the same generated filename. Duplicate Port annotations on a declaration are also rejected under this code.

### Example 1

Before:

```ts
Operation.query({ ...options, name: "Get" }).with(Port({ port: "Store" })).declare()
```

After:

```ts
Operation.query({ ...options, name: "Store.Get" }).with(Port({ port: "Store" })).declare()
```

Repair ownership/data, use PortName.method naming, declare each method once and choose port names whose escaped lowercase filenames differ.

## EFFX3404 — Query-only port has vacuous transaction laws [#EFFX3404]

Owner: persistence

Default severity: warning

Severity policy: Fixed

The port declares only Queries. Generated rollback and atomicity properties are vacuous because no Command mutation exists to exercise them. This is not evidence that an adapter supports transactional writes.

### Example 1

Before:

```ts
Store: { Get: Query }
```

After:

```ts
Store: { Get: Query, Put: Command }
```

Add a real Command if transactional write conformance is required; otherwise accept the query-only limitation.

## EFFX4101 — Cedar projection identity invalid or ambiguous [#EFFX4101]

Owner: cedar

Default severity: error

Severity policy: Fixed

The namespace must consist of unreserved Cedar identifiers joined by ::. Entity type names must be valid, nonreserved and not Action, and cannot merge distinct source identities into one name. Generated policy ids must also be unique. Each variant blocks projection rather than silently renaming or dropping a source.

### Example 1

Before:

```ts
effx cedar --namespace 1bad
```

After:

```ts
effx cedar --namespace App::Authz
```

Use valid unreserved namespace/entity names, disambiguate source exports and ensure distinct policy identities.

## EFFX4102 — Application Cedar policy validation error [#EFFX4102]

Owner: cedar

Default severity: error

Severity policy: Fixed

The Cedar validator rejected an application-authored --policies file against the emitted schema. Findings retain the file, optional policy id, exact validator message and optional help. Generated Cedar validation failures remain CompilerFault invariant failures, not this diagnostic.

### Example 1

Before:

```ts
permit(principal, action == Effx::Action::"operation/User.Gett", resource);
```

After:

```ts
permit(principal, action == Effx::Action::"operation/User.Get", resource);
```

Repair the policy using the emitted actions/entity types and the validator help, then validate again.

## EFFX4103 — Parameterized requirement projected by id only [#EFFX4103]

Owner: cedar

Default severity: warning

Severity policy: Fixed

An AccessContract requirement has parameters. The Cedar projection records its id but does not enforce parameter constraints. Do not mistake successful projection for full authorization equivalence.

### Example 1

Before:

```ts
requirements: [{ id: "workspace.member", parameters: { role: "admin" } }]
```

After:

```ts
// enforce role parameters in the application authorization decision
```

Keep parameter enforcement in the application or an explicitly authored policy; the emitted id-only model is insufficient.

## EFFX4104 — All capabilities cannot be one Cedar request [#EFFX4104]

Owner: cedar

Default severity: warning

Severity policy: Fixed

An AccessContract capabilities All expression, or several linked capabilities without a contract, requires all capabilities at once. One Cedar request cannot represent that conjunction, so the operation action has no capability-group parent. The legacy no-contract form reports the capability count.

### Example 1

Before:

```ts
capabilities: Capability.all("read", "write")
```

After:

```ts
// authorize the required conjunction explicitly in application policy/decision logic
```

Retain the conjunction in application authorization; do not change All to Any just to silence the warning.

## EFFX4105 — Capability uses generic Cedar principal [#EFFX4105]

Owner: cedar

Default severity: info

Severity policy: Fixed

An operation declares a capability without an AccessContract. The projection falls back to the generic Principal entity type because no principalKinds contract exists. This is informational, not a statement that credentials have been checked.

### Example 1

Before:

```ts
@Authorize(ReadCapability) // no Http.Access
```

After:

```ts
@Http.Access({ ...accessContract, principalKinds: ["User"] })
```

Declare an AccessContract when the Cedar model needs the actual principal kinds.

## EFFX4106 — Application Cedar policy validation warning [#EFFX4106]

Owner: cedar

Default severity: warning

Severity policy: Fixed

The Cedar validator warned about an application-authored --policies file. Findings preserve file, optional policy id, exact validator message and optional help. Warnings do not block by default, but --deny-warnings makes the command fail without changing diagnostic severity.

### Example 1

Before:

```ts
permit(principal, action == Effx::Action::"operation/User.Get", resource) when { false };
```

After:

```ts
permit(principal, action == Effx::Action::"operation/User.Get", resource);
```

Review and repair the validator finding; use --deny-warnings when policy warnings must fail the command.

## EFFX4107 — No authorization facts to project [#EFFX4107]

Owner: cedar

Default severity: info

Severity policy: Fixed

No operation has a capability or AccessContract. Cedar writes nothing because there is no authorization model to project, rather than emitting an empty misleading schema.

### Example 1

Before:

```ts
@Query(options) static get() { return handler(); }
```

After:

```ts
@Query(options) @Authorize(ReadCapability) static get() { return handler(); }
```

Declare the intended capability/access facts before requesting a Cedar projection, or accept that nothing is written.

## EFFX9001 — Example Command lacks Audit annotation [#EFFX9001]

Owner: ai-docs

Default severity: warning

Severity policy: Fixed

The shipped handwritten Audit extension warns for each Command without its Audit ExtensionOf contribution. Queries do not trigger this rule. This is an example-owned numeric reservation only.

### Example 1

Before:

```ts
Operation.command(options).handler(handler)
```

After:

```ts
Operation.command(options).annotate("Audit", { level: "sensitive" }).handler(handler)
```

Attach an Audit annotation and select auditExtension if the example audit policy is intended.

## EFFX9002 — Example Audit annotation needs an operation [#EFFX9002]

Owner: ai-docs

Default severity: error

Severity policy: Fixed

The shipped handwritten Audit interpreter cannot attach an Audit contribution when no operation id exists. This reservation is specific to the authoring example.

### Example 1

Before:

```ts
@Annotate("Audit", { level: "standard" }) static get() { return handler(); }
```

After:

```ts
@Query(options) @Annotate("Audit", { level: "standard" }) static get() { return handler(); }
```

Add Query or Command so the Audit node has an operation owner.

## EFFX9101 — Example RateLimit requires HTTP exposure [#EFFX9101]

Owner: ai-docs

Default severity: error

Severity policy: Fixed

The shipped implement(RateLimit) example checks for an HTTP exposure on the annotated operation. RPC-only and unexposed operations cannot use that example rate-limit policy.

### Example 1

Before:

```ts
Operation.query(options).with(RateLimit({ perMinute: 60 })).handler(handler)
```

After:

```ts
Operation.query(options).http.get("/users").with(RateLimit({ perMinute: 60 })).handler(handler)
```

Expose the operation through HTTP or remove this HTTP-specific example annotation.

## EFFX9102 — Example rate limit is effectively unlimited [#EFFX9102]

Owner: ai-docs

Default severity: warning

Severity policy: Fixed

The shipped RateLimit example warns when perMinute exceeds 10,000. At or below that threshold this analysis emits nothing; the warning does not itself enforce requests.

### Example 1

Before:

```ts
@RateLimit({ perMinute: 20000 })
```

After:

```ts
@RateLimit({ perMinute: 60 })
```

Choose the intended finite policy value and enforce it in the relevant runtime boundary.
