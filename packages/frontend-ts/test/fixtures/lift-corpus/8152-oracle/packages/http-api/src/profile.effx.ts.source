import { Capability, Concealment, Http, Operation } from "@effx/runtime";
import { PersonSecurity, nativeOperationAnnotations } from "./common.js";
import {
  ProfileReadOwnProfileCodes,
  ProfileUpdateOwnProfileCodes,
  nativeProblems,
} from "./endpoint-problems.js";
import {
  ConditionalReadHeaders,
  IdempotencyIfMatchHeaders,
  ProfileReadResponseHeaders,
  EntityMutationResponseHeaders,
} from "./http-semantics.js";
import { UserProfileResponse } from "./profile.js";
import { ProfileCurrentPerson, profileAccessAnnotations } from "./profile-effx-adapters.js";
import { ProfileMergePatch } from "./v2-schemas.js";
import { ExternalNativeApi } from "./api.js";

export const ProfileGroup = Http.group({
  root: ExternalNativeApi,
  group: "profile",
  title: "Profile",
  description: "Authenticated self-service profile API.",
  displayName: "Profile",
});

export const ReadOwnProfile = Operation.query({
  name: "profile.readOwnProfile",
  input: ConditionalReadHeaders,
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
      annotator: nativeOperationAnnotations,
      operationId: "profile.readOwnProfile",
      summary: "Read own profile",
      description: "Returns the profile selected by the current session.",
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "ProfileReadOwnProfileProblem",
    codes: ProfileReadOwnProfileCodes,
  })
  .http.access({
    annotator: profileAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: Capability.one("profile.read-self"),
    requirements: [{ id: "profile.owner" }],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: Concealment.reveal,
    decisionTime: "SnapshotRead",
  })
  .declare();

export const UpdateOwnProfile = Operation.command({
  name: "profile.updateOwnProfile",
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
    responseHeaders: EntityMutationResponseHeaders,
    middleware: [PersonSecurity],
    metadata: {
      annotator: nativeOperationAnnotations,
      operationId: "profile.updateOwnProfile",
      summary: "Update own profile",
      description:
        "Updates only the profile selected by the current session and returns the fresh projection.",
    },
  })
  .http.problems({
    registry: nativeProblems,
    identifier: "ProfileUpdateOwnProfileProblem",
    codes: ProfileUpdateOwnProfileCodes,
  })
  .http.access({
    annotator: profileAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
    principalKinds: ["Person"],
    capabilities: Capability.one("profile.update-self"),
    requirements: [{ id: "profile.owner" }],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: Concealment.reveal,
    decisionTime: "Transaction",
  })
  .declare();
