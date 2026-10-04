import { Http, Operation } from "@effx/runtime";
import {
  ConditionalReadHeaders,
  IdempotencyIfMatchHeaders,
  PersonSecurity,
  ProfileCurrentPerson,
  ProfileMergePatch,
  ProfileProblemResponses,
  ProfileReadInput,
  ProfileReadResponseHeaders,
  ProfileWriteResponseHeaders,
  UserProfileResponse,
  fixtureOperationAnnotations,
  profileAccessAnnotations,
} from "./profile-support.js";
import { ExternalNativeApi } from "./profile-root.js";

export const ProfileGroup = Http.group({
  root: ExternalNativeApi,
  group: "profile",
  title: "Profile",
  description: "Authenticated self-service profile API.",
  displayName: "Profile",
});

export const ProfileReadProblemCodes = [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "profile.not-found",
  "profile.unavailable",
] as const;

export const ProfileUpdateProblemCodes = [
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
] as const;

export const readOwnProfile = Operation.query({
  name: "Profile.ReadOwnProfile",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    headers: ConditionalReadHeaders,
    success: UserProfileResponse,
    status: 200,
    responseHeaders: ProfileReadResponseHeaders,
    conditional: true,
    middleware: [PersonSecurity],
    metadata: {
      annotator: fixtureOperationAnnotations,
      operationId: "profile.readOwnProfile",
      summary: "Read own profile",
      description:
        "Returns the authenticated person's current profile, or 304 for a matching ETag.",
      tags: ["Profile"],
    },
  })
  .http.problems({
    registry: ProfileProblemResponses,
    codes: ProfileReadProblemCodes,
    identifier: "ProfileReadOwnProfileProblem",
  })
  .http.access({
    annotator: profileAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "profile.read-self" },
    requirements: [{ id: "profile.owner" }],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead",
  })
  .declare();

export const updateOwnProfile = Operation.command({
  name: "Profile.UpdateOwnProfile",
  input: ProfileMergePatch,
  success: UserProfileResponse,
})
  .http.patch("/api/profile")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    headers: IdempotencyIfMatchHeaders,
    payload: ProfileMergePatch,
    mediaType: "application/merge-patch+json",
    success: UserProfileResponse,
    status: 200,
    responseHeaders: ProfileWriteResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      annotator: fixtureOperationAnnotations,
      operationId: "profile.updateOwnProfile",
      summary: "Update own profile",
      description: "Applies a merge patch with an idempotency key and If-Match precondition.",
      tags: ["Profile"],
    },
  })
  .http.problems({
    registry: ProfileProblemResponses,
    codes: ProfileUpdateProblemCodes,
    identifier: "ProfileUpdateOwnProfileProblem",
  })
  .http.access({
    annotator: profileAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "profile.update-self" },
    requirements: [{ id: "profile.owner" }],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: { _tag: "Reveal" },
    decisionTime: "Transaction",
  })
  .declare();
