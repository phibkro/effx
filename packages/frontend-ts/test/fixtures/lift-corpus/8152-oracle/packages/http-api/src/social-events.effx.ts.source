import { Capability, Concealment, Http, Operation } from "@effx/runtime";
import { ExternalNativeApi } from "./api.js";
import { PersonSecurity, nativeOperationAnnotations } from "./common.js";
import { nativeProblems } from "./endpoint-problems.js";
import {
  CreatedMutationResponseHeaders,
  IdempotencyHeaders,
  PrivateReadResponseHeaders,
} from "./http-semantics.js";
import {
  CreateSocialEventRequest,
  EmptySocialEventInput,
  SocialEventListResource,
  SocialEventResource,
  SocialEventScopeQuery,
  SocialEventScopeResource,
  SocialEventsCreateCodes,
  SocialEventsListCodes,
  SocialEventsReadScopeCodes,
} from "./social-events.js";
import {
  SocialEventsCreateResolver,
  SocialEventsListResolver,
  SocialEventsScopeResolver,
  socialEventsAccessAnnotations,
} from "./social-events-effx-adapters.js";

export const SocialEventsGroup = Http.group({
  root: ExternalNativeApi,
  group: "social-events",
  title: "Social events",
  description: "Department and semester scoped team social events.",
  defaults: {
    middleware: [PersonSecurity],
    metadata: { annotator: nativeOperationAnnotations },
    problems: { registry: nativeProblems },
    access: {
      annotator: socialEventsAccessAnnotations,
      exposure: "External",
      acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
      principalKinds: ["Person"],
      concealment: Concealment.reveal,
    },
  },
});

export const ReadSocialEventScope = Operation.query({
  name: "social-events.readScope",
  input: EmptySocialEventInput,
  success: SocialEventScopeResource,
})
  .in(SocialEventsGroup)
  .http.get("/api/social-events/scope")
  .http.contract({
    status: 200,
    responseHeaders: PrivateReadResponseHeaders,
    metadata: {
      summary: "Read social event scope",
      description: "Returns the caller's authorized departments and canonical semesters.",
    },
  })
  .http.problems({
    identifier: "SocialEventsReadScopeProblem",
    codes: SocialEventsReadScopeCodes,
  })
  .http.access({
    capabilities: Capability.one("social-events.read-scope"),
    requirements: [],
    canonicalScopeResolver: SocialEventsScopeResolver,
    decisionTime: "SnapshotRead",
  })
  .declare();

export const ListSocialEvents = Operation.query({
  name: "social-events.list",
  input: SocialEventScopeQuery,
  success: SocialEventListResource,
})
  .in(SocialEventsGroup)
  .http.get("/api/social-events")
  .http.contract({
    query: true,
    status: 200,
    responseHeaders: PrivateReadResponseHeaders,
    metadata: {
      summary: "List social events",
      description: "Returns social events in one authorized department and semester scope.",
    },
  })
  .http.problems({
    identifier: "SocialEventsListProblem",
    codes: SocialEventsListCodes,
  })
  .http.access({
    capabilities: Capability.one("social-events.read"),
    requirements: [],
    canonicalScopeResolver: SocialEventsListResolver,
    decisionTime: "SnapshotRead",
  })
  .declare();

export const CreateSocialEvent = Operation.command({
  name: "social-events.create",
  input: CreateSocialEventRequest,
  success: SocialEventResource,
})
  .in(SocialEventsGroup)
  .http.post("/api/social-events")
  .http.contract({
    headers: IdempotencyHeaders,
    status: 201,
    responseHeaders: CreatedMutationResponseHeaders,
    metadata: {
      summary: "Create social event",
      description: "Creates or replays one social event command.",
    },
  })
  .http.problems({
    identifier: "SocialEventsCreateProblem",
    codes: SocialEventsCreateCodes,
  })
  .http.access({
    capabilities: Capability.one("social-events.create"),
    requirements: [],
    canonicalScopeResolver: SocialEventsCreateResolver,
    decisionTime: "Transaction",
  })
  .declare();
