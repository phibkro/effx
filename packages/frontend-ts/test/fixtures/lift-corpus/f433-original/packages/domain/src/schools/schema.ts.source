import { Schema } from "effect";
import { Model } from "effect/unstable/schema";
import { DepartmentId, SemesterId } from "../organization/schema.js";

const text = (maxLength: number) =>
  Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value) => value.trim().length > 0, {
        message: "a non-empty string",
      }),
      Schema.isMaxLength(maxLength),
    ),
  );

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const Count = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2147483647)),
);

export const SchoolId = Schema.Int.pipe(
  Schema.check(
    Schema.makeFilter(Number.isSafeInteger, { message: "a safe integer" }),
    Schema.isGreaterThan(0),
  ),
  Schema.brand("SchoolId"),
);

export type SchoolId = typeof SchoolId.Type;

export const SchoolCapacityId = Schema.Int.pipe(
  Schema.check(
    Schema.makeFilter(Number.isSafeInteger, { message: "a safe integer" }),
    Schema.isGreaterThan(0),
  ),
  Schema.brand("SchoolCapacityId"),
);

export type SchoolCapacityId = typeof SchoolCapacityId.Type;

export const SchoolLanguageSchema = Schema.Literals(["Norwegian", "International"]);

export type SchoolLanguage = typeof SchoolLanguageSchema.Type;

export const SchoolName = text(255);

const SchoolContactPerson = text(255);

const SchoolEmail = text(255).pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[^@\s]+@[^@\s]+$/u.test(value), {
      message: "an email address",
    }),
  ),
);

const SchoolPhone = text(255);

/** Canonical external teaching-school record owned by Schools. */
export class School extends Model.Class<School>("Schools.School")({
  schoolId: Model.GeneratedByDb(SchoolId),
  name: Model.Field({
    select: SchoolName,
    insert: SchoolName,
    update: SchoolName,
    json: SchoolName,
    jsonCreate: SchoolName,
    jsonUpdate: SchoolName,
  }),
  contactPerson: Model.Field({
    select: SchoolContactPerson,
    insert: SchoolContactPerson,
    update: SchoolContactPerson,
    json: SchoolContactPerson,
    jsonCreate: SchoolContactPerson,
    jsonUpdate: SchoolContactPerson,
  }),
  email: Model.Field({
    select: SchoolEmail,
    insert: SchoolEmail,
    update: SchoolEmail,
    json: SchoolEmail,
    jsonCreate: SchoolEmail,
    jsonUpdate: SchoolEmail,
  }),
  phone: Model.Field({
    select: SchoolPhone,
    insert: SchoolPhone,
    update: SchoolPhone,
    json: SchoolPhone,
    jsonCreate: SchoolPhone,
    jsonUpdate: SchoolPhone,
  }),
  language: Model.Field({
    select: SchoolLanguageSchema,
    insert: SchoolLanguageSchema,
    update: SchoolLanguageSchema,
    json: SchoolLanguageSchema,
    jsonCreate: SchoolLanguageSchema,
    jsonUpdate: SchoolLanguageSchema,
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

export type SchoolSelect = typeof School.Encoded;

export type SchoolInsert = typeof School.insert.Encoded;

export type SchoolUpdate = typeof School.update.Encoded;

export type SchoolJson = typeof School.json.Type;

export type SchoolJsonCreate = typeof School.jsonCreate.Type;

export type SchoolJsonUpdate = typeof School.jsonUpdate.Type;

/** Canonical many-to-many association; the two references are its identity. */
export class SchoolDepartment extends Model.Class<SchoolDepartment>("Schools.SchoolDepartment")({
  schoolId: Model.Field({
    select: SchoolId,
    insert: SchoolId,
    json: SchoolId,
    jsonCreate: SchoolId,
  }),
  departmentId: Model.Field({
    select: DepartmentId,
    insert: DepartmentId,
    json: DepartmentId,
    jsonCreate: DepartmentId,
  }),
  revision: Model.GeneratedByDb(Revision),
}) {}

export type SchoolDepartmentSelect = typeof SchoolDepartment.Encoded;

export type SchoolDepartmentInsert = typeof SchoolDepartment.insert.Encoded;

export type SchoolDepartmentUpdate = typeof SchoolDepartment.update.Encoded;

export type SchoolDepartmentJson = typeof SchoolDepartment.json.Type;

export type SchoolDepartmentJsonCreate = typeof SchoolDepartment.jsonCreate.Type;

export type SchoolDepartmentJsonUpdate = typeof SchoolDepartment.jsonUpdate.Type;

/** Department-owned weekday capacity, independent of placement demand. */
export class SchoolCapacityPlan extends Model.Class<SchoolCapacityPlan>(
  "Schools.SchoolCapacityPlan",
)({
  capacityId: Model.GeneratedByDb(SchoolCapacityId),
  schoolId: Model.Field({
    select: SchoolId,
    insert: SchoolId,
    json: SchoolId,
    jsonCreate: SchoolId,
  }),
  departmentId: Model.Field({
    select: DepartmentId,
    insert: DepartmentId,
    json: DepartmentId,
    jsonCreate: DepartmentId,
  }),
  semesterId: Model.Field({
    select: SemesterId,
    insert: SemesterId,
    json: SemesterId,
    jsonCreate: SemesterId,
  }),
  monday: Model.Field({
    select: Count,
    insert: Count,
    update: Count,
    json: Count,
    jsonCreate: Count,
    jsonUpdate: Count,
  }),
  tuesday: Model.Field({
    select: Count,
    insert: Count,
    update: Count,
    json: Count,
    jsonCreate: Count,
    jsonUpdate: Count,
  }),
  wednesday: Model.Field({
    select: Count,
    insert: Count,
    update: Count,
    json: Count,
    jsonCreate: Count,
    jsonUpdate: Count,
  }),
  thursday: Model.Field({
    select: Count,
    insert: Count,
    update: Count,
    json: Count,
    jsonCreate: Count,
    jsonUpdate: Count,
  }),
  friday: Model.Field({
    select: Count,
    insert: Count,
    update: Count,
    json: Count,
    jsonCreate: Count,
    jsonUpdate: Count,
  }),
  revision: Model.GeneratedByDb(Revision),
}) {}

export type SchoolCapacityPlanSelect = typeof SchoolCapacityPlan.Encoded;

export type SchoolCapacityPlanInsert = typeof SchoolCapacityPlan.insert.Encoded;

export type SchoolCapacityPlanUpdate = typeof SchoolCapacityPlan.update.Encoded;

export type SchoolCapacityPlanJson = typeof SchoolCapacityPlan.json.Type;

export type SchoolCapacityPlanJsonCreate = typeof SchoolCapacityPlan.jsonCreate.Type;

export type SchoolCapacityPlanJsonUpdate = typeof SchoolCapacityPlan.jsonUpdate.Type;

export const SchoolDirectoryDepartmentSchema = Schema.Struct({
  departmentId: DepartmentId,
  name: Schema.String,
});

export type SchoolDirectoryDepartment = typeof SchoolDirectoryDepartmentSchema.Type;

const compareText = (left: string, right: string): number =>
  left === right ? 0 : left < right ? -1 : 1;

export const SchoolDirectoryDepartmentsSchema = Schema.Array(SchoolDirectoryDepartmentSchema).pipe(
  Schema.check(
    Schema.makeFilter(
      (departments) =>
        departments.every(
          (department, index) =>
            index === 0 ||
            compareText(departments[index - 1]!.departmentId, department.departmentId) < 0,
        ),
      { message: "departments sorted by unique departmentId" },
    ),
  ),
);

export const SchoolDirectoryEntrySchema = Schema.Struct({
  schoolId: SchoolId,
  name: SchoolName,
  contactPerson: SchoolContactPerson,
  email: SchoolEmail,
  phone: SchoolPhone,
  language: SchoolLanguageSchema,
  departments: SchoolDirectoryDepartmentsSchema,
  isActive: Schema.Boolean,
}).annotate({
  examples: [
    {
      schoolId: SchoolId.make(1),
      name: "Trondheim katedral videregående skole",
      contactPerson: "Heidi Holm",
      email: "post@tks.example.org",
      phone: "+47 900 00 001",
      language: "Norwegian",
      departments: [{ departmentId: DepartmentId.make("1"), name: "Trondheim" }],
      isActive: true,
    },
  ],
});

export type SchoolDirectoryEntry = typeof SchoolDirectoryEntrySchema.Type;

export const SchoolDirectorySchema = Schema.Struct({
  activeSchools: Schema.Array(SchoolDirectoryEntrySchema),
  inactiveSchools: Schema.Array(SchoolDirectoryEntrySchema),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (directory) => {
        if (directory.activeSchools.some((school) => !school.isActive)) return false;

        if (directory.inactiveSchools.some((school) => school.isActive)) return false;

        const schoolIds = [
          ...directory.activeSchools.map((school) => school.schoolId),
          ...directory.inactiveSchools.map((school) => school.schoolId),
        ];

        return new Set(schoolIds).size === schoolIds.length;
      },
      { message: "one correctly partitioned directory entry per school" },
    ),
  ),
);

export type SchoolDirectory = typeof SchoolDirectorySchema.Type;

const DepartmentScopeIds = Schema.Array(DepartmentId).pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.makeFilter((departmentIds) => new Set(departmentIds).size === departmentIds.length, {
      message: "unique department identifiers",
    }),
  ),
);

export const SchoolDirectoryScopeSchema = Schema.TaggedUnion({
  All: {},
  DepartmentIds: { departmentIds: DepartmentScopeIds },
});

export type SchoolDirectoryScope = typeof SchoolDirectoryScopeSchema.Type;

export const SchoolDirectoryQuerySchema = Schema.Struct({
  departmentId: Schema.optional(DepartmentId),
});

export type SchoolDirectoryQuery = typeof SchoolDirectoryQuerySchema.Type;

export const SchoolDirectoryListInputSchema = Schema.Struct({
  scope: SchoolDirectoryScopeSchema,
  ...SchoolDirectoryQuerySchema.fields,
});

export type SchoolDirectoryListInput = typeof SchoolDirectoryListInputSchema.Type;
