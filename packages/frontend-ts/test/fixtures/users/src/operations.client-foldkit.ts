import { Effect } from "effect";
import { Command, Foldkit, Http, Query } from "@effx/runtime";
import {
  CredentialMissing,
  ProfileCredentialSecurity,
  ProfileCurrentPerson,
  ProfileProblemResponses,
  ProfileReadHeaders,
  ProfileReadInput,
  ProfileReadQuery,
  ProfileResponse,
  ProfileResponseHeaders,
  ProfileUpdateFailed,
  ProfileUpdated,
  ProfileUpdateInput,
  ProfileWriteHeaders,
  profileAccessAnnotations,
  profileCommandIdentity,
  profileWithEtag,
  type ProfilePrincipal,
} from "./client-foldkit-support.ts";

export class ClientFoldkitProfileOperations {
  @Query({ name: "Profile.Read", input: ProfileReadInput, success: ProfileResponse })
  @Http.Get("/api/profile")
  @Http.Contract({
    group: "profile",
    query: ProfileReadQuery,
    headers: ProfileReadHeaders,
    success: ProfileResponse,
    responseHeaders: ProfileResponseHeaders,
    middleware: [ProfileCredentialSecurity],
    metadata: { operationId: "profile.read" },
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
    codes: ["credential.missing"],
    map: { CredentialMissing: "credential.missing" },
  })
  static read(
    _input: typeof ProfileReadInput.Type,
    authorize: () => Effect.Effect<ProfilePrincipal, CredentialMissing>,
  ) {
    return Effect.gen(function* () {
      yield* authorize();

      return profileWithEtag("Ada");
    });
  }

  @Command({ name: "Profile.Update", input: ProfileUpdateInput, success: ProfileResponse })
  @Http.Patch("/api/profile")
  @Http.Contract({
    group: "profile",
    headers: ProfileWriteHeaders,
    payload: ProfileUpdateInput,
    success: ProfileResponse,
    responseHeaders: ProfileResponseHeaders,
    middleware: [ProfileCredentialSecurity],
    metadata: { operationId: "profile.update", commandIdentity: profileCommandIdentity },
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
    codes: ["credential.missing"],
    map: { CredentialMissing: "credential.missing" },
  })
  @Foldkit.Command({ success: ProfileUpdated, failure: ProfileUpdateFailed })
  static update(
    input: typeof ProfileUpdateInput.Type,
    authorize: () => Effect.Effect<ProfilePrincipal, CredentialMissing>,
  ) {
    return Effect.gen(function* () {
      yield* authorize();

      return profileWithEtag(input.firstName);
    });
  }
}

/** A separate, internal-only root remains a server route but never a published client entry. */
export class ClientFoldkitInternalOperations {
  @Query({ name: "Internal.ProfileRead", input: ProfileReadInput, success: ProfileResponse })
  @Http.Get("/internal/profile")
  @Http.Contract({ root: "internal", group: "secrets", success: ProfileResponse })
  @Http.Access({
    annotator: profileAccessAnnotations,
    exposure: "Internal",
    acceptedCredentials: ["None"],
    principalKinds: ["Anonymous"],
    capabilities: { _tag: "None" },
    requirements: [],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead",
  })
  static read(_input: typeof ProfileReadInput.Type) {
    return Effect.succeed({ firstName: "private" });
  }
}
