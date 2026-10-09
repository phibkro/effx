/**
 * Standalone team application values and their public, staff, and command representations.
 *
 * @since 0.1.0
 */
import { Schema } from "effect";
import { ContactEmail } from "../contact/schema.js";
import { OrganizationAuthorityInstantSchema } from "../organization/authority.js";
import { Department, PersonId, Team, TeamId } from "../organization/schema.js";
import { Rfc3339InstantSchema } from "../time.js";

/** Explicit field bounds. Field of study keeps the legacy 45-character limit. */
export const TEAM_APPLICATION_LIMITS = {
  name: 255,
  email: 254,
  phone: 40,
  yearOfStudy: 100,
  fieldOfStudy: 45,
  biography: 10_000,
  motivation: 10_000,
} as const;

const text = (max: number, multiline: boolean) =>
  Schema.String.pipe(
    Schema.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(max),
      Schema.makeFilter(
        (value) =>
          value.trim() === value &&
          !value.split("").some((character) => {
            const code = character.charCodeAt(0);

            return code === 127 || (code < 32 && (!multiline || ![9, 10, 13].includes(code)));
          }),
        {
          message: multiline
            ? "trimmed text without control characters other than tabs and line breaks"
            : "trimmed single-line text",
        },
      ),
    ),
  );

/** Server-allocated lowercase UUIDv4. */
export const TeamApplicationId = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter(
      (value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value),
      { message: "a lowercase UUIDv4" },
    ),
  ),
  Schema.brand("TeamApplicationId"),
);

export type TeamApplicationId = typeof TeamApplicationId.Type;

export const TeamApplicationCommandId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  Schema.brand("TeamApplicationCommandId"),
);

export type TeamApplicationCommandId = typeof TeamApplicationCommandId.Type;

/** The seven applicant fields. All are required. */
export const TeamApplicationFields = {
  name: text(TEAM_APPLICATION_LIMITS.name, false),
  email: ContactEmail,
  phone: text(TEAM_APPLICATION_LIMITS.phone, false),
  yearOfStudy: text(TEAM_APPLICATION_LIMITS.yearOfStudy, false),
  fieldOfStudy: text(TEAM_APPLICATION_LIMITS.fieldOfStudy, false),
  biography: text(TEAM_APPLICATION_LIMITS.biography, true),
  motivation: text(TEAM_APPLICATION_LIMITS.motivation, true),
};

export const TeamApplicationInput = Schema.Struct(TeamApplicationFields).annotate({
  identifier: "TeamApplicationInput",
  description: "An anonymous visitor's application to one team.",
});

export type TeamApplicationInput = typeof TeamApplicationInput.Type;

/** One stored application with its private applicant fields. */
export const TeamApplication = Schema.Struct({
  applicationId: TeamApplicationId,
  teamId: TeamId,
  ...TeamApplicationFields,
  submittedAt: Rfc3339InstantSchema,
}).annotate({ identifier: "TeamApplication" });

export type TeamApplication = typeof TeamApplication.Type;

export const TeamApplicationSummary = Schema.Struct({
  applicationId: TeamApplicationId,
  name: TeamApplicationFields.name,
  submittedAt: Rfc3339InstantSchema,
}).annotate({ identifier: "TeamApplicationSummary" });

export type TeamApplicationSummary = typeof TeamApplicationSummary.Type;

/** Organization-owned intake settings guarded by the team revision. */
export const TeamApplicationIntakeSettings = Schema.Struct({
  acceptApplication: Schema.NullOr(Schema.Boolean),
  deadline: Team.fields.deadline,
  revision: Team.fields.revision,
}).annotate({ identifier: "TeamApplicationIntakeSettings" });

export type TeamApplicationIntakeSettings = typeof TeamApplicationIntakeSettings.Type;

/** Intake facts evaluated by the open predicate, including both candidate mailboxes. */
export const TeamApplicationIntakeFacts = Schema.Struct({
  teamActive: Schema.Boolean,
  departmentActive: Schema.Boolean,
  acceptApplication: Schema.NullOr(Schema.Boolean),
  deadline: Team.fields.deadline,
  teamEmail: Team.fields.email,
  departmentEmail: Department.fields.email,
});

export type TeamApplicationIntakeFacts = typeof TeamApplicationIntakeFacts.Type;

/** Intake settings for staff, with the open state at the evaluation instant. */
export const TeamApplicationIntake = Schema.Struct({
  acceptApplication: Schema.Boolean,
  deadline: Team.fields.deadline,
  revision: Team.fields.revision,
  open: Schema.Boolean,
}).annotate({ identifier: "TeamApplicationIntake" });

export type TeamApplicationIntake = typeof TeamApplicationIntake.Type;

export const PublicTeamApplicationIntake = Schema.Struct({
  teamId: TeamId,
  teamName: Team.fields.name,
  departmentName: Department.fields.name,
  open: Schema.Boolean,
  deadline: Team.fields.deadline,
}).annotate({ identifier: "PublicTeamApplicationIntake" });

export type PublicTeamApplicationIntake = typeof PublicTeamApplicationIntake.Type;

/** Upper bound for the public intake collection; it holds active teams only. */
export const TEAM_APPLICATION_INTAKE_LIST_LIMIT = 500;

export const TeamApplicationIntakeListItem = Schema.Struct({
  teamId: TeamId,
  open: Schema.Boolean,
  deadline: Team.fields.deadline,
}).annotate({ identifier: "TeamApplicationIntakeListItem" });

export type TeamApplicationIntakeListItem = typeof TeamApplicationIntakeListItem.Type;

export const TeamApplicationConfirmation = Schema.Struct({
  applicationId: TeamApplicationId,
  teamId: TeamId,
  submittedAt: Rfc3339InstantSchema,
}).annotate({ identifier: "TeamApplicationConfirmation" });

export type TeamApplicationConfirmation = typeof TeamApplicationConfirmation.Type;

export const SubmitTeamApplicationCommand = Schema.Struct({
  commandId: TeamApplicationCommandId,
  teamId: TeamId,
  application: TeamApplicationInput,
});

export type SubmitTeamApplicationCommand = typeof SubmitTeamApplicationCommand.Type;

export const DeleteTeamApplicationCommand = Schema.Struct({
  commandId: TeamApplicationCommandId,
  applicationId: TeamApplicationId,
});

export type DeleteTeamApplicationCommand = typeof DeleteTeamApplicationCommand.Type;

/** An absent key keeps the stored value; a null deadline clears it. */
export const ReviseTeamApplicationIntakeCommand = Schema.Struct({
  commandId: TeamApplicationCommandId,
  teamId: TeamId,
  acceptApplication: Schema.optionalKey(Schema.Boolean),
  deadline: Schema.optionalKey(Schema.NullOr(Rfc3339InstantSchema)),
});

export type ReviseTeamApplicationIntakeCommand = typeof ReviseTeamApplicationIntakeCommand.Type;

/** The authenticated person and the single instant at which authority is evaluated. */
export const TeamApplicationPrincipal = Schema.Struct({
  personId: PersonId,
  authorizationInstant: OrganizationAuthorityInstantSchema,
});

export type TeamApplicationPrincipal = typeof TeamApplicationPrincipal.Type;

/** Team-scoped staff authority. Global administration grants no implicit access. */
export const TeamApplicationActor = Schema.TaggedUnion({
  TeamMember: { personId: PersonId, teamId: TeamId },
  TeamLeader: { personId: PersonId, teamId: TeamId },
});

export type TeamApplicationActor = typeof TeamApplicationActor.Type;
