import { Schema } from "effect";
import { reachedDepartments, ReachedDepartments } from "../authz/reach.js";
import { DepartmentId, PersonId, SemesterId } from "../organization/schema.js";
import type { OrganizationPersonAuthority } from "../organization/authority.js";
import { School, SchoolCapacityPlan, SchoolId, SchoolDirectoryDepartmentSchema } from "./schema.js";

const Reason = Schema.String.check(
  Schema.makeFilter((value) => value.trim().length > 0),
  Schema.isMaxLength(2000),
);

const CommandId = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{22,128}$/u));

const DepartmentIds = Schema.Array(DepartmentId).check(
  Schema.isMinLength(1),
  Schema.makeFilter((ids) => new Set(ids).size === ids.length),
);

const facts = Schema.Struct({
  name: School.fields.name,
  contactPerson: School.fields.contactPerson,
  email: School.fields.email,
  phone: School.fields.phone,
  language: School.fields.language,
  active: School.fields.active,
});

const counts = Schema.Struct({
  monday: SchoolCapacityPlan.fields.monday,
  tuesday: SchoolCapacityPlan.fields.tuesday,
  wednesday: SchoolCapacityPlan.fields.wednesday,
  thursday: SchoolCapacityPlan.fields.thursday,
  friday: SchoolCapacityPlan.fields.friday,
});

const common = { commandId: CommandId, reason: Reason };

const capacity = {
  ...common,
  ...counts.fields,
  schoolId: SchoolId,
  departmentId: DepartmentId,
  semesterId: SemesterId,
  expectedSchoolRevision: School.fields.revision,
};

export const SchoolCommand = Schema.TaggedUnion({
  CreateSchool: { ...common, ...facts.fields, departmentIds: DepartmentIds },
  ReviseSchool: {
    ...common,
    ...facts.fields,
    schoolId: SchoolId,
    expectedRevision: School.fields.revision,
  },
  ReplaceSchoolDepartments: {
    ...common,
    schoolId: SchoolId,
    expectedRevision: School.fields.revision,
    departmentIds: DepartmentIds,
  },
  CreateCapacity: capacity,
  ReviseCapacity: { ...capacity, expectedRevision: SchoolCapacityPlan.fields.revision },
});

export type SchoolCommand = typeof SchoolCommand.Type;

export const SchoolCommandResult = Schema.Struct({
  schoolId: SchoolId,
  capacityId: Schema.NullOr(SchoolCapacityPlan.fields.capacityId),
  revision: School.fields.revision,
});

export type SchoolCommandResult = typeof SchoolCommandResult.Type;

export const SchoolAdministrationHistory = Schema.Struct({
  commandId: CommandId,
  schoolId: SchoolId,
  capacityId: Schema.NullOr(SchoolCapacityPlan.fields.capacityId),
  departmentId: Schema.NullOr(DepartmentId),
  actorPersonId: PersonId,
  action: Schema.Literals([
    "CreateSchool",
    "ReviseSchool",
    "ReplaceSchoolDepartments",
    "CreateCapacity",
    "ReviseCapacity",
  ]),
  reason: Reason,
  recordedAt: Schema.String,
  revision: School.fields.revision,
});

export const ManagedSchool = Schema.Struct({
  school: School.json,
  departmentIds: Schema.Array(DepartmentId),
  canEditShared: Schema.Boolean,
  capacityDepartmentIds: Schema.Array(DepartmentId),
  capacities: Schema.Array(SchoolCapacityPlan.json),
});

export const SchoolManagement = Schema.Struct({
  departments: Schema.Array(SchoolDirectoryDepartmentSchema),
  semesters: Schema.Array(Schema.Struct({ semesterId: SemesterId, name: Schema.String })),
  schools: Schema.Array(ManagedSchool),
  history: Schema.Array(SchoolAdministrationHistory),
});

export type SchoolManagement = typeof SchoolManagement.Type;

export class SchoolCommandFailure extends Schema.TaggedError<SchoolCommandFailure>()(
  "SchoolCommandFailure",
  {
    code: Schema.Literals([
      "Denied",
      "NotFound",
      "InvalidReference",
      "InactiveSchool",
      "AssociationInUse",
      "CapacityExists",
      "Stale",
      "Conflict",
      "Invalid",
    ]),
  },
) {}

/**
 * An empty association set needs reach over the whole organization; otherwise every department
 * of the set must be reached with `schools.administer`.
 */
export const canManageSchoolDepartments = (
  authority: OrganizationPersonAuthority,
  departments: ReadonlyArray<DepartmentId>,
): boolean => {
  const reached = reachedDepartments(authority, "schools.administer");

  return (
    ReachedDepartments.$is("All")(reached) ||
    (departments.length > 0 &&
      departments.every((department) => reached.departmentIds.includes(department)))
  );
};
