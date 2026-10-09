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
(`scripts/effx.ts`, spec 0010). The mode is not an IR input, so both
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
(`packages/frontend-ts/test/fixtures/stable-v4/src/fixture-binding.ts`); the module
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
`packages/frontend-ts/test/fixtures/stable-v4/src/{profile,content}.bind.ts`,
`profile-bound-http.ts`, `content-bound-http.ts` and `bound-witnesses.ts`.
They keep backend imports out of contract projections and exercise both record
spread injection styles through `…With`. The fixture's `bun run typecheck`
includes these generated cycles under its installed stable Effect 4.0.0 environment.
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
