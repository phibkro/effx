/**
 * Public intake and staff review contracts for standalone team applications.
 *
 * @since 0.2.0
 */
import { Team, TeamId } from "@vektorprogrammet/domain/organization";
import {
  PublicTeamApplicationIntake,
  TEAM_APPLICATION_INTAKE_LIST_LIMIT,
  TEAM_APPLICATION_PAGE_SIZE,
  TeamApplication,
  TeamApplicationConfirmation,
  TeamApplicationCursor,
  TeamApplicationId,
  TeamApplicationInput,
  TeamApplicationIntake,
  TeamApplicationIntakeListItem,
  TeamApplicationSummary,
} from "@vektorprogrammet/domain/team-application";
import { Rfc3339InstantSchema } from "@vektorprogrammet/domain/time";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, anonymousNativeAccess, personNativeAccess } from "./access.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import {
  createdMutationResponse,
  endpointProblemResponses,
  entityMutationResponse,
  IdempotencyHeaders,
  IdempotencyIfMatchHeaders,
  noContentMutationResponse,
  noStoreReadResponse,
  privateReadResponse,
  problemUnion,
  StrongETag,
} from "./http-semantics.js";

export {
  PublicTeamApplicationIntake,
  TeamApplicationConfirmation,
  TeamApplicationCursor,
  TeamApplicationId,
  TeamApplicationInput,
  TeamApplicationIntakeListItem,
  TeamApplicationSummary,
};

/** Staff intake settings with the team entity tag that `If-Match` must repeat. */
export const TeamApplicationIntakeResource = Schema.Struct({
  ...TeamApplicationIntake.fields,
  etag: StrongETag,
}).annotate({
  identifier: "TeamApplicationIntakeResource",
  description: "Team intake settings, their open state now, and the team revision entity tag.",
});

export const TeamApplicationListResponse = Schema.Struct({
  teamId: TeamId,
  teamName: Team.fields.name,
  items: Schema.Array(TeamApplicationSummary).pipe(
    Schema.check(Schema.isMaxLength(TEAM_APPLICATION_PAGE_SIZE)),
  ),
  nextCursor: Schema.optional(TeamApplicationCursor),
  intake: TeamApplicationIntakeResource,
  canManage: Schema.Boolean,
}).annotate({
  identifier: "TeamApplicationListResponse",
  description:
    "One bounded newest-first page of a team's applications. canManage is a presentation projection.",
});

export const TeamApplicationResource = Schema.Struct({
  ...TeamApplication.fields,
  teamName: Team.fields.name,
  canManage: Schema.Boolean,
}).annotate({
  identifier: "TeamApplicationResource",
  description: "One application with its private applicant fields.",
});

export const TeamApplicationIntakeListResponse = Schema.Array(TeamApplicationIntakeListItem)
  .pipe(Schema.check(Schema.isMaxLength(TEAM_APPLICATION_INTAKE_LIST_LIMIT)))
  .annotate({
    identifier: "TeamApplicationIntakeListResponse",
    description: `Intake state for at most ${TEAM_APPLICATION_INTAKE_LIST_LIMIT} active teams, ordered by team identifier.`,
  });

/** Absence keeps a setting; a null deadline clears it; acceptApplication cannot be deleted. */
export const TeamApplicationIntakeMergePatch = Schema.Struct({
  acceptApplication: Schema.optional(Schema.NullOr(Schema.Boolean)),
  deadline: Schema.optional(Schema.NullOr(Rfc3339InstantSchema)),
}).annotate({ identifier: "TeamApplicationIntakeMergePatch" });

export type TeamApplicationIntakeMergePatch = typeof TeamApplicationIntakeMergePatch.Type;

export const TeamApplicationsReadIntakeProblem = problemUnion("TeamApplicationsReadIntakeProblem", [
  "request.malformed",
  "header.malformed",
  "resource.not-found",
  "internal.error",
]);

export const TeamApplicationsListIntakesProblem = problemUnion(
  "TeamApplicationsListIntakesProblem",
  ["request.malformed", "header.malformed", "internal.error"],
);

export const TeamApplicationsSubmitProblem = problemUnion("TeamApplicationsSubmitProblem", [
  "request.malformed",
  "header.malformed",
  "idempotency-key.invalid",
  "resource.not-found",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "team-application.intake-closed",
  "transaction.conflict",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "rate-limit.exceeded",
  "internal.error",
  "idempotency.unavailable",
]);

export const TeamApplicationsStaffReadProblem = problemUnion("TeamApplicationsStaffReadProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "resource.not-found",
  "internal.error",
]);

export const TeamApplicationsDeleteProblem = problemUnion("TeamApplicationsDeleteProblem", [
  "request.malformed",
  "header.malformed",
  "idempotency-key.invalid",
  "authority.denied",
  "origin.denied",
  "resource.not-found",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "internal.error",
  "idempotency.unavailable",
]);

export const TeamApplicationsReviseIntakeProblem = problemUnion(
  "TeamApplicationsReviseIntakeProblem",
  [
    "request.malformed",
    "header.malformed",
    "idempotency-key.invalid",
    "precondition.invalid",
    "authority.denied",
    "origin.denied",
    "idempotency.in-flight",
    "idempotency.digest-conflict",
    "idempotency.response-expired",
    "transaction.conflict",
    "precondition.failed",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "validation.no-change",
    "validation.field-not-deletable",
    "precondition.required",
    "internal.error",
    "idempotency.unavailable",
  ],
);

const TeamParams = { teamId: TeamId };

const ApplicationParams = { applicationId: TeamApplicationId };

/** @since 0.2.0 @category Endpoints */
export const ReadTeamApplicationIntakeEndpoint = HttpApiEndpoint.get(
  "readTeamApplicationIntake",
  "/api/teams/:teamId/application-intake",
  {
    params: TeamParams,
    success: noStoreReadResponse(PublicTeamApplicationIntake),
    error: endpointProblemResponses(TeamApplicationsReadIntakeProblem),
  },
)
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, anonymousNativeAccess("team-applications.public-intake")),
  )
  .annotateMerge(
    operationAnnotations(
      "Read team application intake",
      "Returns whether one active team accepts applications now. Unknown and inactive teams are not found.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const ListTeamApplicationIntakesEndpoint = HttpApiEndpoint.get(
  "listTeamApplicationIntakes",
  "/api/team-application-intakes",
  {
    success: noStoreReadResponse(TeamApplicationIntakeListResponse),
    error: endpointProblemResponses(TeamApplicationsListIntakesProblem),
  },
)
  .pipe((endpoint) =>
    annotateAccessSpec(endpoint, anonymousNativeAccess("team-applications.public-intakes")),
  )
  .annotateMerge(
    operationAnnotations(
      "List team application intakes",
      `Returns the intake state of at most ${TEAM_APPLICATION_INTAKE_LIST_LIMIT} active teams.`,
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const SubmitTeamApplicationEndpoint = HttpApiEndpoint.post(
  "submitTeamApplication",
  "/api/teams/:teamId/applications",
  {
    params: TeamParams,
    headers: IdempotencyHeaders,
    payload: TeamApplicationInput,
    success: createdMutationResponse(TeamApplicationConfirmation.pipe(HttpApiSchema.status(201))),
    error: endpointProblemResponses(TeamApplicationsSubmitProblem),
  },
)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      anonymousNativeAccess("team-applications.application-create", "Transaction"),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Submit team application",
      "Stores one application to an open team and queues its receipt and team notification. An idempotency-key replay returns the original result. Every submission, including a replay, counts against one public rate limit.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const ListTeamApplicationsEndpoint = HttpApiEndpoint.get(
  "listTeamApplications",
  "/api/teams/:teamId/applications",
  {
    params: TeamParams,
    query: { cursor: Schema.optional(TeamApplicationCursor) },
    success: privateReadResponse(TeamApplicationListResponse),
    error: endpointProblemResponses(TeamApplicationsStaffReadProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "team-applications.read",
        canonicalScopeResolver: "team-applications.team-applications",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "List team applications",
      "Returns a bounded page of the team's applications to a current, nonsuspended member of that team.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const ReadTeamApplicationEndpoint = HttpApiEndpoint.get(
  "readTeamApplication",
  "/api/team-applications/:applicationId",
  {
    params: ApplicationParams,
    success: privateReadResponse(TeamApplicationResource),
    error: endpointProblemResponses(TeamApplicationsStaffReadProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "team-applications.read",
        canonicalScopeResolver: "team-applications.application-by-id",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read team application",
      "Returns one application to a current, nonsuspended member of its team.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const DeleteTeamApplicationEndpoint = HttpApiEndpoint.delete(
  "deleteTeamApplication",
  "/api/team-applications/:applicationId",
  {
    params: ApplicationParams,
    headers: IdempotencyHeaders,
    success: noContentMutationResponse(),
    error: endpointProblemResponses(TeamApplicationsDeleteProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "team-applications.manage",
        canonicalScopeResolver: "team-applications.application-by-id",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Delete team application",
      "Removes one application and its undelivered notifications. Only the current team leader can delete.",
    ),
  );

/** @since 0.2.0 @category Endpoints */
export const ReviseTeamApplicationIntakeEndpoint = HttpApiEndpoint.patch(
  "reviseTeamApplicationIntake",
  "/api/teams/:teamId/application-intake",
  {
    params: TeamParams,
    headers: IdempotencyIfMatchHeaders,
    payload: TeamApplicationIntakeMergePatch.pipe(
      HttpApiSchema.asJson({ contentType: "application/merge-patch+json" }),
    ),
    success: entityMutationResponse(TeamApplicationIntakeResource),
    error: endpointProblemResponses(TeamApplicationsReviseIntakeProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "team-applications.manage",
        canonicalScopeResolver: "team-applications.intake-by-team",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Revise team application intake",
      "Opens or closes intake and sets or clears the deadline. Requires the current team leader and the observed team entity tag.",
    ),
  );

/**
 * Standalone team application intake and staff review.
 *
 * @since 0.2.0
 * @category Groups
 */
export class TeamApplicationsApi extends HttpApiGroup.make("team-applications")
  .add(
    ReadTeamApplicationIntakeEndpoint,
    ListTeamApplicationIntakesEndpoint,
    SubmitTeamApplicationEndpoint,
    ListTeamApplicationsEndpoint,
    ReadTeamApplicationEndpoint,
    DeleteTeamApplicationEndpoint,
    ReviseTeamApplicationIntakeEndpoint,
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Team applications",
      description: "Public team intake, staff review, deletion, and intake settings.",
    }),
  ) {}
