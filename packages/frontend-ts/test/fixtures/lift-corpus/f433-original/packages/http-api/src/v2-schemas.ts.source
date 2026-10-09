/** Public request and response schemas frozen by 0080.1. */
import { AdmissionPeriod, Rfc3339InstantSchema } from "@vektorprogrammet/domain/admission-period";
import {
  PublicApplicationConfirmationSchema,
  PublicApplicationSubmitInputSchema,
} from "@vektorprogrammet/domain/application";
import {
  ArticleDraft,
  ArticleId,
  ArticleVersionNumber,
  ContentArticleDetailSchema,
  PublishObservationSchema,
} from "@vektorprogrammet/domain/content";
import {
  Department,
  DepartmentId,
  FieldOfStudy,
  Team,
} from "@vektorprogrammet/domain/organization";
import { OwnProfile } from "@vektorprogrammet/domain/profile";
import {
  CancelInterviewObservationSchema,
  CorrectInterviewAssessmentCommandSchema,
  CorrectInterviewAssessmentObservationSchema,
  FinalizeInterviewCommandSchema,
  FinalizeInterviewObservationSchema,
  RecruitmentAssignmentCommandSchema,
  RecruitmentInterview,
  RecruitmentScheduleCommandSchema,
  RecruitmentScheduleObservationSchema,
} from "@vektorprogrammet/domain/recruitment";
import {
  Receipt,
  ReceiptSettlementCommandRequestSchema,
  ReceiptSettlementEvidenceSchema,
  isIsoDate,
} from "@vektorprogrammet/domain/receipt";
import { Schema } from "effect";
import { Multipart } from "effect/unstable/http";
import { HttpApiSchema } from "effect/unstable/httpapi";
import { StrongETag } from "./http-semantics.js";

const receiptDescriptionPart = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value !== "null", {
      message: "nonempty receipt description text",
    }),
  ),
);

const receiptAmountPart = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) => {
        const amount = Number(value);

        return value !== "null" && Number.isSafeInteger(amount) && amount > 0;
      },
      { message: "positive safe integer text" },
    ),
  ),
);

const receiptDatePart = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isIsoDate, { message: "a valid YYYY-MM-DD date" })),
);

/** Strict `{}` body for state transitions without public payload fields. */
export const EmptyJsonRequest = Schema.Struct({}).annotate({
  identifier: "EmptyJsonRequest",
  description: "An exact empty JSON object.",
});

export const CancelInterviewRequest = EmptyJsonRequest.annotate({
  identifier: "CancelInterviewRequest",
});

export const WithdrawReceiptRequest = EmptyJsonRequest.annotate({
  identifier: "WithdrawReceiptRequest",
});

export const ApproveReceiptRequest = EmptyJsonRequest.annotate({
  identifier: "ApproveReceiptRequest",
});

export const RecordReceiptSettlementRequest = Schema.Struct({
  expectedRevision:
    ReceiptSettlementCommandRequestSchema.cases.RecordReceiptSettlement.fields.expectedRevision,
  externalAuthority:
    ReceiptSettlementCommandRequestSchema.cases.RecordReceiptSettlement.fields.externalAuthority,
  externalReference:
    ReceiptSettlementCommandRequestSchema.cases.RecordReceiptSettlement.fields.externalReference,
  settledAt: ReceiptSettlementCommandRequestSchema.cases.RecordReceiptSettlement.fields.settledAt,
}).annotate({
  identifier: "RecordReceiptSettlementRequest",
});

export const RejectReceiptRequest = EmptyJsonRequest.annotate({
  identifier: "RejectReceiptRequest",
});

export const ReopenReceiptRequest = EmptyJsonRequest.annotate({
  identifier: "ReopenReceiptRequest",
});

export const PublishArticleRequest = EmptyJsonRequest.annotate({
  identifier: "PublishArticleRequest",
});

export const UnpublishArticleRequest = EmptyJsonRequest.annotate({
  identifier: "UnpublishArticleRequest",
});

export const CreateDepartmentRequest = Schema.Struct({
  ...Department.jsonCreate.fields,
}).annotate({ identifier: "CreateDepartmentRequest" });

export type CreateDepartmentRequest = typeof CreateDepartmentRequest.Type;

export const CreateTeamRequest = Schema.Struct({
  ...Team.jsonCreate.fields,
}).annotate({ identifier: "CreateTeamRequest" });

export type CreateTeamRequest = typeof CreateTeamRequest.Type;

export const CreateFieldOfStudyRequest = Schema.Struct({
  ...FieldOfStudy.jsonCreate.fields,
}).annotate({ identifier: "CreateFieldOfStudyRequest" });

export type CreateFieldOfStudyRequest = typeof CreateFieldOfStudyRequest.Type;

const applicationFields = PublicApplicationSubmitInputSchema.fields;

export const SubmitApplicationRequest = Schema.Struct({
  departmentId: applicationFields.departmentId,
  firstName: applicationFields.firstName,
  lastName: applicationFields.lastName,
  phone: applicationFields.phone,
  email: applicationFields.email,
  gender: applicationFields.gender,
  fieldOfStudyId: applicationFields.fieldOfStudyId,
  yearOfStudy: applicationFields.yearOfStudy,
  availability: applicationFields.availability,
}).annotate({ identifier: "SubmitApplicationRequest" });

export type SubmitApplicationRequest = typeof SubmitApplicationRequest.Type;

export const CreateAdmissionPeriodRequest = Schema.Struct({
  semesterId: AdmissionPeriod.jsonCreate.fields.semesterId,
  startAt: AdmissionPeriod.jsonCreate.fields.startAt,
  endAt: AdmissionPeriod.jsonCreate.fields.endAt,
  departmentId: AdmissionPeriod.jsonCreate.fields.departmentId,
}).annotate({ identifier: "CreateAdmissionPeriodRequest" });

export type CreateAdmissionPeriodRequest = typeof CreateAdmissionPeriodRequest.Type;

export const AdmissionPeriodMergePatch = Schema.Struct({
  startAt: Schema.optional(Schema.NullOr(Rfc3339InstantSchema)),
  endAt: Schema.optional(Schema.NullOr(Rfc3339InstantSchema)),
}).annotate({ identifier: "AdmissionPeriodMergePatch" });

export type AdmissionPeriodMergePatch = typeof AdmissionPeriodMergePatch.Type;

const assignmentFields = RecruitmentAssignmentCommandSchema.fields;

export const CreateApplicationInterviewRequest = Schema.Struct({
  interviewerPersonId: assignmentFields.interviewerPersonId,
  interviewSchemaId: assignmentFields.interviewSchemaId,
}).annotate({ identifier: "CreateApplicationInterviewRequest" });

export type CreateApplicationInterviewRequest = typeof CreateApplicationInterviewRequest.Type;

const scheduleFields = RecruitmentScheduleCommandSchema.fields;

export const ScheduleInterviewRequest = Schema.Struct({
  scheduledAt: scheduleFields.scheduledAt,
  room: scheduleFields.room,
  campus: scheduleFields.campus,
  mapLink: scheduleFields.mapLink,
  message: scheduleFields.message,
}).annotate({ identifier: "ScheduleInterviewRequest" });

export type ScheduleInterviewRequest = typeof ScheduleInterviewRequest.Type;

const finalizeFields = FinalizeInterviewCommandSchema.fields;

export const FinalizeInterviewRequest = Schema.Struct({
  answers: finalizeFields.answers,
  score: finalizeFields.score,
  recommendation: finalizeFields.recommendation,
}).annotate({ identifier: "FinalizeInterviewRequest" });

export type FinalizeInterviewRequest = typeof FinalizeInterviewRequest.Type;

const correctionFields = CorrectInterviewAssessmentCommandSchema.fields;

export const CorrectInterviewAssessmentRequest = Schema.Struct({
  expectedRevision: correctionFields.expectedRevision,
  answers: correctionFields.answers,
  score: correctionFields.score,
  recommendation: correctionFields.recommendation,
}).annotate({ identifier: "CorrectInterviewAssessmentRequest" });

export type CorrectInterviewAssessmentRequest = typeof CorrectInterviewAssessmentRequest.Type;

export const SubmitReceiptMultipartV2 = Schema.Struct({
  description: receiptDescriptionPart,
  amountOre: receiptAmountPart,
  receiptDate: receiptDatePart,
  file: Multipart.PersistedFileSchema,
})
  .pipe(HttpApiSchema.asMultipart())
  .annotate({ identifier: "SubmitReceiptMultipartV2" });

export const ReviseReceiptMultipartV2 = Schema.Struct({
  description: Schema.optional(receiptDescriptionPart),
  amountOre: Schema.optional(receiptAmountPart),
  receiptDate: Schema.optional(receiptDatePart),
  file: Schema.optional(Multipart.PersistedFileSchema),
})
  .pipe(
    Schema.check(
      Schema.makeFilter((value) => Object.keys(value).length > 0, {
        message: "at least one changed field",
      }),
    ),
    HttpApiSchema.asMultipart(),
  )
  .annotate({ identifier: "ReviseReceiptMultipartV2" });

export const CreateArticleRequest = Schema.Struct({
  title: ArticleDraft.jsonCreate.fields.title,
  bodyHtml: ArticleDraft.jsonCreate.fields.bodyHtml,
  departmentIds: Schema.Array(DepartmentId).pipe(
    Schema.check(
      Schema.makeFilter((values) => new Set(values).size === values.length, {
        message: "unique department identifiers",
      }),
    ),
  ),
  sticky: Schema.optional(ArticleDraft.jsonCreate.fields.sticky),
}).annotate({ identifier: "CreateArticleRequest" });

export type CreateArticleRequest = typeof CreateArticleRequest.Type;

export const ArticleMergePatch = Schema.Struct({
  title: Schema.optional(Schema.NullOr(ArticleDraft.jsonUpdate.fields.title)),
  bodyHtml: Schema.optional(Schema.NullOr(ArticleDraft.jsonUpdate.fields.bodyHtml)),
  departmentIds: Schema.optional(
    Schema.NullOr(
      Schema.Array(DepartmentId).pipe(
        Schema.check(
          Schema.makeFilter((values) => new Set(values).size === values.length, {
            message: "unique department identifiers",
          }),
        ),
      ),
    ),
  ),
  sticky: Schema.optional(Schema.NullOr(ArticleDraft.jsonUpdate.fields.sticky)),
}).annotate({ identifier: "ArticleMergePatch" });

export type ArticleMergePatch = typeof ArticleMergePatch.Type;

export const ProfileMergePatch = Schema.Struct({
  firstName: Schema.optional(Schema.NullOr(OwnProfile.fields.firstName)),
  lastName: Schema.optional(Schema.NullOr(OwnProfile.fields.lastName)),
  email: Schema.optional(Schema.NullOr(OwnProfile.fields.email)),
  phone: Schema.optional(Schema.NullOr(OwnProfile.fields.phone)),
}).annotate({ identifier: "ProfileMergePatch" });

export type ProfileMergePatch = typeof ProfileMergePatch.Type;

export const OpenAdmissionPeriod = Schema.Struct({
  id: AdmissionPeriod.json.fields.id,
  departmentId: AdmissionPeriod.json.fields.departmentId,
  semesterId: AdmissionPeriod.json.fields.semesterId,
  startAt: AdmissionPeriod.json.fields.startAt,
  endAt: AdmissionPeriod.json.fields.endAt,
}).annotate({ identifier: "OpenAdmissionPeriod" });

export type OpenAdmissionPeriod = typeof OpenAdmissionPeriod.Type;

export const OpenAdmissionPeriodListResponse = Schema.Struct({
  items: Schema.Array(OpenAdmissionPeriod),
  totalItems: Schema.Int,
}).annotate({ identifier: "OpenAdmissionPeriodListResponse" });

export const AdmissionPeriodManagementItem = Schema.Struct({
  id: AdmissionPeriod.json.fields.id,
  departmentId: AdmissionPeriod.json.fields.departmentId,
  semesterId: AdmissionPeriod.json.fields.semesterId,
  startAt: AdmissionPeriod.json.fields.startAt,
  endAt: AdmissionPeriod.json.fields.endAt,
  revision: AdmissionPeriod.json.fields.revision,
  etag: StrongETag,
}).annotate({ identifier: "AdmissionPeriodManagementItem" });

export const AdmissionPeriodManagementListResponse = Schema.Struct({
  items: Schema.Array(AdmissionPeriodManagementItem),
  totalItems: Schema.Int,
}).annotate({ identifier: "AdmissionPeriodManagementListResponse" });

export const RecruitmentInterviewResource = RecruitmentInterview.json.annotate({
  identifier: "RecruitmentInterviewResource",
});

export const ScheduleInterviewResponse = Schema.Struct({
  interviewId: RecruitmentScheduleObservationSchema.fields.interviewId,
  schedule: RecruitmentScheduleObservationSchema.fields.schedule,
  responseState: RecruitmentScheduleObservationSchema.fields.responseState,
  notificationState: RecruitmentScheduleObservationSchema.fields.notificationState,
}).annotate({ identifier: "ScheduleInterviewResponse" });

export const FinalizeInterviewResponse = Schema.Struct({
  interviewId: FinalizeInterviewObservationSchema.fields.interviewId,
  finalizedAt: FinalizeInterviewObservationSchema.fields.finalizedAt,
  completionState: FinalizeInterviewObservationSchema.fields.completionState,
  cancellationState: FinalizeInterviewObservationSchema.fields.cancellationState,
}).annotate({ identifier: "FinalizeInterviewResponse" });

export const CorrectInterviewAssessmentResponse = Schema.Struct({
  _tag: CorrectInterviewAssessmentObservationSchema.fields._tag,
  commandId: CorrectInterviewAssessmentObservationSchema.fields.commandId,
  interviewId: CorrectInterviewAssessmentObservationSchema.fields.interviewId,
  predecessorRevision: CorrectInterviewAssessmentObservationSchema.fields.predecessorRevision,
  resultingRevision: CorrectInterviewAssessmentObservationSchema.fields.resultingRevision,
  replayed: Schema.Boolean,
}).annotate({ identifier: "CorrectInterviewAssessmentResponse" });

export const CancelInterviewResponse = Schema.Struct({
  interviewId: CancelInterviewObservationSchema.fields.interviewId,
  cancelledAt: CancelInterviewObservationSchema.fields.cancelledAt,
  completionState: CancelInterviewObservationSchema.fields.completionState,
  cancellationState: CancelInterviewObservationSchema.fields.cancellationState,
}).annotate({ identifier: "CancelInterviewResponse" });

export const ReceiptResource = Schema.Struct({
  ...Receipt.json.fields,
  etag: StrongETag,
}).annotate({ identifier: "ReceiptResource" });

export const ReceiptSettlementEvidenceResource = ReceiptSettlementEvidenceSchema.annotate({
  identifier: "ReceiptSettlementEvidenceResource",
});

export const PublishArticleResponse = Schema.Struct({
  articleId: ArticleId,
  versionNumber: ArticleVersionNumber,
  publishedAt: PublishObservationSchema.fields.publishedAt,
}).annotate({ identifier: "PublishArticleResponse" });

export const UnpublishArticleResponse = Schema.Struct({
  articleId: ArticleId,
}).annotate({ identifier: "UnpublishArticleResponse" });

export { ContentArticleDetailSchema, PublicApplicationConfirmationSchema };
