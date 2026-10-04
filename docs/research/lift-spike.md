# Lift spike — recognizer over mono-web Profile (2026-10-04)

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

Evidence for [spec 0019](../specs/0019-lift.md). Throwaway code in worktree `../effx-lift` (branch `lift-spike` off `main` `5de7921`), **not merged and since removed**; mono-web and every effx package were read-only. Observed results only; anything not run is marked.

## Question

Can a recognizer over the **hand-written** `f433ea90:packages/http-api/src/profile.ts` (2 endpoints) emit a `.effx.ts` whose compiled IR has the same semantic hash as the human lift committed in `mono-web-effx-baseline`, and is the generated Effect functionally the same as the original?

## Setup (all observed)

| Item | Value |
| ---- | ----- |
| Compiler | effx `main` `5de7921` run as `bun packages/cli/src/main.ts --project … build --strict-access --emit=contract`; the mono-web vendored CLI (`f3c6bf8…` tarball) gave an **identical** `ir.json` for the committed declaration |
| TypeScript | `@typescript/typescript6` 6.0.x for the recognizer (as `frontend-ts`); no checker, AST + import-specifier resolution only |
| Source lifted | `git show f433ea90:packages/http-api/src/profile.ts` saved as `src/profile.orig.ts` |
| Scratch project | `temporary workspace`: copy of the baseline worktree's `packages/http-api/src` (HEAD was `604cbde5 (unpublished)` at copy time; it has since advanced) with root and package `node_modules` symlinked to the baseline's, so imports resolve to rc.116 Effect, the vendored `@effx/runtime` and `@vektorprogrammet/domain`. The scratch path keeps mono-web's `packages/http-api/…` depth, so module paths in `ir.json` are the committed ones |
| Supporting modules | two modes. **refactored** = the baseline's current `http-semantics.ts`/`endpoint-problems.ts`/`common.ts` (what the human lift produced); **original** = `f433ea90` copies (`*.orig.ts`) |
| Lifter table | hard-coded in the spike (`NATIVE`): 4 success wrappers, `nativeProblems`, `operationAnnotations → nativeOperationAnnotations`, `personNativeAccess` → Person/cookie+bearer fields, one resolver symbol, the *existing* `profileAccessAnnotations`/`ProfileCurrentPerson` adapters from `profile-effx-adapters.ts` |
| Spike size | recognizer+printer 334 lines, corpus scanner 164, problem-union scan 21, wire check 63 |

Recognizer steps (the spec's §3.4): find `export const X = HttpApiEndpoint.<verb>(key, path, {…})` chains; read channels (named import ⇒ `Ref`, inline ⇒ `LIFT-INLINE-SCHEMA`); `payload: X.pipe(HttpApiSchema.asJson({contentType}))` ⇒ `mediaType`; `success: wrapper(S[.pipe(status(n))])` ⇒ table lookup; `error: endpointProblemResponses(P)` ⇒ resolve `problemUnion("Id", codes)` in `endpoint-problems`; `.middleware(M)`; `.pipe(e => annotateAccessSpec(e, personNativeAccess({…})))`; `.annotateMerge(operationAnnotations(s, d))`; the `HttpApiGroup.make(id).add(…).annotateMerge(OpenApi.annotations(…))` class; root from the lifter. Emitter: builder form identical in layout to the human declaration, plus a dense form.

## Result 1 — IR hash

| Artifact | semanticHash |
| -------- | ------------ |
| committed `profile.effx.ts` rebuilt (profile-only entry) | `ea8695d9f8f8f7ef578b6519339aae46a7df07f7931d3e9c771aa9dd0f72d92b` |
| **lifted, verbose** | `ea8695d9…92b` — **equal** |
| **lifted, dense** (group defaults, `.in(Group)`) | `ea8695d9…92b` — **equal** |
| mutation control: `status: 200 → 201` | `545a5940a655619345007aa98032a22abf33a6e0e5bee8ca25d32bdb85bd982c` (differs; the hash is not vacuous) |
| lifted without `status: 200` (`explicit` mode) | `c9df481f0a0853a4d023ab2f3f0a3cadd0027e1a202d9b19181e33667531aa8e` (differs: it is a real IR field) |
| renaming the `Operation`/`Http.group` const exports | unchanged `ea8695d9…` |

Further equalities: `jq -S` of the lifted `ir.json` equals the rebuilt truth's; the rebuilt Profile nodes are identical to the Profile subset of the **committed** `packages/http-api/.effx/ir.json` (14 nodes); the generated `profile-contract.ts` of lifted and truth are **byte-identical** (`diff` empty).

The historical hash in `profile-slice-evidence.md` (`0e628ff8bd1f35fd78b4b9678971575413116e12db68d6faea2ff6bd730b8cb9`, compiler `17374d6`) is **not reproduced** by either current compiler (both give `ea8695d9…`). I did not bisect why; [INFERENCE] IR/extension changes since `17374d6`. Consequence adopted in the spec: the corpus oracle is the committed declaration **rebuilt by the test's own compiler**, not a number copied from a document. For context the committed four-group manifest carries `5d47dabb6d6b26b67a9abfab485f2881adbb0f789a5130b49106a6a34f21f9f2`.

## Result 2 — refactors detected on the original modules

With the original `f433ea90` supporting modules the recognizer lifted both endpoints but reported (no diagnostics):

| Spike output | Human diff `f433ea90 → baseline` |
| ------------ | -------------------------------- |
| export `ProfileReadResponseHeaders` (built inline by `privateConditionalResponses`) | present |
| export `EntityMutationResponseHeaders` (built inline by `entityMutationResponse`) | present |
| extract 9-code array of `ProfileReadOwnProfileProblem` into `ProfileReadOwnProfileCodes` | present, same name |
| extract 21-code array of `ProfileUpdateOwnProfileProblem` into `ProfileUpdateOwnProfileCodes` | present, same name |

The human diff also added things a recognizer **cannot derive from P**: the `nativeProblems` registry function, `nativeOperationAnnotations`, `operationAnnotations(summary?, description?)`, and the 67-line per-group access adapter (`profileAccessAnnotations`, `ProfileCurrentPerson`). Those are the *adapter prerequisites* of spec 0019 §4.2.5 / §5.5. Caveat: the successful **compile** used the human-refactored modules; the spike did not apply its own refactor patches (no patch emitter yet), so "the suggestion works after the listed refactors" rests on the refactor list matching the human diff for these four items, not on an applied overlay.

## Result 3 — wire isomorphism (`HttpApi.reflect` + `OpenApi.fromApi`)

Throwaway check (`spike-wire.ts`, 63 lines, appendix): two roots `HttpApi.make("external-native-api").add(G)`, one with the original `ProfileApi`, one with the generated `ProfileApi`; compare `OpenApi.fromApi` JSON and a per-endpoint record (identifier, method, path, merged annotation keys, `AccessSpec` JSON via mono-web's `reflectAccessSpec`, middleware keys, success/error status sets).

| Variant | OpenAPI | Endpoint records |
| ------- | ------- | ---------------- |
| `status: 200` as the human wrote it | **differs only by Δ1**: PATCH `$ref` → `UserProfileResponse_1` (GET keeps `UserProfileResponse`), plus a deep-equal duplicate component | equal after Δ2 |
| `explicit` status (omit `status`) | **byte-equal** (`openapiEqual: true`) | equal after Δ2 |
| mutated summary + media type (negative control, `explicit`) | differs; the diff names `summary` ("Read own profile" vs "Read my profile") and `requestBody.content["application/merge-patch+json"]` | — |

Two non-semantic deltas the first raw run exposed, both now classes in the spec:

- **Δ1 `ref-suffix`.** `HttpApiSchema.status(200)` wraps the success in a new instance; Effect's OpenAPI names the second structurally separate instance of one identifier `N_1`. Deleting `status: 200` removes it (observed). Same mechanism as the accepted SocialEvents delta (`social-events-slice-evidence.md`).
- **Δ2 `explicit-default-identifier`.** The generated endpoint carries `OpenApi/Identifier` = `profile.readOwnProfile`; the original has none and Effect defaults to the same operation id. Raw annotation-key sets differ, the OpenAPI operation id does not.

Finding for the compiler: the human-compatible `status: always` mode is what the committed declarations use, so a lifted declaration that must **hash-equal** a human one takes Δ1 on the wire. The two goals (hash equality with the human lift; byte-equal OpenAPI) conflict unless the generator elides `status(200)` for schemas without their own status (seam S5, no IR change).

## Result 4 — corpus shape counts (mono-web `main` = `f433ea90`, `packages/http-api/src`)

Syntactic scan of every `HttpApiEndpoint.<verb>(…)` chain (scanner not preserved; rules are spec 0019 §3.3). **108 endpoints**: 107 chains of the form `export const X = HttpApiEndpoint…` and 1 wrapped in `annotateAccessSpec(HttpApiEndpoint…, CONST)`; GET 59, POST 41, PATCH 5, DELETE 3; keys, paths and option objects literal 108/108. Lift classes by worst construct:

| Class | Count | Share |
| ----- | ----- | ----- |
| A0 recognizable (plugin tables + codes/header exports) | 52 | 48% |
| A1 + export inline/`.fields` request schema | 13 | 12% |
| A2 + export inline success schema | 6 | 6% |
| B access as closure `access(bool)` (21), constant (5), inline `makeAccessSpec` (2) | 26 | 24% |
| C no-schema success (`noContentMutationResponse` 8, `documentMutationResponse` 1, direct `WithHeaders` 1) or `endpointProblemResponses(…, {cors:false})` | 11 | 10% |

Per-channel counts, wrapper histogram, access-builder histogram (`personNativeAccess` 57, `anonymousNativeAccess` 12, `browserSessionNativeAccess` 6, `invitationNativeAccess` 4) and problem-union shapes (88 definitions; 83 literal arrays, 5 non-literal) are in the spec table. Backend binding side: 16 `HttpApiBuilder.group(…)` sites; 108 real `.handleRaw(` calls (the 109th grep match is a comment); 0 `.handle(`. No `RpcGroup` or CLI `Command` exists in the lifted packages (only a doc/profile-proof mention), so RPC/CLI lift has no corpus.

Desk-checked, not run: the human Directory and SocialEvents lifts differ from a pure recognizer in exactly these ways — invented `EmptyDirectoryInput`/`EmptySocialEventInput` (`Operation.input` has no Effect twin), extracted `SchoolsDirectoryQuery`/`SocialEventScopeQuery` (inline fields and `X.fields`), an extracted `SchoolDirectoryResponse` (inline `.annotate`), exported `…Codes` tuples, and resolver export names that are not derivable from the ids (`PeopleDirectoryResolver` for `"profile.people-directory"`, while Profile's `ProfileCurrentPerson` *is* `PascalCase("profile.current-person")`). Hence spec 0019 §2.3: names that enter the hash must be pinned in the lifter's `names` map.

## What the spike did **not** show

- Only Profile (2 endpoints) was lifted and compiled; Directory and SocialEvents were not.
- The lifter table, wrapper meanings and access mapping were hard-coded; nothing was inferred from the helper bodies.
- Refactors were detected, not applied; the overlay `tsc`, a binding check and a refactor-patch emitter do not exist.
- The wire check ran on one group, one rc.116 install; `ProjectionHook` was hard-wired to `reflectAccessSpec`.
- No property test of `lift(lower(x))`; the generator emits strings, so a pure Term-level law needs seam S2.

## Appendix — wire check (spike-wire.ts, essentials)

```ts
const root = (group) => HttpApi.make("external-native-api").add(group);
const reflection = (g) => {
  const api = root(g), endpoints = [];
  HttpApi.reflect(api, {
    onGroup: () => {},
    onEndpoint: ({ group, endpoint, mergedAnnotations, middleware, successes, errors }) =>
      endpoints.push({
        group: group.identifier, key: endpoint.identifier, method: endpoint.method, path: endpoint.path,
        annotationKeys: [...mergedAnnotations.mapUnsafe.keys()].filter((k) => k !== "effect/httpapi/OpenApi/Identifier").sort(), // Δ2
        access: Option.getOrNull(reflectAccessSpec(endpoint)),                       // app ProjectionHook
        middleware: [...middleware].map((m) => m.key).sort(),
        successStatuses: [...successes.keys()].sort(), errorStatuses: [...errors.keys()].sort(),
      }),
  });
  return { openapi: OpenApi.fromApi(api), endpoints };
};
// Δ1: collapse components `N_k` deep-equal to `N`, rewrite `$ref`s, then compare with isDeepStrictEqual.
```

## Reproduction

```
git worktree add ../effx-lift -b lift-spike main && (cd ../effx-lift && bun install --frozen-lockfile --ignore-scripts)
# scratch: copy <baseline>/packages/http-api/{src,package.json,tsconfig.json} + root tsconfig/package.json, symlink both node_modules,
#          save f433ea90:…/profile.ts as src/profile.orig.ts and the three support modules as *.orig.ts
bun packages/cli/src/main.ts --project <scratch>/packages/http-api/tsconfig.<x>.json build --strict-access --emit=contract
jq -c .semanticHash <scratch>/packages/http-api/.effx/manifest.json
```
