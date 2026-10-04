# Profile declaration: a dense-form proposal

Measured on the maintainer's workstation; mono-web revisions refer to an unpublished integration branch.

This is a **proposed source diff**, not an edit to mono-web. The reference is the committed `packages/http-api/src/profile.effx.ts` at mono-web `188f2385 (unpublished)`; the historical hand-written endpoint source is `f433ea90:packages/http-api/src/profile.ts`. effx spec 0013 defines inheritance and the source-only `.in(ProfileGroup)` association (`docs/specs/0013-group-defaults.md`). Neither annotations nor this note move Profile authority, transactions, or handlers into generated code (`apps/backend/src/profile/http.ts`; `packages/database/src/profile/postgres.ts`).

```diff
--- a/packages/http-api/src/profile.effx.ts (mono-web 188f2385 (unpublished))
+++ b/packages/http-api/src/profile.effx.ts (proposed only)
@@ imports
-import { Http, Operation } from "@effx/runtime";
+import { Capability, Concealment, Http, Operation } from "@effx/runtime";
@@ ProfileGroup
   displayName: "Profile",
+  defaults: {
+    middleware: [PersonSecurity],
+    metadata: { annotator: nativeOperationAnnotations },
+    problems: { registry: nativeProblems },
+    access: {
+      annotator: profileAccessAnnotations,
+      exposure: "External",
+      acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
+      principalKinds: ["Person"],
+      concealment: Concealment.reveal,
+    },
+  },
@@ ReadOwnProfile
 })
+  .in(ProfileGroup)
   .http.get("/api/profile")
   .http.contract({
-    root: "external-native-api",
-    group: "profile",
     headers: ConditionalReadHeaders,
-    success: UserProfileResponse,
     status: 200,
     responseHeaders: ProfileReadResponseHeaders,
     conditional: true,
-    middleware: [PersonSecurity],
     metadata: {
-      annotator: nativeOperationAnnotations,
-      operationId: "profile.readOwnProfile",
       summary: "Read own profile",
@@ ReadOwnProfile problems/access
   .http.problems({
-    registry: nativeProblems,
     identifier: "ProfileReadOwnProfileProblem",
     codes: ProfileReadOwnProfileCodes,
   })
   .http.access({
-    annotator: profileAccessAnnotations,
-    exposure: "External",
-    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
-    principalKinds: ["Person"],
-    // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- EX-0011: effx lowers source metadata literals.
-    capabilities: { _tag: "One", capability: "profile.read-self" },
+    capabilities: Capability.one("profile.read-self"),
     requirements: [{ id: "profile.owner" }],
     canonicalScopeResolver: ProfileCurrentPerson,
-    // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- EX-0011: effx lowers source metadata literals.
-    concealment: { _tag: "Reveal" },
     decisionTime: "SnapshotRead",
@@ UpdateOwnProfile
 })
+  .in(ProfileGroup)
   .http.patch("/api/profile")
   .http.contract({
-    root: "external-native-api",
-    group: "profile",
     headers: IdempotencyIfMatchHeaders,
-    payload: ProfileMergePatch,
     mediaType: "application/merge-patch+json",
-    success: UserProfileResponse,
     status: 200,
     responseHeaders: EntityMutationResponseHeaders,
-    middleware: [PersonSecurity],
     metadata: {
-      annotator: nativeOperationAnnotations,
-      operationId: "profile.updateOwnProfile",
       summary: "Update own profile",
@@ UpdateOwnProfile problems/access
   .http.problems({
-    registry: nativeProblems,
     identifier: "ProfileUpdateOwnProfileProblem",
     codes: ProfileUpdateOwnProfileCodes,
   })
   .http.access({
-    annotator: profileAccessAnnotations,
-    exposure: "External",
-    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
-    principalKinds: ["Person"],
-    // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- EX-0011: effx lowers source metadata literals.
-    capabilities: { _tag: "One", capability: "profile.update-self" },
+    capabilities: Capability.one("profile.update-self"),
     requirements: [{ id: "profile.owner" }],
     canonicalScopeResolver: ProfileCurrentPerson,
-    // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- EX-0011: effx lowers source metadata literals.
-    concealment: { _tag: "Reveal" },
     decisionTime: "Transaction",
```

The proposed source has no active suppression comments. The frontend lowers both constructors to the original tagged JSON before IR compilation (`packages/frontend-ts/src/lower.ts`; `packages/frontend-ts/test/tagged-access.test.ts`).

The GET input remains mapped explicitly to `ConditionalReadHeaders`; it is **not** a query schema. PATCH input `ProfileMergePatch` can supply its payload alongside the separate `IdempotencyIfMatchHeaders`. Both operation names already have the `profile.<key>` shape, so the omitted metadata `operationId` is derived without changing either value (`packages/http-api/src/profile.effx.ts:27-111`; `packages/compiler/src/group-defaults.ts`). The application still declares per-operation problem codes, capabilities, requirement, scope resolver, decision time, response status/headers, and method/path.

| Physical source lines (`wc -l`; imports/comments included) | Verbose | Dense/proposed | Difference |
| --- | ---: | ---: | ---: |
| Mono-web Profile at `188f2385 (unpublished)` → literal proposed text above, **not applied** | 111 | 96 | −15 |
| effx rc.116 Profile `packages/frontend-ts/test/fixtures/rc116/src/profile-verbose.effx.ts` → `packages/frontend-ts/test/fixtures/rc116/src/profile.effx.ts` | 144 | 135 | −9 |
| effx rc.116 Directory-like twin `packages/frontend-ts/test/fixtures/rc116/src/directory-{verbose,dense}.effx.ts` | 193 | 160 | −33 |

The mono-web count is the in-memory application of these changes to the full 111-line file, without running mono-web's formatter or checks. The rc.116 fixture counts are the **formatted committed source**; `packages/frontend-ts/test/rc116.test.ts` compares dense and verbose canonical IR, semantic hash, and generated contract/handler bytes and typechecks the generated output against installed Effect rc.116. Directory-like is not a line-for-line copy of mono-web's four Directory operations (`packages/http-api/src/directory.effx.ts` at `188f2385 (unpublished)`); do not call the 33-line reduction a mono-web migration measurement. The older native Profile file includes schema and documentation as well as its two endpoint declarations, so its 143 physical lines are **not** an apples-to-apples LOC baseline (`f433ea90:packages/http-api/src/profile.ts`). The benefit shown here is consolidation of repeated policy, not proof that every effx declaration is shorter than hand-written Effect.
