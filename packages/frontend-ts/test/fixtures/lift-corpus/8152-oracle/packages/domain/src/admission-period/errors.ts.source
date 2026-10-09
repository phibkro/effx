import { Schema } from "effect";
import { DepartmentId, PersonId, SemesterId } from "../organization/schema.js";
import { AdmissionPeriodCommandId, AdmissionPeriodId } from "./schema.js";

export class AdmissionPeriodDecodeError extends Schema.TaggedError<AdmissionPeriodDecodeError>()(
  "AdmissionPeriodDecodeError",
  { message: Schema.String },
) {}

export class UnauthenticatedActor extends Schema.TaggedError<UnauthenticatedActor>()(
  "UnauthenticatedActor",
  { message: Schema.String },
) {}

export class InactiveActor extends Schema.TaggedError<InactiveActor>()("InactiveActor", {
  personId: PersonId,
}) {}

export class AdmissionRoleDenied extends Schema.TaggedError<AdmissionRoleDenied>()(
  "AdmissionRoleDenied",
  { personId: PersonId },
) {}

export class AdmissionScopeDenied extends Schema.TaggedError<AdmissionScopeDenied>()(
  "AdmissionScopeDenied",
  {
    personId: PersonId,
    departmentId: DepartmentId,
    admissionPeriodId: Schema.optional(AdmissionPeriodId),
  },
) {}

export class DepartmentRequired extends Schema.TaggedError<DepartmentRequired>()(
  "DepartmentRequired",
  {},
) {}

export class DepartmentNotFound extends Schema.TaggedError<DepartmentNotFound>()(
  "DepartmentNotFound",
  { departmentId: DepartmentId },
) {}

export class SemesterNotFound extends Schema.TaggedError<SemesterNotFound>()("SemesterNotFound", {
  semesterId: SemesterId,
}) {}

export class AdmissionPeriodNotFound extends Schema.TaggedError<AdmissionPeriodNotFound>()(
  "AdmissionPeriodNotFound",
  { admissionPeriodId: AdmissionPeriodId },
) {}

export class InvalidAdmissionPeriodWindow extends Schema.TaggedError<InvalidAdmissionPeriodWindow>()(
  "InvalidAdmissionPeriodWindow",
  {
    startAt: Schema.String,
    endAt: Schema.String,
    reason: Schema.Literals(["EqualBounds", "ReversedBounds"]),
  },
) {}

export class AdmissionWindowOutsideSemester extends Schema.TaggedError<AdmissionWindowOutsideSemester>()(
  "AdmissionWindowOutsideSemester",
  {
    semesterId: SemesterId,
    startAt: Schema.String,
    endAt: Schema.String,
    semesterStartAt: Schema.String,
    semesterEndAt: Schema.String,
  },
) {}

export class AdmissionPeriodAlreadyExists extends Schema.TaggedError<AdmissionPeriodAlreadyExists>()(
  "AdmissionPeriodAlreadyExists",
  { departmentId: DepartmentId, semesterId: SemesterId },
) {}

export class StaleAdmissionPeriodRevision extends Schema.TaggedError<StaleAdmissionPeriodRevision>()(
  "StaleAdmissionPeriodRevision",
  {
    admissionPeriodId: AdmissionPeriodId,
    expected: Schema.Int,
    actual: Schema.Int,
  },
) {}

export class DuplicateAdmissionPeriodCommandConflict extends Schema.TaggedError<DuplicateAdmissionPeriodCommandConflict>()(
  "DuplicateAdmissionPeriodCommandConflict",
  { commandId: AdmissionPeriodCommandId },
) {}

export class AdmissionPeriodPersistenceError extends Schema.TaggedError<AdmissionPeriodPersistenceError>()(
  "AdmissionPeriodPersistenceError",
  { operation: Schema.String, message: Schema.String },
) {}

export type AdmissionPeriodFailure =
  | AdmissionPeriodDecodeError
  | UnauthenticatedActor
  | InactiveActor
  | AdmissionRoleDenied
  | AdmissionScopeDenied
  | DepartmentRequired
  | DepartmentNotFound
  | SemesterNotFound
  | AdmissionPeriodNotFound
  | InvalidAdmissionPeriodWindow
  | AdmissionWindowOutsideSemester
  | AdmissionPeriodAlreadyExists
  | StaleAdmissionPeriodRevision
  | DuplicateAdmissionPeriodCommandConflict
  | AdmissionPeriodPersistenceError;
