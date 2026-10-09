import { Schema } from "effect";
import { DepartmentId } from "../organization/schema.js";

export class SchoolsDecodeError extends Schema.TaggedError<SchoolsDecodeError>()(
  "SchoolsDecodeError",
  {
    operation: Schema.String,
    message: Schema.String,
  },
) {}

export class SchoolsPersistenceError extends Schema.TaggedError<SchoolsPersistenceError>()(
  "SchoolsPersistenceError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export class SchoolsAuthorityInactive extends Schema.TaggedError<SchoolsAuthorityInactive>()(
  "AuthorityInactive",
  {},
) {}

export class SchoolsNotInScope extends Schema.TaggedError<SchoolsNotInScope>()("NotInScope", {}) {}

export class SchoolsDepartmentNotFound extends Schema.TaggedError<SchoolsDepartmentNotFound>()(
  "SchoolsDepartmentNotFound",
  { departmentId: DepartmentId },
) {}

export class SchoolsDepartmentOutOfScope extends Schema.TaggedError<SchoolsDepartmentOutOfScope>()(
  "SchoolsDepartmentOutOfScope",
  { departmentId: DepartmentId },
) {}

export type SchoolsFailure = SchoolsDecodeError | SchoolsPersistenceError;

export type ReadSchoolsDirectoryFailure =
  | SchoolsFailure
  | SchoolsAuthorityInactive
  | SchoolsNotInScope
  | SchoolsDepartmentNotFound
  | SchoolsDepartmentOutOfScope;
