import { Schema } from "effect";
import { AdmissionFieldOfStudyId } from "../admission-period/schema.js";
import { DepartmentId } from "../organization/schema.js";
import { PublicApplicationCommandIdSchema, PublicApplicationIdSchema } from "./schema.js";

export class PublicApplicationDecodeError extends Schema.TaggedError<PublicApplicationDecodeError>()(
  "PublicApplicationDecodeError",
  { message: Schema.String },
) {}

export class NoEligibleAdmissionPeriod extends Schema.TaggedError<NoEligibleAdmissionPeriod>()(
  "NoEligibleAdmissionPeriod",
  { departmentId: DepartmentId },
) {}

export class AmbiguousAdmissionPeriod extends Schema.TaggedError<AmbiguousAdmissionPeriod>()(
  "AmbiguousAdmissionPeriod",
  { departmentId: DepartmentId },
) {}

/** `_tag` remains DepartmentNotFound for the public error contract. */
export class PublicApplicationDepartmentNotFound extends Schema.TaggedError<PublicApplicationDepartmentNotFound>()(
  "DepartmentNotFound",
  { departmentId: DepartmentId },
) {}

export class FieldOfStudyNotFound extends Schema.TaggedError<FieldOfStudyNotFound>()(
  "FieldOfStudyNotFound",
  { fieldOfStudyId: AdmissionFieldOfStudyId },
) {}

export class FieldOfStudyInactive extends Schema.TaggedError<FieldOfStudyInactive>()(
  "FieldOfStudyInactive",
  { fieldOfStudyId: AdmissionFieldOfStudyId },
) {}

export class FieldOfStudyDepartmentMismatch extends Schema.TaggedError<FieldOfStudyDepartmentMismatch>()(
  "FieldOfStudyDepartmentMismatch",
  { fieldOfStudyId: AdmissionFieldOfStudyId, departmentId: DepartmentId },
) {}

export class DuplicatePublicApplication extends Schema.TaggedError<DuplicatePublicApplication>()(
  "DuplicatePublicApplication",
  {},
) {}

export class DuplicatePublicApplicationCommandConflict extends Schema.TaggedError<DuplicatePublicApplicationCommandConflict>()(
  "DuplicatePublicApplicationCommandConflict",
  { commandId: PublicApplicationCommandIdSchema },
) {}

export class PublicApplicationNotFound extends Schema.TaggedError<PublicApplicationNotFound>()(
  "PublicApplicationNotFound",
  { applicationId: PublicApplicationIdSchema },
) {}

export class PublicApplicationQueryLimitExceeded extends Schema.TaggedError<PublicApplicationQueryLimitExceeded>()(
  "PublicApplicationQueryLimitExceeded",
  { limit: Schema.Int },
) {}

export class PublicApplicationPersistenceError extends Schema.TaggedError<PublicApplicationPersistenceError>()(
  "PublicApplicationPersistenceError",
  { operation: Schema.String, message: Schema.String },
) {}

export type ApplicantContactProjectionFailure =
  | PublicApplicationDecodeError
  | PublicApplicationNotFound
  | PublicApplicationQueryLimitExceeded
  | PublicApplicationPersistenceError;

/** Transport adapters may use these typed failures before entering the transaction. */
export class RequestBodyTooLarge extends Schema.TaggedError<RequestBodyTooLarge>()(
  "RequestBodyTooLarge",
  {},
) {}

export class PublicApplicationRateLimitExceeded extends Schema.TaggedError<PublicApplicationRateLimitExceeded>()(
  "PublicApplicationRateLimitExceeded",
  {},
) {}

export type PublicApplicationError =
  | PublicApplicationDecodeError
  | NoEligibleAdmissionPeriod
  | AmbiguousAdmissionPeriod
  | PublicApplicationDepartmentNotFound
  | FieldOfStudyNotFound
  | FieldOfStudyInactive
  | FieldOfStudyDepartmentMismatch
  | DuplicatePublicApplication
  | DuplicatePublicApplicationCommandConflict
  | PublicApplicationNotFound
  | PublicApplicationQueryLimitExceeded
  | PublicApplicationPersistenceError
  | RequestBodyTooLarge
  | PublicApplicationRateLimitExceeded;
