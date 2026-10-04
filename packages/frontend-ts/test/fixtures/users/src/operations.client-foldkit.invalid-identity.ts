import { Effect } from "effect";
import { Command, Http, Query } from "@effx/runtime";
import {
  ProfileReadInput,
  ProfileResponse,
  ProfileUpdateInput,
  ProfileWriteHeaders,
  profileCommandIdentity,
} from "./client-foldkit-support.ts";

const privateIdentity = profileCommandIdentity;

export class InvalidClientFoldkitIdentity {
  @Query({ name: "Invalid.IdentityQuery", input: ProfileReadInput, success: ProfileResponse })
  @Http.Get("/invalid/identity-query")
  @Http.Contract({
    group: "invalid",
    headers: ProfileWriteHeaders,
    success: ProfileResponse,
    metadata: { commandIdentity: profileCommandIdentity },
  })
  static query(_input: typeof ProfileReadInput.Type) {
    return Effect.succeed({ firstName: "Ada" });
  }

  @Command({ name: "Invalid.IdentityHeaders", input: ProfileUpdateInput, success: ProfileResponse })
  @Http.Patch("/invalid/identity-headers")
  @Http.Contract({
    group: "invalid",
    headers: ProfileReadInput,
    payload: ProfileUpdateInput,
    success: ProfileResponse,
    metadata: { commandIdentity: profileCommandIdentity },
  })
  static missingHeaders(input: typeof ProfileUpdateInput.Type) {
    return Effect.succeed({ firstName: input.firstName });
  }

  @Command({ name: "Invalid.PrivateIdentity", input: ProfileUpdateInput, success: ProfileResponse })
  @Http.Patch("/invalid/private-identity")
  @Http.Contract({
    group: "invalid",
    headers: ProfileWriteHeaders,
    payload: ProfileUpdateInput,
    success: ProfileResponse,
    metadata: { commandIdentity: privateIdentity },
  })
  static privateIdentity(input: typeof ProfileUpdateInput.Type) {
    return Effect.succeed({ firstName: input.firstName });
  }

  @Command({
    name: "Invalid.DuplicateIdentity",
    input: ProfileUpdateInput,
    success: ProfileResponse,
  })
  @Http.Patch("/invalid/duplicate-identity")
  @Http.Contract({
    group: "invalid",
    headers: ProfileWriteHeaders,
    payload: ProfileUpdateInput,
    success: ProfileResponse,
    metadata: { commandIdentity: profileCommandIdentity },
  })
  @Http.Contract({
    group: "invalid",
    headers: ProfileWriteHeaders,
    payload: ProfileUpdateInput,
    success: ProfileResponse,
    metadata: { commandIdentity: profileCommandIdentity },
  })
  static duplicate(input: typeof ProfileUpdateInput.Type) {
    return Effect.succeed({ firstName: input.firstName });
  }
}
