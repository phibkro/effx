import { Effect } from "effect";
import { Operation } from "@effx/runtime";
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

export const clientFoldkitRead = Operation.query({
  name: "Profile.Read",
  input: ProfileReadInput,
  success: ProfileResponse,
})
  .http.get("/api/profile")
  .http.contract({
    group: "profile",
    query: ProfileReadQuery,
    headers: ProfileReadHeaders,
    success: ProfileResponse,
    responseHeaders: ProfileResponseHeaders,
    middleware: [ProfileCredentialSecurity],
    metadata: { operationId: "profile.read" },
  })
  .http.access({
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
  .http.problems({
    registry: ProfileProblemResponses,
    codes: ["credential.missing"],
    map: { CredentialMissing: "credential.missing" },
  })
  .handler(
    (
      _input: typeof ProfileReadInput.Type,
      authorize: () => Effect.Effect<ProfilePrincipal, CredentialMissing>,
    ) =>
      Effect.gen(function* () {
        yield* authorize();

        return profileWithEtag("Ada");
      }),
  );

export const clientFoldkitUpdate = Operation.command({
  name: "Profile.Update",
  input: ProfileUpdateInput,
  success: ProfileResponse,
})
  .http.patch("/api/profile")
  .http.contract({
    group: "profile",
    headers: ProfileWriteHeaders,
    payload: ProfileUpdateInput,
    success: ProfileResponse,
    responseHeaders: ProfileResponseHeaders,
    middleware: [ProfileCredentialSecurity],
    metadata: { operationId: "profile.update", commandIdentity: profileCommandIdentity },
  })
  .http.access({
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
  .http.problems({
    registry: ProfileProblemResponses,
    codes: ["credential.missing"],
    map: { CredentialMissing: "credential.missing" },
  })
  .foldkit.command({ success: ProfileUpdated, failure: ProfileUpdateFailed })
  .handler(
    (
      input: typeof ProfileUpdateInput.Type,
      authorize: () => Effect.Effect<ProfilePrincipal, CredentialMissing>,
    ) =>
      Effect.gen(function* () {
        yield* authorize();

        return profileWithEtag(input.firstName);
      }),
  );

export const clientFoldkitInternalRead = Operation.query({
  name: "Internal.ProfileRead",
  input: ProfileReadInput,
  success: ProfileResponse,
})
  .http.get("/internal/profile")
  .http.contract({ root: "internal", group: "secrets", success: ProfileResponse })
  .http.access({
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
  .handler((_input: typeof ProfileReadInput.Type) => Effect.succeed({ firstName: "private" }));
