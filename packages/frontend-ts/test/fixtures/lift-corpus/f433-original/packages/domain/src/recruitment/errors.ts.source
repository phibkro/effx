import { Schema } from "effect";
import { PublicApplicationIdSchema } from "../application/schema.js";
import { DepartmentId, PersonId } from "../organization/schema.js";
import {
  InterviewSchemaId,
  RecruitmentAssignmentCommandId,
  RecruitmentConductCommandId,
  RecruitmentCancellationCommandId,
  RecruitmentInterviewCorrectionCommandId,
  RecruitmentInterviewId,
  RecruitmentScheduleCommandId,
} from "./schema.js";

export class RecruitmentDecodeError extends Schema.TaggedError<RecruitmentDecodeError>()(
  "RecruitmentDecodeError",
  { message: Schema.String },
) {}

export class RecruitmentInactiveActor extends Schema.TaggedError<RecruitmentInactiveActor>()(
  "RecruitmentInactiveActor",
  { personId: PersonId },
) {}

export class RecruitmentRoleDenied extends Schema.TaggedError<RecruitmentRoleDenied>()(
  "RecruitmentRoleDenied",
  { personId: PersonId },
) {}

export class RecruitmentScopeDenied extends Schema.TaggedError<RecruitmentScopeDenied>()(
  "RecruitmentScopeDenied",
  {
    personId: PersonId,
    departmentId: DepartmentId,
    applicationId: Schema.optional(PublicApplicationIdSchema),
  },
) {}

export class RecruitmentAdmissionPeriodNotFound extends Schema.TaggedError<RecruitmentAdmissionPeriodNotFound>()(
  "RecruitmentAdmissionPeriodNotFound",
  { departmentId: DepartmentId },
) {}

export class RecruitmentAmbiguousAdmissionPeriod extends Schema.TaggedError<RecruitmentAmbiguousAdmissionPeriod>()(
  "RecruitmentAmbiguousAdmissionPeriod",
  { departmentId: DepartmentId },
) {}

export class RecruitmentApplicationNotFound extends Schema.TaggedError<RecruitmentApplicationNotFound>()(
  "RecruitmentApplicationNotFound",
  { applicationId: PublicApplicationIdSchema },
) {}

export class RecruitmentApplicationAlreadyAssigned extends Schema.TaggedError<RecruitmentApplicationAlreadyAssigned>()(
  "RecruitmentApplicationAlreadyAssigned",
  {
    applicationId: PublicApplicationIdSchema,
    interviewId: Schema.optional(RecruitmentInterviewId),
  },
) {}

export class RecruitmentInterviewSchemaNotFound extends Schema.TaggedError<RecruitmentInterviewSchemaNotFound>()(
  "RecruitmentInterviewSchemaNotFound",
  { interviewSchemaId: InterviewSchemaId },
) {}

export class RecruitmentInterviewSchemaInactive extends Schema.TaggedError<RecruitmentInterviewSchemaInactive>()(
  "RecruitmentInterviewSchemaInactive",
  { interviewSchemaId: InterviewSchemaId },
) {}

export class RecruitmentInterviewerNotEligible extends Schema.TaggedError<RecruitmentInterviewerNotEligible>()(
  "RecruitmentInterviewerNotEligible",
  { personId: PersonId, departmentId: DepartmentId },
) {}

export class RecruitmentAssignmentCommandConflict extends Schema.TaggedError<RecruitmentAssignmentCommandConflict>()(
  "RecruitmentAssignmentCommandConflict",
  { commandId: RecruitmentAssignmentCommandId },
) {}

export class RecruitmentInterviewNotFound extends Schema.TaggedError<RecruitmentInterviewNotFound>()(
  "RecruitmentInterviewNotFound",
  { interviewId: RecruitmentInterviewId },
) {}

export class RecruitmentInvitationNotFound extends Schema.TaggedError<RecruitmentInvitationNotFound>()(
  "RecruitmentInvitationNotFound",
  {},
) {}

export class RecruitmentInvitationAlreadyResponded extends Schema.TaggedError<RecruitmentInvitationAlreadyResponded>()(
  "RecruitmentInvitationAlreadyResponded",
  {},
) {}

export class RecruitmentInterviewAlreadyScheduled extends Schema.TaggedError<RecruitmentInterviewAlreadyScheduled>()(
  "RecruitmentInterviewAlreadyScheduled",
  { interviewId: RecruitmentInterviewId },
) {}

export class RecruitmentInterviewStaleRevision extends Schema.TaggedError<RecruitmentInterviewStaleRevision>()(
  "RecruitmentInterviewStaleRevision",
  {
    interviewId: RecruitmentInterviewId,
    expectedRevision: Schema.Int,
    actualRevision: Schema.Int,
  },
) {}

export class RecruitmentScheduleCommandConflict extends Schema.TaggedError<RecruitmentScheduleCommandConflict>()(
  "RecruitmentScheduleCommandConflict",
  { commandId: RecruitmentScheduleCommandId },
) {}

export class RecruitmentScheduleInPast extends Schema.TaggedError<RecruitmentScheduleInPast>()(
  "RecruitmentScheduleInPast",
  { interviewId: RecruitmentInterviewId },
) {}

export class RecruitmentInvalidContext extends Schema.TaggedError<RecruitmentInvalidContext>()(
  "RecruitmentInvalidContext",
  { message: Schema.String },
) {}

export class InterviewQuestionsUnavailable extends Schema.TaggedError<InterviewQuestionsUnavailable>()(
  "InterviewQuestionsUnavailable",
  {
    interviewSchemaId: InterviewSchemaId,
    reason: Schema.String,
  },
) {}

export class RecruitmentPersistenceError extends Schema.TaggedError<RecruitmentPersistenceError>()(
  "RecruitmentPersistenceError",
  { operation: Schema.String, message: Schema.String, cause: Schema.optional(Schema.Unknown) },
) {}

export class RecruitmentLifecycleCommandConflict extends Schema.TaggedError<RecruitmentLifecycleCommandConflict>()(
  "RecruitmentLifecycleCommandConflict",
  {
    commandId: Schema.Union([
      RecruitmentConductCommandId,
      RecruitmentCancellationCommandId,
      RecruitmentInterviewCorrectionCommandId,
    ]),
  },
) {}

export class RecruitmentInterviewAlreadyFinalized extends Schema.TaggedError<RecruitmentInterviewAlreadyFinalized>()(
  "RecruitmentInterviewAlreadyFinalized",
  { interviewId: RecruitmentInterviewId },
) {}

export class RecruitmentInterviewAlreadyCancelled extends Schema.TaggedError<RecruitmentInterviewAlreadyCancelled>()(
  "RecruitmentInterviewAlreadyCancelled",
  { interviewId: RecruitmentInterviewId },
) {}

export class RecruitmentInvitationNotAccepted extends Schema.TaggedError<RecruitmentInvitationNotAccepted>()(
  "RecruitmentInvitationNotAccepted",
  { interviewId: RecruitmentInterviewId, responseState: Schema.String },
) {}

export class RecruitmentInterviewNotScheduled extends Schema.TaggedError<RecruitmentInterviewNotScheduled>()(
  "RecruitmentInterviewNotScheduled",
  { interviewId: RecruitmentInterviewId },
) {}

export class RecruitmentConductValidationError extends Schema.TaggedError<RecruitmentConductValidationError>()(
  "RecruitmentConductValidationError",
  { interviewId: RecruitmentInterviewId, message: Schema.String },
) {}
