import { Effect } from "effect";
import { Command, Http, Query } from "@effx/runtime";
import {
  ProfileCurrentPerson,
  ProfilePersonSecurity,
  ProfileReadInput,
  ProfileRequestMarker,
  ProfileResponse,
  ProfileUpdateInput,
  profileAccessAnnotations,
} from "./access-support.ts";

export class InvalidAccessOperations {
  @Command({ name: "Invalid.SnapshotCommand", input: ProfileUpdateInput, success: ProfileResponse })
  @Http.Patch("/invalid/profile")
  @Http.Contract({
    group: "invalid",
    payload: ProfileUpdateInput,
    success: ProfileResponse,
    middleware: [ProfilePersonSecurity],
  })
  @Http.Access({
    annotator: profileAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "profile.update-self" },
    requirements: [],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead",
  })
  static snapshotCommand(input: typeof ProfileUpdateInput.Type) {
    return Effect.succeed({ firstName: input.firstName });
  }

  @Query({ name: "Invalid.TransactionQuery", input: ProfileReadInput, success: ProfileResponse })
  @Http.Get("/invalid/profile")
  @Http.Contract({
    group: "invalid",
    success: ProfileResponse,
    middleware: [ProfilePersonSecurity],
  })
  @Http.Access({
    annotator: profileAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "profile.read-self" },
    requirements: [],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: { _tag: "Reveal" },
    decisionTime: "Transaction",
  })
  static transactionQuery(_input: typeof ProfileReadInput.Type) {
    return Effect.succeed({ firstName: "Ada" });
  }

  @Query({ name: "Invalid.UnboundSecurity", input: ProfileReadInput, success: ProfileResponse })
  @Http.Get("/invalid/no-security")
  @Http.Contract({ group: "invalid", success: ProfileResponse, middleware: [ProfileRequestMarker] })
  @Http.Access({
    annotator: profileAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["BetterAuthCookie"],
    principalKinds: ["Person"],
    capabilities: { _tag: "One", capability: "profile.read-self" },
    requirements: [],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead",
  })
  static unboundSecurity(_input: typeof ProfileReadInput.Type) {
    return Effect.succeed({ firstName: "Ada" });
  }

  @Query({ name: "Invalid.NoAccess", input: ProfileReadInput, success: ProfileResponse })
  @Http.Get("/invalid/no-access")
  static noAccess(_input: typeof ProfileReadInput.Type) {
    return Effect.succeed({ firstName: "Ada" });
  }
}
