import { Schema } from "effect";
import { TeamId } from "../organization/schema.js";

/** Unknown team, inactive team, or team in an inactive department. */
export class TeamApplicationTeamNotFound extends Schema.TaggedError<TeamApplicationTeamNotFound>()(
  "TeamApplicationTeamNotFound",
  { teamId: TeamId },
) {}

/** The intake is closed, including when the team has no deliverable mailbox. */
export class TeamApplicationIntakeClosed extends Schema.TaggedError<TeamApplicationIntakeClosed>()(
  "TeamApplicationIntakeClosed",
  { teamId: TeamId },
) {}

export class TeamApplicationNotFound extends Schema.TaggedError<TeamApplicationNotFound>()(
  "TeamApplicationNotFound",
  { applicationId: Schema.String },
) {}

export const TeamApplicationDenialReason = Schema.Literals([
  "NotInScope",
  "AuthorityInactive",
  "NotLeader",
]);

export type TeamApplicationDenialReason = typeof TeamApplicationDenialReason.Type;

export class TeamApplicationAccessDenied extends Schema.TaggedError<TeamApplicationAccessDenied>()(
  "TeamApplicationAccessDenied",
  { reason: TeamApplicationDenialReason },
) {}

/** The command identifier was already committed with a different request. */
export class TeamApplicationCommandConflict extends Schema.TaggedError<TeamApplicationCommandConflict>()(
  "TeamApplicationCommandConflict",
  { commandId: Schema.String },
) {}

export class TeamApplicationInvalidCursor extends Schema.TaggedError<TeamApplicationInvalidCursor>()(
  "TeamApplicationInvalidCursor",
  {},
) {}

/** Internal cause information must not enter a public response. */
export class TeamApplicationPersistenceError extends Schema.TaggedError<TeamApplicationPersistenceError>()(
  "TeamApplicationPersistenceError",
  {
    operation: Schema.String,
    conflict: Schema.Boolean,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

export type TeamApplicationPublicReadFailure =
  | TeamApplicationTeamNotFound
  | TeamApplicationPersistenceError;

export type TeamApplicationSubmitFailure =
  | TeamApplicationTeamNotFound
  | TeamApplicationIntakeClosed
  | TeamApplicationCommandConflict
  | TeamApplicationPersistenceError;

export type TeamApplicationReadFailure =
  | TeamApplicationAccessDenied
  | TeamApplicationNotFound
  | TeamApplicationInvalidCursor
  | TeamApplicationPersistenceError;

export type TeamApplicationDeleteFailure =
  | TeamApplicationAccessDenied
  | TeamApplicationNotFound
  | TeamApplicationCommandConflict
  | TeamApplicationPersistenceError;

export type TeamApplicationReviseFailure =
  | TeamApplicationAccessDenied
  | TeamApplicationCommandConflict
  | TeamApplicationPersistenceError;
