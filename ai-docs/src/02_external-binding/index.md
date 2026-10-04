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
