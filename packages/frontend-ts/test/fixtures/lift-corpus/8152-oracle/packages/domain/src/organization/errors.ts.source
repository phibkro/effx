import { Schema } from "effect";
import { DepartmentId, MembershipId, PersonId, TeamId } from "./schema.js";
import { OrganizationCommandId } from "./administration-schema.js";

const NonEmpty = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

export class OrganizationDecodeError extends Schema.TaggedError<OrganizationDecodeError>()(
  "OrganizationDecodeError",
  { operation: NonEmpty, message: NonEmpty },
) {}

export class OrganizationPersistenceError extends Schema.TaggedError<OrganizationPersistenceError>()(
  "OrganizationPersistenceError",
  { operation: NonEmpty, message: NonEmpty, cause: Schema.optional(Schema.Unknown) },
) {}

export class OrganizationAuthorityRecordNotFound extends Schema.TaggedError<OrganizationAuthorityRecordNotFound>()(
  "OrganizationAuthorityRecordNotFound",
  { grantId: NonEmpty },
) {}

export class OrganizationAuthorityWriteConflict extends Schema.TaggedError<OrganizationAuthorityWriteConflict>()(
  "OrganizationAuthorityWriteConflict",
  { grantId: NonEmpty, expectedRevision: Schema.Int },
) {}

export class OrganizationRoleDenied extends Schema.TaggedError<OrganizationRoleDenied>()(
  "OrganizationRoleDenied",
  {
    actorPersonId: PersonId,
    requiredRole: Schema.Literals(["OrganizationAdministrator", "DepartmentAdministrator"]),
  },
) {}

export class OrganizationInvalidReference extends Schema.TaggedError<OrganizationInvalidReference>()(
  "OrganizationInvalidReference",
  { referenceKind: Schema.Literals(["Department", "Semester", "CurrentSemester"]) },
) {}

export class OrganizationCommandConflict extends Schema.TaggedError<OrganizationCommandConflict>()(
  "OrganizationCommandConflict",
  { commandId: OrganizationCommandId },
) {}

export class DepartmentNotFound extends Schema.TaggedError<DepartmentNotFound>()(
  "DepartmentNotFound",
  { departmentId: DepartmentId },
) {}

export class TeamNotFound extends Schema.TaggedError<TeamNotFound>()("TeamNotFound", {
  teamId: TeamId,
}) {}

export class MembershipNotFound extends Schema.TaggedError<MembershipNotFound>()(
  "MembershipNotFound",
  { membershipId: MembershipId },
) {}

export class MembershipStaleRevision extends Schema.TaggedError<MembershipStaleRevision>()(
  "MembershipStaleRevision",
  {
    membershipId: MembershipId,
    expectedRevision: Schema.Int,
    actualRevision: Schema.Int,
  },
) {}

export class MembershipInvalidInterval extends Schema.TaggedError<MembershipInvalidInterval>()(
  "MembershipInvalidInterval",
  { membershipId: MembershipId },
) {}

export class MembershipImmutableField extends Schema.TaggedError<MembershipImmutableField>()(
  "MembershipImmutableField",
  { field: NonEmpty },
) {}

export class MembershipRevisionConflict extends Schema.TaggedError<MembershipRevisionConflict>()(
  "MembershipRevisionConflict",
  { membershipId: MembershipId },
) {}

export class OrganizationImportError extends Schema.TaggedError<OrganizationImportError>()(
  "OrganizationImportError",
  { operation: NonEmpty, message: NonEmpty },
) {}

export type OrganizationFailure =
  | OrganizationDecodeError
  | OrganizationPersistenceError
  | OrganizationAuthorityRecordNotFound
  | OrganizationAuthorityWriteConflict
  | DepartmentNotFound
  | OrganizationRoleDenied
  | OrganizationInvalidReference
  | OrganizationCommandConflict
  | TeamNotFound
  | MembershipNotFound
  | MembershipStaleRevision
  | MembershipInvalidInterval
  | MembershipImmutableField
  | MembershipRevisionConflict
  | OrganizationImportError;

export type OrganizationReadFailure =
  | OrganizationDecodeError
  | OrganizationPersistenceError
  | DepartmentNotFound
  | TeamNotFound
  | MembershipNotFound;

export type OrganizationMembershipFailure =
  | OrganizationDecodeError
  | OrganizationPersistenceError
  | MembershipNotFound
  | MembershipStaleRevision
  | MembershipInvalidInterval
  | MembershipImmutableField
  | MembershipRevisionConflict;

export type OrganizationCommandFailure =
  | OrganizationDecodeError
  | OrganizationPersistenceError
  | OrganizationRoleDenied
  | OrganizationInvalidReference
  | OrganizationCommandConflict;
