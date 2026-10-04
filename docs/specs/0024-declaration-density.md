# Spec 0024 — Declaration density: derived channels, defaults, naming and binding inference

Status: **approved and frozen 2026-10-04** (operator). Order of work: spec 0015 → generator-only S5 (`monoweb-gap`) → spec 0020 → **this spec** → spec 0019. Lands only after the built-ins are re-expressed with identical hashes (0020 §3); each of the five items is a **separate commit with its own falsifier**. Builds on 0005, 0006, 0009, 0010, 0013, 0015, 0020. Mono-web files are read-only evidence; every measurement below was taken on throwaway copies.

## 0. Operator decisions (2026-10-04)

1. Derive request channels from the operation `input` by an unambiguous rule; an explicit field wins; ambiguity is a diagnostic, never a guess.
2. `status: 200` is unnecessary: the declaration-side change is documentation, examples and lift (0019) no longer writing it; the compiler side is S5 (owned by `monoweb-gap`, landing before 0020).
3. `decisionTime` defaults from the operation kind: `Query → SnapshotRead`, `Command → Transaction`; an explicit value overrides; EFFX2501/2502 keep checking the resolved value.
4. The problem-identifier naming rule is configurable in `effx.config.ts` as a **declared pattern** (data, not a function), default `${endpointKey}Problem`.
5. Binding inference: the generated handler factory binds handlers and guards by a **declaration-site reference in a backend-owned file**, resolved by symbol, never by executing a module; the contract package stays free of backend imports (specs 0009/0010).

## 1. Evidence (hand-edited throwaway copies of mono-web `fcc2f3e0 (unpublished)`, formatted with oxfmt, not compiled)

Declaration files (`packages/http-api/src/*.effx.ts`), physical lines:

| File              | Current | V1: only what 0013 already offers (payload omitted, hoisted middleware/credentials) | V2: V1 + items 1–4 | 0024's own share (V1→V2) |
| ----------------- | ------- | ----------------------------------------------------------------------------------- | ------------------ | ------------------------ |
| `profile.effx.ts` | 107     | 93                                                                                  | **85**             | −8                       |
| `content.effx.ts` | 316     | 297                                                                                 | **269**            | −28                      |

V1 shows that part of the gap is declarations not yet using existing 0013 features (Content repeats `payload:` and `middleware: [PersonSecurity]` per operation although group defaults and the payload rule exist). This spec claims only the V1→V2 difference. What disappears in V2 (Profile and Content): `status: 200` (nine sites), `decisionTime` (ten), `identifier: "…Problem"` (ten, all of the form `{Group}{Key}Problem`), `query: true` (three), `params:`/`headers:` that duplicate `input` (two). Over all four committed groups (Profile, Directory, SocialEvents, Content) the same fields occur at `status: 200` 15, `decisionTime` 17, `identifier` 17, `query: true` 4 sites; the only identifiers that do not follow the pattern are Directory's deliberately shared `SchoolAdministrationProblem`.

Backend binding files (`apps/backend/src/{profile,content}/http.ts`), same method, after applying §6 by hand:

| File              | Current | After (binding file included)                                                       | Change         |
| ----------------- | ------- | ----------------------------------------------------------------------------------- | -------------- |
| `content/http.ts` | 162     | 115 + 8-line `content.bind.ts`, plus 2 lines of pre-applied typing (§6.4) = **125** | **−37 (−23%)** |
| `profile/http.ts` | 407     | 399 + 8-line `profile.bind.ts`, plus typing = **≈407**                              | **≈0**         |

Why the asymmetry, from the sources: Content's per-operation guards differ only by the operation's access (staff or public), so one `guardFor(endpoint)` replaces a 10-entry record, its 11-line `LocalContentGuards` type, nine endpoint-value imports and the factory wrapper. Profile's two guards are genuinely different programs (snapshot vs in-transaction actor resolution) and its raw handlers are application logic; binding inference removes only type plumbing there. **The bulk of every binding file is application logic (`webHandler(...)` adapters, actor resolution, receipts) that no convention can infer.** The binding half of this spec is justified by removing wiring and a dependency-direction hazard, not by a large line count. Final numbers come from compiled code at the §8 gate; these are design estimates.

## 2. Derive request channels from `input`

### 2.1 Rule

Run in the 0013 pre-pass (`expandGroupDefaults`), after group defaults, before interpretation. Inputs: the HTTP method; the path parameter names `P` (existing `pathParams`, including `:id:action` forms); the operation `input` schema `S` with its statically captured field keys `F` (spec 0020 `A.schema({ fieldKeys: "all" })` on `input`; absent when `S` is not a struct with static fields); the explicit channels in `Http.Contract`; and whether `S` is **header-marked**.

| Step | Condition                                                           | Result                                                                                                                                                               |
| ---- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | `S` is already the schema of an explicit channel (same `SchemaRef`) | nothing to derive (this keeps `input: X` + `headers: X` valid and IR-identical)                                                                                      |
| 1    | `S` is header-marked                                                | `headers := S`, unless `headers` is explicit with another schema: **EFFX2410** (an input that is a header schema cannot also be a body)                              |
| 2    | `P` empty                                                           | GET/DELETE → `query := S`; POST/PUT/PATCH → `payload := S` (the 0013 rule, unchanged)                                                                                |
| 3    | `P` non-empty, `F` known, `F = P`                                   | `params := S`                                                                                                                                                        |
| 4    | `P` non-empty, `F` known, `F ∩ P = ∅`                               | GET/DELETE → `query := S`; POST/PUT/PATCH → `payload := S`                                                                                                           |
| 5    | `P` non-empty, `F` known, otherwise (partial overlap)               | **EFFX2410**: the input mixes path and body/query fields; write the channels explicitly (no derived split schema is ever invented: it would change OpenAPI identity) |
| 6    | `P` non-empty, `F` unknown                                          | POST/PUT/PATCH → `payload := S` (0013 compatibility); GET/DELETE → **EFFX2411**                                                                                      |

A derived channel never overrides an explicit one: if the target slot is already explicit with a different schema, `input` simply serves no channel (it remains the operation's semantic input, as today). `query: true` keeps working (it means "derive here") and is redundant for GET.

### 2.2 The header marker

`Http.headers(schema)` in `@effx/runtime` is an identity function typed `<S extends Schema.Top>(schema: S) => S & { readonly "~effx/Http/Headers": true }`. The frontend detects the brand **by type shape** (as `~effect/Schema/Schema`) and records `marker: "headers"` on the lowered `SchemaArg` (an optional field; `SchemaRef` and the IR are unchanged). No name or key-pattern heuristic is used: "all field names look like header names" is a guess and is rejected. Mono-web marks four existing schemas in `http-semantics.ts` (`ConditionalReadHeaders`, `IdempotencyHeaders`, `IdempotencyIfMatchHeaders`, `IfMatchHeaders`) with one wrapping call each; the contract package already depends on the runtime.

### 2.3 Identity

The pre-pass writes the derived channel into the `Http.Contract` annotation arguments, so `HttpContractData`, its `paramsKeys`/`headersKeys`, the IR, the hash and every generated byte are **identical** to the explicit spelling. Only the pre-expansion `Collected` differs (new `fields` on `input`, `marker` on a header schema).

## 3. `status: 200` is unnecessary

Compiler side: S5, delivered by `monoweb-gap` before 0020. Because the generator sees only a `SchemaRef` and may not evaluate application source (ADR 0001), S5 emits a conditional expression for `status: 200` (`(SchemaAST.resolve(schema.ast)?.httpApiStatus ?? 200) === 200 ? schema : HttpApiSchema.status(200)(schema)`, using only the public, typed `httpApiStatus` annotation, never the `@internal` `getStatusSuccess`) rather than omitting the wrapper: a 200 or unannotated schema keeps its own object (no `_1` suffix), a schema annotated with another status is still overridden. This spec adds no compiler code for it. Declaration side: docs, examples, the rc116 Profile/Directory twins and `lift` stop writing `status: 200`; a non-default `status` (201) stays explicit, and an explicit `status: 200` stays valid and means the same as today.

**Hash consequence, stated plainly.** `HttpContractData.status` is part of the IR and the compiler cannot prove a schema has no status annotation of its own (it detects only literal annotations, `signature.ts:46`), so _absent_ and _200_ stay different IR values. A declaration that drops `status: 200` therefore has a **different semantic hash** from today's, while its OpenAPI and SDK are byte-identical once S5 is in and its generated contract file differs from the explicit-200 spelling **only in that status expression**. This is the one item whose falsifier does not claim hash identity; it claims: hash differs only in `status`; OpenAPI and SDK identical; generated contract bytes identical apart from the S5 status expression. Consequence for 0019: lift emits `status` only for an explicit non-200 `HttpApiSchema.status(n)`, and its corpus oracle becomes the dense rewrite (§8), not the committed verbose declaration.

## 4. `decisionTime` default

`Http.Access.decisionTime` becomes source-optional (0020 `A.sourceOptional`; required in `Read`). The pre-pass fills it from the sibling operation annotation: `Query → "SnapshotRead"`, `Command → "Transaction"`. An explicit value is kept (mono-web has reads that run in a transaction and write `"Transaction"` on a Query). `EFFX2501` (Command + SnapshotRead, error) and `EFFX2502` (Query + Transaction, warning) run on the resolved value, so a default can never trip them and an explicit mismatch still does. A declaration with no `Query`/`Command` to default from is **EFFX2414**. Decorators, builders and group-level access defaults behave identically (the group's `defaults.access` deliberately does **not** gain `decisionTime`: it is per-operation by nature). The IR value is present after the pre-pass, so IR/hash/bytes are identical to the explicit spelling. Evidence: all 17 operations of the four committed groups already satisfy the default.

## 5. Problem identifier naming

`defineConfig({ naming: { problemIdentifier: "{Group}{Key}Problem" } })` (spec 0015 config; also the tsconfig `effx.naming` block and a `--naming-problem-identifier` flag, resolved with the 0015 precedence table). The value is a string literal pattern; it is **data**, so a project can be analysed without running anything and the pattern is recorded in the manifest.

| Placeholder         | Meaning                                                                          | Example (`profile`/`readOwnProfile`; `social-events`/`create`) |
| ------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `{Group}`           | PascalCase group part (the existing `groupExportPart`: `-`, `_`, `.` boundaries) | `Profile`; `SocialEvents`                                      |
| `{Key}`             | endpoint key with first letter upper-cased                                       | `ReadOwnProfile`; `Create`                                     |
| `{group}` / `{key}` | the raw group id / endpoint key                                                  | `profile` / `readOwnProfile`                                   |

Validation at config load: only these placeholders; the pattern must contain `{Key}` or `{key}`; the expansion must be identifier-safe; otherwise **EFFX2412**. Resolution: the pre-pass fills `Http.Problems.identifier` when the operation does not set one; an explicit `identifier` always wins (Directory's shared `SchoolAdministrationProblem` stays as written). Two operations whose **derived** identifiers collide with different code lists are **EFFX2413** (two distinct unions would share one OpenAPI schema name); equal code lists are allowed. Default (no config, no explicit value) stays `${endpointKey}Problem`, so no existing project changes. Mono-web's convention is `"{Group}{Key}Problem"`, which reproduces all ten Content/Profile identifiers.

IR consequence: with a pattern configured the identifier is written into the problem contract exactly as an explicit one would be, so the IR/hash equal the explicit declaration's. `naming` is therefore a **semantic input** and is recorded in `.effx/manifest.json`; the contract and handlers passes must use the same value (the check that both passes hash alike already catches a mismatch).

## 6. Binding inference

### 6.1 Today

The app writes, per group, a raw-handler record and a guard record keyed by operation, types them against generated types it must re-derive (`type ContentEndpoints = HttpApiGroup.Endpoints<(typeof ExternalNativeApi)["groups"]["content"]>`, `satisfies ContentGuards<…>`/`ContentRawHandlers<…, Guards>`, a hand-written `LocalContentGuards`), imports one endpoint value per guard, and calls `GeneratedContentApiHandlers({ raw, guards })` (`apps/backend/src/{profile,content}/http.ts`; generated `*-handlers.ts`).

### 6.2 Declaration: a backend-owned binding file

The reference cannot live in the contract declaration (`.declare({ handler })` would make `packages/http-api` import backend code, reversing the 0009/0010 dependency). It lives in a **backend file collected only by the handlers pass**:

```ts
// apps/backend/src/content/content.bind.ts
import { Binding } from "@effx/runtime";
import { ContentGroup } from "@vektorprogrammet/http-api/content.effx";
import { contentGuard, makeContentRawHandlers } from "./http.js";

export const ContentBinding = Binding.group(ContentGroup, {
  handlers: makeContentRawHandlers, // (...ctx) => { [endpointKey]: (input, authorize) => Effect<HttpServerResponse> }
  guardFor: contentGuard, // (endpoint) => (request) => Effect<unknown, Problem>   — OR —
  // guards: makeProfileGuards,       // (...ctx) => { [qualified operation id]: (request) => Effect }
});
```

`Binding.group` is an identity function in `@effx/runtime` (source syntax only, ADR 0001); it is **untyped** against the group: the endpoint types come from Effect and differ per target profile (`effect/http-api` vs `effect/unstable/httpapi`), which the runtime cannot import. Type checking therefore stays where it is today, in the generated file.

- **Collected, not IR.** The frontend collects an exported `Binding.group(G, { … })` call from the handlers-pass entries into `Collected.bindings` (`{ group: SymbolRef, handlers: SymbolRef, guards? | guardFor?: SymbolRef }`); symbols are resolved statically (exported function; `G` an exported `Http.group` value or `@Http.Group` class). Bindings carry no semantics and **never enter the IR or its hash**; they are a generation input exactly like `outputDir`. The contract pass does not list the binding file, and if it did it would ignore it, so both passes keep the same IR hash.
- **No module is executed.** Only symbol identity is read; the generated file imports the symbols.
- **Convention rejected.** Resolving handlers by export name (`handlers.readContentWorkspace`) was considered; it cannot carry the shared context (`resolveActor`, `maxBodyBytes`) or guard typing, and is a guess where the reference is explicit.
- **Adapter rejected.** A configured adapter for the repeated `webHandler(request, (webRequest) => …)` wrapper (about two lines per Content operation) was considered and dropped: it is application-specific and its typing costs more than it saves.

### 6.3 Generated factory

Only a bound group changes; an unbound group keeps today's `({ raw, guards })` factory and its bytes.

```ts
// content-handlers.ts (bound mode, sketch)
export const ContentApiHandlersWith = ({ raw, guards }: …) => HttpApiBuilder.group(root, "content", …); // today's factory, renamed
export const ContentApiHandlers = (...ctx: Parameters<typeof makeContentRawHandlers>) =>
  ContentApiHandlersWith({
    raw: makeContentRawHandlers(...ctx),
    guards: { "content.readContentWorkspace": contentGuard(root.groups.content.endpoints.readContentWorkspace), … },
  });
```

- `ContentApiHandlersWith` keeps the explicit record form so tests can inject their own guards (`http.test.ts` and `http-command-guards.postgres.test.ts` do exactly this with `{ ...contentGuards, … }`).
- `guards` mode: `guards: makeProfileGuards(...ctx)`; `handlers` and `guards` take the **same parameter tuple** (checked: `guards` is typed `(...ctx: Ctx)`).
- `guardFor` mode derives one guard per endpoint from the reflected endpoint value of the concrete root; the guard's failure type must be assignable to each operation's declared errors (the existing generated constraint); principal typing is `unknown`, which is what Content already uses.
- The generated file stays backend-owned and imports the root; the contract file imports nothing from the backend.

### 6.4 Typing the app side

Without `satisfies Content…`, an app handler record loses its contextual types. The bound-mode generated file therefore exports two **pre-applied types**, `ContentRaw` (raw record with `authorize` typed from the binding's guards) and `ContentEndpoints`, so the app writes `}) satisfies ContentRaw;` (one type-only import, one clause; the estimate in §1 includes them). The type-only import cycle (binding file → handlers module → generated types → binding symbols) is type-level only; whether `typeof` through it infers is part of the §8 gate.

## 7. Diagnostics (reserved `EFFX2410`–`EFFX2429`; 0021/0023 hold `EFFX28xx`)

| Code     | Condition                                                                                                                        |
| -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| EFFX2410 | `input` classification is ambiguous: partial path/body overlap, or a header-marked `input` with a conflicting explicit `headers` |
| EFFX2411 | GET/DELETE with path parameters and an `input` whose field keys are not static                                                   |
| EFFX2412 | invalid `naming.problemIdentifier` pattern                                                                                       |
| EFFX2413 | two derived problem identifiers collide with different code lists                                                                |
| EFFX2414 | `decisionTime` omitted on a declaration with no `Query`/`Command`                                                                |
| EFFX2420 | `Binding.group` first argument is not an exported `Http.group` value or `@Http.Group` class                                      |
| EFFX2421 | `handlers`/`guards`/`guardFor` is not an exported function                                                                       |
| EFFX2422 | more than one binding for one group                                                                                              |
| EFFX2423 | a binding gives both `guards` and `guardFor`, or neither plus no handlers                                                        |
| EFFX2424 | a binding group has no external operations in the IR, or mixes local and external operations                                     |

Existing codes are unchanged (EFFX2501/2502 on the resolved `decisionTime`).

## 8. Falsifiers and measurement (per item, separate commits)

Throwaway method for every mono-web claim: copy `packages/http-api/src` (and the backend files named in §1) to a scratch tree with `node_modules` symlinked to the read-only baseline; rewrite the declarations; run the project's own compiler. Never write to mono-web.

| Item | Gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Rewrite Profile/Directory/SocialEvents/Content to drop `query: true`, duplicated `params`/`headers`, mark the header schemas; **IR canonical bytes, semantic hash, generated contract bytes, and the complete `OpenApi.fromApi` and SDK operation index equal the current declarations'** (compare against the pre-change snapshot of `scripts/identity-snapshot.ts`). Negative fixtures for EFFX2410/2411 and for each table row, including "explicit wins" and "input already an explicit channel".                                                                                                                                                      |
| 2    | `OpenApi.fromApi` and SDK index **equal** to the explicit-`status: 200` spelling, and generated contract bytes equal apart from the S5 status expression (assert by diffing with that expression normalized); the IR hash differs **only** in `status` (assert by diffing the two IRs); explicit `status: 201` and explicit `status: 200` unchanged. Examples, docs and rc116 twins no longer write `status: 200`. Requires S5 on main.                                                                                                                                                                                                                    |
| 3    | IR/hash/bytes equal to the explicit spelling for every operation of the four mono-web groups; explicit-mismatch fixtures still raise EFFX2501/2502; EFFX2414 fixture.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 4    | With `"{Group}{Key}Problem"`, the ten Content/Profile operations (and every Directory/SocialEvents one except the shared `SchoolAdministrationProblem`) lose their `identifier:` yet IR/hash/bytes equal the explicit spelling; an explicit override and EFFX2412/2413 fixtures; manifest records `naming`.                                                                                                                                                                                                                                                                                                                                                |
| 5    | Bound-mode generation for Profile and Content in the rc116 fixture typechecks under rc.116 with negative witnesses (missing handler key, undeclared guard failure, mismatched ctx tuples); an unbound group's generated bytes unchanged; the contract file imports no backend module; both emit passes report one IR hash; the two backend test files that inject guards still typecheck through `…With`. **Measure** `wc -l` of `apps/backend/src/{profile,content}/http.ts` plus the new binding files and the declaration files before/after on compiled throwaway copies; report all four numbers next to §1's estimates, including any that disagree. |

Every item also runs the standing gates: `bun run check`, `effect:diagnostics`, the rc116 fixture typecheck, and the 0020 identity snapshot on every fixture plus the vendored mono-web declarations (all hashes unchanged except where this spec states otherwise).

## 9. Consequences for neighbouring specs and sequencing

- **0019 (lift):** the recognizer's emitted normal form is the dense form after this spec: no `status` unless explicit non-200, no `decisionTime` equal to the kind default, no `identifier` equal to the configured pattern, no channel `input` already implies. Its corpus oracle is the **dense rewrite** of each committed declaration (hash-identical per §8 items 1, 3, 4; the status difference of §3 applies), and its handler-binding report (0019 §7) targets `Binding.group`. 0019 is amended accordingly with this commit.
- **0020:** items 1, 3 and 4 need `A.sourceOptional` (`decisionTime`, `identifier`) and `A.schema({ fieldKeys, marker })`; item 5 needs `Binding.group` as a built-in (internal target, no annotation).
- **Not in scope** (candidates the evidence suggests, awaiting an operator decision): default `requirements: []` (twelve `requirements: []` sites across the four groups), deriving the operation `name` from group plus export (`ReadOwnProfile` → `profile.readOwnProfile`), and a group-level `middleware: []` override marker for public operations (Content writes `middleware: []` twice).
