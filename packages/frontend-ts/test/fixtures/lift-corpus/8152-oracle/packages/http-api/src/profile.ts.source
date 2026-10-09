/**
 * Public HTTP contracts for the current user's profile.
 *
 * @since 0.1.0
 */
import { PersonId, ProfileRoleSchema } from "@vektorprogrammet/domain/organization";
import { OwnProfile } from "@vektorprogrammet/domain/profile";
import { Schema } from "effect";

/**
 * Dashboard role projection for navigation. A department administrator holds a capability beyond
 * one team through a board leadership or a delegation; a team leader acts within the team.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const UserRoleSchema = ProfileRoleSchema;

/**
 * Strict self-profile response exposed to the dashboard.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const UserProfileResponse = Schema.Struct({
  personId: OwnProfile.fields.personId,
  firstName: OwnProfile.fields.firstName,
  lastName: OwnProfile.fields.lastName,
  email: OwnProfile.fields.email,
  phone: OwnProfile.fields.phone,
  role: UserRoleSchema,
  nameRevision: OwnProfile.fields.nameRevision,
  contactRevision: OwnProfile.fields.contactRevision,
}).annotate({
  identifier: "UserProfileResponse",
  description: "The current person's editable profile and authorization role projection.",
  examples: [
    {
      personId: PersonId.make("7202"),
      firstName: "Ming",
      lastName: "Medlem",
      email: "ming.medlem@example.org",
      phone: "+47 900 00 000",
      role: "ROLE_TEAM_MEMBER",
      nameRevision: 0,
      contactRevision: 1,
    },
  ],
});
