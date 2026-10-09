import { Data, DateTime, Predicate, Schema } from "effect";
import { allow, deny, type Decision } from "../authz/decision.js";
import { leadsUnit } from "../authz/reach.js";
import { ContactEmail } from "../contact/schema.js";
import type { OrganizationPersonAuthority } from "../organization/authority.js";
import type { TeamId } from "../organization/schema.js";
import { TeamApplicationActor, type TeamApplicationIntakeFacts } from "./schema.js";

/** An evaluated intake. Only an open intake carries the mailbox its notifications use. */
export type TeamApplicationIntakeState = Data.TaggedEnum<{
  readonly Open: { readonly mailbox: typeof ContactEmail.Type };
  readonly Closed: {};
}>;

export const TeamApplicationIntakeState = Data.taggedEnum<TeamApplicationIntakeState>();

/**
 * Intake is open only for an active team in an active department that explicitly
 * accepts applications, before its deadline, with a deliverable mailbox. The deadline
 * instant itself is closed. The mailbox is the team email, or the department email when
 * the team has none; an undeliverable team email does not fall back to the department.
 */
export const evaluateTeamApplicationIntake = (
  facts: TeamApplicationIntakeFacts,
  now: DateTime.Utc,
): TeamApplicationIntakeState => {
  const mailbox = facts.teamEmail ?? facts.departmentEmail;

  return facts.teamActive &&
    facts.departmentActive &&
    facts.acceptApplication === true &&
    (facts.deadline === null || DateTime.isLessThan(now, DateTime.makeUnsafe(facts.deadline))) &&
    Schema.is(ContactEmail)(mailbox)
    ? TeamApplicationIntakeState.Open({ mailbox })
    : TeamApplicationIntakeState.Closed();
};

/** Public reads, staff reads, and submission all derive `open` from one evaluation. */
export const isTeamApplicationIntakeOpen = (
  facts: TeamApplicationIntakeFacts,
  now: DateTime.Utc,
): boolean => Predicate.isTagged(evaluateTeamApplicationIntake(facts, now), "Open");

/**
 * Maps the Organization projection to one team's staff actor. The unit's current leader
 * changes intake and deletes applications; a current member reads them. An active membership
 * already excludes ended, suspended, and inactive-team or inactive-department memberships.
 * Global administration grants no implicit access.
 */
export const mapOrganizationAuthorityToTeamApplicationActor = (
  authority: OrganizationPersonAuthority,
  teamId: TeamId,
): Decision<TeamApplicationActor> => {
  if (leadsUnit(authority, teamId)) {
    return allow<TeamApplicationActor>(
      TeamApplicationActor.cases.TeamLeader.make({ personId: authority.personId, teamId }),
    );
  }

  const memberships = authority.memberships.filter((membership) => membership.teamId === teamId);

  if (memberships.some((membership) => membership.active)) {
    return allow<TeamApplicationActor>(
      TeamApplicationActor.cases.TeamMember.make({ personId: authority.personId, teamId }),
    );
  }

  return deny<TeamApplicationActor>(memberships.length > 0 ? "AuthorityInactive" : "NotInScope");
};
