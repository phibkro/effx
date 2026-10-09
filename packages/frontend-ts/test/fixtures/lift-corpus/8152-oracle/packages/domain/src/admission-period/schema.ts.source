/**
 * Public identities, models, commands, and observations for admission periods.
 *
 * @since 0.1.0
 */
import { Schema } from "effect";
import { Model } from "effect/unstable/schema";
import { DepartmentId, PersonId, SemesterId } from "../organization/schema.js";
import { Rfc3339InstantSchema } from "../time.js";

export { Rfc3339InstantSchema, isRfc3339Instant } from "../time.js";

const NonEmptyIdSchema = Schema.NonEmptyString;

export const AdmissionPeriodId = NonEmptyIdSchema.pipe(Schema.brand("AdmissionPeriodId"));

export type AdmissionPeriodId = typeof AdmissionPeriodId.Type;

export const AdmissionFieldOfStudyId = NonEmptyIdSchema.pipe(
  Schema.brand("AdmissionFieldOfStudyId"),
);

export type AdmissionFieldOfStudyId = typeof AdmissionFieldOfStudyId.Type;

export const AdmissionPeriodCommandId = NonEmptyIdSchema.pipe(
  Schema.brand("AdmissionPeriodCommandId"),
);

export type AdmissionPeriodCommandId = typeof AdmissionPeriodCommandId.Type;

export const AdmissionPeriodEffectId = NonEmptyIdSchema.pipe(
  Schema.brand("AdmissionPeriodEffectId"),
);

export type AdmissionPeriodEffectId = typeof AdmissionPeriodEffectId.Type;

export const RevisionSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const ReferenceNameSchema = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0, { message: "a non-empty name" }),
  ),
);

export class AdmissionDepartment extends Model.Class<AdmissionDepartment>("AdmissionDepartment")({
  departmentId: Model.Field({
    select: DepartmentId,
    insert: DepartmentId,
    json: DepartmentId,
  }),
  name: Model.Field({
    select: ReferenceNameSchema,
    insert: ReferenceNameSchema,
    json: ReferenceNameSchema,
  }),
}) {}

export class AdmissionSemester extends Model.Class<AdmissionSemester>("AdmissionSemester")({
  semesterId: Model.Field({
    select: SemesterId,
    insert: SemesterId,
    json: SemesterId,
  }),
  startAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
    json: Rfc3339InstantSchema,
  }),
  endAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
    json: Rfc3339InstantSchema,
  }),
}) {}

export class AdmissionFieldOfStudy extends Model.Class<AdmissionFieldOfStudy>(
  "AdmissionFieldOfStudy",
)({
  fieldOfStudyId: Model.Field({
    select: AdmissionFieldOfStudyId,
    insert: AdmissionFieldOfStudyId,
    json: AdmissionFieldOfStudyId,
  }),
  departmentId: Model.Field({
    select: DepartmentId,
    insert: DepartmentId,
    json: DepartmentId,
  }),
  name: Model.Field({
    select: ReferenceNameSchema,
    insert: ReferenceNameSchema,
    json: ReferenceNameSchema,
  }),
  active: Model.Field({
    select: Schema.Boolean,
    insert: Schema.Boolean,
    json: Schema.Boolean,
  }),
}) {}

export class AdmissionPeriod extends Model.Class<AdmissionPeriod>("AdmissionPeriod")({
  id: Model.Field({
    select: AdmissionPeriodId,
    insert: AdmissionPeriodId,
    json: AdmissionPeriodId,
  }),
  departmentId: Model.Field({
    select: DepartmentId,
    insert: DepartmentId,
    json: DepartmentId,
    jsonCreate: Schema.optional(DepartmentId),
  }),
  semesterId: Model.Field({
    select: SemesterId,
    insert: SemesterId,
    json: SemesterId,
    jsonCreate: SemesterId,
  }),
  startAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
    update: Rfc3339InstantSchema,
    json: Rfc3339InstantSchema,
    jsonCreate: Rfc3339InstantSchema,
    jsonUpdate: Rfc3339InstantSchema,
  }),
  endAt: Model.Field({
    select: Rfc3339InstantSchema,
    insert: Rfc3339InstantSchema,
    update: Rfc3339InstantSchema,
    json: Rfc3339InstantSchema,
    jsonCreate: Rfc3339InstantSchema,
    jsonUpdate: Rfc3339InstantSchema,
  }),
  revision: Model.GeneratedByApp(RevisionSchema),
  lastCommandId: Model.GeneratedByApp(AdmissionPeriodCommandId),
}) {}

export const AdmissionPeriodSchema = AdmissionPeriod;

export const AdmissionSemesterSchema = AdmissionSemester;

export const AdmissionDepartmentSchema = AdmissionDepartment;

export const AdmissionFieldOfStudySchema = AdmissionFieldOfStudy;

export const AdmissionPeriodActorSchema = Schema.TaggedUnion({
  DepartmentAdministrator: {
    personId: PersonId,
    departmentId: DepartmentId,
    active: Schema.Boolean,
  },
  Member: {
    personId: PersonId,
    departmentId: DepartmentId,
    active: Schema.Boolean,
  },
  GlobalAdmin: {
    personId: PersonId,
    active: Schema.Boolean,
  },
});

export type AdmissionPeriodActor = typeof AdmissionPeriodActorSchema.Type;

const AdmissionPeriodCreateFields = AdmissionPeriod.jsonCreate.fields;

const AdmissionPeriodUpdateFields = AdmissionPeriod.jsonUpdate.fields;

const CreateAdmissionPeriodFields = {
  commandId: AdmissionPeriodCommandId,
  semesterId: AdmissionPeriodCreateFields.semesterId,
  startAt: AdmissionPeriodCreateFields.startAt,
  endAt: AdmissionPeriodCreateFields.endAt,
  departmentId: AdmissionPeriodCreateFields.departmentId,
};

/** Exact create command body; department is omitted for department-scoped actors. */
export const CreateAdmissionPeriodInputSchema = Schema.Struct(CreateAdmissionPeriodFields);

export type CreateAdmissionPeriodInput = typeof CreateAdmissionPeriodInputSchema.Type;

const ReviseAdmissionPeriodFields = {
  commandId: AdmissionPeriodCommandId,
  admissionPeriodId: AdmissionPeriod.json.fields.id,
  expectedRevision: AdmissionPeriod.update.fields.revision,
  startAt: AdmissionPeriodUpdateFields.startAt,
  endAt: AdmissionPeriodUpdateFields.endAt,
};

export const ReviseAdmissionPeriodInputSchema = Schema.Struct(ReviseAdmissionPeriodFields);

export type ReviseAdmissionPeriodInput = typeof ReviseAdmissionPeriodInputSchema.Type;

export const AdmissionPeriodCommandSchema = Schema.TaggedUnion({
  CreateAdmissionPeriod: CreateAdmissionPeriodFields,
  ReviseAdmissionPeriod: ReviseAdmissionPeriodFields,
});

export type AdmissionPeriodCommand = typeof AdmissionPeriodCommandSchema.Type;

export const AdmissionPeriodProjectionSchema = Schema.Struct({
  ...AdmissionPeriod.json.fields,
  eligible: Schema.Boolean,
});

export type AdmissionPeriodProjection = typeof AdmissionPeriodProjectionSchema.Type;

const CreatedObservationSchema = Schema.TaggedStruct("Created", {
  commandId: AdmissionPeriodCommandId,
  period: AdmissionPeriod,
});

const RevisedObservationSchema = Schema.TaggedStruct("Revised", {
  commandId: AdmissionPeriodCommandId,
  period: AdmissionPeriod,
});

export const AdmissionPeriodObservationSchema = Schema.TaggedUnion({
  Created: {
    commandId: AdmissionPeriodCommandId,
    period: AdmissionPeriod,
  },
  Revised: {
    commandId: AdmissionPeriodCommandId,
    period: AdmissionPeriod,
  },
  Replayed: {
    commandId: AdmissionPeriodCommandId,
    original: Schema.Union([CreatedObservationSchema, RevisedObservationSchema]),
  },
  Rejected: {
    commandId: AdmissionPeriodCommandId,
    reason: NonEmptyIdSchema,
  },
});

export type AdmissionPeriodObservation = typeof AdmissionPeriodObservationSchema.Type;

export const AdmissionPeriodListSchema = Schema.Array(AdmissionPeriodProjectionSchema);

export type AdmissionPeriodList = typeof AdmissionPeriodListSchema.Type;

export const decodeAdmissionPeriodCommand = Schema.decodeUnknownEffect(
  AdmissionPeriodCommandSchema,
  {
    onExcessProperty: "error",
  },
);

export const decodeCreateAdmissionPeriodInput = Schema.decodeUnknownEffect(
  CreateAdmissionPeriodInputSchema,
  {
    onExcessProperty: "error",
  },
);

export const decodeReviseAdmissionPeriodInput = Schema.decodeUnknownEffect(
  ReviseAdmissionPeriodInputSchema,
  {
    onExcessProperty: "error",
  },
);
