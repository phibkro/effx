import { Schema } from "effect";
import {
  type AdmissionPeriodActor,
  AdmissionPeriodActorSchema,
} from "../admission-period/schema.js";
import { allow, deny, type Decision } from "../authz/decision.js";
import {
  Delegation,
  type OrganizationCapability,
  TeamScope,
  UnitKind,
} from "../authz/delegation.js";
import { holdsDepartmentReach, leadsAnyTeam, reaches, ReachTarget } from "../authz/reach.js";
import { compareRfc3339Instants, Rfc3339InstantSchema } from "../time.js";
import {
  OrganizationMemberSchema,
  type OrganizationActor,
  OrganizationAdministratorSchema,
} from "./administration-schema.js";
import { DepartmentId, MembershipId, PersonId, TeamId } from "./schema.js";

const NonEmpty = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value.trim() === value, {
      message: "a trimmed non-empty string",
    }),
  ),
);

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const OrganizationGlobalAdministratorGrantId = NonEmpty.pipe(
  Schema.brand("OrganizationGlobalAdministratorGrantId"),
);

export type OrganizationGlobalAdministratorGrantId =
  typeof OrganizationGlobalAdministratorGrantId.Type;

export const OrganizationAuthorityInstantSchema = Rfc3339InstantSchema;

export type OrganizationAuthorityInstant = typeof OrganizationAuthorityInstantSchema.Type;

const OrganizationGlobalAdministratorGrantFields = Schema.Struct({
  grantId: OrganizationGlobalAdministratorGrantId,
  personId: PersonId,
  startAt: OrganizationAuthorityInstantSchema,
  endAt: Schema.NullOr(OrganizationAuthorityInstantSchema),
  revision: Revision,
});

export const OrganizationGlobalAdministratorGrantSchema =
  OrganizationGlobalAdministratorGrantFields.pipe(
    Schema.check(
      Schema.makeFilter(
        (grant) => grant.endAt === null || compareRfc3339Instants(grant.endAt, grant.startAt) > 0,
        { message: "a half-open global-administrator grant interval" },
      ),
    ),
  );

export type OrganizationGlobalAdministratorGrant =
  typeof OrganizationGlobalAdministratorGrantSchema.Type;

export const CreateOrganizationGlobalAdministratorGrantInputSchema = Schema.Struct({
  grantId: OrganizationGlobalAdministratorGrantId,
  personId: PersonId,
  startAt: OrganizationAuthorityInstantSchema,
  endAt: Schema.NullOr(OrganizationAuthorityInstantSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (grant) => grant.endAt === null || compareRfc3339Instants(grant.endAt, grant.startAt) > 0,
      { message: "a half-open global-administrator grant interval" },
    ),
  ),
);

export type CreateOrganizationGlobalAdministratorGrantInput =
  typeof CreateOrganizationGlobalAdministratorGrantInputSchema.Type;

export const EndOrganizationGlobalAdministratorGrantInputSchema = Schema.Struct({
  grantId: OrganizationGlobalAdministratorGrantId,
  endAt: OrganizationAuthorityInstantSchema,
  expectedRevision: Revision,
});

export type EndOrganizationGlobalAdministratorGrantInput =
  typeof EndOrganizationGlobalAdministratorGrantInputSchema.Type;

export const RemoveOrganizationGlobalAdministratorGrantInputSchema = Schema.Struct({
  grantId: OrganizationGlobalAdministratorGrantId,
  expectedRevision: Revision,
});

export type RemoveOrganizationGlobalAdministratorGrantInput =
  typeof RemoveOrganizationGlobalAdministratorGrantInputSchema.Type;

export const OrganizationGlobalAdministratorStatusSchema = Schema.Literals([
  "Active",
  "Inactive",
  "Absent",
]);

export type OrganizationGlobalAdministratorStatus =
  typeof OrganizationGlobalAdministratorStatusSchema.Type;

/**
 * One appointment on a team or a department board, with the facts of its unit that reach depends
 * on. `active` means started, not ended, not suspended, and an active unit and department.
 * `unitLeader` is the unit's leadership: a team's leader, or a department board's leader.
 */
export const OrganizationAuthorityMembershipSchema = Schema.Struct({
  membershipId: MembershipId,
  teamId: TeamId,
  departmentId: DepartmentId,
  active: Schema.Boolean,
  unitLeader: Schema.Boolean,
  unitKind: UnitKind,
  teamScope: TeamScope,
  departmentIndependent: Schema.Boolean,
});

export type OrganizationAuthorityMembership = typeof OrganizationAuthorityMembershipSchema.Type;

/** One seat on the national board (Hovedstyret). */
export const OrganizationAuthorityBoardSeatSchema = Schema.Struct({
  membershipId: MembershipId,
  boardId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
  active: Schema.Boolean,
  unitLeader: Schema.Boolean,
});

export type OrganizationAuthorityBoardSeat = typeof OrganizationAuthorityBoardSeatSchema.Type;

/**
 * Everything that decides a person's organisational authority at one instant: the
 * global-administrator grant, team and board appointments, national board seats, and the
 * delegations of the person's teams. `authz/reach.ts` interprets it.
 */
export const OrganizationPersonAuthoritySchema = Schema.Struct({
  personId: PersonId,
  evaluatedAt: OrganizationAuthorityInstantSchema,
  globalAdministrator: OrganizationGlobalAdministratorStatusSchema,
  memberships: Schema.Array(OrganizationAuthorityMembershipSchema),
  nationalBoardSeats: Schema.Array(OrganizationAuthorityBoardSeatSchema),
  delegations: Schema.Array(Delegation),
});

export type OrganizationPersonAuthority = typeof OrganizationPersonAuthoritySchema.Type;

/**
 * The coarse dashboard role, a projection for navigation only. A department administrator holds a
 * capability beyond one team through a board leadership or a delegation; a team leader leads an
 * ordinary team and acts within it.
 */
export const ProfileRoleSchema = Schema.Literals([
  "ROLE_ADMIN",
  "ROLE_DEPARTMENT_ADMINISTRATOR",
  "ROLE_TEAM_LEADER",
  "ROLE_TEAM_MEMBER",
]);

export type ProfileRole = typeof ProfileRoleSchema.Type;

/**
 * Maps one explicit department scope and one capability without selecting a primary membership.
 * An active global administrator acts as today (O8-13). Otherwise the capability's reach decides
 * department administration: a board leadership or a delegation, never a team leadership. An
 * active membership in the department without that reach is a member. Roles and grants are
 * independent: an ended global-administrator grant removes no role authority, and only names the
 * denial where nothing reaches the department.
 */
export const mapOrganizationAuthorityToDepartmentActor = (
  authority: OrganizationPersonAuthority,
  capability: OrganizationCapability,
  departmentId: DepartmentId,
): Decision<AdmissionPeriodActor> => {
  if (authority.globalAdministrator === "Active") {
    return allow<AdmissionPeriodActor>(
      AdmissionPeriodActorSchema.cases.GlobalAdmin.make({
        personId: authority.personId,
        active: true,
      }),
    );
  }

  if (reaches(authority, capability, ReachTarget.Department({ departmentId }))) {
    return allow<AdmissionPeriodActor>(
      AdmissionPeriodActorSchema.cases.DepartmentAdministrator.make({
        personId: authority.personId,
        departmentId,
        active: true,
      }),
    );
  }

  const memberships = authority.memberships.filter(
    (membership) => membership.departmentId === departmentId,
  );

  if (memberships.some((membership) => membership.active)) {
    return allow<AdmissionPeriodActor>(
      AdmissionPeriodActorSchema.cases.Member.make({
        personId: authority.personId,
        departmentId,
        active: true,
      }),
    );
  }

  return deny<AdmissionPeriodActor>(
    memberships.length > 0 || authority.globalAdministrator === "Inactive"
      ? "AuthorityInactive"
      : "NotInScope",
  );
};

export const mapOrganizationAuthorityToOrganizationActor = (
  authority: OrganizationPersonAuthority,
): OrganizationActor =>
  authority.globalAdministrator === "Active"
    ? OrganizationAdministratorSchema.make({ personId: authority.personId })
    : OrganizationMemberSchema.make({ personId: authority.personId });

export const mapOrganizationAuthorityToProfileRole = (
  authority: OrganizationPersonAuthority,
): Decision<ProfileRole> => {
  if (authority.globalAdministrator === "Active") {
    return allow<ProfileRole>("ROLE_ADMIN");
  }

  if (holdsDepartmentReach(authority)) {
    return allow<ProfileRole>("ROLE_DEPARTMENT_ADMINISTRATOR");
  }

  if (leadsAnyTeam(authority)) {
    return allow<ProfileRole>("ROLE_TEAM_LEADER");
  }

  if (
    authority.memberships.some((membership) => membership.active) ||
    authority.nationalBoardSeats.some((seat) => seat.active)
  ) {
    return allow<ProfileRole>("ROLE_TEAM_MEMBER");
  }

  return deny<ProfileRole>(
    authority.globalAdministrator === "Absent" &&
      authority.memberships.length === 0 &&
      authority.nationalBoardSeats.length === 0
      ? "NotInScope"
      : "AuthorityInactive",
  );
};
