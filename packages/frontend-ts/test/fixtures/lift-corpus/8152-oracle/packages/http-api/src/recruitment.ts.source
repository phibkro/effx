/**
 * Public HTTP contracts for recruitment assignment, scheduling, and interviews.
 *
 * @since 0.1.0
 */
import {
  RecruitmentMaintenanceCommand,
  RecruitmentMaintenanceResult,
  QuestionnaireManagement,
  InterviewStaffingManagement,
} from "@vektorprogrammet/domain/recruitment";
import { AdmissionPeriodId } from "@vektorprogrammet/domain/admission-period";
import { ApplicantIdSchema, PublicApplicationIdSchema } from "@vektorprogrammet/domain/application";
import { DepartmentId, PersonId } from "@vektorprogrammet/domain/organization";
import {
  CancelInterviewObservationSchema,
  containsRecruitmentInvitationCapabilitySequence,
  FinalizeInterviewObservationSchema,
  InterviewRecommendationSchema,
  InterviewReport,
  InterviewReportQuery,
  InterviewSchemaId,
  interviewRecommendations,
  interviewScoreTotal,
  RecruitmentAssignmentBoardQuerySchema,
  RecruitmentAssignmentBoardSchema,
  RecruitmentInterviewConductObservationSchema,
  RecruitmentInterviewId,
  RecruitmentInterviewerOptionSchema,
  RecruitmentInvitationCapabilitySchema,
  RecruitmentInvitationRejectInputSchema,
  RecruitmentInvitationRequestNewTimeInputSchema,
  RecruitmentInvitationResponseMessageSchema,
  RecruitmentInvitationResponseObservationSchema,
  RecruitmentInterviewQuestionSnapshot,
  RecruitmentSchedulingInterviewSchema,
  RecruitmentSchedulingBoardSchema,
  type RecruitmentAssignmentBoard,
  type RecruitmentAssignmentBoardQuery,
  type RecruitmentInterviewConductObservation,
  type RecruitmentSchedulingInterview,
} from "@vektorprogrammet/domain/recruitment";

const InvitationResponseObservationExample: any = {
  scheduledAt: "2026-09-10T14:00:00.000Z",
  room: "Realfagbygget, R90",
  campus: "Gløshaugen",
  responseState: "Pending",
  responseMessage: null,
} as const;

const AssignmentBoardExample: any = {
  admissionPeriodId: AdmissionPeriodId.make("period-1"),
  departmentId: DepartmentId.make("1"),
  candidates: [
    {
      applicationId: PublicApplicationIdSchema.make("app-0080"),
      applicantId: ApplicantIdSchema.make("applicant-0080"),
      firstName: "Ming",
      lastName: "Medlem",
      email: "ming.medlem@example.org",
      submittedAt: "2026-08-15T12:00:00.000Z",
      applicationState: "Received",
      interviewState: "Unassigned",
      interviewer: null,
      interviewSchema: null,
      scheduledAt: null,
    },
  ],
  interviewers: [{ personId: PersonId.make("1001"), displayName: "Kari Leder" }],
  interviewSchemas: [
    {
      interviewSchemaId: InterviewSchemaId.make("interview-schema-1"),
      name: "Standardintervju",
      questionCount: 5,
      active: true,
      revision: 2,
    },
  ],
};

const SchedulingBoardExample: any = {
  departmentId: DepartmentId.make("1"),
  interviews: [
    {
      interviewId: RecruitmentInterviewId.make("interview-1"),
      applicationId: PublicApplicationIdSchema.make("app-0080"),
      departmentId: DepartmentId.make("1"),
      interviewer: {
        personId: PersonId.make("1001"),
        displayName: "Kari Leder",
        email: "kari.leder@example.org",
        phone: "+47 900 00 000",
      },
      coInterviewer: {
        personId: PersonId.make("1003"),
        displayName: "Ola Medintervjuer",
      },
      applicant: {
        applicationId: PublicApplicationIdSchema.make("app-0080"),
        applicantId: ApplicantIdSchema.make("applicant-0080"),
        firstName: "Ming",
        lastName: "Medlem",
        email: "ming.medlem@example.org",
        phone: "+47 900 00 000",
      },
      revision: 2,
      etag: StrongETag.make('"vkr2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'),
      schedule: {
        interviewId: RecruitmentInterviewId.make("interview-1"),
        scheduledAt: "2026-09-10T14:00:00.000Z",
        room: "Realfagbygget, R90",
        campus: "Gløshaugen",
        mapLink: "https://maps.example.org/r90",
        message: "Interview invitation with room details.",
        scheduledByPersonId: PersonId.make("1002"),
        committedAt: "2026-08-20T10:05:00.000Z",
        scheduleRevision: 1,
      },
      notificationState: "Pending",
      responseState: "Pending",
      responseMessage: null,
    },
  ],
};

const ConductObservationExample: any = {
  interviewId: RecruitmentInterviewId.make("interview-1"),
  applicationId: PublicApplicationIdSchema.make("app-0080"),
  applicant: {
    applicantId: ApplicantIdSchema.make("applicant-0080"),
    firstName: "Ming",
    lastName: "Medlem",
  },
  schedule: {
    interviewId: RecruitmentInterviewId.make("interview-1"),
    scheduledAt: "2026-09-10T14:00:00.000Z",
    room: "Realfagbygget, R90",
    campus: "Gløshaugen",
    mapLink: "https://maps.example.org/r90",
    message: "Interview invitation with room details.",
    scheduledByPersonId: PersonId.make("1002"),
    committedAt: "2026-08-20T10:05:00.000Z",
    scheduleRevision: 1,
  },
  invitationResponse: "Accepted",
  questions: [
    {
      interviewId: RecruitmentInterviewId.make("interview-1"),
      questionId: "q-1",
      ordinal: 1,
      prompt: "Why did you apply to this programme?",
      helpText: null,
      kind: "text",
      alternatives: [],
    },
  ],
  answers: [{ questionId: "q-1", answer: "I am drawn to the study programme's breadth." }],
  score: { explanatoryPower: 7, roleModel: 8, suitability: 6 },
  recommendation: "Ja",
  completionState: "Completed",
  cancellationState: "NotCancelled",
  finalizedAt: "2026-09-12T15:00:00.000Z",
  cancelledAt: null,
  revision: 3,
  canFinalize: false,
  canCancel: false,
};

import * as Schema from "effect/Schema";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, invitationNativeAccess, personNativeAccess } from "./access.js";
import { InvitationCapabilitySecurity, operationAnnotations, PersonSecurity } from "./common.js";
import {
  RecruitmentCancelInterviewProblem,
  RecruitmentCorrectInterviewAssessmentProblem,
  RecruitmentConfirmInvitationProblem,
  RecruitmentCreateApplicationInterviewProblem,
  RecruitmentFinalizeInterviewProblem,
  RecruitmentReadAssignmentBoardProblem,
  RecruitmentReadInterviewConductProblem,
  RecruitmentReadInvitationResponseProblem,
  RecruitmentReadSchedulingBoardProblem,
  RecruitmentReadInterviewReportProblem,
  RecruitmentRejectInvitationProblem,
  RecruitmentRequestNewInvitationTimeProblem,
  RecruitmentScheduleInterviewProblem,
} from "./endpoint-problems.js";
import {
  problemUnion,
  ConditionalReadHeaders,
  createdMutationResponse,
  endpointProblemResponses,
  entityMutationResponse,
  IdempotencyHeaders,
  IdempotencyIfMatchHeaders,
  IfMatchHeaders,
  noContentMutationResponse,
  privateConditionalResponses,
  privateReadResponse,
  StrongETag,
} from "./http-semantics.js";
import {
  CancelInterviewRequest,
  CancelInterviewResponse,
  CorrectInterviewAssessmentRequest,
  CorrectInterviewAssessmentResponse,
  CreateApplicationInterviewRequest,
  EmptyJsonRequest,
  FinalizeInterviewRequest,
  FinalizeInterviewResponse,
  RecruitmentInterviewResource,
  ScheduleInterviewRequest,
  ScheduleInterviewResponse,
} from "./v2-schemas.js";

export {
  CancelInterviewObservationSchema,
  containsRecruitmentInvitationCapabilitySequence,
  FinalizeInterviewObservationSchema,
  InterviewRecommendationSchema,
  InterviewReport,
  InterviewReportQuery,
  InterviewSchemaId,
  interviewRecommendations,
  interviewScoreTotal,
  RecruitmentAssignmentBoardQuerySchema,
  RecruitmentAssignmentBoardSchema,
  RecruitmentInterviewConductObservationSchema,
  RecruitmentInterviewId,
  RecruitmentInterviewerOptionSchema,
  RecruitmentInvitationCapabilitySchema,
  RecruitmentInvitationResponseMessageSchema,
  RecruitmentInvitationResponseObservationSchema,
  RecruitmentInterviewQuestionSnapshot,
  RecruitmentSchedulingInterviewSchema,
};

export type {
  RecruitmentAssignmentBoard,
  RecruitmentAssignmentBoardQuery,
  RecruitmentInterviewConductObservation,
  RecruitmentSchedulingInterview,
};

/**
 * Exact empty JSON object required when accepting an invitation.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const ConfirmInvitationPayload = EmptyJsonRequest.annotate({
  identifier: "ConfirmInvitationRequest",
  description: "An exact empty JSON object.",
  examples: [{}],
});

export const InvitationRejectInput = RecruitmentInvitationRejectInputSchema.annotate({
  identifier: "InvitationRejectInput",
  description: "Optional short rejection message.",
  examples: [{ message: "Cannot attend that day." }, {}],
});

export const InvitationRequestNewTimeInput =
  RecruitmentInvitationRequestNewTimeInputSchema.annotate({
    identifier: "InvitationRequestNewTimeInput",
    description: "Short message proposing another time.",
    examples: [{ message: "Could we do Thursday instead?" }],
  });

export const InvitationResponseObservation =
  RecruitmentInvitationResponseObservationSchema.annotate({
    identifier: "InvitationResponseObservation",
    description: "Interview invitation state visible to the invitee.",
    examples: [InvitationResponseObservationExample],
  });

export const AssignmentBoard = RecruitmentAssignmentBoardSchema.annotate({
  identifier: "AssignmentBoard",
  description:
    "Candidates and interviewers in the departments where the caller manages interviews.",
  examples: [AssignmentBoardExample],
});

export const SchedulingInterview = RecruitmentSchedulingInterviewSchema.mapMembers((members) => [
  members[0].mapFields((fields) => ({ ...fields, etag: StrongETag })),
  members[1].mapFields((fields) => ({ ...fields, etag: StrongETag })),
  members[2].mapFields((fields) => ({ ...fields, etag: StrongETag })),
  members[3].mapFields((fields) => ({ ...fields, etag: StrongETag })),
]).annotate({
  identifier: "SchedulingInterview",
  description: "One interview with the strong validator for its mutation.",
});

export const SchedulingBoard = Schema.Struct({
  departmentId: RecruitmentSchedulingBoardSchema.fields.departmentId,
  interviews: Schema.Array(SchedulingInterview),
}).annotate({
  identifier: "SchedulingBoard",
  description: "Interviews visible to the current member.",
  examples: [SchedulingBoardExample],
});

export const ConductObservation = RecruitmentInterviewConductObservationSchema.annotate({
  identifier: "ConductObservation",
  description: "Interview questions, answers, and conduct state.",
  examples: [ConductObservationExample],
});

/** @since 0.1.0 @category Endpoints */
export const ReadInvitationResponseEndpoint = HttpApiEndpoint.get(
  "readInvitationResponse",
  "/api/recruitment/invitation-response",
  {
    headers: ConditionalReadHeaders,
    success: privateConditionalResponses(InvitationResponseObservation),
    error: endpointProblemResponses(RecruitmentReadInvitationResponseProblem),
  },
)
  .middleware(InvitationCapabilitySecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, invitationNativeAccess([], "SnapshotRead")))
  .annotateMerge(
    operationAnnotations(
      "Read invitation response",
      "Reads an interview invitation by capability.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ConfirmInvitationEndpoint = HttpApiEndpoint.post(
  "confirmInvitation",
  "/api/recruitment/invitation-response:confirm",
  {
    params: {},
    headers: IfMatchHeaders,
    payload: ConfirmInvitationPayload,
    success: noContentMutationResponse({ etag: true }),
    error: endpointProblemResponses(RecruitmentConfirmInvitationProblem),
  },
)
  .middleware(InvitationCapabilitySecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, invitationNativeAccess([], "Transaction")))
  .annotateMerge(
    operationAnnotations("Confirm invitation", "Accepts an interview invitation by capability."),
  );

/** @since 0.1.0 @category Endpoints */
export const RejectInvitationEndpoint = HttpApiEndpoint.post(
  "rejectInvitation",
  "/api/recruitment/invitation-response:reject",
  {
    params: {},
    headers: IfMatchHeaders,
    payload: InvitationRejectInput,
    success: noContentMutationResponse({ etag: true }),
    error: endpointProblemResponses(RecruitmentRejectInvitationProblem),
  },
)
  .middleware(InvitationCapabilitySecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, invitationNativeAccess([], "Transaction")))
  .annotateMerge(
    operationAnnotations("Reject invitation", "Rejects an interview invitation by capability."),
  );

/** @since 0.1.0 @category Endpoints */
export const RequestNewInvitationTimeEndpoint = HttpApiEndpoint.post(
  "requestNewInvitationTime",
  "/api/recruitment/invitation-response:request-new-time",
  {
    params: {},
    headers: IfMatchHeaders,
    payload: InvitationRequestNewTimeInput,
    success: noContentMutationResponse({ etag: true }),
    error: endpointProblemResponses(RecruitmentRequestNewInvitationTimeProblem),
  },
)
  .middleware(InvitationCapabilitySecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, invitationNativeAccess([], "Transaction")))
  .annotateMerge(
    operationAnnotations(
      "Request a new invitation time",
      "Requests another interview time by capability.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ReadAssignmentBoardEndpoint = HttpApiEndpoint.get(
  "readAssignmentBoard",
  "/api/recruitment/application-assignments",
  {
    query: RecruitmentAssignmentBoardQuerySchema.fields,
    success: privateReadResponse(AssignmentBoard),
    error: endpointProblemResponses(RecruitmentReadAssignmentBoardProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "reviewApplicants",
        canonicalScopeResolver: "recruitment.application-assignments",
        requirements: ["organization.single-department-administrator"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read assignment board",
      "Returns applicants and interviewers where the caller manages interviews.",
    ),
  );

/** Scoped completed conduct projection; raw conduct access remains separate. */
export const ReadInterviewReportEndpoint = HttpApiEndpoint.get(
  "readInterviewReport",
  "/api/recruitment/interview-report",
  {
    query: InterviewReportQuery.fields,
    success: privateReadResponse(InterviewReport),
    error: endpointProblemResponses(RecruitmentReadInterviewReportProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.read-interview-report",
        canonicalScopeResolver: "recruitment.interview-report",
        requirements: ["organization.single-department-administrator"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read completed interview report",
      "Returns limited completed interview observations for an explicitly selected department admission period; proven self assessments are excluded.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ReadSchedulingBoardEndpoint = HttpApiEndpoint.get(
  "readSchedulingBoard",
  "/api/recruitment/interviews",
  {
    success: privateReadResponse(SchedulingBoard),
    error: endpointProblemResponses(RecruitmentReadSchedulingBoardProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.read-interviews",
        canonicalScopeResolver: "recruitment.interviews",
        requirements: ["organization.single-department-member"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read scheduling board",
      "Returns interviews visible to the current member.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const AssignApplicantEndpoint = HttpApiEndpoint.post(
  "createApplicationInterview",
  "/api/recruitment/applications/:applicationId/interviews",
  {
    params: { applicationId: PublicApplicationIdSchema },
    headers: IdempotencyHeaders,
    payload: CreateApplicationInterviewRequest,
    success: createdMutationResponse(RecruitmentInterviewResource.pipe(HttpApiSchema.status(201))),
    error: endpointProblemResponses(RecruitmentCreateApplicationInterviewProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "reviewApplicants",
        canonicalScopeResolver: "recruitment.application-by-id",
        requirements: [
          "organization.single-department-administrator",
          "recruitment.interviewer-eligible",
        ],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("Assign applicant", "Assigns an applicant to an eligible interviewer."),
  );

/** @since 0.1.0 @category Endpoints */
export const ScheduleInterviewEndpoint = HttpApiEndpoint.post(
  "scheduleInterview",
  "/api/recruitment/interviews/:interviewId:schedule",
  {
    params: { interviewId: RecruitmentInterviewId },
    headers: IdempotencyIfMatchHeaders,
    payload: ScheduleInterviewRequest,
    success: entityMutationResponse(ScheduleInterviewResponse),
    error: endpointProblemResponses(RecruitmentScheduleInterviewProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.schedule-interview",
        canonicalScopeResolver: "recruitment.interview-by-id",
        requirements: ["recruitment.assigned-interviewer-or-administrator"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("Schedule interview", "Schedules an assigned interview and invitation."),
  );

/** @since 0.1.0 @category Endpoints */
export const ReadInterviewConductEndpoint = HttpApiEndpoint.get(
  "readInterviewConduct",
  "/api/recruitment/interviews/:interviewId",
  {
    params: { interviewId: RecruitmentInterviewId },
    headers: ConditionalReadHeaders,
    success: privateConditionalResponses(ConductObservation),
    error: endpointProblemResponses(RecruitmentReadInterviewConductProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.conduct-interview",
        canonicalScopeResolver: "recruitment.interview-by-id",
        requirements: [
          "recruitment.assigned-interviewer-or-co-interviewer",
          "recruitment.not-known-self",
        ],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read interview conduct",
      "Returns interview questions and conduct state.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const FinalizeInterviewEndpoint = HttpApiEndpoint.post(
  "finalizeInterview",
  "/api/recruitment/interviews/:interviewId:finalize",
  {
    params: { interviewId: RecruitmentInterviewId },
    headers: IdempotencyIfMatchHeaders,
    payload: FinalizeInterviewRequest,
    success: entityMutationResponse(FinalizeInterviewResponse),
    error: endpointProblemResponses(RecruitmentFinalizeInterviewProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.conduct-interview",
        canonicalScopeResolver: "recruitment.interview-by-id",
        requirements: ["recruitment.assigned-interviewer", "recruitment.not-known-self"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("Finalize interview", "Records answers and scores for an interview."),
  );

/** @since 0.1.0 @category Endpoints */
export const CorrectInterviewAssessmentEndpoint = HttpApiEndpoint.post(
  "correctInterviewAssessment",
  "/api/recruitment/interviews/:interviewId:correct",
  {
    params: { interviewId: RecruitmentInterviewId },
    headers: IdempotencyIfMatchHeaders,
    payload: CorrectInterviewAssessmentRequest,
    success: entityMutationResponse(CorrectInterviewAssessmentResponse),
    error: endpointProblemResponses(RecruitmentCorrectInterviewAssessmentProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.conduct-interview",
        canonicalScopeResolver: "recruitment.interview-by-id",
        requirements: [
          "recruitment.assigned-interviewer-or-co-interviewer",
          "recruitment.not-known-self",
        ],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Correct interview assessment",
      "Appends a replacement assessment to a completed interview.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const CancelInterviewEndpoint = HttpApiEndpoint.post(
  "cancelInterview",
  "/api/recruitment/interviews/:interviewId:cancel",
  {
    params: { interviewId: RecruitmentInterviewId },
    headers: IdempotencyIfMatchHeaders,
    payload: CancelInterviewRequest,
    success: entityMutationResponse(CancelInterviewResponse),
    error: endpointProblemResponses(RecruitmentCancelInterviewProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.conduct-interview",
        canonicalScopeResolver: "recruitment.interview-by-id",
        requirements: ["recruitment.assigned-interviewer", "recruitment.not-known-self"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("Cancel interview", "Cancels an interview before finalization."),
  );

/**
 * Recruitment assignment, scheduling, conduct, and invitation API.
 *
 * @since 0.1.0
 * @category Groups
 */

const RecruitmentMaintenanceProblem = problemUnion("RecruitmentMaintenanceProblem", [
  "authority.denied",
  "origin.denied",
  "request.malformed",
  "request.too-large",
  "media-type.unsupported",
  "header.malformed",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "resource.not-found",
  "precondition.failed",
  "recruitment.invalid-command",
  "recruitment.ineligible",
  "recruitment.empty-active-questionnaire",
  "recruitment.terminal",
  "recruitment.unavailable",
  "idempotency.unavailable",
  "internal.error",
]);

export const ReadQuestionnairesEndpoint = HttpApiEndpoint.get(
  "readQuestionnaires",
  "/api/recruitment/questionnaires",
  {
    success: privateReadResponse(QuestionnaireManagement),
    error: endpointProblemResponses(RecruitmentMaintenanceProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.maintain",
        canonicalScopeResolver: "recruitment.maintenance",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read questionnaires",
      "Returns global questionnaire definitions and immutable maintenance history for a current global administrator.",
    ),
  );

export const ReadInterviewStaffingEndpoint = HttpApiEndpoint.get(
  "readInterviewStaffing",
  "/api/recruitment/interview-staffing",
  {
    success: privateReadResponse(InterviewStaffingManagement),
    error: endpointProblemResponses(RecruitmentMaintenanceProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.maintain",
        canonicalScopeResolver: "recruitment.maintenance",
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read interview staffing",
      "Returns interviews, eligible candidates, and staffing history in the current coordinator scope.",
    ),
  );

export const MaintainRecruitmentEndpoint = HttpApiEndpoint.post(
  "maintainRecruitment",
  "/api/recruitment/maintenance/commands",
  {
    headers: IdempotencyHeaders,
    payload: RecruitmentMaintenanceCommand,
    success: entityMutationResponse(RecruitmentMaintenanceResult),
    error: endpointProblemResponses(RecruitmentMaintenanceProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "recruitment.maintain",
        canonicalScopeResolver: "recruitment.maintenance",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Maintain recruitment",
      "Creates or revises a questionnaire, or replaces a nonterminal interview staffing pair with an observed revision and reason.",
    ),
  );

export {
  RecruitmentMaintenanceCommand,
  RecruitmentMaintenanceResult,
  QuestionnaireManagement,
  InterviewStaffingManagement,
};

export { RecruitmentInterviewQuestionKindSchema } from "@vektorprogrammet/domain/recruitment";

export class RecruitmentApi extends HttpApiGroup.make("recruitment")
  .add(
    ReadInvitationResponseEndpoint,
    ConfirmInvitationEndpoint,
    RejectInvitationEndpoint,
    RequestNewInvitationTimeEndpoint,
    ReadAssignmentBoardEndpoint,
    ReadSchedulingBoardEndpoint,
    ReadInterviewReportEndpoint,
    AssignApplicantEndpoint,
    ScheduleInterviewEndpoint,
    ReadInterviewConductEndpoint,
    FinalizeInterviewEndpoint,
    CorrectInterviewAssessmentEndpoint,
    CancelInterviewEndpoint,
    ReadQuestionnairesEndpoint,
    ReadInterviewStaffingEndpoint,
    MaintainRecruitmentEndpoint,
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Recruitment",
      description: "Applicant assignment, interview scheduling, conduct, and invitation response.",
    }),
  ) {}
