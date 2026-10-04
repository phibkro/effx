import { Effect } from "effect";
import { Command, Http, Query } from "@effx/runtime";
import {
  AccessDenied,
  ProfileCurrentPerson,
  ProfilePersonSecurity,
  ProfileProblemResponses,
  ProfileReadHeaders,
  ProfileReadInput,
  ProfileResponse,
  ProfileUpdateInput,
  ProfileWriteHeaders,
  profileAccessAnnotations,
  type ProfilePrincipal,
} from "./access-support.ts";

export class ProfileOperations {
  @Query({ name: "Profile.Read", input: ProfileReadInput, success: ProfileResponse })
  @Http.Get("/api/profile")
  @Http.Contract({
    group: "profile",
    headers: ProfileReadHeaders,
    success: ProfileResponse,
    middleware: [ProfilePersonSecurity],
  })
  @Http.Access({
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
  @Http.Problems({
    registry: ProfileProblemResponses,
    codes: ["authority.denied"],
    map: { AccessDenied: "authority.denied" },
  })
  static read(
    _input: typeof ProfileReadInput.Type,
    authorize: () => Effect.Effect<ProfilePrincipal, AccessDenied>,
  ) {
    return Effect.gen(function* () {
      yield* authorize();

      return { firstName: "Ada" };
    });
  }

  @Command({ name: "Profile.Update", input: ProfileUpdateInput, success: ProfileResponse })
  @Http.Patch("/api/profile")
  @Http.Contract({
    group: "profile",
    headers: ProfileWriteHeaders,
    payload: ProfileUpdateInput,
    success: ProfileResponse,
    middleware: [ProfilePersonSecurity],
  })
  @Http.Access({
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
  @Http.Problems({
    registry: ProfileProblemResponses,
    codes: ["authority.denied"],
    map: { AccessDenied: "authority.denied" },
  })
  static update(
    input: typeof ProfileUpdateInput.Type,
    authorize: () => Effect.Effect<ProfilePrincipal, AccessDenied>,
  ) {
    return Effect.gen(function* () {
      yield* authorize();

      return { firstName: input.firstName };
    });
  }
}
