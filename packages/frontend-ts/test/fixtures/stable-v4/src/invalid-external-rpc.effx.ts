import { Operation } from "@effx/runtime";
import { ProfileReadInput, UserProfileResponse } from "./profile-support.js";

export const externalRpc = Operation.query({
  name: "Invalid.ExternalRpc",
  input: ProfileReadInput,
  success: UserProfileResponse,
})
  .rpc("profile.externalRpc")
  .declare();
