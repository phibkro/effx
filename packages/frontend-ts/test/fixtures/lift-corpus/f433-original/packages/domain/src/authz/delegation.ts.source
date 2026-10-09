/**
 * Organisational capabilities and the delegation aggregate (AccessControl `Delegations`).
 *
 * `docs/model/authority.als` is the source of truth: a team role acts within its team, a board's
 * leader acts where the board sits, and a team acts beyond itself only through an explicit, named,
 * time-bounded delegation of one capability in one area.
 */
import { Match, Record, Result, Schema } from "effect";
import { DepartmentId, PersonId, TeamId } from "../organization/schema.js";
import { compareRfc3339Instants, Rfc3339InstantSchema } from "../time.js";

const Text = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(250), Schema.isPattern(/\S/)),
);

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

/**
 * How a delegation may carry a capability:
 * - `TeamArea`: in any area inside the team's area (its home department; for a national team, any
 *   department or the whole organization), to all members or to the leaders only;
 * - `National`: in the whole organization only, so only a national team can hold it;
 * - `NationalLeaders`: as `National`, and to the team's current leaders only;
 * - `Never`: no delegation carries it.
 */
export type DelegationRule = "TeamArea" | "National" | "NationalLeaders" | "Never";

export interface OrganizationCapabilityRule {
  /** An active leader of an ordinary team holds it within that team. */
  readonly teamLeader: boolean;
  /** An active leader of a board holds it where the board sits. */
  readonly boardLeader: boolean;
  /** An active global-administrator grant holds it everywhere (O8-13). */
  readonly globalAdministrator: boolean;
  readonly delegation: DelegationRule;
}

/**
 * The one registry of organisational capabilities. Who holds each capability, and whether a
 * delegation may carry it, derive from this table and nowhere else.
 */
export const ORGANIZATION_CAPABILITIES = {
  /** Create, revise and list admission periods for management. */
  "admissions.periods": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /** Decide admission outcomes and invite admitted applicants to claim an account. */
  "admissions.outcomes": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /** Assign and staff interviews, read every interview and the completed-interview report. */
  "recruitment.interviews": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /** Coordinate placements, rosters, school service and coverage. */
  "placements.coordinate": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /**
   * Confirm or adjust each assistant's days served in a department and semester. The department
   * grants it to its school-coordination team by an explicit delegation; no team name implies it.
   */
  "placements.days-served": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /** Maintain schools, their department associations and capacity. */
  "schools.administer": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /** Appoint, revise, end, suspend and reinstate appointments. */
  "appointments.manage": {
    teamLeader: true,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /** Read the people directory and mailing recipients. */
  "people.read": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /** Read the team-interest registrations. */
  "team-interest.read": {
    teamLeader: true,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /** Publish, unpublish and revise the articles of an area. */
  "content.publish": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "TeamArea",
  },
  /** Read receipt files, approve, reject and reopen expense claims. */
  "receipts.approve": {
    teamLeader: false,
    boardLeader: false,
    globalAdministrator: false,
    delegation: "National",
  },
  /** Record the external settlement of an approved claim: the finance lead. */
  "receipts.settle": {
    teamLeader: false,
    boardLeader: false,
    globalAdministrator: false,
    delegation: "NationalLeaders",
  },
  /** Issue and end the delegations of the teams in an area. */
  "delegations.manage": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "Never",
  },
  /** Classify teams and recognise independent departments. */
  "organization.govern": {
    teamLeader: false,
    boardLeader: true,
    globalAdministrator: true,
    delegation: "Never",
  },
} as const satisfies Record<string, OrganizationCapabilityRule>;

type Capabilities = typeof ORGANIZATION_CAPABILITIES;

export const ORGANIZATION_CAPABILITY_IDS = Record.keys(ORGANIZATION_CAPABILITIES);

export const OrganizationCapability = Schema.Literals(ORGANIZATION_CAPABILITY_IDS);

export type OrganizationCapability = typeof OrganizationCapability.Type;

export type DelegableCapability = {
  [K in keyof Capabilities]: Capabilities[K]["delegation"] extends "Never" ? never : K;
}[keyof Capabilities];

const isDelegable = (capability: OrganizationCapability): capability is DelegableCapability =>
  ORGANIZATION_CAPABILITIES[capability].delegation !== "Never";

export const DELEGABLE_CAPABILITY_IDS: ReadonlyArray<DelegableCapability> =
  ORGANIZATION_CAPABILITY_IDS.filter(isDelegable);

export const DelegableCapability = Schema.Literals(DELEGABLE_CAPABILITY_IDS);

export const DelegationId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^delegation-[a-f0-9]{64}$/)),
  Schema.brand("DelegationId"),
);

export type DelegationId = typeof DelegationId.Type;

/** The area where a delegation acts: one department, or the whole organization. */
export const DelegationArea = Schema.TaggedUnion({
  Department: { departmentId: DepartmentId },
  Organization: {},
});

export type DelegationArea = typeof DelegationArea.Type;

/** A delegation reaches every current member of its team, or its current leaders only. */
export const DelegationHolders = Schema.Literals(["AllMembers", "LeadersOnly"]);

export type DelegationHolders = typeof DelegationHolders.Type;

export const TeamScope = Schema.Literals(["HomeDepartment", "National"]);

export type TeamScope = typeof TeamScope.Type;

export const UnitKind = Schema.Literals(["Team", "DepartmentBoard"]);

export type UnitKind = typeof UnitKind.Type;

const delegationFields = {
  delegationId: DelegationId,
  name: Text,
  teamId: TeamId,
  capability: OrganizationCapability,
  area: DelegationArea,
  holders: DelegationHolders,
  startAt: Rfc3339InstantSchema,
  endAt: Schema.NullOr(Rfc3339InstantSchema),
  revision: Revision,
};

const orderedInterval = Schema.makeFilter(
  (interval: { readonly startAt: string; readonly endAt: string | null }) =>
    interval.endAt === null || compareRfc3339Instants(interval.startAt, interval.endAt) < 0,
  { message: "a half-open delegation interval" },
);

/**
 * A persisted delegation. The capability decodes against the whole registry, so a row that the
 * registry no longer delegates stays readable and confers nothing (`delegationConforms`).
 */
export const Delegation = Schema.Struct(delegationFields).pipe(Schema.check(orderedInterval));

export type Delegation = typeof Delegation.Type;

/** Temporal state is derived from the half-open interval at one instant. */
export const DelegationState = Schema.Literals(["Future", "Current", "Ended"]);

export type DelegationState = typeof DelegationState.Type;

export const DelegationView = Schema.Struct({
  ...delegationFields,
  state: DelegationState,
}).pipe(Schema.check(orderedInterval));

export type DelegationView = typeof DelegationView.Type;

export const delegationStateAt = (
  delegation: Pick<Delegation, "startAt" | "endAt">,
  now: string,
): DelegationState =>
  delegation.endAt !== null && compareRfc3339Instants(delegation.endAt, now) <= 0
    ? "Ended"
    : compareRfc3339Instants(delegation.startAt, now) > 0
      ? "Future"
      : "Current";

/** Active from its start, inclusive, until its end, exclusive. */
export const delegationActiveAt = (
  delegation: Pick<Delegation, "startAt" | "endAt">,
  instant: string,
): boolean => delegationStateAt(delegation, instant) === "Current";

/** The facts of the delegated team that its delegations depend on. */
export interface DelegationTeam {
  readonly teamId: TeamId;
  readonly departmentId: DepartmentId;
  readonly unitKind: UnitKind;
  readonly teamScope: TeamScope;
  readonly active: boolean;
}

/** A team's area: its home department, or the whole organization for a national team. */
export const teamAreaCovers = (
  team: Pick<DelegationTeam, "departmentId" | "teamScope">,
  area: DelegationArea,
): boolean =>
  team.teamScope === "National" ||
  (DelegationArea.guards.Department(area) && area.departmentId === team.departmentId);

/**
 * Whether a delegation can confer its capability on the members of this team: the registry
 * delegates the capability in this area to these holders, the team is an ordinary team, and the
 * area lies inside the team's area. Evaluated again at every decision, so a reclassified team or a
 * changed registry fails closed.
 */
export const delegationConforms = (
  delegation: Pick<Delegation, "capability" | "area" | "holders">,
  team: Pick<DelegationTeam, "departmentId" | "teamScope" | "unitKind">,
): boolean => {
  const rule = ORGANIZATION_CAPABILITIES[delegation.capability].delegation;

  return (
    team.unitKind === "Team" &&
    teamAreaCovers(team, delegation.area) &&
    Match.value(rule).pipe(
      Match.when("TeamArea", () => true),
      Match.when("National", () => DelegationArea.guards.Organization(delegation.area)),
      Match.when(
        "NationalLeaders",
        () =>
          DelegationArea.guards.Organization(delegation.area) &&
          delegation.holders === "LeadersOnly",
      ),
      Match.when("Never", () => false),
      Match.exhaustive,
    )
  );
};

const command = { commandId: Text, reason: Text };

export const DelegationCommand = Schema.TaggedUnion({
  IssueDelegation: {
    ...command,
    name: Text,
    teamId: TeamId,
    capability: DelegableCapability,
    area: DelegationArea,
    holders: DelegationHolders,
    startAt: Rfc3339InstantSchema,
    endAt: Schema.NullOr(Rfc3339InstantSchema),
  },
  EndDelegation: {
    ...command,
    delegationId: DelegationId,
    expectedRevision: Revision,
    endAt: Rfc3339InstantSchema,
  },
});

export type DelegationCommand = typeof DelegationCommand.Type;

export const DelegationResult = Schema.Struct({
  commandId: Text,
  delegationId: DelegationId,
  revision: Revision,
});

export type DelegationResult = typeof DelegationResult.Type;

export const DelegationHistory = Schema.Struct({
  commandId: Text,
  action: Schema.Literals(["IssueDelegation", "EndDelegation"]),
  delegationId: DelegationId,
  teamId: TeamId,
  actorPersonId: PersonId,
  occurredAt: Rfc3339InstantSchema,
  reason: Text,
  before: Schema.NullOr(Delegation),
  after: Delegation,
});

export type DelegationHistory = typeof DelegationHistory.Type;

/** The teams, areas, delegations and history that one person manages. */
export const DelegationManagement = Schema.Struct({
  teams: Schema.Array(
    Schema.Struct({
      teamId: TeamId,
      name: Text,
      departmentId: DepartmentId,
      teamScope: TeamScope,
    }),
  ),
  departments: Schema.Array(Schema.Struct({ departmentId: DepartmentId, name: Text })),
  delegations: Schema.Array(DelegationView),
  history: Schema.Array(DelegationHistory),
});

export type DelegationManagement = typeof DelegationManagement.Type;

export class DelegationTransitionFailure extends Schema.TaggedError<DelegationTransitionFailure>()(
  "DelegationTransitionFailure",
  { code: Schema.Literals(["NotFound", "Stale", "Invalid"]) },
) {}

const invalid = () => Result.fail(new DelegationTransitionFailure({ code: "Invalid" }));

/**
 * One exhaustive machine owns every delegation transition. Issuing needs an active ordinary team
 * whose area covers the requested area and a capability that the registry delegates there.
 * Ending never extends a delegation and never ends it before now.
 */
export const transitionDelegation = (
  current: Delegation | undefined,
  command: DelegationCommand,
  input: {
    readonly delegationId: DelegationId;
    readonly team: DelegationTeam | undefined;
    readonly now: string;
  },
): Result.Result<Delegation, DelegationTransitionFailure> =>
  Match.value(command).pipe(
    Match.withReturnType<Result.Result<Delegation, DelegationTransitionFailure>>(),
    Match.tag("IssueDelegation", (command) => {
      if (current !== undefined) return invalid();

      if (input.team === undefined)
        return Result.fail(new DelegationTransitionFailure({ code: "NotFound" }));

      if (
        !input.team.active ||
        !delegationConforms(command, input.team) ||
        (command.endAt !== null && compareRfc3339Instants(command.startAt, command.endAt) >= 0)
      )
        return invalid();

      return Result.succeed({
        delegationId: input.delegationId,
        name: command.name,
        teamId: command.teamId,
        capability: command.capability,
        area: command.area,
        holders: command.holders,
        startAt: command.startAt,
        endAt: command.endAt,
        revision: 0,
      });
    }),
    Match.tag("EndDelegation", (command) => {
      if (current === undefined)
        return Result.fail(new DelegationTransitionFailure({ code: "NotFound" }));

      if (current.revision !== command.expectedRevision)
        return Result.fail(new DelegationTransitionFailure({ code: "Stale" }));

      if (
        delegationStateAt(current, input.now) === "Ended" ||
        compareRfc3339Instants(command.endAt, input.now) < 0 ||
        compareRfc3339Instants(command.endAt, current.startAt) <= 0 ||
        (current.endAt !== null && compareRfc3339Instants(command.endAt, current.endAt) > 0)
      )
        return invalid();

      return Result.succeed({ ...current, endAt: command.endAt, revision: current.revision + 1 });
    }),
    Match.exhaustive,
  );
