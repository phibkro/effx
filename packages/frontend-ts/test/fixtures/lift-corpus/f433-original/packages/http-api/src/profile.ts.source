/**
 * Public HTTP contracts for the current user's profile.
 *
 * @since 0.1.0
 */
import { PersonId, ProfileRoleSchema } from "@vektorprogrammet/domain/organization";
import { OwnProfile } from "@vektorprogrammet/domain/profile";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, personNativeAccess } from "./access.js";
import {
  ProfileReadOwnProfileProblem,
  ProfileUpdateOwnProfileProblem,
} from "./endpoint-problems.js";
import {
  ConditionalReadHeaders,
  endpointProblemResponses,
  entityMutationResponse,
  IdempotencyIfMatchHeaders,
  privateConditionalResponses,
} from "./http-semantics.js";
import { operationAnnotations, PersonSecurity } from "./common.js";
import { ProfileMergePatch } from "./v2-schemas.js";

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

/**
 * Reads the current person's profile.
 *
 * @since 0.1.0
 * @category Endpoints
 */
export const ReadOwnProfileEndpoint = HttpApiEndpoint.get("readOwnProfile", "/api/profile", {
  headers: ConditionalReadHeaders,
  success: privateConditionalResponses(UserProfileResponse),
  error: endpointProblemResponses(ProfileReadOwnProfileProblem),
})
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "profile.read-self",
        canonicalScopeResolver: "profile.current-person",
        requirements: ["profile.owner"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read own profile",
      "Returns the profile selected by the current session.",
    ),
  );

/**
 * Updates the current person's profile with optimistic revisions.
 *
 * @since 0.1.0
 * @category Endpoints
 */
export const UpdateOwnProfileEndpoint = HttpApiEndpoint.patch("updateOwnProfile", "/api/profile", {
  headers: IdempotencyIfMatchHeaders,
  payload: ProfileMergePatch.pipe(
    HttpApiSchema.asJson({ contentType: "application/merge-patch+json" }),
  ),
  success: entityMutationResponse(UserProfileResponse),
  error: endpointProblemResponses(ProfileUpdateOwnProfileProblem),
})
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "profile.update-self",
        canonicalScopeResolver: "profile.current-person",
        requirements: ["profile.owner"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Update own profile",
      "Updates only the profile selected by the current session and returns the fresh projection.",
    ),
  );

/**
 * Current-person profile endpoints.
 *
 * @since 0.1.0
 * @category Groups
 */
export class ProfileApi extends HttpApiGroup.make("profile")
  .add(ReadOwnProfileEndpoint, UpdateOwnProfileEndpoint)
  .annotateMerge(
    OpenApi.annotations({
      title: "Profile",
      description: "Authenticated self-service profile API.",
      override: { "x-displayName": "Profile" },
    }),
  ) {}
