/** Public schemas for the generated people and school directory contracts. */
import { DepartmentId } from "@vektorprogrammet/domain/organization";
import {
  SchoolCommand,
  SchoolCommandResult,
  SchoolManagement,
  SchoolDirectoryDepartmentSchema,
  SchoolDirectorySchema,
  SchoolId,
  type SchoolDirectory,
  type SchoolDirectoryDepartment,
  type SchoolDirectoryEntry,
} from "@vektorprogrammet/domain/schools";
import { Schema } from "effect";

export { SchoolDirectoryDepartmentSchema, SchoolDirectorySchema, SchoolId };

export type { SchoolDirectory, SchoolDirectoryDepartment, SchoolDirectoryEntry };

/**
 * One profile/organization directory row.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const PeopleDirectoryEntry = Schema.Struct({
  personId: Schema.String,
  firstName: Schema.String,
  lastName: Schema.String,
  email: Schema.String,
  phone: Schema.String,
  studyProgramme: Schema.Null,
  departments: Schema.Array(Schema.String),
  isActive: Schema.Boolean,
}).annotate({
  identifier: "PeopleDirectoryEntry",
  description: "Person profile enriched with Organization-owned department facts.",
  examples: [
    {
      personId: "7202",
      firstName: "Ming",
      lastName: "Medlem",
      email: "ming.medlem@example.org",
      phone: "+47 900 00 000",
      studyProgramme: null,
      departments: ["1"],
      isActive: true,
    },
  ],
});

/**
 * Complete scoped people directory response.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const PeopleDirectoryResponse = Schema.Struct({
  activePeople: Schema.Array(PeopleDirectoryEntry),
  inactivePeople: Schema.Array(PeopleDirectoryEntry),
  nextCursor: Schema.NullOr(Schema.String),
}).annotate({
  identifier: "PeopleDirectoryResponse",
  description: "Active and inactive people visible in the caller's authority scope.",
  examples: [
    {
      activePeople: [
        {
          personId: "7202",
          firstName: "Ming",
          lastName: "Medlem",
          email: "ming.medlem@example.org",
          phone: "+47 900 00 000",
          studyProgramme: null,
          departments: ["1"],
          isActive: true,
        },
      ],
      inactivePeople: [],
      nextCursor: null,
    },
  ],
});

/** Semantic input for directory reads that accept no request body or query. */
export const EmptyDirectoryInput = Schema.Struct({});

export const SchoolDirectoryExample = {
  activeSchools: [
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
  inactiveSchools: [],
} as const;

/** The sole optional wire query member; the backend retains strict multiplicity checks. */
export const SchoolsDirectoryQuery = Schema.Struct({ department: Schema.optional(DepartmentId) });

/** Preserves the public SchoolDirectory schema identifier and documented example. */
export const SchoolDirectoryResponse = SchoolDirectorySchema.annotate({
  identifier: "SchoolDirectory",
  description: "Active and inactive school directory entries.",
  examples: [SchoolDirectoryExample],
});

export { SchoolCommand, SchoolCommandResult, SchoolManagement };
