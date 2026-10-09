/**
 * The one interpreter of organisational reach (`docs/model/authority.als`, `reach` and
 * `delegatedReach`). Every decision that depends on team or board leadership, or on a delegation,
 * asks this module; no other product code reads a leadership flag.
 */
import { Data, Match, Option, Order } from "effect";
import type { OrganizationPersonAuthority } from "../organization/authority.js";
import type { DepartmentId, MembershipId, PersonId, TeamId } from "../organization/schema.js";
import {
  delegationActiveAt,
  delegationConforms,
  DelegationArea,
  ORGANIZATION_CAPABILITIES,
  ORGANIZATION_CAPABILITY_IDS,
  type Delegation,
  type OrganizationCapability,
  type TeamScope,
  type UnitKind,
} from "./delegation.js";

/** A scope where a person holds a capability. */
export type ReachScope = Data.TaggedEnum<{
  Organization: {};
  Department: { readonly departmentId: DepartmentId };
  Team: { readonly teamId: TeamId };
}>;

export const ReachScope = Data.taggedEnum<ReachScope>();

/** What a decision targets. A team or department board is a unit inside its home department. */
export type ReachTarget = Data.TaggedEnum<{
  Organization: {};
  Department: { readonly departmentId: DepartmentId };
  Team: { readonly teamId: TeamId; readonly departmentId: DepartmentId };
  NationalBoard: {};
}>;

export const ReachTarget = Data.taggedEnum<ReachTarget>();

/** Containment: the organization covers everything, a department its units, a team itself. */
export const scopeCovers = (scope: ReachScope, target: ReachTarget): boolean =>
  Match.value(scope).pipe(
    Match.tag("Organization", () => true),
    Match.tag(
      "Department",
      ({ departmentId }) =>
        (ReachTarget.$is("Department")(target) || ReachTarget.$is("Team")(target)) &&
        target.departmentId === departmentId,
    ),
    Match.tag("Team", ({ teamId }) => ReachTarget.$is("Team")(target) && target.teamId === teamId),
    Match.exhaustive,
  );

/**
 * The active delegations of a capability that reach this person: an active membership of the
 * delegated team, the leaders only for a leaders-only delegation, and a delegation that still
 * conforms to the registry and to the team's current area.
 */
export const delegationsReaching = (
  authority: OrganizationPersonAuthority,
  capability: OrganizationCapability,
): ReadonlyArray<Delegation> =>
  authority.delegations.filter(
    (delegation) =>
      delegation.capability === capability &&
      delegationActiveAt(delegation, authority.evaluatedAt) &&
      authority.memberships.some(
        (membership) =>
          membership.teamId === delegation.teamId &&
          membership.active &&
          (delegation.holders === "AllMembers" || membership.unitLeader) &&
          delegationConforms(delegation, membership),
      ),
  );

/** Why a person holds a capability in a scope. */
export type ReachBasis = "GlobalAdministrator" | "TeamLeader" | "BoardLeader" | "Delegation";

interface Reach {
  readonly scope: ReachScope;
  readonly basis: ReachBasis;
}

const reachesOf = (
  authority: OrganizationPersonAuthority,
  capability: OrganizationCapability,
): ReadonlyArray<Reach> => {
  const rule = ORGANIZATION_CAPABILITIES[capability];
  const reaches: Array<Reach> = [];

  if (rule.globalAdministrator && authority.globalAdministrator === "Active")
    reaches.push({ scope: ReachScope.Organization(), basis: "GlobalAdministrator" });

  for (const membership of authority.memberships) {
    if (!membership.active || !membership.unitLeader) continue;

    if (membership.unitKind === "Team" && rule.teamLeader)
      reaches.push({ scope: ReachScope.Team({ teamId: membership.teamId }), basis: "TeamLeader" });

    // A department's board governs the department only while it is independent.
    if (
      membership.unitKind === "DepartmentBoard" &&
      membership.departmentIndependent &&
      rule.boardLeader
    )
      reaches.push({
        scope: ReachScope.Department({ departmentId: membership.departmentId }),
        basis: "BoardLeader",
      });
  }

  if (
    rule.boardLeader &&
    authority.nationalBoardSeats.some((seat) => seat.active && seat.unitLeader)
  )
    reaches.push({ scope: ReachScope.Organization(), basis: "BoardLeader" });

  for (const delegation of delegationsReaching(authority, capability)) {
    reaches.push({
      scope: DelegationArea.guards.Department(delegation.area)
        ? ReachScope.Department({ departmentId: delegation.area.departmentId })
        : ReachScope.Organization(),
      basis: "Delegation",
    });
  }

  return reaches;
};

/**
 * Every scope where the person holds the capability at the projection's instant. A team leader
 * acts within the team; a department board's leader acts in the department while it is
 * independent; the national board's leader and a global administrator act everywhere; a
 * delegation acts in its area.
 */
export const reachScopes = (
  authority: OrganizationPersonAuthority,
  capability: OrganizationCapability,
): ReadonlyArray<ReachScope> => reachesOf(authority, capability).map(({ scope }) => scope);

export const reaches = (
  authority: OrganizationPersonAuthority,
  capability: OrganizationCapability,
  target: ReachTarget,
): boolean => reachScopes(authority, capability).some((scope) => scopeCovers(scope, target));

/** The departments that the person reaches as a whole. */
export type ReachedDepartments = Data.TaggedEnum<{
  All: {};
  Departments: { readonly departmentIds: ReadonlyArray<DepartmentId> };
}>;

export const ReachedDepartments = Data.taggedEnum<ReachedDepartments>();

export const reachedDepartments = (
  authority: OrganizationPersonAuthority,
  capability: OrganizationCapability,
): ReachedDepartments => {
  const scopes = reachScopes(authority, capability);

  if (scopes.some(ReachScope.$is("Organization"))) return ReachedDepartments.All();

  const departmentIds = new Set<DepartmentId>();

  for (const scope of scopes) {
    if (ReachScope.$is("Department")(scope)) departmentIds.add(scope.departmentId);
  }

  return ReachedDepartments.Departments({
    departmentIds: [...departmentIds].sort((left, right) => left.localeCompare(right)),
  });
};

/** The teams that the person reaches through a team scope (a team leader's own team). */
export const reachedTeams = (
  authority: OrganizationPersonAuthority,
  capability: OrganizationCapability,
): ReadonlyArray<TeamId> => {
  const teamIds = new Set<TeamId>();

  for (const scope of reachScopes(authority, capability)) {
    if (ReachScope.$is("Team")(scope)) teamIds.add(scope.teamId);
  }

  return [...teamIds].sort((left, right) => left.localeCompare(right));
};

/**
 * Whether a board leadership or a delegation gives the person a capability beyond a single team.
 * A global-administrator grant does not count; callers ask for it separately.
 */
export const holdsDepartmentReach = (authority: OrganizationPersonAuthority): boolean =>
  ORGANIZATION_CAPABILITY_IDS.some((capability) =>
    reachesOf(authority, capability).some(
      ({ scope, basis }) => basis !== "GlobalAdministrator" && !ReachScope.$is("Team")(scope),
    ),
  );

/** Whether the person currently leads this unit (a team, or a department board). */
export const leadsUnit = (authority: OrganizationPersonAuthority, teamId: TeamId): boolean =>
  authority.memberships.some(
    (membership) => membership.teamId === teamId && membership.active && membership.unitLeader,
  );

/** Whether the person currently leads an ordinary team. */
export const leadsAnyTeam = (authority: OrganizationPersonAuthority): boolean =>
  authority.memberships.some(
    (membership) => membership.active && membership.unitLeader && membership.unitKind === "Team",
  );

/** The board that a seat sits on: a department's board (Styret), or the national board. */
export type SeatBoard = Data.TaggedEnum<{
  DepartmentBoard: { readonly departmentId: DepartmentId };
  NationalBoard: {};
}>;

export const SeatBoard = Data.taggedEnum<SeatBoard>();

/** One appointment with the facts of its unit, as a derived seat reads it. */
export interface UnitAppointment {
  readonly membershipId: MembershipId;
  readonly personId: PersonId;
  readonly teamId: TeamId;
  readonly departmentId: DepartmentId;
  readonly unitKind: UnitKind;
  readonly teamScope: TeamScope;
  readonly active: boolean;
  readonly unitLeader: boolean;
}

/** A board seat that a current team leadership gives. It is computed, never stored. */
export interface DerivedBoardSeat {
  readonly board: SeatBoard;
  readonly personId: PersonId;
  readonly sourceMembershipId: MembershipId;
  readonly sourceTeamId: TeamId;
}

const byMembership = Order.mapInput(
  Order.String,
  (appointment: { readonly membershipId: MembershipId }) => appointment.membershipId,
);

/**
 * The derived seats at the facts' instant: every current leader of a local team sits on the
 * board of the team's home department, and every current leader of a national team sits on
 * Hovedstyret. A derived seat starts and ends with the leadership. It gives membership and
 * certificate issuance only: no reach above reads it, so it gives no administration.
 */
export const derivedBoardSeats = (
  appointments: ReadonlyArray<UnitAppointment>,
): ReadonlyArray<DerivedBoardSeat> =>
  appointments
    .filter(
      (appointment) =>
        appointment.active && appointment.unitLeader && appointment.unitKind === "Team",
    )
    .toSorted(byMembership)
    .map((appointment) => ({
      board:
        appointment.teamScope === "National"
          ? SeatBoard.NationalBoard()
          : SeatBoard.DepartmentBoard({ departmentId: appointment.departmentId }),
      personId: appointment.personId,
      sourceMembershipId: appointment.membershipId,
      sourceTeamId: appointment.teamId,
    }));

/** The seat, or the grant, that lets a person issue the certificates of a department. */
export type IssuerBasis = Data.TaggedEnum<{
  /** An appointed seat on the board that governs the department. */
  BoardSeat: { readonly membershipId: MembershipId };
  /** A seat on that board derived from the current leadership of a team. */
  DerivedSeat: { readonly membershipId: MembershipId; readonly teamId: TeamId };
  GlobalAdministrator: {};
}>;

export const IssuerBasis = Data.taggedEnum<IssuerBasis>();

/** The facts of a department that decide which board governs it. */
export interface GovernedDepartment {
  readonly departmentId: DepartmentId;
  readonly independent: boolean;
}

/**
 * Who issues the certificates of a department (O8-16). The seats on the board of an independent
 * department issue for that department only, and the seats on Hovedstyret for a department that
 * is not independent; derived seats count as seats. A global administrator issues everywhere.
 * An appointed seat comes before a derived seat, and a seat before the grant, so the certificate
 * names the seat. Anyone else, a team leader without such a seat included, has no basis.
 */
export const certificateIssuerBasis = (
  authority: OrganizationPersonAuthority,
  department: GovernedDepartment,
): Option.Option<IssuerBasis> => {
  const appointed = department.independent
    ? authority.memberships
        .filter(
          (membership) =>
            membership.active &&
            membership.unitKind === "DepartmentBoard" &&
            membership.departmentId === department.departmentId,
        )
        .toSorted(byMembership)
    : authority.nationalBoardSeats.filter((seat) => seat.active).toSorted(byMembership);

  const seat = appointed[0];

  if (seat !== undefined)
    return Option.some(IssuerBasis.BoardSeat({ membershipId: seat.membershipId }));

  const derived = derivedBoardSeats(
    authority.memberships.map((membership) => ({ ...membership, personId: authority.personId })),
  ).find((candidate) =>
    SeatBoard.$match(candidate.board, {
      DepartmentBoard: ({ departmentId }) =>
        department.independent && departmentId === department.departmentId,
      NationalBoard: () => !department.independent,
    }),
  );

  if (derived !== undefined)
    return Option.some(
      IssuerBasis.DerivedSeat({
        membershipId: derived.sourceMembershipId,
        teamId: derived.sourceTeamId,
      }),
    );

  return authority.globalAdministrator === "Active"
    ? Option.some(IssuerBasis.GlobalAdministrator())
    : Option.none();
};
