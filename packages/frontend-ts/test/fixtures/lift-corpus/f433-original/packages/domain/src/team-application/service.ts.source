/**
 * Portable service contract for standalone team applications.
 *
 * @since 0.1.0
 */
import { Context, Data, type Duration, type Effect } from "effect";
import type { Mail } from "../mail.js";
import type { TeamId } from "../organization/schema.js";
import type {
  TeamApplicationAccessDenied,
  TeamApplicationDeleteFailure,
  TeamApplicationNotFound,
  TeamApplicationPersistenceError,
  TeamApplicationPublicReadFailure,
  TeamApplicationReadFailure,
  TeamApplicationReviseFailure,
  TeamApplicationSubmitFailure,
} from "./errors.js";
import type { TeamApplicationOutboxDelivery } from "./notification.js";
import type { TeamApplicationPage } from "./pagination.js";
import type {
  DeleteTeamApplicationCommand,
  PublicTeamApplicationIntake,
  ReviseTeamApplicationIntakeCommand,
  SubmitTeamApplicationCommand,
  TeamApplication,
  TeamApplicationActor,
  TeamApplicationConfirmation,
  TeamApplicationId,
  TeamApplicationIntake,
  TeamApplicationIntakeListItem,
  TeamApplicationPrincipal,
  TeamApplicationSummary,
} from "./schema.js";

/** A staff action and its required team authority. Reads need a member; changes need the leader. */
export type TeamApplicationAction = Data.TaggedEnum<{
  readonly ReadTeamApplications: { readonly teamId: TeamId };
  readonly ReadTeamApplication: { readonly applicationId: TeamApplicationId };
  readonly DeleteTeamApplication: { readonly applicationId: TeamApplicationId };
  readonly ReviseTeamApplicationIntake: { readonly teamId: TeamId };
}>;

export const TeamApplicationAction = Data.taggedEnum<TeamApplicationAction>();

export interface TeamApplicationSubmission {
  readonly confirmation: TeamApplicationConfirmation;
  readonly replayed: boolean;
}

export interface TeamApplicationStaffPage extends TeamApplicationPage<TeamApplicationSummary> {
  readonly teamId: TeamId;
  readonly teamName: string;
  readonly intake: TeamApplicationIntake;
  readonly actor: TeamApplicationActor;
}

export interface TeamApplicationView {
  readonly application: TeamApplication;
  readonly teamName: string;
  readonly actor: TeamApplicationActor;
}

export interface TeamApplicationIntakeRevision {
  readonly teamId: TeamId;
  readonly intake: TeamApplicationIntake;
  readonly replayed: boolean;
}

/**
 * Trusted server operations. Every staff operation resolves the principal's current
 * Organization authority on the caller's transaction connection; commands hold
 * their row locks, the command receipt, audit, and outbox writes in that same
 * transaction. The caller owns authentication, the transaction, and HTTP receipts.
 */
export interface TeamApplicationsOperations {
  /** Fails with TeamApplicationTeamNotFound for an unknown or inactive team or department. */
  readonly readPublicIntake: (
    teamId: TeamId,
  ) => Effect.Effect<PublicTeamApplicationIntake, TeamApplicationPublicReadFailure>;
  /** Active teams in active departments, bounded by TEAM_APPLICATION_INTAKE_LIST_LIMIT. */
  readonly listPublicIntakes: Effect.Effect<
    ReadonlyArray<TeamApplicationIntakeListItem>,
    TeamApplicationPersistenceError
  >;
  /**
   * Evaluates intake at the Clock instant under a shared team lock, then stores the
   * application, its command receipt, and both notification envelopes.
   */
  readonly submit: (
    command: SubmitTeamApplicationCommand,
  ) => Effect.Effect<TeamApplicationSubmission, TeamApplicationSubmitFailure>;
  /**
   * Resolves current authority for one staff action before a transport replay.
   * Change actions lock the target row first. The result grants nothing beyond
   * the caller's transaction.
   */
  readonly authorize: (
    principal: TeamApplicationPrincipal,
    action: TeamApplicationAction,
  ) => Effect.Effect<
    TeamApplicationActor,
    TeamApplicationAccessDenied | TeamApplicationNotFound | TeamApplicationPersistenceError
  >;
  readonly listApplications: (
    principal: TeamApplicationPrincipal,
    teamId: TeamId,
    cursor?: string,
  ) => Effect.Effect<TeamApplicationStaffPage, TeamApplicationReadFailure>;
  readonly readApplication: (
    principal: TeamApplicationPrincipal,
    applicationId: TeamApplicationId,
  ) => Effect.Effect<TeamApplicationView, TeamApplicationReadFailure>;
  /**
   * Leader-only. Removes the application and its private fields, and cancels and
   * clears every undelivered notification envelope for it.
   */
  readonly deleteApplication: (
    command: DeleteTeamApplicationCommand,
    principal: TeamApplicationPrincipal,
  ) => Effect.Effect<void, TeamApplicationDeleteFailure>;
  /**
   * Leader-only. Locks the team, supplies the fresh intake to the transport
   * precondition, then compares and sets the team revision. The callback grants no
   * authority and must not write business state.
   */
  readonly reviseIntake: <E, R>(
    command: ReviseTeamApplicationIntakeCommand,
    principal: TeamApplicationPrincipal,
    checkPrecondition: (current: TeamApplicationIntake) => Effect.Effect<void, E, R>,
  ) => Effect.Effect<TeamApplicationIntakeRevision, TeamApplicationReviseFailure | E, R>;
  /**
   * Takes the next due notification, attempts delivery, and records the outcome while the
   * attempt holds the queue lease, or returns Idle when none is taken within `idle`. A
   * temporary failure returns Failed; the queue retries it after its backoff.
   */
  readonly deliverNextOutboxEffect: (
    sender: string,
    idle: Duration.Duration,
  ) => Effect.Effect<TeamApplicationOutboxDelivery, TeamApplicationPersistenceError, Mail>;
  /** Removes queue items that completed before the retention window; outbox rows stay. */
  readonly cleanUpDeliveryQueue: Effect.Effect<void, TeamApplicationPersistenceError>;
}

export class TeamApplications extends Context.Service<
  TeamApplications,
  TeamApplicationsOperations
>()("@vektorprogrammet/domain/team-application/TeamApplications") {}
