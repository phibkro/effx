/**
 * Portable service contract for organization reads, authority, and administration.
 *
 * @since 0.1.0
 */
import { Context, Effect } from "effect";
import type {
  DelegationCommand,
  DelegationManagement,
  DelegationResult,
} from "../authz/delegation.js";
import type {
  AppointmentManagement,
  OrganizationLifecycleCommand,
  OrganizationLifecycleResult,
  OrganizationLifecycleFailure,
} from "./lifecycle.js";
import type { BoardRosters } from "./board-roster.js";
import type {
  CreateDepartmentCommand,
  CreateDepartmentResult,
  CreateFieldOfStudyCommand,
  CreateFieldOfStudyResult,
  CreateTeamCommand,
  CreateTeamResult,
  OrganizationActor,
} from "./administration-schema.js";
import type { OrganizationAuthorityInstant, OrganizationPersonAuthority } from "./authority.js";
import type { OrganizationDirectoryFacts } from "./directory.js";
import type { SemesterId, TeamInterestRegistration } from "./schema.js";
import type {
  DepartmentNotFound,
  MembershipInvalidInterval,
  MembershipNotFound,
  MembershipRevisionConflict,
  MembershipStaleRevision,
  OrganizationDecodeError,
  OrganizationImportError,
  OrganizationPersistenceError,
  OrganizationCommandFailure,
  OrganizationInvalidReference,
  OrganizationRoleDenied,
  TeamNotFound,
} from "./errors.js";
import type {
  Department,
  DepartmentId,
  FieldOfStudy,
  Membership,
  MembershipId,
  PersonId,
  Team,
  TeamId,
} from "./schema.js";
import type { LegacyOrganizationSnapshot, OrganizationImportResult } from "./import.js";
import type { MailingList, MailingListType } from "./mailing-lists.js";
import type { ProfileFailure } from "../profile/errors.js";
import type { Profile } from "../profile/service.js";

/**
 * Spec 0059 read filter: the authorized scope is explicit input (0055). A registration is in
 * scope when its department or its team is authorized.
 */
export interface TeamInterestFilter {
  readonly authorizedDepartmentIds: ReadonlyArray<DepartmentId>;
  readonly authorizedTeamIds: ReadonlyArray<TeamId>;
  readonly departmentId?: DepartmentId;
  readonly semesterId?: SemesterId;
}

export type OrganizationListFailure = OrganizationDecodeError | OrganizationPersistenceError;

export type OrganizationReadError =
  | OrganizationDecodeError
  | OrganizationPersistenceError
  | DepartmentNotFound
  | TeamNotFound
  | MembershipNotFound;

export type OrganizationRevisionError =
  | OrganizationDecodeError
  | OrganizationPersistenceError
  | MembershipNotFound
  | MembershipStaleRevision
  | MembershipInvalidInterval
  | MembershipRevisionConflict;

export interface OrganizationOperations {
  readonly readAppointmentManagement: (
    actorPersonId: PersonId,
  ) => Effect.Effect<AppointmentManagement, OrganizationLifecycleFailure>;
  /**
   * The rosters of Styret of an independent department and of Hovedstyret, for the boards whose
   * appointments the person can read: appointed seats and the seats that current team
   * leadership derives, at the request instant.
   */
  readonly readBoardRosters: (
    actorPersonId: PersonId,
  ) => Effect.Effect<BoardRosters, OrganizationLifecycleFailure>;
  readonly executeLifecycle: (
    command: OrganizationLifecycleCommand,
    actorPersonId: PersonId,
  ) => Effect.Effect<OrganizationLifecycleResult, OrganizationLifecycleFailure>;
  /** The teams, delegations and history within the person's `delegations.manage` reach. */
  readonly readDelegationManagement: (
    actorPersonId: PersonId,
  ) => Effect.Effect<DelegationManagement, OrganizationLifecycleFailure>;
  /** Issues or ends one delegation under current authority, with receipt and history. */
  readonly executeDelegation: (
    command: DelegationCommand,
    actorPersonId: PersonId,
  ) => Effect.Effect<DelegationResult, OrganizationLifecycleFailure>;
  readonly readDepartment: (
    departmentId: DepartmentId,
  ) => Effect.Effect<Department, OrganizationReadError>;
  readonly listDepartments: Effect.Effect<ReadonlyArray<Department>, OrganizationListFailure>;
  readonly readTeam: (teamId: TeamId) => Effect.Effect<Team, OrganizationReadError>;
  readonly listTeams: (
    departmentId?: DepartmentId,
  ) => Effect.Effect<ReadonlyArray<Team>, OrganizationListFailure>;
  readonly listFieldOfStudies: Effect.Effect<ReadonlyArray<FieldOfStudy>, OrganizationListFailure>;

  /**
   * Spec 0059 read: durable team-interest registrations with the referenced
   * team name, inside the authorized department scope and ordered by
   * registration_id ASC. No authorization happens here; no narrowing may
   * exceed the authorized set.
   */
  readonly listTeamInterestRegistrations: (
    filter: TeamInterestFilter,
  ) => Effect.Effect<
    ReadonlyArray<TeamInterestRegistration>,
    OrganizationDecodeError | OrganizationPersistenceError
  >;

  /** Read canonical recipients under current authority and the selected semester. */
  readonly projectMailingLists: (input: {
    readonly actorPersonId: PersonId;
    readonly authorizationInstant: OrganizationAuthorityInstant;
    readonly type: MailingListType;
    readonly departmentId?: DepartmentId;
    readonly semesterId?: SemesterId;
  }) => Effect.Effect<
    ReadonlyArray<MailingList>,
    | OrganizationDecodeError
    | OrganizationPersistenceError
    | OrganizationInvalidReference
    | OrganizationRoleDenied
    | ProfileFailure,
    Profile
  >;

  readonly createDepartment: (
    command: CreateDepartmentCommand,
    actor: OrganizationActor,
  ) => Effect.Effect<CreateDepartmentResult, OrganizationCommandFailure>;
  readonly createTeam: (
    command: CreateTeamCommand,
    actor: OrganizationActor,
  ) => Effect.Effect<CreateTeamResult, OrganizationCommandFailure>;
  readonly createFieldOfStudy: (
    command: CreateFieldOfStudyCommand,
    actor: OrganizationActor,
  ) => Effect.Effect<CreateFieldOfStudyResult, OrganizationCommandFailure>;
  readonly readMembership: (
    membershipId: MembershipId,
  ) => Effect.Effect<Membership, OrganizationReadError>;
  readonly listMembershipsForTeam: (
    teamId: TeamId,
  ) => Effect.Effect<
    ReadonlyArray<Membership>,
    OrganizationPersistenceError | OrganizationDecodeError
  >;
  readonly listHistoricalMemberships: Effect.Effect<
    ReadonlyArray<Membership>,
    OrganizationPersistenceError | OrganizationDecodeError
  >;
  readonly resolvePersonAuthority: (
    personId: PersonId,
    authorizationInstant: OrganizationAuthorityInstant,
  ) => Effect.Effect<
    OrganizationPersonAuthority,
    OrganizationDecodeError | OrganizationPersistenceError
  >;
  /**
   * Same canonical projection without row locks, for a caller-owned
   * repeatable-read, read-only snapshot.
   */
  readonly resolvePersonAuthorityForRead: (
    personId: PersonId,
    authorizationInstant: OrganizationAuthorityInstant,
  ) => Effect.Effect<
    OrganizationPersonAuthority,
    OrganizationDecodeError | OrganizationPersistenceError
  >;
  /** Spec 0057: per-person directory facts at one authorizationInstant. */
  readonly deriveDirectoryFacts: (
    personIds: ReadonlyArray<PersonId>,
    authorizationInstant: OrganizationAuthorityInstant,
  ) => Effect.Effect<
    OrganizationDirectoryFacts,
    OrganizationDecodeError | OrganizationPersistenceError
  >;

  readonly importLegacyOrganization: (
    snapshot: LegacyOrganizationSnapshot,
  ) => Effect.Effect<
    OrganizationImportResult,
    OrganizationImportError | OrganizationPersistenceError
  >;
}

export class Organization extends Context.Service<Organization, OrganizationOperations>()(
  "@vektorprogrammet/domain/Organization",
) {}
