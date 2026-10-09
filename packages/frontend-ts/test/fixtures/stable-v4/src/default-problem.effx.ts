import { Http, Operation } from "@effx/runtime";
import {
  ProfileProblemResponses,
  ProfileReadInput,
  UserProfileResponse,
} from "./profile-support.js";
import { ExternalNativeApi } from "./profile-root.js";

export const ProfileGroup = Http.group({
  root: ExternalNativeApi,
  group: "profile",
  title: "Profile",
  description: "Authenticated self-service profile API.",
  displayName: "Profile",
});

export const fallback = Operation.query({
  name: "Profile.Fallback",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    metadata: { operationId: "profile.readOwnProfile" },
  })
  .http.problems({ registry: ProfileProblemResponses, codes: ["profile.not-found"] })
  .declare();
