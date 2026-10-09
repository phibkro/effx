import { Schema } from "effect";
import {
  Department,
  DepartmentJsonSchema,
  FieldOfStudy,
  FieldOfStudyJsonSchema,
  PersonId,
  Team,
  TeamJsonSchema,
} from "./schema.js";

const NonEmpty = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0, { message: "a non-empty string" }),
  ),
);

export const OrganizationCommandId = NonEmpty.pipe(Schema.brand("OrganizationCommandId"));

export type OrganizationCommandId = typeof OrganizationCommandId.Type;

export const OrganizationEntityKindSchema = Schema.Literals(["Department", "Team", "FieldOfStudy"]);

export type OrganizationEntityKind = typeof OrganizationEntityKindSchema.Type;

export const OrganizationAdministratorSchema = Schema.TaggedStruct("OrganizationAdministrator", {
  personId: PersonId,
});

export type OrganizationAdministrator = typeof OrganizationAdministratorSchema.Type;

export const OrganizationMemberSchema = Schema.TaggedStruct("OrganizationMember", {
  personId: PersonId,
});

export type OrganizationMember = typeof OrganizationMemberSchema.Type;

export const OrganizationActorSchema = Schema.Union([
  OrganizationAdministratorSchema,
  OrganizationMemberSchema,
]);

export type OrganizationActor = typeof OrganizationActorSchema.Type;

export const CreateDepartmentCommandSchema = Schema.TaggedStruct("CreateDepartment", {
  commandId: OrganizationCommandId,
  ...Department.jsonCreate.fields,
});

export type CreateDepartmentCommand = typeof CreateDepartmentCommandSchema.Type;

export const CreateTeamCommandSchema = Schema.TaggedStruct("CreateTeam", {
  commandId: OrganizationCommandId,
  ...Team.jsonCreate.fields,
});

export type CreateTeamCommand = typeof CreateTeamCommandSchema.Type;

export const CreateFieldOfStudyCommandSchema = Schema.TaggedStruct("CreateFieldOfStudy", {
  commandId: OrganizationCommandId,
  ...FieldOfStudy.jsonCreate.fields,
});

export type CreateFieldOfStudyCommand = typeof CreateFieldOfStudyCommandSchema.Type;

export const OrganizationCreateCommandSchema = Schema.Union([
  CreateDepartmentCommandSchema,
  CreateTeamCommandSchema,
  CreateFieldOfStudyCommandSchema,
]);

export type OrganizationCreateCommand = typeof OrganizationCreateCommandSchema.Type;

export const DepartmentCreatedObservationSchema = Schema.TaggedStruct("DepartmentCreated", {
  commandId: OrganizationCommandId,
  department: DepartmentJsonSchema,
});

export type DepartmentCreatedObservation = typeof DepartmentCreatedObservationSchema.Type;

export const TeamCreatedObservationSchema = Schema.TaggedStruct("TeamCreated", {
  commandId: OrganizationCommandId,
  team: TeamJsonSchema,
});

export type TeamCreatedObservation = typeof TeamCreatedObservationSchema.Type;

export const FieldOfStudyCreatedObservationSchema = Schema.TaggedStruct("FieldOfStudyCreated", {
  commandId: OrganizationCommandId,
  fieldOfStudy: FieldOfStudyJsonSchema,
});

export type FieldOfStudyCreatedObservation = typeof FieldOfStudyCreatedObservationSchema.Type;

export const OrganizationCreatedObservationSchema = Schema.Union([
  DepartmentCreatedObservationSchema,
  TeamCreatedObservationSchema,
  FieldOfStudyCreatedObservationSchema,
]);

export type OrganizationCreatedObservation = typeof OrganizationCreatedObservationSchema.Type;

export const DepartmentReplayedObservationSchema = Schema.TaggedStruct("Replayed", {
  commandId: OrganizationCommandId,
  original: DepartmentCreatedObservationSchema,
});

export type DepartmentReplayedObservation = typeof DepartmentReplayedObservationSchema.Type;

export const TeamReplayedObservationSchema = Schema.TaggedStruct("Replayed", {
  commandId: OrganizationCommandId,
  original: TeamCreatedObservationSchema,
});

export type TeamReplayedObservation = typeof TeamReplayedObservationSchema.Type;

export const FieldOfStudyReplayedObservationSchema = Schema.TaggedStruct("Replayed", {
  commandId: OrganizationCommandId,
  original: FieldOfStudyCreatedObservationSchema,
});

export type FieldOfStudyReplayedObservation = typeof FieldOfStudyReplayedObservationSchema.Type;

export const OrganizationReplayedObservationSchema = Schema.Union([
  DepartmentReplayedObservationSchema,
  TeamReplayedObservationSchema,
  FieldOfStudyReplayedObservationSchema,
]);

export type OrganizationReplayedObservation = typeof OrganizationReplayedObservationSchema.Type;

export const OrganizationCreateObservationSchema = Schema.Union([
  OrganizationCreatedObservationSchema,
  OrganizationReplayedObservationSchema,
]);

export type OrganizationCreateObservation = typeof OrganizationCreateObservationSchema.Type;

export const CreateDepartmentResultSchema = Schema.Union([
  Schema.Struct({
    committed: Schema.Literals([true]),
    observation: DepartmentCreatedObservationSchema,
  }),
  Schema.Struct({
    committed: Schema.Literals([false]),
    observation: DepartmentReplayedObservationSchema,
  }),
]);

export type CreateDepartmentResult = typeof CreateDepartmentResultSchema.Type;

export const CreateTeamResultSchema = Schema.Union([
  Schema.Struct({
    committed: Schema.Literals([true]),
    observation: TeamCreatedObservationSchema,
  }),
  Schema.Struct({
    committed: Schema.Literals([false]),
    observation: TeamReplayedObservationSchema,
  }),
]);

export type CreateTeamResult = typeof CreateTeamResultSchema.Type;

export const CreateFieldOfStudyResultSchema = Schema.Union([
  Schema.Struct({
    committed: Schema.Literals([true]),
    observation: FieldOfStudyCreatedObservationSchema,
  }),
  Schema.Struct({
    committed: Schema.Literals([false]),
    observation: FieldOfStudyReplayedObservationSchema,
  }),
]);

export type CreateFieldOfStudyResult = typeof CreateFieldOfStudyResultSchema.Type;

export const OrganizationCreateResultSchema = Schema.Union([
  CreateDepartmentResultSchema,
  CreateTeamResultSchema,
  CreateFieldOfStudyResultSchema,
]);

export type OrganizationCreateResult = typeof OrganizationCreateResultSchema.Type;
