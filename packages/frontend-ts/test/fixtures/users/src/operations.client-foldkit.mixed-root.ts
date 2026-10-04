import { Effect } from "effect";
import { Http, Query } from "@effx/runtime";
import {
  ProfileCurrentPerson,
  ProfileReadInput,
  ProfileResponse,
  profileAccessAnnotations,
} from "./client-foldkit-support.ts";

export class MixedClientRootOperations {
  @Query({ name: "Mixed.External", input: ProfileReadInput, success: ProfileResponse })
  @Http.Get("/mixed/external")
  @Http.Contract({ root: "mixed", group: "profile", success: ProfileResponse })
  @Http.Access({
    annotator: profileAccessAnnotations,
    exposure: "External",
    acceptedCredentials: ["None"],
    principalKinds: ["Anonymous"],
    capabilities: { _tag: "None" },
    requirements: [],
    canonicalScopeResolver: ProfileCurrentPerson,
    concealment: { _tag: "Reveal" },
    decisionTime: "SnapshotRead",
  })
  static external(_input: typeof ProfileReadInput.Type) {
    return Effect.succeed({ firstName: "public" });
  }

  @Query({ name: "Mixed.Internal", input: ProfileReadInput, success: ProfileResponse })
  @Http.Get("/mixed/internal")
  @Http.Contract({ root: "mixed", group: "profile", success: ProfileResponse })
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
  static internal(_input: typeof ProfileReadInput.Type) {
    return Effect.succeed({ firstName: "private" });
  }
}
