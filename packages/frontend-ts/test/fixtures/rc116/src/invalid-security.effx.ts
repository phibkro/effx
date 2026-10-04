import { Operation } from "@effx/runtime";
import {
  ProfileCurrentPerson,
  ProfileReadInput,
  UserProfileResponse,
  profileAccessAnnotations,
} from "./profile-support.js";

export const noSecurityMarker = Operation.query({
  name: "Invalid.NoSecurityMarker",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/unsecured")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    metadata: { operationId: "profile.unsecured" },
  })
  .http.access({
    annotator: profileAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "profile.read-self" },
    requirements: [{ id: "profile.owner" }],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead",
  })
  .declare();
