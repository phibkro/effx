import { Schema } from "effect";
import {
  PublicApplicationEmailSchema,
  PublicApplicationIdSchema,
  PublicApplicationPhoneSchema,
} from "../application/schema.js";
import { PersonContactEmail, PersonContactPhone } from "../profile/schema.js";
import {
  RecruitmentConductCommandId,
  RecruitmentInvitationId,
  RecruitmentInvitationResponseMessageSchema,
  RecruitmentInterviewSchedule,
  RecruitmentInstantSchema,
  RecruitmentNotificationEffectId,
  RecruitmentScheduleCommandId,
  RecruitmentInterviewId,
} from "./schema.js";

const NonEmpty = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0, { message: "a non-empty value" }),
  ),
);

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0)));

export const RecruitmentInvitationOutboxRequestSchema = Schema.TaggedStruct(
  "SendInterviewInvitation",
  {
    effectId: RecruitmentNotificationEffectId,
    commandId: RecruitmentScheduleCommandId,
    interviewId: RecruitmentInterviewId,
    invitationId: RecruitmentInvitationId,
    scheduleRevision: Revision,
    applicantEmail: PublicApplicationEmailSchema,
    applicantPhone: PublicApplicationPhoneSchema,
    interviewerDisplayName: NonEmpty,
    interviewerEmail: PersonContactEmail,
    interviewerPhone: PersonContactPhone,
    scheduledAt: RecruitmentInterviewSchedule.fields.scheduledAt,
    room: RecruitmentInterviewSchedule.fields.room,
    campus: RecruitmentInterviewSchedule.fields.campus,
    mapLink: RecruitmentInterviewSchedule.fields.mapLink,
    message: RecruitmentInterviewSchedule.fields.message,
    responseCapability: NonEmpty,
  },
);

export const RecruitmentInterviewCompletionOutboxRequestSchema = Schema.TaggedStruct(
  "SendInterviewCompletionReceipt",
  {
    effectId: RecruitmentNotificationEffectId,
    commandId: RecruitmentConductCommandId,
    interviewId: RecruitmentInterviewId,
    applicationId: PublicApplicationIdSchema,
    interviewRevision: Revision,
    applicantDisplayName: NonEmpty,
    applicantEmail: PublicApplicationEmailSchema,
    interviewerDisplayName: NonEmpty,
    interviewerEmail: PersonContactEmail,
  },
);

export type RecruitmentInterviewCompletionOutboxRequest =
  typeof RecruitmentInterviewCompletionOutboxRequestSchema.Type;

export type RecruitmentInvitationOutboxRequest =
  typeof RecruitmentInvitationOutboxRequestSchema.Type;

export const RecruitmentInvitationResponseOutboxRequestFieldSchemas = {
  effectId: RecruitmentNotificationEffectId,
  invitationId: RecruitmentInvitationId,
  interviewId: RecruitmentInterviewId,
  scheduleRevision: Revision,
  responseRevision: Revision,
  applicantDisplayName: NonEmpty,
  interviewerEmail: PersonContactEmail,
  interviewerPhone: PersonContactPhone,
  scheduledAt: RecruitmentInterviewSchedule.fields.scheduledAt,
};

export const RecruitmentInvitationResponseOutboxRequestSchema = Schema.Union([
  Schema.TaggedStruct("SendInterviewInvitationResponse", {
    ...RecruitmentInvitationResponseOutboxRequestFieldSchemas,
    responseState: Schema.Literals(["Rejected"]),
    responseMessage: Schema.NullOr(RecruitmentInvitationResponseMessageSchema),
  }),
  Schema.TaggedStruct("SendInterviewInvitationResponse", {
    ...RecruitmentInvitationResponseOutboxRequestFieldSchemas,
    responseState: Schema.Literals(["RequestedNewTime"]),
    responseMessage: RecruitmentInvitationResponseMessageSchema,
  }),
]);

export type RecruitmentInvitationResponseOutboxRequest =
  typeof RecruitmentInvitationResponseOutboxRequestSchema.Type;

export const RecruitmentNotificationEvidenceSchema = Schema.Struct({
  effectId: RecruitmentNotificationEffectId,
  deliveredAt: RecruitmentInstantSchema,
  providerReference: NonEmpty,
});

export type RecruitmentNotificationEvidence = typeof RecruitmentNotificationEvidenceSchema.Type;

export class RecruitmentNotificationDeliveryError extends Schema.TaggedError<RecruitmentNotificationDeliveryError>()(
  "RecruitmentNotificationDeliveryError",
  {
    effectId: RecruitmentNotificationEffectId,
    message: NonEmpty,
  },
) {}
