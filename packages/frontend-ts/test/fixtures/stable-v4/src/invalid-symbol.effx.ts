import { Schema } from "effect";
import { Operation } from "@effx/runtime";
import { PersonSecurity, ProfileReadInput, UserProfileResponse } from "./profile-support.js";

const hiddenProblemRegistry = (_identifier: string, _codes: ReadonlyArray<string>) => [
  Schema.Struct({ code: Schema.String }),
];

export const unexportedRegistry = Operation.query({
  name: "Invalid.UnexportedRegistry",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .http.get("/api/profile/unexported")
  .http.contract({
    root: "external-native-api",
    group: "profile",
    success: UserProfileResponse,
    middleware: [PersonSecurity],
    metadata: { operationId: "profile.unexported" },
  })
  .http.problems({ registry: hiddenProblemRegistry, codes: ["profile.not-found"] })
  .declare();
