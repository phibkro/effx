# Profile parity baseline — mono-web Gate 0

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

Observed 2026-10-03 against mono-web commit `f433ea906c9f9af5134c7316d54c78d8c859038f` (commit date `2026-09-27T11:12:02+02:00`; `git rev-parse HEAD`, `git show -s --format=%cI HEAD`). The operator-owned `mw` main checkout had **0 dirty entries** (`git status --porcelain=v1 | wc -l`); it was read only. The separate worktree `mw` at branch `effx/profile-baseline` remains at that revision with **0 dirty entries**. It was created for these runs and is deliberately retained for the migration slice. No mono-web source was imported into effx, and no deployed environment or production resource was touched.

## Maintained Profile source footprint

`wc -l` on the following 17 files (physical lines, excluding tests, migrations and shared infrastructure):

| Path relative to mono-web | Lines |
| --- | ---: |
| `packages/http-api/src/profile.ts` | 143 |
| `apps/backend/src/profile/http.ts` | 354 |
| `packages/domain/src/profile/schema.ts` | 176 |
| `packages/domain/src/profile/service.ts` | 71 |
| `packages/domain/src/profile/errors.ts` | 54 |
| `packages/database/src/profile/postgres.ts` | 727 |
| `packages/database/src/profile/postgres-layer.ts` | 42 |
| `apps/dashboard/app/foldkit/profile/model.ts` | 57 |
| `apps/dashboard/app/foldkit/profile/message.ts` | 31 |
| `apps/dashboard/app/foldkit/profile/command.ts` | 26 |
| `apps/dashboard/app/foldkit/profile/update.ts` | 132 |
| `apps/dashboard/app/foldkit/profile/view.ts` | 173 |
| `apps/dashboard/app/foldkit/profile/bridge.ts` | 64 |
| `apps/dashboard/app/foldkit/profile/browser-client.ts` | 55 |
| `apps/dashboard/app/foldkit/profile/main.ts` | 43 |
| `apps/dashboard/app/routes/dashboard.profile.rediger._index.tsx` | 49 |
| `apps/dashboard/app/routes/__foldkit.profile.ts` | 91 |
| **17-file total** | **2,288** |

**Counting inconsistency in spec 0004 §4:** its table also explicitly lists `apps/dashboard/app/foldkit/profile/elements.ts` (**67** lines). That makes the literal expanded table **18 files / 2,355 lines**, not 17 / 2,288. The 17-file total above is exactly the claimed 2,288 only when `elements.ts` is excluded; the spec gives no reason to exclude this UI source. At this exact revision no counted file differs from the claimed 17-file sum; the discrepancy is the additional listed file, not a changed line count. A future LOC delta must explicitly say whether `elements.ts` is included; do not compare 18-file after-state to this 17-file baseline.

## Endpoint inventory

At the exact worktree revision, `devenv shell -- bun run --cwd packages/sdk generate` regenerated the ignored `packages/sdk/native-api-operations.json` from `@vektorprogrammet/http-api/ExternalNativeApi`. The worktree-generated file and the main checkout's generated file have identical SHA-256 `c4abcca1878171c84fd3c531c3fe5c93f92329818c59d4b73a8bf796bca8aad3`. The index is generated/ignored, not a tracked source file.

`jq -r '"external=" + (.operations|length|tostring), (.operations[]|select(.group=="profile")|.operationId)' packages/sdk/native-api-operations.json` reports **107 external operations** and exactly these `profile` operation ids:

```text
profile.readOwnProfile
profile.updateOwnProfile
```

`grep -E 'HttpApiEndpoint\.(get|post|put|patch|delete)\(' packages/http-api/src/*.ts | wc -l` reports **108 declarations**: 107 external plus one internal (see `packages/http-api/src/api.ts` and `receipts.ts`; spec 0004 §1). This is a declaration count, not an assertion that all routes were exercised by the Profile run.

## Frozen Profile contract

The following is **verbatim** `packages/http-api/src/profile.ts`, lines 1–143, at the revision above; it contains both `annotateAccessSpec` values. GET: `profile.read-self`, `profile.current-person`, `["profile.owner"]`, `SnapshotRead`; PATCH: `profile.update-self`, same resolver and requirement, `Transaction`. Both use `PersonSecurity`.

```ts
/**
 * Public HTTP contracts for the current user's profile.
 *
 * @since 0.1.0
 */
import { PersonId, ProfileRoleSchema } from "@vektorprogrammet/domain/organization";
import { OwnProfile } from "@vektorprogrammet/domain/profile";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, personNativeAccess } from "./access.js";
import {
  ProfileReadOwnProfileProblem,
  ProfileUpdateOwnProfileProblem,
} from "./endpoint-problems.js";
import {
  ConditionalReadHeaders,
  endpointProblemResponses,
  entityMutationResponse,
  IdempotencyIfMatchHeaders,
  privateConditionalResponses,
} from "./http-semantics.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import { ProfileMergePatch } from "./v2-schemas.js";

/**
 * Dashboard role projection for navigation. A department administrator holds a capability beyond
 * one team through a board leadership or a delegation; a team leader acts within the team.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const UserRoleSchema = ProfileRoleSchema;

/**
 * Strict self-profile response exposed to the dashboard.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const UserProfileResponse = Schema.Struct({
  personId: OwnProfile.fields.personId,
  firstName: OwnProfile.fields.firstName,
  lastName: OwnProfile.fields.lastName,
  email: OwnProfile.fields.email,
  phone: OwnProfile.fields.phone,
  role: UserRoleSchema,
  nameRevision: OwnProfile.fields.nameRevision,
  contactRevision: OwnProfile.fields.contactRevision,
}).annotate({
  identifier: "UserProfileResponse",
  description: "The current person's editable profile and authorization role projection.",
  examples: [
    {
      personId: PersonId.make("7202"),
      firstName: "Ming",
      lastName: "Medlem",
      email: "ming.medlem@example.org",
      phone: "+47 900 00 000",
      role: "ROLE_TEAM_MEMBER",
      nameRevision: 0,
      contactRevision: 1,
    },
  ],
});

/**
 * Reads the current person's profile.
 *
 * @since 0.1.0
 * @category Endpoints
 */
export const ReadOwnProfileEndpoint = HttpApiEndpoint.get("readOwnProfile", "/api/profile", {
  headers: ConditionalReadHeaders,
  success: privateConditionalResponses(UserProfileResponse),
  error: endpointProblemResponses(ProfileReadOwnProfileProblem),
})
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "profile.read-self",
        canonicalScopeResolver: "profile.current-person",
        requirements: ["profile.owner"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read own profile",
      "Returns the profile selected by the current session.",
    ),
  );

/**
 * Updates the current person's profile with optimistic revisions.
 *
 * @since 0.1.0
 * @category Endpoints
 */
export const UpdateOwnProfileEndpoint = HttpApiEndpoint.patch("updateOwnProfile", "/api/profile", {
  headers: IdempotencyIfMatchHeaders,
  payload: ProfileMergePatch.pipe(
    HttpApiSchema.asJson({ contentType: "application/merge-patch+json" }),
  ),
  success: entityMutationResponse(UserProfileResponse),
  error: endpointProblemResponses(ProfileUpdateOwnProfileProblem),
})
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "profile.update-self",
        canonicalScopeResolver: "profile.current-person",
        requirements: ["profile.owner"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Update own profile",
      "Updates only the profile selected by the current session and returns the fresh projection.",
    ),
  );

/**
 * Current-person profile endpoints.
 *
 * @since 0.1.0
 * @category Groups
 */
export class ProfileApi extends HttpApiGroup.make("profile")
  .add(ReadOwnProfileEndpoint, UpdateOwnProfileEndpoint)
  .annotateMerge(
    OpenApi.annotations({
      title: "Profile",
      description: "Authenticated self-service profile API.",
      override: { "x-displayName": "Profile" },
    }),
  ) {}
```

The endpoint-specific problem code arrays are quoted verbatim from `packages/http-api/src/endpoint-problems.ts`, lines 91–127:

```ts
/** Problems for `profile.readOwnProfile`. */
export const ProfileReadOwnProfileProblem = problemUnion("ProfileReadOwnProfileProblem", [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "profile.not-found",
  "profile.unavailable",
]);

/** Problems for `profile.updateOwnProfile`. */
export const ProfileUpdateOwnProfileProblem = problemUnion("ProfileUpdateOwnProfileProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "validation.no-change",
  "validation.field-not-deletable",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "transaction.conflict",
  "internal.error",
  "profile.not-found",
  "profile.unavailable",
  "idempotency.unavailable",
]);
```

The exact request/response header definitions used by these endpoints, quoted from `packages/http-api/src/http-semantics.ts`. The PATCH payload media-type declaration is in `profile.ts` above; its body schema is `ProfileMergePatch` in `v2-schemas.ts`.

`http-semantics.ts:11-39` (the `IdempotencyKey` and strong ETag schemas):

```ts
const idempotencyKeyPattern = /^[A-Za-z0-9_-]{22,128}$/u;

const strongETagPattern = /^"vkr2\.[A-Za-z0-9_-]{43}"$/u;

const sha256HexPattern = /^[a-f0-9]{64}$/u;

/** A case-sensitive, unpadded base64url idempotency key. */
export const IdempotencyKey = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => idempotencyKeyPattern.test(value), {
      message: "22 through 128 unpadded base64url characters",
    }),
  ),
  Schema.brand("IdempotencyKey"),
);

export type IdempotencyKey = typeof IdempotencyKey.Type;

/** A strong opaque v0.2 entity tag in canonical quoted wire form. */
export const StrongETag = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => strongETagPattern.test(value), {
      message: "a quoted vkr2 strong entity tag",
    }),
  ),
  Schema.brand("StrongETag"),
);

export type StrongETag = typeof StrongETag.Type;
```

`http-semantics.ts:53-87` (`IdempotencyIfMatchHeaders` for PATCH; `ConditionalReadHeaders` for GET, including their value schemas):

```ts
/** Headers accepted by every replayable external native mutation. */
export const IdempotencyHeaders = Schema.Struct({
  "idempotency-key": IdempotencyKey,
}).annotate({ identifier: "IdempotencyHeaders" });

export type IdempotencyHeaders = typeof IdempotencyHeaders.Type;

/** Headers accepted by a replayable existing-resource native mutation. */
export const IdempotencyIfMatchHeaders = Schema.Struct({
  "idempotency-key": IdempotencyKey,
  "if-match": StrongETag,
}).annotate({ identifier: "IdempotencyIfMatchHeaders" });

export type IdempotencyIfMatchHeaders = typeof IdempotencyIfMatchHeaders.Type;

/** Headers accepted by an existing-resource mutation that stores no replayable receipt. */
export const IfMatchHeaders = Schema.Struct({
  "if-match": StrongETag,
}).annotate({ identifier: "IfMatchHeaders" });

export type IfMatchHeaders = typeof IfMatchHeaders.Type;

const EntityTagConditionHeader = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0 && value.length <= 4096, {
      message: "an entity-tag condition",
    }),
  ),
);

/** Optional validators accepted by each frozen conditional read. */
export const ConditionalReadHeaders = Schema.Struct({
  "if-match": Schema.optional(EntityTagConditionHeader),
  "if-none-match": Schema.optional(EntityTagConditionHeader),
}).annotate({ identifier: "ConditionalReadHeaders" });
```

`http-semantics.ts:91-97` (cache/vary response literal schemas):

```ts
const OriginVary = Schema.Literal("Origin");

const NoStore = Schema.Literal("no-store");

const PrivateNoStore = Schema.Literal("private, no-store");

const PublicCache = Schema.Literal("public, max-age=60, s-maxage=300, must-revalidate");
```

`http-semantics.ts:136-170` (response header composition, GET's 200/304 conditional forms and private cache):

```ts
const externalHeaders = <CacheControl extends Schema.Top>(cacheControl: CacheControl) => ({
  "cache-control": cacheControl,
  vary: OriginVary,
});

const conditionalReadResponses = <S extends Schema.Top, CacheControl extends Schema.Top>(
  success: S,
  cacheControl: CacheControl,
) => {
  const headers = {
    ...externalHeaders(cacheControl),
    etag: StrongETag,
  };

  return [
    HttpApiSchema.WithHeaders(success, headers),
    HttpApiSchema.WithHeaders(HttpApiSchema.NoContent.pipe(HttpApiSchema.status(304)), headers),
  ] as const;
};

/** Public conditional response with the fixed five-minute shared cache policy. */
export const publicConditionalResponses = <S extends Schema.Top>(success: S) =>
  conditionalReadResponses(success, PublicCache);

/** Public conditional response whose TTL is bounded by the next admission boundary. */
export const dynamicAdmissionConditionalResponses = <S extends Schema.Top>(success: S) =>
  conditionalReadResponses(success, DynamicAdmissionCache);

/** Credential-selected conditional response that is never stored. */
export const privateConditionalResponses = <S extends Schema.Top>(success: S) =>
  conditionalReadResponses(success, PrivateNoStore);

/** Credential-selected non-conditional read response. */
export const privateReadResponse = <S extends Schema.Top>(success: S) =>
  HttpApiSchema.WithHeaders(success, externalHeaders(PrivateNoStore));
```

`http-semantics.ts:188-193` (PATCH's entity response with ETag and no-store headers):

```ts
/** Successful mutation response carrying a current mutable representation. */
export const entityMutationResponse = <S extends Schema.Top>(success: S) =>
  HttpApiSchema.WithHeaders(success, {
    ...externalHeaders(NoStore),
    etag: StrongETag,
  });
```

## Executed journey and focused checks

All commands ran **inside the isolated worktree**, through `devenv shell`. Heavy commands were serialized by the machine-wide `just measure` lock. Durations are the observed outer wall times; parentheses give the rounded inner duration printed by `measure-job`. Failed test names: **none**.

| Command (from worktree root) | Exit | Duration | Observation |
| --- | ---: | ---: | --- |
| `devenv shell -- just --list` | 0 | 9.92 s | Confirmed `just e2e profile` recipe; `justfile:135-143` dispatches to `bun run --cwd apps/dashboard e2e:real-profile`, which runs `node e2e/run-real-native-profile-self-edit.mjs`. |
| `devenv shell -- bun install --frozen-lockfile` | 0 | 2.23 s | Fresh worktree had no root/dashboard dependencies; installed pinned packages. |
| `devenv shell -- just measure --class e2e -- just e2e profile` | 0 | 48.52 s (48 s) | Chromium browser suite: **1 passed**; peak RSS **2.6 GiB**. Runner also completed its disposable PostgreSQL two-connection race/replay proof. |
| `devenv shell -- just measure --class test -- bun run --cwd apps/backend vitest run src/profile/http.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 5.25 s (5 s) | **4 passed** in one file; peak RSS **0.8 GiB**. |
| `devenv shell -- just measure --class test -- bun run --cwd packages/database vitest run src/profile/postgres.test.ts --no-file-parallelism --maxWorkers=1` | 0 | 3.62 s (3 s) | **2 passed** in one file; peak RSS **0.8 GiB**. |
| `devenv shell -- just measure --report` | 0 | 0.53 s | Read the machine's runtime ledger; per-run RSS values above come from each `measure-job` completion line, not the class aggregate (which contains older work by other owners). |
| `devenv shell -- bun run --cwd packages/sdk generate` | 0 | 0.82 s | Generated the exact-revision, ignored 107-operation index; no tracked changes. |
| `jq` inventory, `grep -E ... | wc -l`, `wc -l`, SHA-256 and `git status --porcelain=v1 | wc -l` | 0 | each <0.2 s | Counts, digest and clean state above. |

Browser test title (`apps/dashboard/e2e/native-profile-self-edit.spec.ts:132-136`): **Native Profile self-edit (spec 0064) / proves one authenticated edit, stale conflict, strict HTTP, replay, and confinement**. The runner reported PostgreSQL 18.6, real Chromium 145.0.7632.6, actual Better Auth session cookie without recording its value, disposable loopback PostgreSQL, and clean teardown with ports closed. Its browser observations included unauthenticated GET/PATCH 401, successful edit 200 and fresh read, malformed request 422 without mutation, stale ETag 412, changed-digest idempotency conflict 409 without data change, strict response fields and no serious/critical axe violations at initial/invalid/success/stale states. The PostgreSQL proof observed independent connection PIDs, one success and one `ProfileStaleRevision`, an unchanged conflicting receipt and byte-equal replay. These are local baseline observations, not an effx-generated parity result or production/provider acceptance.

Focused backend HTTP cases (`apps/backend/src/profile/http.test.ts:106-209`): `preserves AuthorityInactive as a typed scope denial`, `preserves NotInScope as a typed scope denial`, `maps an unavailable authority provider failure to unavailable`, `changes only after the persisted role representation revision changes`. Focused database cases (`packages/database/src/profile/postgres.test.ts:11-81`): `fails the whole directory page when a scanned person has no contact row`, `reads the persisted Profile HTTP representation revision with the profile snapshot`.

**Not run:** full mono-web `just check` / `just test`, other browser suites, PostgreSQL 17 variant, deployed/production journeys, or any effx-generated replacement—Gate 0 requires only the unchanged existing Profile baseline at this mono-web revision. The Profile browser run does not substitute for later Gate 3 parity against generated code.
