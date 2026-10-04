# Profile Gate 3 integration blockers (historical)

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

**Resolved locally:** effx `17374d6008bbad4894ce38cc64f18808ca8d96ae` and mono-web `dd7a5f399df335b30e630b55586e924f820f73aa (unpublished)` pass the formerly failing typecheck and operation-provenance tests, plus the complete named Gate 3 acceptance. See [Profile slice evidence](profile-slice-evidence.md). The failures below are retained as reproductions from the older revisions, not a current hold.

Observed 2026-10-03 against effx distribution commit `2382e2c67ae77e66b349250587488d2359f2faeb` and mono-web branch `effx/profile-baseline`: integration commit `d200b6794da308d565cfd594ecbefeb2d6588749 (unpublished)`, followed only by generated construct-documentation commit `4e608892 (unpublished)`. The later effx main commit `a92fece` changes only CLI command binding; it does not change the HTTP generator. Mono-web generated files are ignored outputs from `just effx-profile`; neither they nor the vendored tarballs were edited.

## 1. Generated raw handler requirements omit the real adapter's services

**Historical command:** in `mw`, `devenv shell -- just measure --class check -- just check --concurrency=1`. Exit **1** at backend `TS2322` on the then-current `4e608892 (unpublished)` revision, `apps/backend/src/profile/http.ts:406,412,419` (after selecting the concrete `ExternalNativeApi.groups.profile` endpoint type). A direct backend check on `d200b679 (unpublished)` produced the same three diagnostics at lines 399,405,412.

The generated `apps/backend/.effx/generated/profile-handlers.ts:23-31` constrains each raw callback's Effect requirements to `Effect.Services<ReturnType<Guards[key]>>` plus explicit operation requirements. Its factory binds the concrete full root at lines 34-45. The source is effx `packages/compiler/src/generate/http.ts:389-400`, where `declaredRequirements` is the only additional `R`.

A minimal witness is the actual mono-web raw record:

```ts
type ProfileEndpoints = HttpApiGroup.Endpoints<(typeof ExternalNativeApi)["groups"]["profile"]>;
const guards = makeProfileGuards(input);
const raw = {
  readOwnProfile: ({ request }, authorize) =>
    webHandler(request, (webRequest) =>
      readOwnProfile(webRequest, authorize).pipe(
        Effect.provideService(CurrentProfileWebRequest, webRequest),
      ),
    ),
  updateOwnProfile: ({ request }, authorize) =>
    webHandler(request, (webRequest) =>
      updateOwnProfile(webRequest, authorize).pipe(
        Effect.provideService(CurrentProfileWebRequest, webRequest),
      ),
    ),
} satisfies ProfileRawHandlers<ProfileEndpoints, typeof guards>;
```

The first callback still requires `Database` to read the profile. The second still requires `Profile` for the existing domain update (`apps/backend/src/profile/http.ts:272-391`). Its guards require `Identity | OAuthCredentialAuthority | Organization` for GET and `Database | IdentitySnapshot | OAuthCredentialAuthority | Organization` for PATCH. TypeScript reports that GET's `Database` is not assignable to the guard-only `Identity | OAuthCredentialAuthority | Organization`, and PATCH's `Profile` is not assignable to the guard-only `Database | IdentitySnapshot | OAuthCredentialAuthority | Organization`. The third diagnostic rejects the assembled `raw` record for the same reason. In particular:

```text
src/profile/http.ts(406,7): error TS2322: ... Database | Identity | OAuthCredentialAuthority | Organization ...
  is not assignable to ... Identity | OAuthCredentialAuthority | Organization ...
src/profile/http.ts(412,7): error TS2322: ... Database | IdentitySnapshot | OAuthCredentialAuthority | Organization | Profile ...
  is not assignable to ... Database | IdentitySnapshot | OAuthCredentialAuthority | Organization ...
src/profile/http.ts(419,40): error TS2322: raw.readOwnProfile return requirements are incompatible.
```

**Needed compiler contract:** a raw callback can require its own services in addition to those of the guard, while `HttpApiBuilder.group` retains and checks the complete union. Do not force `@Requirements(Database, Profile)` into `packages/http-api/src/profile.effx.ts`: that package depends on domain contracts, not on the PostgreSQL adapter (`mono-web/docs/architecture.md:64-70`). Requiring otherwise unused services from the guards would only suppress this symptom. The fix belongs in the generated `ProfileRawHandlers`/factory types, not in a cast or a handwritten generated-file patch.

## 2. Generated Profile endpoints omit operation provenance

**Command:** `devenv shell -- just measure --class test -- bun run --cwd packages/http-api vitest run --no-file-parallelism --maxWorkers=1`. Exit **1**: 24 tests passed, one failed at `packages/http-api/test/native-api.test.ts:1266`:

```text
native API reflection > derives unique operation ids and representative request, response, and error schemas
AssertionError: expected { tags: [ 'Profile' ], … } to have property "x-vektorprogrammet-provenance"
```

Old Profile endpoints use `operationAnnotations(summary, description)`, whose `OpenApi.annotations({ transform })` adds the registry-owned `x-vektorprogrammet-provenance` to each operation (`packages/http-api/src/common.ts:214-222`). Generated `packages/http-api/.effx/generated/profile-contract.ts:13-24` emits identifier, summary and description, but not that transform. The emitter's metadata handling is effx `packages/compiler/src/generate/http.ts:134-151`. The full root still has its own top-level provenance; it does not supply this per-operation field (`packages/http-api/src/api.ts:51-76`). The existing test correctly rejects the drift. A contract-side adapter or emitter hook must reuse the application-owned operation annotation without copying its provenance object into effx. Do not patch generated files or weaken the assertion.

## Exercised boundaries and next gate

- Fresh detached checkout at the committed mono-web revision: `devenv shell -- bun install --frozen-lockfile` and `devenv shell -- just effx-profile` both exited **0** without a checked-in generated seed. Both emit modes reported the same semantic hash `9ebded261134b51d7c9f8b791fda508f922ba35fda879cb8a0e470b9219cebc1` and identical IR bytes. That disposable checkout was clean and removed afterward.
- `just e2e profile` under `just measure --class e2e` exited **0** at the committed mono-web revision: one Chromium test passed, including the runner's two-connection PostgreSQL race/replay proof. Ledger wall time **47,159 ms**, peak RSS **2,650,763,264 bytes**. The two focused backend/database suites also exited **0** (4 and 2 tests). The SDK generated index remains 107 external operations with two Profile operations and matched the Gate 0 index SHA-256 `c4abcca1878171c84fd3c531c3fe5c93f92329818c59d4b73a8bf796bca8aad3`.
- `just check --concurrency=1` under `just measure --class check` first exited **1** on a stale generated `docs/constructs/http-problem.md` source-line reference. Mono-web regenerated and committed that page with `just constructs write` (`4e608892 (unpublished)`). The same full check then exited **1** after layout, constructs, guides, exceptions, source-safety, format and lint passed, at the backend `TS2322` reported above; measured wall time **32 s**, peak RSS **3.6 GiB**. The separate HTTP API provenance test also failed at that older revision, so Gate 3 was red there.

The compiler now infers independent backend raw-callback requirements and emits the application-owned metadata annotator. At mono-web `dd7a5f39 (unpublished)`, both previously failing checks and all four same-commit Profile acceptance commands exited **0**; Gate 3 is accepted **locally**, not deployed or landed. See [Profile slice evidence](profile-slice-evidence.md). No production/provider or operator main checkout was touched.
