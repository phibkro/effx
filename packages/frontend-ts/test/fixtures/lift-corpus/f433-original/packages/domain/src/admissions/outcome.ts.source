import { Data, Predicate, Schema } from "effect";
import { AdmissionPeriodId } from "../admission-period/schema.js";
import {
  PublicApplicationEmailSchema,
  PublicApplicationIdSchema,
  PublicApplicationNameSchema,
  PublicApplicationPhoneSchema,
  PublicApplicationYearOfStudySchema,
} from "../application/schema.js";
import {
  mapOrganizationAuthorityToDepartmentActor,
  type OrganizationPersonAuthority,
} from "../organization/authority.js";
import { DepartmentId, SemesterId } from "../organization/schema.js";

/**
 * The admission outcome of one application when the semester's placements are complete.
 * An admitted person has a placement. A substitute is admitted without a placement and is on
 * call to cover absences. The outcome is a recorded decision; it does not place anyone.
 */
export const AdmissionOutcome = Schema.Literals(["Admitted", "Substitute", "Rejected"]);

export type AdmissionOutcome = typeof AdmissionOutcome.Type;

export const AdmissionOutcomeScope = Schema.Struct({
  departmentId: DepartmentId,
  semesterId: SemesterId,
});

export type AdmissionOutcomeScope = typeof AdmissionOutcomeScope.Type;

export const AdmissionOutcomeCommand = Schema.Struct({ outcome: AdmissionOutcome });

export type AdmissionOutcomeCommand = typeof AdmissionOutcomeCommand.Type;

/** One application of the scope's admission period with its current outcome, if any. */
export const AdmissionOutcomeEntry = Schema.Struct({
  applicationId: PublicApplicationIdSchema,
  admissionPeriodId: AdmissionPeriodId,
  departmentId: DepartmentId,
  semesterId: SemesterId,
  firstName: PublicApplicationNameSchema,
  lastName: PublicApplicationNameSchema,
  email: PublicApplicationEmailSchema,
  phone: PublicApplicationPhoneSchema,
  yearOfStudy: PublicApplicationYearOfStudySchema,
  outcome: Schema.NullOr(AdmissionOutcome),
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0))),
});

export type AdmissionOutcomeEntry = typeof AdmissionOutcomeEntry.Type;

/** The contact a department member needs to arrange cover with a substitute on call. */
export const OnCallSubstitute = Schema.Struct({
  applicationId: PublicApplicationIdSchema,
  firstName: PublicApplicationNameSchema,
  lastName: PublicApplicationNameSchema,
  email: PublicApplicationEmailSchema,
  phone: PublicApplicationPhoneSchema,
});

export type OnCallSubstitute = typeof OnCallSubstitute.Type;

export const AdmissionOutcomeBoard = Schema.Struct({
  admissionPeriodId: Schema.NullOr(AdmissionPeriodId),
  entries: Schema.Array(AdmissionOutcomeEntry),
});

export type AdmissionOutcomeBoard = typeof AdmissionOutcomeBoard.Type;

export const AdmissionOutcomeScopes = Schema.Struct({
  departments: Schema.Array(Schema.Struct({ departmentId: DepartmentId, name: Schema.String })),
  semesters: Schema.Array(
    Schema.Struct({ semesterId: SemesterId, startAt: Schema.String, endAt: Schema.String }),
  ),
});

export type AdmissionOutcomeScopes = typeof AdmissionOutcomeScopes.Type;

export class AdmissionOutcomeFailure extends Data.TaggedError("AdmissionOutcomeFailure")<{
  readonly code: "authority.denied" | "resource.not-found" | "scope.invalid";
  readonly status: 403 | 404 | 422;
}> {}

/** Internal cause information must not enter a public response. */
export class AdmissionOutcomePersistenceError extends Data.TaggedError(
  "AdmissionOutcomePersistenceError",
)<{
  readonly code: "internal.error" | "transaction.conflict";
  readonly status: 409 | 500;
  readonly cause: unknown;
}> {}

export type AdmissionOutcomeOperationFailure =
  | AdmissionOutcomeFailure
  | AdmissionOutcomePersistenceError;

/**
 * Whoever holds `admissions.outcomes` in the department decides outcomes; other department members
 * read only the substitutes on call. Uses the canonical department mapping, so multi-membership
 * and ended-grant semantics match admission management.
 */
export const admissionOutcomePermission = (
  authority: OrganizationPersonAuthority,
  departmentId: DepartmentId,
): "Denied" | "ReadOnly" | "Decide" => {
  const decision = mapOrganizationAuthorityToDepartmentActor(
    authority,
    "admissions.outcomes",
    departmentId,
  );

  return Predicate.isTagged(decision, "Deny")
    ? "Denied"
    : Predicate.isTagged(decision.value, "Member")
      ? "ReadOnly"
      : "Decide";
};

/** A department member sees only the name and contact of a substitute on call. */
export const onCallSubstitutes = (
  entries: ReadonlyArray<AdmissionOutcomeEntry>,
): ReadonlyArray<OnCallSubstitute> =>
  entries.flatMap((entry) =>
    entry.outcome === "Substitute"
      ? [
          {
            applicationId: entry.applicationId,
            firstName: entry.firstName,
            lastName: entry.lastName,
            email: entry.email,
            phone: entry.phone,
          },
        ]
      : [],
  );
