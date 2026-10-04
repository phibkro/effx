import { Operation } from "@effx/runtime";
import {
  ProfileProblemResponses,
  ProfileReadInput,
  UserProfileResponse,
} from "./profile-support.js";

export const blankProblemName = Operation.query({
  name: "Invalid.BlankProblemName",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/blank-problem")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    metadata: { operationId: "profile.blankProblem" },
  })
  .http.problems({
    registry: ProfileProblemResponses,
    codes: ["profile.not-found"],
    identifier: "",
  })
  .declare();

export const invalidProblemName = Operation.query({
  name: "Invalid.InvalidProblemName",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/invalid-problem")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    metadata: { operationId: "profile.invalidProblem" },
  })
  .http.problems({
    registry: ProfileProblemResponses,
    codes: ["profile.not-found"],
    identifier: "Invalid Problem Name",
  })
  .declare();
