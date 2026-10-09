import { Context, Data, Effect, Schema } from "effect";
import {
  AdmissionPeriodId,
  AdmissionPeriodProjectionSchema,
  AdmissionFieldOfStudyId,
} from "../admission-period/schema.js";
import { AssistantAvailabilityFields } from "./availability.js";
import {
  ApplicantIdSchema,
  PublicApplicationIdSchema,
  PublicApplicationYearOfStudySchema,
} from "./schema.js";
import { DepartmentId, PersonId, TeamId } from "../organization/schema.js";

export const ReturningRegistrationIdSchema = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^returning-registration-[a-f0-9]{64}$/)),
  Schema.brand("ReturningRegistrationId"),
);

export type ReturningRegistrationId = typeof ReturningRegistrationIdSchema.Type;

export const ReturningCommandIdSchema = Schema.String.pipe(
  Schema.check(Schema.makeFilter((value) => value.trim().length > 0, { message: "command id" })),
  Schema.brand("ReturningCommandId"),
);

export type ReturningCommandId = typeof ReturningCommandIdSchema.Type;

/** A school the assistant wishes to return to, as the legacy registration asked it. */
const PreferredSchool = Schema.NullOr(Schema.String.pipe(Schema.check(Schema.isMaxLength(255))));

const TeamIds = Schema.Array(TeamId).pipe(
  Schema.check(
    Schema.makeFilter((ids) => new Set(ids).size === ids.length, { message: "unique team ids" }),
  ),
);

const ReturningPreferenceFields = {
  yearOfStudy: PublicApplicationYearOfStudySchema,
  ...AssistantAvailabilityFields,
  preferredSchool: PreferredSchool,
  teamInterest: Schema.Boolean,
  teamIds: TeamIds,
};

export const ReturningAssistantPreferencesSchema = Schema.Struct(ReturningPreferenceFields);

export type ReturningAssistantPreferences = typeof ReturningAssistantPreferencesSchema.Type;

export const ReturningAssistantRegistrationInputSchema = Schema.Struct({
  commandId: ReturningCommandIdSchema,
  admissionPeriodId: AdmissionPeriodId,
  expectedRevision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  ...ReturningPreferenceFields,
});

export type ReturningAssistantRegistrationInput =
  typeof ReturningAssistantRegistrationInputSchema.Type;

export const ReturningAssistantPreferencesSnapshotSchema = Schema.Struct({
  registrationId: ReturningRegistrationIdSchema,
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  ...ReturningPreferenceFields,
});

export type ReturningAssistantPreferencesSnapshot =
  typeof ReturningAssistantPreferencesSnapshotSchema.Type;

export const ReturningAssistantPeriodOptionSchema = Schema.Struct({
  period: AdmissionPeriodProjectionSchema,
  semesterName: Schema.String,
  currentRevision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
  currentPreferences: Schema.NullOr(ReturningAssistantPreferencesSnapshotSchema),
});

export type ReturningAssistantPeriodOption = typeof ReturningAssistantPeriodOptionSchema.Type;

export const ReturningAssistantOptionsSchema = Schema.Struct({
  personId: PersonId,
  applicantId: ApplicantIdSchema,
  departmentId: DepartmentId,
  fieldOfStudyId: AdmissionFieldOfStudyId,
  periods: Schema.Array(ReturningAssistantPeriodOptionSchema),
  teams: Schema.Array(Schema.Struct({ teamId: TeamId, name: Schema.String })),
});

export type ReturningAssistantOptions = typeof ReturningAssistantOptionsSchema.Type;

export const ReturningAssistantObservationSchema = Schema.TaggedStruct(
  "ReturningAssistantRegistered",
  {
    commandId: ReturningCommandIdSchema,
    applicationId: PublicApplicationIdSchema,
    registrationId: ReturningRegistrationIdSchema,
    revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  },
);

export type ReturningAssistantObservation = typeof ReturningAssistantObservationSchema.Type;

export const ReturningAssistantRegistrationResponseSchema = Schema.Struct({
  observation: ReturningAssistantObservationSchema,
  replayed: Schema.Boolean,
  outboxCount: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});

export type ReturningAssistantRegistrationResponse =
  typeof ReturningAssistantRegistrationResponseSchema.Type;

export class ReturningAssistantDecodeError extends Data.TaggedError(
  "ReturningAssistantDecodeError",
)<{
  readonly message: string;
}> {}

export class ReturningAssistantUnauthenticated extends Data.TaggedError(
  "ReturningAssistantUnauthenticated",
)<{}> {}

export class ReturningAssistantIdentityMissing extends Data.TaggedError(
  "ReturningAssistantIdentityMissing",
)<{}> {}

export class ReturningAssistantIdentityAmbiguous extends Data.TaggedError(
  "ReturningAssistantIdentityAmbiguous",
)<{}> {}

export class ReturningAssistantHistoryMissing extends Data.TaggedError(
  "ReturningAssistantHistoryMissing",
)<{}> {}

export class ReturningAssistantStudyMappingInvalid extends Data.TaggedError(
  "ReturningAssistantStudyMappingInvalid",
)<{}> {}

export class ReturningAssistantPeriodUnavailable extends Data.TaggedError(
  "ReturningAssistantPeriodUnavailable",
)<{}> {}

export class ReturningAssistantTeamScopeDenied extends Data.TaggedError(
  "ReturningAssistantTeamScopeDenied",
)<{}> {}

export class ReturningAssistantDuplicate extends Data.TaggedError(
  "ReturningAssistantDuplicate",
)<{}> {}

export class ReturningAssistantRevisionConflict extends Data.TaggedError(
  "ReturningAssistantRevisionConflict",
)<{
  readonly expectedRevision: number;
  readonly currentRevision: number;
}> {}

export class ReturningAssistantCommandConflict extends Data.TaggedError(
  "ReturningAssistantCommandConflict",
)<{}> {}

export class ReturningAssistantPersistenceError extends Data.TaggedError(
  "ReturningAssistantPersistenceError",
)<{
  readonly operation: string;
  readonly cause?: unknown;
}> {}

export type ReturningAssistantError =
  | ReturningAssistantDecodeError
  | ReturningAssistantUnauthenticated
  | ReturningAssistantIdentityMissing
  | ReturningAssistantIdentityAmbiguous
  | ReturningAssistantHistoryMissing
  | ReturningAssistantStudyMappingInvalid
  | ReturningAssistantPeriodUnavailable
  | ReturningAssistantTeamScopeDenied
  | ReturningAssistantDuplicate
  | ReturningAssistantRevisionConflict
  | ReturningAssistantCommandConflict
  | ReturningAssistantPersistenceError;

export interface ReturningAssistantOperations {
  readonly readOptions: (input: {
    readonly personId: PersonId;
    readonly now: string | (() => string);
  }) => Effect.Effect<ReturningAssistantOptions, ReturningAssistantError>;
  readonly preflight: (
    input: Pick<ReturningAssistantRegistrationInput, "admissionPeriodId" | "teamIds">,
    context: { readonly personId: PersonId; readonly now: string | (() => string) },
  ) => Effect.Effect<void, ReturningAssistantError>;
  readonly register: (
    input: ReturningAssistantRegistrationInput,
    context: { readonly personId: PersonId; readonly now: string | (() => string) },
  ) => Effect.Effect<
    {
      readonly observation: ReturningAssistantObservation;
      readonly replayed: boolean;
      readonly outboxCount: number;
    },
    ReturningAssistantError
  >;
}

export class ReturningAssistants extends Context.Service<
  ReturningAssistants,
  ReturningAssistantOperations
>()("@vektorprogrammet/domain/ReturningAssistants") {}
