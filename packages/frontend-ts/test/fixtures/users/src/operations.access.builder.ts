import { Effect } from "effect";
import { Operation } from "@effx/runtime";
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

export const readProfile = Operation.query({
  name: "Profile.Read",
  input: ProfileReadInput,
  success: ProfileResponse,
})
  .http.get("/api/profile")
  .http.contract({
    group: "profile",
    headers: ProfileReadHeaders,
    success: ProfileResponse,
    middleware: [ProfilePersonSecurity],
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
    codes: ["authority.denied"],
    map: { AccessDenied: "authority.denied" },
  })
  .handler(
    (
      _input: typeof ProfileReadInput.Type,
      authorize: () => Effect.Effect<ProfilePrincipal, AccessDenied>,
    ) =>
      Effect.gen(function* () {
        yield* authorize();

        return { firstName: "Ada" };
      }),
  );

export const updateProfile = Operation.command({
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
    middleware: [ProfilePersonSecurity],
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
    codes: ["authority.denied"],
    map: { AccessDenied: "authority.denied" },
  })
  .handler(
    (
      input: typeof ProfileUpdateInput.Type,
      authorize: () => Effect.Effect<ProfilePrincipal, AccessDenied>,
    ) =>
      Effect.gen(function* () {
        yield* authorize();

        return { firstName: input.firstName };
      }),
  );
