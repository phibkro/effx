/**
 * Public schemas for application submission, confirmation, and management.
 *
 * @since 0.1.0
 */
import { Schema } from "effect";
import { Model } from "effect/unstable/schema";
import {
  AdmissionDepartment,
  AdmissionFieldOfStudy,
  AdmissionFieldOfStudyId,
  AdmissionPeriod,
  AdmissionPeriodId,
} from "../admission-period/schema.js";
import { DepartmentId, PersonId, SemesterId } from "../organization/schema.js";
import { AssistantAvailabilitySchema } from "./availability.js";
import { isRfc3339Instant, Rfc3339InstantSchema } from "../time.js";

/** Stable IDs are opaque, non-empty, and free of control characters. */
const StableApplicationIdSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(value), {
      message: "a non-empty stable identifier",
    }),
  ),
);

export const PublicApplicationIdSchema = StableApplicationIdSchema.pipe(
  Schema.brand("PublicApplicationId"),
);

export type PublicApplicationId = typeof PublicApplicationIdSchema.Type;

export const ApplicantIdSchema = StableApplicationIdSchema.pipe(Schema.brand("ApplicantId"));

export type ApplicantId = typeof ApplicantIdSchema.Type;

export const PublicApplicationCommandIdSchema = StableApplicationIdSchema.pipe(
  Schema.brand("PublicApplicationCommandId"),
);

export type PublicApplicationCommandId = typeof PublicApplicationCommandIdSchema.Type;

export const PublicApplicationEffectIdSchema = StableApplicationIdSchema.pipe(
  Schema.brand("PublicApplicationEffectId"),
);

export type PublicApplicationEffectId = typeof PublicApplicationEffectIdSchema.Type;

export const isPublicApplicationName = (value: string): boolean => {
  const normalized = value.trim();

  return (
    normalized.length > 0 &&
    Array.from(normalized).length <= 100 &&
    !/[\p{Cc}\p{Cf}]/u.test(normalized)
  );
};

export const isPublicApplicationPhone = (value: string): boolean => {
  const normalized = value.trim();

  return (
    normalized.length > 0 &&
    Array.from(normalized).length <= 32 &&
    !/[\p{Cc}\p{Cf}]/u.test(normalized)
  );
};

export const isPublicApplicationEmail = (value: string): boolean => {
  const normalized = value.trim();

  return (
    normalized.length > 0 &&
    Array.from(normalized).length <= 254 &&
    !/[\p{Cc}\p{Cf}\s]/u.test(normalized) &&
    /^[^@]+@[^@]+\.[^@]+$/u.test(normalized)
  );
};

export const PublicApplicationNameSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isPublicApplicationName, { message: "a valid name" })),
);

export const PublicApplicationPhoneSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isPublicApplicationPhone, { message: "a valid phone" })),
);

export const PublicApplicationEmailSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isPublicApplicationEmail, { message: "a valid email" })),
);

export const PublicApplicationGenderSchema = Schema.Literals([0, 1]);

export type PublicApplicationGender = typeof PublicApplicationGenderSchema.Type;

export const PublicApplicationYearOfStudySchema = Schema.Int.pipe(
  Schema.check(
    Schema.makeFilter((value) => value >= 1 && value <= 5, { message: "a year from 1 to 5" }),
  ),
);

const Sha256Schema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[a-f0-9]{64}$/u.test(value), { message: "a SHA-256 digest" }),
  ),
);

export const isPublicApplicationInstant = isRfc3339Instant;

export const PublicApplicationInstantSchema = Rfc3339InstantSchema;

export type PublicApplicationInstant = typeof PublicApplicationInstantSchema.Type;

export class ApplicantRecord extends Model.Class<ApplicantRecord>("ApplicantRecord")({
  id: Model.Field({
    select: ApplicantIdSchema,
    insert: ApplicantIdSchema,
    json: ApplicantIdSchema,
  }),
  normalizedEmail: Model.Field({
    select: PublicApplicationEmailSchema,
    insert: PublicApplicationEmailSchema,
  }),
  email: Model.Sensitive(PublicApplicationEmailSchema),
  firstName: Model.Field({
    select: PublicApplicationNameSchema,
    insert: PublicApplicationNameSchema,
    update: PublicApplicationNameSchema,
    json: PublicApplicationNameSchema,
    jsonCreate: PublicApplicationNameSchema,
    jsonUpdate: PublicApplicationNameSchema,
  }),
  lastName: Model.Field({
    select: PublicApplicationNameSchema,
    insert: PublicApplicationNameSchema,
    update: PublicApplicationNameSchema,
    json: PublicApplicationNameSchema,
    jsonCreate: PublicApplicationNameSchema,
    jsonUpdate: PublicApplicationNameSchema,
  }),
  phone: Model.Field({
    select: PublicApplicationPhoneSchema,
    insert: PublicApplicationPhoneSchema,
    update: PublicApplicationPhoneSchema,
    json: PublicApplicationPhoneSchema,
    jsonCreate: PublicApplicationPhoneSchema,
    jsonUpdate: PublicApplicationPhoneSchema,
  }),
  gender: Model.Field({
    select: PublicApplicationGenderSchema,
    insert: PublicApplicationGenderSchema,
    update: PublicApplicationGenderSchema,
    json: PublicApplicationGenderSchema,
    jsonCreate: PublicApplicationGenderSchema,
    jsonUpdate: PublicApplicationGenderSchema,
  }),
  fieldOfStudyId: Model.Field({
    select: AdmissionFieldOfStudyId,
    insert: AdmissionFieldOfStudyId,
    update: AdmissionFieldOfStudyId,
    json: AdmissionFieldOfStudyId,
    jsonCreate: AdmissionFieldOfStudyId,
    jsonUpdate: AdmissionFieldOfStudyId,
  }),
  yearOfStudy: Model.Field({
    select: PublicApplicationYearOfStudySchema,
    insert: PublicApplicationYearOfStudySchema,
    update: PublicApplicationYearOfStudySchema,
    json: PublicApplicationYearOfStudySchema,
    jsonCreate: PublicApplicationYearOfStudySchema,
    jsonUpdate: PublicApplicationYearOfStudySchema,
  }),
  activationDigest: Model.Sensitive(Schema.NullOr(Sha256Schema)),
}) {}

/** Model-derived non-email applicant boundary used by effect payload construction. */
export const ApplicantSchema = ApplicantRecord.json;

export type Applicant = typeof ApplicantSchema.Type;

export const ApplicantRecordSchema = ApplicantRecord;

export class PublicApplication extends Model.Class<PublicApplication>("PublicApplication")({
  id: Model.Field({
    select: PublicApplicationIdSchema,
    insert: PublicApplicationIdSchema,
    json: PublicApplicationIdSchema,
  }),
  applicantId: Model.Field({
    select: ApplicantIdSchema,
    insert: ApplicantIdSchema,
    json: ApplicantIdSchema,
  }),
  admissionPeriodId: Model.Field({
    select: AdmissionPeriodId,
    insert: AdmissionPeriodId,
    json: AdmissionPeriodId,
  }),
  departmentId: Model.Field({
    select: DepartmentId,
    insert: DepartmentId,
    json: DepartmentId,
  }),
  fieldOfStudyId: Model.Field({
    select: AdmissionFieldOfStudyId,
    insert: AdmissionFieldOfStudyId,
    json: AdmissionFieldOfStudyId,
  }),
  yearOfStudy: Model.Field({
    select: PublicApplicationYearOfStudySchema,
    insert: PublicApplicationYearOfStudySchema,
    update: PublicApplicationYearOfStudySchema,
    json: PublicApplicationYearOfStudySchema,
  }),
  submittedAt: Model.Field({
    select: PublicApplicationInstantSchema,
    insert: PublicApplicationInstantSchema,
    json: PublicApplicationInstantSchema,
  }),
  revision: Model.Field({
    select: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    insert: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
    json: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  /** Private and immutable: database select/insert only, with no update or JSON variant. */
  activationDigest: Model.Field({
    select: Schema.NullOr(Sha256Schema),
    insert: Schema.NullOr(Sha256Schema),
  }),
  /**
   * What the applicant states about weekdays, blocks, and teaching language. A public
   * application states it. It is null for an application submitted before the form asked,
   * and for the application of a returning registration, which states it itself.
   */
  availability: Model.Field({
    select: Schema.NullOr(AssistantAvailabilitySchema),
    insert: AssistantAvailabilitySchema,
  }),
}) {}

export const PublicApplicationSchema = PublicApplication;

/**
 * Admissions-owned applicant contact projection. The application identity is the lookup key;
 * every field is derived from the persisted application and applicant Models.
 */
export const ApplicantContactProjectionSchema = Schema.Struct({
  applicationId: PublicApplication.fields.id,
  applicantId: ApplicantRecord.fields.id,
  firstName: ApplicantRecord.fields.firstName,
  lastName: ApplicantRecord.fields.lastName,
  email: ApplicantRecord.fields.email,
  phone: ApplicantRecord.fields.phone,
});

export type ApplicantContactProjection = typeof ApplicantContactProjectionSchema.Type;

const ApplicantCreateFields = ApplicantRecord.jsonCreate.fields;

const ApplicantInsertFields = ApplicantRecord.insert.fields;

/** Exact public request body. No `_tag`, applicant, period, or status fields are accepted. */
const SubmitPublicApplicationFields = {
  commandId: PublicApplicationCommandIdSchema,
  departmentId: DepartmentId,
  firstName: ApplicantCreateFields.firstName,
  lastName: ApplicantCreateFields.lastName,
  phone: ApplicantCreateFields.phone,
  email: ApplicantInsertFields.email,
  gender: ApplicantCreateFields.gender,
  fieldOfStudyId: ApplicantCreateFields.fieldOfStudyId,
  yearOfStudy: ApplicantCreateFields.yearOfStudy,
  availability: AssistantAvailabilitySchema,
};

export const PublicApplicationSubmitInputSchema = Schema.Struct(SubmitPublicApplicationFields);

export type PublicApplicationSubmitInput = typeof PublicApplicationSubmitInputSchema.Type;

export const SubmitPublicApplicationInputSchema = PublicApplicationSubmitInputSchema;

export type SubmitPublicApplicationInput = PublicApplicationSubmitInput;

export const PublicApplicationActivationTokenSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[A-Za-z0-9_-]{43,128}$/u.test(value), {
      message: "a server-generated activation token",
    }),
  ),
);

export type PublicApplicationActivationToken = typeof PublicApplicationActivationTokenSchema.Type;

export const SubmitPublicApplicationCommandSchema = Schema.TaggedUnion({
  SubmitPublicApplication: SubmitPublicApplicationFields,
});

export type SubmitPublicApplicationCommand = typeof SubmitPublicApplicationCommandSchema.Type;

export const PublicApplicationSubmitObservationSchema = Schema.TaggedUnion({
  Submitted: {
    commandId: PublicApplicationCommandIdSchema,
    applicationId: PublicApplicationIdSchema,
  },
});

export type PublicApplicationSubmitObservation =
  typeof PublicApplicationSubmitObservationSchema.Type;

export const PublicApplicationObservationSchema = PublicApplicationSubmitObservationSchema;

export type PublicApplicationObservation = PublicApplicationSubmitObservation;

export const PublicApplicationConfirmationSchema = Schema.TaggedStruct("ApplicationConfirmed", {
  applicationId: PublicApplicationIdSchema,
});

export type PublicApplicationConfirmation = typeof PublicApplicationConfirmationSchema.Type;

export const ApplicantInterviewScheduleSchema = Schema.Struct({
  scheduledAt: Rfc3339InstantSchema,
  room: Schema.NonEmptyString,
  campus: Schema.NullOr(Schema.NonEmptyString),
  mapLink: Schema.NullOr(Schema.String),
});

export type ApplicantInterviewSchedule = typeof ApplicantInterviewScheduleSchema.Type;

export const ApplicantProgressStateSchema = Schema.TaggedUnion({
  ApplicationReceived: {},
  InvitedToInterview: {
    schedule: ApplicantInterviewScheduleSchema,
  },
  InterviewAccepted: {
    schedule: ApplicantInterviewScheduleSchema,
  },
  AwaitingNewInterviewTime: {},
  Cancelled: {},
  InterviewCompleted: {},
  ReturningRegistrationCompleted: {},
  AffiliationPending: {},
  AffiliationActive: {},
  AssignedToSchool: {},
});

export type ApplicantProgressState = typeof ApplicantProgressStateSchema.Type;

export const ApplicantProgressItemSchema = Schema.Struct({
  applicationId: PublicApplicationIdSchema,
  admissionPeriodId: AdmissionPeriodId,
  departmentId: DepartmentId,
  departmentName: Schema.NonEmptyString,
  semesterId: SemesterId,
  submittedAt: Rfc3339InstantSchema,
  progress: ApplicantProgressStateSchema,
});

export type ApplicantProgressItem = typeof ApplicantProgressItemSchema.Type;

export const ApplicantProgressResponseSchema = Schema.Struct({
  personId: PersonId,
  observedAt: Rfc3339InstantSchema,
  applications: Schema.Array(ApplicantProgressItemSchema),
});

export type ApplicantProgressResponse = typeof ApplicantProgressResponseSchema.Type;

export const decodeApplicantProgressResponse = Schema.decodeUnknownSync(
  ApplicantProgressResponseSchema,
  {
    onExcessProperty: "error",
  },
);

export const PublicApplicationFieldOfStudySchema = Schema.Struct({
  fieldOfStudyId: AdmissionFieldOfStudy.json.fields.fieldOfStudyId,
  name: AdmissionFieldOfStudy.json.fields.name,
});

export type PublicApplicationFieldOfStudy = typeof PublicApplicationFieldOfStudySchema.Type;

export const PublicApplicationCatalogDepartmentSchema = Schema.Struct({
  departmentId: AdmissionDepartment.json.fields.departmentId,
  name: AdmissionDepartment.json.fields.name,
  closesAt: AdmissionPeriod.json.fields.endAt,
  fieldsOfStudy: Schema.Array(PublicApplicationFieldOfStudySchema),
});

export type PublicApplicationCatalogDepartment =
  typeof PublicApplicationCatalogDepartmentSchema.Type;

export const PublicApplicationCatalogSchema = Schema.Struct({
  departments: Schema.Array(PublicApplicationCatalogDepartmentSchema),
});

export type PublicApplicationCatalog = typeof PublicApplicationCatalogSchema.Type;

export interface PublicApplicationCatalogHttpSource {
  readonly catalog: PublicApplicationCatalog;
  readonly validatorSource: {
    readonly intervalIdentity: string;
    readonly itemRevisions: ReadonlyArray<readonly [identity: string, revision: number]>;
  };
}

export interface PublicApplicationCatalogContext {
  readonly now: string;
}

export interface PublicApplicationSubmitContext {
  readonly now: string;
  /** Optional server-generated opaque ID. It is never accepted from the public body. */
  readonly applicationId?: PublicApplicationId;
  /** Optional server-owned applicant identity hint for a new normalized email. */
  readonly applicantId?: ApplicantId;
  /** Server-generated token for a new or inactive applicant. */
  readonly activationToken: string;
}

export interface PublicApplicationSubmitResult {
  readonly observation: PublicApplicationSubmitObservation;
  readonly replayed: boolean;
  readonly outboxCount: number;
}

export const decodePublicApplicationConfirmation = Schema.decodeUnknownEffect(
  PublicApplicationConfirmationSchema,
  {
    onExcessProperty: "error",
  },
);
