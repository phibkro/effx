import { Effect } from "effect";
import { Operation } from "@effx/runtime";
import { PersonSecurity, ProfileReadInput, UserProfileResponse } from "./profile-support.js";

export const localInExternalGroup = Operation.query({
  name: "Invalid.LocalInMixedGroup",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/local")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    middleware: [PersonSecurity],
    metadata: { operationId: "profile.local" },
  })
  .handler(() => Effect.succeed({ firstName: "Local", lastName: "Fixture" }));

export const externalInLocalGroup = Operation.query({
  name: "Invalid.ExternalInMixedGroup",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/external")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    middleware: [PersonSecurity],
    metadata: { operationId: "profile.external" },
  })
  .declare();
