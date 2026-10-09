/**
 * Public schemas for recruitment assignment, scheduling, conduct, and invitation responses.
 *
 * @since 0.1.0
 */
import { Schema, SchemaGetter } from "effect";
import { Model } from "effect/unstable/schema";
import {
  AdmissionPeriodActorSchema,
  type AdmissionPeriodActor,
  AdmissionPeriodId,
} from "../admission-period/schema.js";
import {
  ApplicantIdSchema,
  PublicApplicationEmailSchema,
  PublicApplicationIdSchema,
  PublicApplicationNameSchema,
  PublicApplicationPhoneSchema,
} from "../application/schema.js";
import { DepartmentId, PersonId } from "../organization/schema.js";
import { isRfc3339Instant, Rfc3339InstantSchema } from "../time.js";
import { PersonContactEmail, PersonContactPhone } from "../profile/schema.js";

const StableId = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(value), {
      message: "a non-empty stable identifier",
    }),
  ),
);

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const NonNegative = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const Name = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0, { message: "a non-empty name" }),
    Schema.isMaxLength(250),
  ),
);

export const InterviewSchemaId = StableId.pipe(Schema.brand("InterviewSchemaId"));

export type InterviewSchemaId = typeof InterviewSchemaId.Type;

export const RecruitmentInterviewId = StableId.pipe(Schema.brand("RecruitmentInterviewId"));

export type RecruitmentInterviewId = typeof RecruitmentInterviewId.Type;

const QuestionPrompt = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value === value.trim(), {
      message: "a trimmed non-empty question prompt",
    }),
    Schema.isMaxLength(5_000),
  ),
);

const QuestionHelpText = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length <= 5_000, {
      message: "question help text is too long",
    }),
  ),
);

const QuestionAlternative = QuestionPrompt;

export const RecruitmentInterviewQuestionKindSchema = Schema.Literals([
  "text",
  "list",
  "radio",
  "check",
]);

export type RecruitmentInterviewQuestionKind = typeof RecruitmentInterviewQuestionKindSchema.Type;

const questionDefinitionFields = {
  questionId: StableId,
  ordinal: NonNegative,
  prompt: QuestionPrompt,
  helpText: Schema.NullOr(QuestionHelpText),
  kind: RecruitmentInterviewQuestionKindSchema,
  alternatives: Schema.Array(QuestionAlternative),
};

const validQuestionDefinition = Schema.makeFilter(
  (question: {
    readonly kind: RecruitmentInterviewQuestionKind;
    readonly alternatives: ReadonlyArray<string>;
  }) =>
    new Set(question.alternatives).size === question.alternatives.length &&
    (question.kind === "text"
      ? question.alternatives.length === 0
      : question.alternatives.length > 0),
  { message: "question alternatives do not match the question kind" },
);

export const InterviewQuestionDefinitionSchema = Schema.Struct(questionDefinitionFields).pipe(
  Schema.check(validQuestionDefinition),
);

export type InterviewQuestionDefinition = typeof InterviewQuestionDefinitionSchema.Type;

export const RecruitmentInterviewQuestionSourceSchema = Schema.Array(
  InterviewQuestionDefinitionSchema,
).pipe(
  Schema.check(
    Schema.makeFilter(
      (questions) =>
        new Set(questions.map((question) => question.questionId)).size === questions.length &&
        questions.every((question, index) => question.ordinal === index),
      { message: "question IDs and ordinals must be unique and contiguous from zero" },
    ),
  ),
);

export type RecruitmentInterviewQuestionSource =
  typeof RecruitmentInterviewQuestionSourceSchema.Type;

export class RecruitmentInterviewQuestionSnapshot extends Model.Class<RecruitmentInterviewQuestionSnapshot>(
  "Recruitment.RecruitmentInterviewQuestionSnapshot",
)({
  interviewId: Model.Field({
    select: RecruitmentInterviewId,
    insert: RecruitmentInterviewId,
    json: RecruitmentInterviewId,
  }),
  questionId: Model.Field({
    select: StableId,
    insert: StableId,
    json: StableId,
  }),
  ordinal: Model.Field({
    select: NonNegative,
    insert: NonNegative,
    json: NonNegative,
  }),
  prompt: Model.Field({
    select: QuestionPrompt,
    insert: QuestionPrompt,
    json: QuestionPrompt,
  }),
  helpText: Model.Field({
    select: Schema.NullOr(QuestionHelpText),
    insert: Schema.NullOr(QuestionHelpText),
    json: Schema.NullOr(QuestionHelpText),
  }),
  kind: Model.Field({
    select: RecruitmentInterviewQuestionKindSchema,
    insert: RecruitmentInterviewQuestionKindSchema,
    json: RecruitmentInterviewQuestionKindSchema,
  }),
  alternatives: Model.Field({
    select: Schema.Array(QuestionAlternative),
    insert: Schema.Array(QuestionAlternative),
    json: Schema.Array(QuestionAlternative),
  }),
}) {}

export type RecruitmentInterviewQuestionSnapshotSelect =
  typeof RecruitmentInterviewQuestionSnapshot.Encoded;

export type RecruitmentInterviewQuestionSnapshotInsert =
  typeof RecruitmentInterviewQuestionSnapshot.insert.Encoded;

export type RecruitmentInterviewQuestionSnapshotJson =
  typeof RecruitmentInterviewQuestionSnapshot.json.Type;

export type RecruitmentInterviewQuestionSnapshotValue = RecruitmentInterviewQuestionSnapshot;

export const RecruitmentAssignmentCommandId = StableId.pipe(
  Schema.brand("RecruitmentAssignmentCommandId"),
);

export type RecruitmentAssignmentCommandId = typeof RecruitmentAssignmentCommandId.Type;

export const RecruitmentScheduleCommandId = StableId.pipe(
  Schema.brand("RecruitmentScheduleCommandId"),
);

export type RecruitmentScheduleCommandId = typeof RecruitmentScheduleCommandId.Type;

export const RecruitmentInvitationId = StableId.pipe(Schema.brand("RecruitmentInvitationId"));

export type RecruitmentInvitationId = typeof RecruitmentInvitationId.Type;

export const RecruitmentNotificationEffectId = StableId.pipe(
  Schema.brand("RecruitmentNotificationEffectId"),
);

export type RecruitmentNotificationEffectId = typeof RecruitmentNotificationEffectId.Type;

export const RecruitmentActorSchema = AdmissionPeriodActorSchema;

export type RecruitmentActor = AdmissionPeriodActor;

export const RecruitmentAssignmentStatusSchema = Schema.Literals(["new", "all"]);

export type RecruitmentAssignmentStatus = typeof RecruitmentAssignmentStatusSchema.Type;

export const RecruitmentAssignmentBoardQuerySchema = Schema.Struct({
  status: RecruitmentAssignmentStatusSchema,
});

export type RecruitmentAssignmentBoardQuery = typeof RecruitmentAssignmentBoardQuerySchema.Type;

export class InterviewSchema extends Model.Class<InterviewSchema>("Recruitment.InterviewSchema")({
  interviewSchemaId: Model.Field({
    select: InterviewSchemaId,
    insert: InterviewSchemaId,
    json: InterviewSchemaId,
  }),
  name: Model.Field({
    select: Name,
    insert: Name,
    update: Name,
    json: Name,
    jsonCreate: Name,
    jsonUpdate: Name,
  }),
  questionCount: Model.Field({
    select: NonNegative,
    insert: NonNegative,
    update: NonNegative,
    json: NonNegative,
    jsonCreate: NonNegative,
    jsonUpdate: NonNegative,
  }),
  active: Model.Field({
    select: Schema.Boolean,
    insert: Schema.Boolean,
    update: Schema.Boolean,
    json: Schema.Boolean,
    jsonCreate: Schema.Boolean,
    jsonUpdate: Schema.Boolean,
  }),
  revision: Model.GeneratedByDb(Revision),
}) {}

export type InterviewSchemaSelect = typeof InterviewSchema.Encoded;

export type InterviewSchemaInsert = typeof InterviewSchema.insert.Encoded;

export type InterviewSchemaUpdate = typeof InterviewSchema.update.Encoded;

export type InterviewSchemaJson = typeof InterviewSchema.json.Type;

export type InterviewSchemaJsonCreate = typeof InterviewSchema.jsonCreate.Type;

export type InterviewSchemaJsonUpdate = typeof InterviewSchema.jsonUpdate.Type;

export type InterviewSchemaValue = InterviewSchema;

export class RecruitmentInterview extends Model.Class<RecruitmentInterview>(
  "Recruitment.RecruitmentInterview",
)({
  interviewId: Model.Field({
    select: RecruitmentInterviewId,
    insert: RecruitmentInterviewId,
    json: RecruitmentInterviewId,
  }),
  applicationId: Model.Field({
    select: PublicApplicationIdSchema,
    insert: PublicApplicationIdSchema,
    json: PublicApplicationIdSchema,
  }),
  departmentId: Model.Field({
    select: DepartmentId,
    insert: DepartmentId,
    json: DepartmentId,
  }),
  interviewerPersonId: Model.Field({
    select: PersonId,
    insert: PersonId,
    json: PersonId,
  }),
  coInterviewerPersonId: Model.GeneratedByDb(Schema.NullOr(PersonId)),
  interviewSchemaId: Model.Field({
    select: InterviewSchemaId,
    insert: InterviewSchemaId,
    json: InterviewSchemaId,
  }),
  assignedByPersonId: Model.Field({
    select: PersonId,
    insert: PersonId,
    json: PersonId,
  }),
  assignedAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
    json: Rfc3339InstantSchema,
  }),
  revision: Model.GeneratedByDb(Revision),
}) {}

export type RecruitmentInterviewSelect = typeof RecruitmentInterview.Encoded;

export type RecruitmentInterviewInsert = typeof RecruitmentInterview.insert.Encoded;

export type RecruitmentInterviewJson = typeof RecruitmentInterview.json.Type;

export type RecruitmentInterviewValue = RecruitmentInterview;

const ScheduleMessage = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0, {
      message: "a non-empty schedule message",
    }),
    Schema.isMaxLength(2_000),
  ),
);

const HttpsMapLink = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => {
        try {
          const url = new URL(value);

          return (
            url.protocol === "https:" && url.username.length === 0 && url.password.length === 0
          );
        } catch {
          return false;
        }
      },
      { message: "an HTTPS URL without user credentials" },
    ),
  ),
);

const CapabilitySha256 = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[a-f0-9]{64}$/u.test(value), {
      message: "a lowercase SHA-256 digest",
    }),
  ),
);

export class RecruitmentInterviewSchedule extends Model.Class<RecruitmentInterviewSchedule>(
  "Recruitment.RecruitmentInterviewSchedule",
)({
  interviewId: Model.Field({
    select: RecruitmentInterviewId,
    insert: RecruitmentInterviewId,
    json: RecruitmentInterviewId,
  }),
  scheduledAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
    json: Rfc3339InstantSchema,
  }),
  room: Model.Field({
    select: Name,
    insert: Name,
    json: Name,
  }),
  campus: Model.Field({
    select: Schema.NullOr(Name),
    insert: Schema.NullOr(Name),
    json: Schema.NullOr(Name),
  }),
  mapLink: Model.Field({
    select: Schema.NullOr(HttpsMapLink),
    insert: Schema.NullOr(HttpsMapLink),
    json: Schema.NullOr(HttpsMapLink),
  }),
  message: Model.Field({
    select: ScheduleMessage,
    insert: ScheduleMessage,
    json: ScheduleMessage,
  }),
  scheduledByPersonId: Model.Field({
    select: PersonId,
    insert: PersonId,
    json: PersonId,
  }),
  committedAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
    json: Rfc3339InstantSchema,
  }),
  scheduleRevision: Model.Field({
    select: Revision,
    insert: Revision,
    json: Revision,
  }),
}) {}

export type RecruitmentInterviewScheduleSelect = typeof RecruitmentInterviewSchedule.Encoded;

export type RecruitmentInterviewScheduleValue = RecruitmentInterviewSchedule;

export const RecruitmentInvitationCapabilitySchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[A-Za-z0-9_-]{43}$/u.test(value), {
      message: "a 43-character base64url capability",
    }),
  ),
  Schema.brand("RecruitmentInvitationCapability"),
);

export type RecruitmentInvitationCapability = typeof RecruitmentInvitationCapabilitySchema.Type;

export const RecruitmentInvitationResponseStateSchema = Schema.Literals([
  "Pending",
  "Accepted",
  "Rejected",
  "RequestedNewTime",
]);

export type RecruitmentInvitationResponseState =
  typeof RecruitmentInvitationResponseStateSchema.Type;

const RecruitmentInvitationCapabilitySequencePattern = /[A-Za-z0-9_-]{43}/u;

export const containsRecruitmentInvitationCapabilitySequence = (value: string): boolean =>
  RecruitmentInvitationCapabilitySequencePattern.test(value);

const TrimmedRecruitmentInvitationResponseMessageSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value === value.trim(), {
      message: "a trimmed non-empty invitation response message",
    }),
    Schema.isMaxLength(2_000),
    Schema.makeFilter((value) => !containsRecruitmentInvitationCapabilitySequence(value), {
      message: "an invitation response message without a 43-character base64url sequence",
    }),
  ),
);

export const RecruitmentInvitationResponseMessageSchema = Schema.String.pipe(
  Schema.decodeTo(TrimmedRecruitmentInvitationResponseMessageSchema, {
    decode: SchemaGetter.transform((value: string) => value.trim()),
    encode: SchemaGetter.transform((value: string) => value),
  }),
);

export type RecruitmentInvitationResponseMessage =
  typeof RecruitmentInvitationResponseMessageSchema.Type;

const RecruitmentInvitationRejectInputEncodedSchema = Schema.Struct({
  message: Schema.optional(Schema.String),
}).annotate({
  identifier: "InvitationRejectInputEncoded",
  description: "Optional short rejection message.",
  examples: [{ message: "Cannot attend that day." }, {}],
});

const RecruitmentInvitationRejectInputNormalizedSchema = Schema.Struct({
  message: Schema.optional(RecruitmentInvitationResponseMessageSchema),
});

export const RecruitmentInvitationRejectInputSchema =
  RecruitmentInvitationRejectInputEncodedSchema.pipe(
    Schema.decodeTo(RecruitmentInvitationRejectInputNormalizedSchema, {
      decode: SchemaGetter.transform((input: { readonly message?: string }) => {
        const message = input.message?.trim();

        return message === undefined || message.length === 0 ? {} : { message };
      }),
      encode: SchemaGetter.transform((input: { readonly message?: string }) => input),
    }),
  );

export type RecruitmentInvitationRejectInput = typeof RecruitmentInvitationRejectInputSchema.Type;

export const RecruitmentInvitationRequestNewTimeInputSchema = Schema.Struct({
  message: RecruitmentInvitationResponseMessageSchema,
});

export type RecruitmentInvitationRequestNewTimeInput =
  typeof RecruitmentInvitationRequestNewTimeInputSchema.Type;

export class RecruitmentInvitation extends Model.Class<RecruitmentInvitation>(
  "Recruitment.RecruitmentInvitation",
)({
  invitationId: Model.Field({
    select: RecruitmentInvitationId,
    insert: RecruitmentInvitationId,
  }),
  interviewId: Model.Field({
    select: RecruitmentInterviewId,
    insert: RecruitmentInterviewId,
  }),
  scheduleRevision: Model.Field({
    select: Revision,
    insert: Revision,
  }),
  capabilitySha256: Model.Field({
    select: CapabilitySha256,
    insert: CapabilitySha256,
  }),
  responseState: Model.Field({
    select: RecruitmentInvitationResponseStateSchema,
    insert: RecruitmentInvitationResponseStateSchema,
    update: RecruitmentInvitationResponseStateSchema,
  }),
  responseMessage: Model.GeneratedByDb(Schema.NullOr(RecruitmentInvitationResponseMessageSchema)),
  respondedAt: Model.GeneratedByDb(Schema.NullOr(Rfc3339InstantSchema)),
  responseRevision: Model.GeneratedByDb(Revision),
  supersededAt: Model.GeneratedByDb(Schema.NullOr(Rfc3339InstantSchema)),
  createdAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
  }),
}) {}

export type RecruitmentInvitationSelect = typeof RecruitmentInvitation.Encoded;

export type RecruitmentInvitationValue = RecruitmentInvitation;

const RecruitmentInvitationResponseObservationFields = {
  scheduledAt: RecruitmentInterviewSchedule.fields.scheduledAt,
  room: RecruitmentInterviewSchedule.fields.room,
  campus: RecruitmentInterviewSchedule.fields.campus,
};

export const RecruitmentInvitationResponseObservationSchema = Schema.Union([
  Schema.Struct({
    ...RecruitmentInvitationResponseObservationFields,
    responseState: Schema.Literals(["Pending", "Accepted"]),
    responseMessage: Schema.Null,
  }),
  Schema.Struct({
    ...RecruitmentInvitationResponseObservationFields,
    responseState: Schema.Literals(["Rejected"]),
    responseMessage: Schema.NullOr(RecruitmentInvitationResponseMessageSchema),
  }),
  Schema.Struct({
    ...RecruitmentInvitationResponseObservationFields,
    responseState: Schema.Literals(["RequestedNewTime"]),
    responseMessage: RecruitmentInvitationResponseMessageSchema,
  }),
]);

export type RecruitmentInvitationResponseObservation =
  typeof RecruitmentInvitationResponseObservationSchema.Type;

export const RecruitmentInvitationResponseNotificationStateSchema = Schema.Literals([
  "NotRequired",
  "Pending",
]);

export type RecruitmentInvitationResponseNotificationState =
  typeof RecruitmentInvitationResponseNotificationStateSchema.Type;

const RecruitmentInvitationResponseResultFields = {
  interviewRevision: Revision,
  scheduleRevision: Revision,
  responseRevision: Revision,
  respondedAt: Rfc3339InstantSchema,
};

export const RecruitmentInvitationResponseResultSchema = Schema.Union([
  Schema.TaggedStruct("InvitationResponseRecorded", {
    ...RecruitmentInvitationResponseResultFields,
    responseState: Schema.Literals(["Accepted"]),
    responseMessage: Schema.Null,
    notificationState: Schema.Literals(["NotRequired"]),
  }),
  Schema.TaggedStruct("InvitationResponseRecorded", {
    ...RecruitmentInvitationResponseResultFields,
    responseState: Schema.Literals(["Rejected"]),
    responseMessage: Schema.NullOr(RecruitmentInvitationResponseMessageSchema),
    notificationState: Schema.Literals(["Pending"]),
  }),
  Schema.TaggedStruct("InvitationResponseRecorded", {
    ...RecruitmentInvitationResponseResultFields,
    responseState: Schema.Literals(["RequestedNewTime"]),
    responseMessage: RecruitmentInvitationResponseMessageSchema,
    notificationState: Schema.Literals(["Pending"]),
  }),
]);

export type RecruitmentInvitationResponseResult =
  typeof RecruitmentInvitationResponseResultSchema.Type;

export const RecruitmentInterviewerOptionSchema = Schema.Struct({
  personId: PersonId,
  displayName: Name,
});

export type RecruitmentInterviewerOption = typeof RecruitmentInterviewerOptionSchema.Type;

export const RecruitmentInterviewSchemaOptionSchema = Schema.Struct({
  interviewSchemaId: InterviewSchemaId,
  name: Name,
  questionCount: NonNegative,
  active: Schema.Boolean,
  revision: Revision,
});

export type RecruitmentInterviewSchemaOption = typeof RecruitmentInterviewSchemaOptionSchema.Type;

export const RecruitmentInterviewStateForBoardSchema = Schema.Literals([
  "Unassigned",
  "NoContact",
  "Scheduled",
]);

export type RecruitmentInterviewStateForBoard = typeof RecruitmentInterviewStateForBoardSchema.Type;

export const RecruitmentApplicationStateSchema = Schema.Literals(["Received"]);

export type RecruitmentApplicationState = typeof RecruitmentApplicationStateSchema.Type;

export const RecruitmentAssignmentCandidateSchema = Schema.Struct({
  applicationId: PublicApplicationIdSchema,
  applicantId: ApplicantIdSchema,
  firstName: PublicApplicationNameSchema,
  lastName: PublicApplicationNameSchema,
  email: PublicApplicationEmailSchema,
  submittedAt: Rfc3339InstantSchema,
  applicationState: RecruitmentApplicationStateSchema,
  interviewState: RecruitmentInterviewStateForBoardSchema,
  interviewer: Schema.NullOr(RecruitmentInterviewerOptionSchema),
  interviewSchema: Schema.NullOr(RecruitmentInterviewSchemaOptionSchema),
  scheduledAt: Schema.NullOr(Rfc3339InstantSchema),
});

export type RecruitmentAssignmentCandidate = typeof RecruitmentAssignmentCandidateSchema.Type;

export const RecruitmentAssignmentBoardSchema = Schema.Struct({
  admissionPeriodId: AdmissionPeriodId,
  departmentId: DepartmentId,
  candidates: Schema.Array(RecruitmentAssignmentCandidateSchema),
  interviewers: Schema.Array(RecruitmentInterviewerOptionSchema),
  interviewSchemas: Schema.Array(RecruitmentInterviewSchemaOptionSchema),
});

export type RecruitmentAssignmentBoard = typeof RecruitmentAssignmentBoardSchema.Type;

export const RecruitmentAssignmentCommandSchema = Schema.Struct({
  commandId: RecruitmentAssignmentCommandId,
  applicationId: PublicApplicationIdSchema,
  interviewerPersonId: PersonId,
  interviewSchemaId: InterviewSchemaId,
});

export type RecruitmentAssignmentCommand = typeof RecruitmentAssignmentCommandSchema.Type;

export const RecruitmentAssignmentObservationSchema = Schema.TaggedStruct("ApplicantAssigned", {
  commandId: RecruitmentAssignmentCommandId,
  interview: RecruitmentInterview,
});

export type RecruitmentAssignmentObservation = typeof RecruitmentAssignmentObservationSchema.Type;

export const RecruitmentAssignmentResultSchema = Schema.Struct({
  observation: RecruitmentAssignmentObservationSchema,
  replayed: Schema.Boolean,
});

export type RecruitmentAssignmentResult = typeof RecruitmentAssignmentResultSchema.Type;

export const RecruitmentNotificationDeliveryStateSchema = Schema.Literals([
  "Pending",
  "Processing",
  "Delivered",
  "Failed",
  "Quarantined",
]);

export type RecruitmentNotificationDeliveryState =
  typeof RecruitmentNotificationDeliveryStateSchema.Type;

export const RecruitmentSchedulingApplicantSchema = Schema.Struct({
  applicationId: PublicApplicationIdSchema,
  applicantId: ApplicantIdSchema,
  firstName: PublicApplicationNameSchema,
  lastName: PublicApplicationNameSchema,
  email: PublicApplicationEmailSchema,
  phone: PublicApplicationPhoneSchema,
});

export type RecruitmentSchedulingApplicant = typeof RecruitmentSchedulingApplicantSchema.Type;

export const RecruitmentSchedulingInterviewerSchema = Schema.Struct({
  personId: PersonId,
  displayName: Name,
  email: PersonContactEmail,
  phone: PersonContactPhone,
});

export type RecruitmentSchedulingInterviewer = typeof RecruitmentSchedulingInterviewerSchema.Type;

export const RecruitmentSchedulingCoInterviewerSchema = Schema.Struct({
  personId: PersonId,
  displayName: Name,
});

export type RecruitmentSchedulingCoInterviewer =
  typeof RecruitmentSchedulingCoInterviewerSchema.Type;

const RecruitmentSchedulingInterviewFields = {
  interviewId: RecruitmentInterviewId,
  applicationId: PublicApplicationIdSchema,
  departmentId: DepartmentId,
  interviewer: RecruitmentSchedulingInterviewerSchema,
  coInterviewer: Schema.NullOr(RecruitmentSchedulingCoInterviewerSchema),
  applicant: RecruitmentSchedulingApplicantSchema,
  revision: Revision,
  schedule: Schema.NullOr(RecruitmentInterviewSchedule),
  notificationState: Schema.NullOr(RecruitmentNotificationDeliveryStateSchema),
};

export const RecruitmentSchedulingInterviewSchema = Schema.Union([
  Schema.Struct({
    ...RecruitmentSchedulingInterviewFields,
    responseState: Schema.Null,
    responseMessage: Schema.Null,
  }),
  Schema.Struct({
    ...RecruitmentSchedulingInterviewFields,
    responseState: Schema.Literals(["Pending", "Accepted"]),
    responseMessage: Schema.Null,
  }),
  Schema.Struct({
    ...RecruitmentSchedulingInterviewFields,
    responseState: Schema.Literals(["Rejected"]),
    responseMessage: Schema.NullOr(RecruitmentInvitationResponseMessageSchema),
  }),
  Schema.Struct({
    ...RecruitmentSchedulingInterviewFields,
    responseState: Schema.Literals(["RequestedNewTime"]),
    responseMessage: RecruitmentInvitationResponseMessageSchema,
  }),
]);

export type RecruitmentSchedulingInterview = typeof RecruitmentSchedulingInterviewSchema.Type;

export const RecruitmentSchedulingBoardSchema = Schema.Struct({
  departmentId: DepartmentId,
  interviews: Schema.Array(RecruitmentSchedulingInterviewSchema),
});

export type RecruitmentSchedulingBoard = typeof RecruitmentSchedulingBoardSchema.Type;

export const RecruitmentScheduleCommandSchema = Schema.Struct({
  commandId: RecruitmentScheduleCommandId,
  interviewId: RecruitmentInterviewId,
  expectedRevision: Revision,
  scheduledAt: Rfc3339InstantSchema,
  room: Name,
  campus: Schema.NullOr(Name),
  mapLink: Schema.NullOr(HttpsMapLink),
  message: ScheduleMessage,
});

export type RecruitmentScheduleCommand = typeof RecruitmentScheduleCommandSchema.Type;

export const RecruitmentScheduleObservationSchema = Schema.TaggedStruct("InterviewScheduled", {
  commandId: RecruitmentScheduleCommandId,
  interviewId: RecruitmentInterviewId,
  schedule: RecruitmentInterviewSchedule,
  interviewRevision: Revision,
  responseState: RecruitmentInvitationResponseStateSchema,
  notificationState: RecruitmentNotificationDeliveryStateSchema,
});

export type RecruitmentScheduleObservation = typeof RecruitmentScheduleObservationSchema.Type;

export const RecruitmentScheduleResultSchema = Schema.Struct({
  observation: RecruitmentScheduleObservationSchema,
  replayed: Schema.Boolean,
});

export type RecruitmentScheduleResult = typeof RecruitmentScheduleResultSchema.Type;

export interface RecruitmentInvitationResponseContext {
  readonly now: string;
}

export interface RecruitmentReadSchedulingBoardContext {
  readonly actor: RecruitmentActor;
  readonly now: string;
}

export interface RecruitmentScheduleContext {
  readonly actor: RecruitmentActor;
  readonly now: string;
  readonly invitationId: RecruitmentInvitationId;
  readonly responseCapability: string;
}

export interface RecruitmentReadAssignmentBoardContext {
  readonly actor: RecruitmentActor;
  readonly now: string;
}

export interface RecruitmentAssignmentContext {
  readonly actor: RecruitmentActor;
  readonly now: string;
  readonly interviewId: RecruitmentInterviewId;
}

export const isRecruitmentNow = isRfc3339Instant;

export const RecruitmentInstantSchema = Rfc3339InstantSchema;

export const RecruitmentConductCommandId = StableId.pipe(
  Schema.brand("RecruitmentConductCommandId"),
);

export type RecruitmentConductCommandId = typeof RecruitmentConductCommandId.Type;

export const RecruitmentCancellationCommandId = StableId.pipe(
  Schema.brand("RecruitmentCancellationCommandId"),
);

export type RecruitmentCancellationCommandId = typeof RecruitmentCancellationCommandId.Type;

export const RecruitmentInterviewCorrectionCommandId = StableId.pipe(
  Schema.brand("RecruitmentInterviewCorrectionCommandId"),
);

export type RecruitmentInterviewCorrectionCommandId =
  typeof RecruitmentInterviewCorrectionCommandId.Type;

export const RecruitmentInterviewAnswerSchema = Schema.Struct({
  questionId: StableId,
  answer: Schema.Union([Schema.String, Schema.Array(Schema.String)]),
});

export type RecruitmentInterviewAnswer = typeof RecruitmentInterviewAnswerSchema.Type;

export const interviewRecommendations = ["Ja", "Kanskje", "Nei"] as const;

export const InterviewRecommendationSchema = Schema.Literals(interviewRecommendations);

export type InterviewRecommendation = typeof InterviewRecommendationSchema.Type;

export const RecruitmentInterviewScoreSchema = Schema.Struct({
  explanatoryPower: Schema.Int.pipe(
    Schema.check(
      Schema.makeFilter((value) => value >= 0 && value <= 10, {
        message: "explanatory power must be an integer from 0 to 10",
      }),
    ),
  ),
  roleModel: Schema.Int.pipe(
    Schema.check(
      Schema.makeFilter((value) => value >= 0 && value <= 10, {
        message: "role model must be an integer from 0 to 10",
      }),
    ),
  ),
  suitability: Schema.Int.pipe(
    Schema.check(
      Schema.makeFilter((value) => value >= 0 && value <= 10, {
        message: "suitability must be an integer from 0 to 10",
      }),
    ),
  ),
});

export type RecruitmentInterviewScore = typeof RecruitmentInterviewScoreSchema.Type;

export class RecruitmentInterviewConduct extends Model.Class<RecruitmentInterviewConduct>(
  "Recruitment.RecruitmentInterviewConduct",
)({
  interviewId: Model.Field({
    select: RecruitmentInterviewId,
    insert: RecruitmentInterviewId,
    json: RecruitmentInterviewId,
  }),
  answers: Model.Field({
    select: Schema.Array(RecruitmentInterviewAnswerSchema),
    insert: Schema.Array(RecruitmentInterviewAnswerSchema),
    json: Schema.Array(RecruitmentInterviewAnswerSchema),
  }),
  score: Model.Field({
    select: RecruitmentInterviewScoreSchema,
    insert: RecruitmentInterviewScoreSchema,
    json: RecruitmentInterviewScoreSchema,
  }),
  recommendation: Model.Field({
    select: Schema.NullOr(InterviewRecommendationSchema),
    insert: InterviewRecommendationSchema,
    json: Schema.NullOr(InterviewRecommendationSchema),
  }),
  finalizedByPersonId: Model.Field({
    select: PersonId,
    insert: PersonId,
    json: PersonId,
  }),
  finalizedAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
    json: Rfc3339InstantSchema,
  }),
  interviewRevision: Model.Field({
    select: Revision,
    insert: Revision,
    json: Revision,
  }),
}) {}

export const RecruitmentInterviewCorrectionSchema = Schema.Struct({
  interviewId: RecruitmentInterviewId,
  predecessorRevision: Revision,
  resultingRevision: Revision,
  answers: Schema.Array(RecruitmentInterviewAnswerSchema),
  score: RecruitmentInterviewScoreSchema,
  recommendation: InterviewRecommendationSchema,
  correctedByPersonId: PersonId,
  correctedAt: Rfc3339InstantSchema,
  commandId: RecruitmentInterviewCorrectionCommandId,
});

export type RecruitmentInterviewCorrection = typeof RecruitmentInterviewCorrectionSchema.Type;

export type RecruitmentInterviewConductSelect = typeof RecruitmentInterviewConduct.Encoded;

export type RecruitmentInterviewConductInsert = typeof RecruitmentInterviewConduct.insert.Encoded;

export type RecruitmentInterviewConductJson = typeof RecruitmentInterviewConduct.json.Type;

export type RecruitmentInterviewConductValue = RecruitmentInterviewConduct;

export class RecruitmentInterviewCancellation extends Model.Class<RecruitmentInterviewCancellation>(
  "Recruitment.RecruitmentInterviewCancellation",
)({
  interviewId: Model.Field({
    select: RecruitmentInterviewId,
    insert: RecruitmentInterviewId,
    json: RecruitmentInterviewId,
  }),
  cancelledByPersonId: Model.Field({
    select: PersonId,
    insert: PersonId,
    json: PersonId,
  }),
  cancelledAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
    json: Rfc3339InstantSchema,
  }),
  interviewRevision: Model.Field({
    select: Revision,
    insert: Revision,
    json: Revision,
  }),
}) {}

export type RecruitmentInterviewCancellationSelect =
  typeof RecruitmentInterviewCancellation.Encoded;

export type RecruitmentInterviewCancellationInsert =
  typeof RecruitmentInterviewCancellation.insert.Encoded;

export type RecruitmentInterviewCancellationJson =
  typeof RecruitmentInterviewCancellation.json.Type;

export type RecruitmentInterviewCancellationValue = RecruitmentInterviewCancellation;

export const FinalizeInterviewCommandSchema = Schema.Struct({
  commandId: RecruitmentConductCommandId,
  interviewId: RecruitmentInterviewId,
  expectedRevision: Revision,
  answers: Schema.Array(RecruitmentInterviewAnswerSchema),
  score: RecruitmentInterviewScoreSchema,
  recommendation: InterviewRecommendationSchema,
});

export type FinalizeInterviewCommand = typeof FinalizeInterviewCommandSchema.Type;

export const CancelInterviewCommandSchema = Schema.Struct({
  commandId: RecruitmentCancellationCommandId,
  interviewId: RecruitmentInterviewId,
  expectedRevision: Revision,
});

export type CancelInterviewCommand = typeof CancelInterviewCommandSchema.Type;

export const CorrectInterviewAssessmentCommandSchema = Schema.Struct({
  commandId: RecruitmentInterviewCorrectionCommandId,
  interviewId: RecruitmentInterviewId,
  expectedRevision: Revision,
  answers: Schema.Array(RecruitmentInterviewAnswerSchema),
  score: RecruitmentInterviewScoreSchema,
  recommendation: InterviewRecommendationSchema,
});

export type CorrectInterviewAssessmentCommand = typeof CorrectInterviewAssessmentCommandSchema.Type;

export const CorrectionHistoryOriginalSchema = Schema.TaggedStruct("Original", {
  revision: Revision,
  answers: Schema.Array(RecruitmentInterviewAnswerSchema),
  score: RecruitmentInterviewScoreSchema,
  recommendation: Schema.NullOr(InterviewRecommendationSchema),
  finalizedByPersonId: PersonId,
  finalizedAt: Rfc3339InstantSchema,
});

export const CorrectionHistoryEntrySchema = Schema.TaggedStruct("Correction", {
  revision: Revision,
  predecessorRevision: Revision,
  answers: Schema.Array(RecruitmentInterviewAnswerSchema),
  score: RecruitmentInterviewScoreSchema,
  recommendation: InterviewRecommendationSchema,
  correctedByPersonId: PersonId,
  correctedAt: Rfc3339InstantSchema,
  commandId: RecruitmentInterviewCorrectionCommandId,
});

export const RecruitmentInterviewCorrectionHistoryEntrySchema = Schema.Union([
  CorrectionHistoryOriginalSchema,
  CorrectionHistoryEntrySchema,
]);

export type RecruitmentInterviewCorrectionHistoryEntry =
  typeof RecruitmentInterviewCorrectionHistoryEntrySchema.Type;

export const CorrectInterviewAssessmentObservationSchema = Schema.TaggedStruct(
  "InterviewCorrected",
  {
    commandId: RecruitmentInterviewCorrectionCommandId,
    interviewId: RecruitmentInterviewId,
    predecessorRevision: Revision,
    resultingRevision: Revision,
  },
);

export type CorrectInterviewAssessmentObservation =
  typeof CorrectInterviewAssessmentObservationSchema.Type;

export const CorrectInterviewAssessmentResultSchema = Schema.Struct({
  observation: CorrectInterviewAssessmentObservationSchema,
  replayed: Schema.Boolean,
});

export type CorrectInterviewAssessmentResult = typeof CorrectInterviewAssessmentResultSchema.Type;

export const FinalizeInterviewObservationSchema = Schema.TaggedStruct("InterviewFinalized", {
  commandId: RecruitmentConductCommandId,
  interviewId: RecruitmentInterviewId,
  interviewRevision: Revision,
  finalizedAt: Rfc3339InstantSchema,
  completionState: Schema.Literals(["Completed"]),
  cancellationState: Schema.Literals(["NotCancelled"]),
  notificationState: Schema.Literals(["Pending"]),
});

export type FinalizeInterviewObservation = typeof FinalizeInterviewObservationSchema.Type;

export const CancelInterviewObservationSchema = Schema.TaggedStruct("InterviewCancelled", {
  commandId: RecruitmentCancellationCommandId,
  interviewId: RecruitmentInterviewId,
  interviewRevision: Revision,
  cancelledAt: Rfc3339InstantSchema,
  completionState: Schema.Literals(["NotCompleted"]),
  cancellationState: Schema.Literals(["Cancelled"]),
});

export type CancelInterviewObservation = typeof CancelInterviewObservationSchema.Type;

export const FinalizeInterviewResultSchema = Schema.Struct({
  observation: FinalizeInterviewObservationSchema,
  replayed: Schema.Boolean,
});

export type FinalizeInterviewResult = typeof FinalizeInterviewResultSchema.Type;

export const CancelInterviewResultSchema = Schema.Struct({
  observation: CancelInterviewObservationSchema,
  replayed: Schema.Boolean,
});

export type CancelInterviewResult = typeof CancelInterviewResultSchema.Type;

export const RecruitmentConductActorSchema = Schema.Struct({
  personId: PersonId,
  departmentId: DepartmentId,
  active: Schema.Boolean,
  membershipActive: Schema.Boolean,
  teamActive: Schema.Boolean,
  departmentActive: Schema.Boolean,
});

export type RecruitmentConductActor = typeof RecruitmentConductActorSchema.Type;

export interface RecruitmentConductState {
  readonly interview: RecruitmentInterviewValue;
  readonly schedule: RecruitmentInterviewScheduleValue | null;
  readonly invitationResponse: RecruitmentInvitationResponseState | null;
  readonly questions: ReadonlyArray<RecruitmentInterviewQuestionSnapshotValue>;
  readonly conduct: RecruitmentInterviewConductValue | null;
  readonly cancellation: RecruitmentInterviewCancellationValue | null;
  readonly revision: number;
}

export interface RecruitmentConductContext {
  readonly actor: RecruitmentActor;
  readonly now: string;
  readonly authorizationInstant?: string;
}

export const RecruitmentInterviewConductObservationSchema = Schema.Struct({
  interviewId: RecruitmentInterviewId,
  applicationId: PublicApplicationIdSchema,
  applicant: Schema.Struct({
    applicantId: ApplicantIdSchema,
    firstName: PublicApplicationNameSchema,
    lastName: PublicApplicationNameSchema,
  }),
  schedule: RecruitmentInterviewSchedule,
  invitationResponse: Schema.Literals(["Accepted"]),
  questions: Schema.Array(RecruitmentInterviewQuestionSnapshot),
  finalizedByPersonId: Schema.NullOr(PersonId),
  finalizedAt: Schema.NullOr(Rfc3339InstantSchema),
  answers: Schema.Array(RecruitmentInterviewAnswerSchema),
  score: Schema.NullOr(RecruitmentInterviewScoreSchema),
  recommendation: Schema.NullOr(InterviewRecommendationSchema),
  completionState: Schema.Literals(["NotCompleted", "Completed"]),
  cancellationState: Schema.Literals(["NotCancelled", "Cancelled"]),
  effectiveRevision: Revision,
  history: Schema.Array(RecruitmentInterviewCorrectionHistoryEntrySchema),
  cancelledAt: Schema.NullOr(Rfc3339InstantSchema),
  revision: Revision,
  canFinalize: Schema.Boolean,
  canCancel: Schema.Boolean,
});

export type RecruitmentInterviewConductObservation =
  typeof RecruitmentInterviewConductObservationSchema.Type;
