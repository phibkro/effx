import { flow, Predicate, Effect, Schema } from "effect";
import { canonicalJsonBytes, sha256Hex } from "../shared-kernel/index.js";
import { OrganizationDecodeError, OrganizationRoleDenied } from "./errors.js";
import {
  CreateDepartmentCommandSchema,
  CreateFieldOfStudyCommandSchema,
  CreateTeamCommandSchema,
  OrganizationActorSchema,
  OrganizationCreateCommandSchema,
  type OrganizationActor,
  type OrganizationCommandId,
  type OrganizationCreateCommand,
  type OrganizationEntityKind,
} from "./administration-schema.js";
import {
  DepartmentId,
  FieldOfStudyId,
  TeamId,
  type DepartmentId as DepartmentIdType,
  type FieldOfStudyId as FieldOfStudyIdType,
  type TeamId as TeamIdType,
} from "./schema.js";

const decodeError = (operation: string, cause: unknown) =>
  new OrganizationDecodeError({ operation, message: String(cause) });

export const decodeOrganizationActor = flow(
  Schema.decodeUnknownEffect(OrganizationActorSchema, {
    onExcessProperty: "error",
  }),
  Effect.mapError((cause) => decodeError("decode organization actor", cause)),
);

export const decodeCreateDepartmentCommand = flow(
  Schema.decodeUnknownEffect(CreateDepartmentCommandSchema, {
    onExcessProperty: "error",
  }),
  Effect.mapError((cause) => decodeError("decode CreateDepartment command", cause)),
);

export const decodeCreateTeamCommand = flow(
  Schema.decodeUnknownEffect(CreateTeamCommandSchema, {
    onExcessProperty: "error",
  }),
  Effect.mapError((cause) => decodeError("decode CreateTeam command", cause)),
);

export const decodeCreateFieldOfStudyCommand = flow(
  Schema.decodeUnknownEffect(CreateFieldOfStudyCommandSchema, {
    onExcessProperty: "error",
  }),
  Effect.mapError((cause) => decodeError("decode CreateFieldOfStudy command", cause)),
);

export const decodeOrganizationCreateCommand = flow(
  Schema.decodeUnknownEffect(OrganizationCreateCommandSchema, {
    onExcessProperty: "error",
  }),
  Effect.mapError((cause) => decodeError("decode organization create command", cause)),
);

export const organizationCommandBytes = (command: OrganizationCreateCommand): Uint8Array =>
  canonicalJsonBytes(command);

export const organizationCommandDigest = (command: OrganizationCreateCommand): string =>
  sha256Hex(organizationCommandBytes(command));

export const organizationEntityDigest = (
  entityKind: OrganizationEntityKind,
  commandId: OrganizationCommandId,
): string => sha256Hex(canonicalJsonBytes({ entityKind, commandId }));

export function organizationEntityIdForCommand(
  entityKind: "Department",
  commandId: OrganizationCommandId,
): DepartmentIdType;
export function organizationEntityIdForCommand(
  entityKind: "Team",
  commandId: OrganizationCommandId,
): TeamIdType;
export function organizationEntityIdForCommand(
  entityKind: "FieldOfStudy",
  commandId: OrganizationCommandId,
): FieldOfStudyIdType;
export function organizationEntityIdForCommand(
  entityKind: OrganizationEntityKind,
  commandId: OrganizationCommandId,
): DepartmentIdType | TeamIdType | FieldOfStudyIdType {
  const digest = organizationEntityDigest(entityKind, commandId);

  switch (entityKind) {
    case "Department":
      return DepartmentId.make(`department-${digest}`);
    case "Team":
      return TeamId.make(`team-${digest}`);
    case "FieldOfStudy":
      return FieldOfStudyId.make(`field-of-study-${digest}`);
  }
}

export const departmentIdForCommand = (commandId: OrganizationCommandId): DepartmentIdType =>
  organizationEntityIdForCommand("Department", commandId);

export const teamIdForCommand = (commandId: OrganizationCommandId): TeamIdType =>
  organizationEntityIdForCommand("Team", commandId);

export const fieldOfStudyIdForCommand = (commandId: OrganizationCommandId): FieldOfStudyIdType =>
  organizationEntityIdForCommand("FieldOfStudy", commandId);

export const authorizeOrganizationActor = (
  actor: OrganizationActor,
): Effect.Effect<void, OrganizationRoleDenied> =>
  Predicate.isTagged(actor, "OrganizationAdministrator")
    ? Effect.void
    : Effect.fail(
        new OrganizationRoleDenied({
          actorPersonId: actor.personId,
          requiredRole: "OrganizationAdministrator",
        }),
      );
