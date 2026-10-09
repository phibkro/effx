/**
 * Portable Recruitment service contract for reads and lifecycle commands.
 *
 * @since 0.1.0
 */
import { Context, Effect } from "effect";
import type { PersonId } from "../organization/schema.js";
import type { PublicApplicationId } from "../application/schema.js";
import type { RecruitmentActor } from "./schema.js";
import type { InterviewReport, InterviewReportQuery } from "./report.js";
import type {
  RecruitmentApplicationHttpAccess,
  RecruitmentAuthorityHttpSource,
  RecruitmentInterviewHttpSource,
  RecruitmentInvitationHttpSnapshot,
  RecruitmentInvitationTransition,
} from "./access.js";
import type {
  RecruitmentMaintenanceCommand,
  RecruitmentMaintenanceResult,
  QuestionnaireManagement,
  InterviewStaffingManagement,
  RecruitmentMaintenanceFailure,
} from "./maintenance.js";
import type { AdmissionPeriodFailure } from "../admission-period/errors.js";
import type {
  OrganizationDecodeError,
  OrganizationPersistenceError,
} from "../organization/errors.js";
import type { ProfileFailure } from "../profile/errors.js";
import type {
  RecruitmentAssignmentBoard,
  RecruitmentAssignmentBoardQuery,
  RecruitmentAssignmentCommand,
  RecruitmentAssignmentContext,
  RecruitmentAssignmentResult,
  RecruitmentInvitationCapability,
  RecruitmentInvitationResponseContext,
  RecruitmentInvitationRejectInput,
  RecruitmentInvitationRequestNewTimeInput,
  RecruitmentInvitationResponseObservation,
  RecruitmentInvitationResponseResult,
  RecruitmentReadAssignmentBoardContext,
  RecruitmentReadSchedulingBoardContext,
  RecruitmentScheduleCommand,
  RecruitmentScheduleContext,
  RecruitmentScheduleResult,
  RecruitmentSchedulingBoard,
  RecruitmentConductContext,
  RecruitmentInterviewConductObservation,
  CorrectInterviewAssessmentCommand,
  CorrectInterviewAssessmentResult,
  FinalizeInterviewCommand,
  FinalizeInterviewResult,
  CancelInterviewCommand,
  RecruitmentInterviewId,
  CancelInterviewResult,
} from "./schema.js";
import type {
  RecruitmentAdmissionPeriodNotFound,
  RecruitmentAmbiguousAdmissionPeriod,
  RecruitmentApplicationAlreadyAssigned,
  RecruitmentApplicationNotFound,
  RecruitmentAssignmentCommandConflict,
  RecruitmentDecodeError,
  RecruitmentInactiveActor,
  RecruitmentInterviewerNotEligible,
  RecruitmentInterviewNotFound,
  RecruitmentInterviewAlreadyFinalized,
  RecruitmentInterviewAlreadyCancelled,
  RecruitmentInterviewNotScheduled,
  RecruitmentInvitationNotAccepted,
  RecruitmentInterviewAlreadyScheduled,
  RecruitmentInterviewSchemaInactive,
  RecruitmentInterviewSchemaNotFound,
  RecruitmentInterviewStaleRevision,
  RecruitmentInvitationAlreadyResponded,
  RecruitmentInvitationNotFound,
  RecruitmentScheduleCommandConflict,
  RecruitmentScheduleInPast,
  RecruitmentInvalidContext,
  RecruitmentPersistenceError,
  RecruitmentRoleDenied,
  RecruitmentScopeDenied,
  InterviewQuestionsUnavailable,
  RecruitmentLifecycleCommandConflict,
  RecruitmentConductValidationError,
} from "./errors.js";

export type RecruitmentFailure =
  | RecruitmentMaintenanceFailure
  | RecruitmentDecodeError
  | RecruitmentInactiveActor
  | RecruitmentRoleDenied
  | RecruitmentScopeDenied
  | RecruitmentAdmissionPeriodNotFound
  | RecruitmentAmbiguousAdmissionPeriod
  | RecruitmentApplicationNotFound
  | RecruitmentApplicationAlreadyAssigned
  | RecruitmentInterviewSchemaNotFound
  | RecruitmentInterviewSchemaInactive
  | RecruitmentInterviewerNotEligible
  | RecruitmentAssignmentCommandConflict
  | RecruitmentInterviewNotFound
  | RecruitmentInterviewAlreadyScheduled
  | RecruitmentInterviewStaleRevision
  | RecruitmentInvitationNotFound
  | RecruitmentInvitationAlreadyResponded
  | RecruitmentScheduleCommandConflict
  | RecruitmentScheduleInPast
  | InterviewQuestionsUnavailable
  | RecruitmentInvalidContext
  | RecruitmentPersistenceError
  | RecruitmentLifecycleCommandConflict
  | RecruitmentInterviewAlreadyFinalized
  | RecruitmentInterviewAlreadyCancelled
  | RecruitmentInterviewNotScheduled
  | RecruitmentInvitationNotAccepted
  | RecruitmentConductValidationError
  | AdmissionPeriodFailure
  | OrganizationDecodeError
  | OrganizationPersistenceError
  | ProfileFailure;

export interface RecruitmentOperations {
  /** Caller holds the receipt transaction; current target authority precedes replay. */
  readonly prepareAssignment: (input: {
    readonly applicationId: PublicApplicationId;
    readonly interviewerPersonId: PersonId;
    readonly personId: PersonId;
    readonly authorizationInstant: string;
  }) => Effect.Effect<
    { readonly access: RecruitmentApplicationHttpAccess; readonly actor: RecruitmentActor },
    RecruitmentFailure
  >;
  /** Acquires applicant custody before interview or transport-receipt locks. */
  readonly prepareInterview: (input: {
    readonly interviewId: RecruitmentInterviewId;
    readonly personId: PersonId;
    readonly authorizationInstant: string;
  }) => Effect.Effect<
    {
      readonly source: RecruitmentInterviewHttpSource;
      readonly actor: RecruitmentActor;
      readonly activeMember: boolean;
    },
    RecruitmentFailure
  >;
  readonly readInterviewSource: (
    interviewId: RecruitmentInterviewId,
    personId: PersonId,
  ) => Effect.Effect<RecruitmentInterviewHttpSource, RecruitmentFailure>;
  readonly readPersonAuthoritySources: (
    personId: PersonId,
  ) => Effect.Effect<ReadonlyArray<RecruitmentAuthorityHttpSource>, RecruitmentFailure>;
  readonly readInvitationSnapshot: (
    capability: RecruitmentInvitationCapability,
  ) => Effect.Effect<RecruitmentInvitationHttpSnapshot, RecruitmentFailure>;
  readonly transitionInvitation: (input: {
    readonly capability: RecruitmentInvitationCapability;
    readonly transition: RecruitmentInvitationTransition;
    readonly now: string;
  }) => Effect.Effect<RecruitmentInvitationHttpSnapshot, RecruitmentFailure>;
  readonly resolveInterviewReportLeader: (
    personId: PersonId,
    now: string,
  ) => Effect.Effect<
    Extract<RecruitmentActor, { readonly _tag: "DepartmentAdministrator" }>,
    RecruitmentFailure
  >;
  readonly readCompletedInterviewReport: (
    personId: PersonId,
    now: string,
    query: InterviewReportQuery,
  ) => Effect.Effect<InterviewReport, RecruitmentFailure>;
  readonly readQuestionnaires: (
    personId: PersonId,
  ) => Effect.Effect<QuestionnaireManagement, RecruitmentFailure>;
  readonly readInterviewStaffing: (
    personId: PersonId,
  ) => Effect.Effect<InterviewStaffingManagement, RecruitmentFailure>;
  readonly authorizeMaintenance: (
    command: RecruitmentMaintenanceCommand,
    personId: PersonId,
  ) => Effect.Effect<void, RecruitmentFailure>;
  readonly maintainRecruitment: (
    command: RecruitmentMaintenanceCommand,
    personId: PersonId,
  ) => Effect.Effect<RecruitmentMaintenanceResult, RecruitmentFailure>;
  readonly readAssignmentBoard: (
    query: RecruitmentAssignmentBoardQuery,
    context: RecruitmentReadAssignmentBoardContext,
  ) => Effect.Effect<RecruitmentAssignmentBoard, RecruitmentFailure>;
  readonly assignApplicant: (
    command: RecruitmentAssignmentCommand,
    context: RecruitmentAssignmentContext,
  ) => Effect.Effect<RecruitmentAssignmentResult, RecruitmentFailure>;
  readonly readSchedulingBoard: (
    context: RecruitmentReadSchedulingBoardContext,
  ) => Effect.Effect<RecruitmentSchedulingBoard, RecruitmentFailure>;
  readonly scheduleInterview: (
    command: RecruitmentScheduleCommand,
    context: RecruitmentScheduleContext,
  ) => Effect.Effect<RecruitmentScheduleResult, RecruitmentFailure>;
  readonly readInvitationResponse: (
    capability: RecruitmentInvitationCapability,
  ) => Effect.Effect<RecruitmentInvitationResponseObservation, RecruitmentFailure>;
  readonly confirmInvitation: (
    capability: RecruitmentInvitationCapability,
    context: RecruitmentInvitationResponseContext,
  ) => Effect.Effect<RecruitmentInvitationResponseResult, RecruitmentFailure>;
  readonly rejectInvitation: (
    capability: RecruitmentInvitationCapability,
    input: RecruitmentInvitationRejectInput,
    context: RecruitmentInvitationResponseContext,
  ) => Effect.Effect<RecruitmentInvitationResponseResult, RecruitmentFailure>;
  readonly requestNewInvitationTime: (
    capability: RecruitmentInvitationCapability,
    input: RecruitmentInvitationRequestNewTimeInput,
    context: RecruitmentInvitationResponseContext,
  ) => Effect.Effect<RecruitmentInvitationResponseResult, RecruitmentFailure>;
  readonly readInterviewConduct: (
    interviewId: RecruitmentInterviewId,
    context: RecruitmentConductContext,
  ) => Effect.Effect<RecruitmentInterviewConductObservation, RecruitmentFailure>;
  readonly finalizeInterview: (
    command: FinalizeInterviewCommand,
    context: RecruitmentConductContext,
  ) => Effect.Effect<FinalizeInterviewResult, RecruitmentFailure>;
  readonly cancelInterview: (
    command: CancelInterviewCommand,
    context: RecruitmentConductContext,
  ) => Effect.Effect<CancelInterviewResult, RecruitmentFailure>;
  readonly correctInterviewAssessment: (
    command: CorrectInterviewAssessmentCommand,
    context: RecruitmentConductContext,
  ) => Effect.Effect<CorrectInterviewAssessmentResult, RecruitmentFailure>;
}

export class Recruitment extends Context.Service<Recruitment, RecruitmentOperations>()(
  "@vektorprogrammet/domain/Recruitment",
) {}
