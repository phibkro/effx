import { Context, Effect } from "effect";
import type {
  AdmissionPeriodCommandContext,
  AdmissionPeriodManagementContext,
  AdmissionPeriodTransactionResult,
} from "../admission-period/context.js";
import type { AdmissionPeriodFailure } from "../admission-period/errors.js";
import {
  type AdmissionPeriodProjection,
  type AdmissionPeriodCommand,
} from "../admission-period/schema.js";
import type { OrganizationPersonAuthority } from "../organization/authority.js";
import type { PersonId } from "../organization/schema.js";
import type {
  AdmissionOutcomeBoard,
  AdmissionOutcomeCommand,
  AdmissionOutcomeEntry,
  AdmissionOutcomeOperationFailure,
  AdmissionOutcomeScope,
  AdmissionOutcomeScopes,
} from "./outcome.js";
import type {
  ApplicantContactProjectionFailure,
  PublicApplicationError,
} from "../application/errors.js";
import {
  type ApplicantContactProjection,
  type ApplicantProgressResponse,
  type PublicApplicationCatalogContext,
  type PublicApplicationCatalogHttpSource,
  type PublicApplicationConfirmation,
  type PublicApplicationSubmitContext,
  type PublicApplicationId,
  type PublicApplicationSubmitResult,
  type PublicApplicationSubmitInput,
} from "../application/schema.js";

export interface AdmissionsOperations {
  readonly executeAdmissionPeriod: (
    input: AdmissionPeriodCommand,
    context: AdmissionPeriodCommandContext,
  ) => Effect.Effect<AdmissionPeriodTransactionResult, AdmissionPeriodFailure>;
  readonly listAdmissionPeriodsForManagement: (
    context: AdmissionPeriodManagementContext,
  ) => Effect.Effect<ReadonlyArray<AdmissionPeriodProjection>, AdmissionPeriodFailure>;
  readonly listOpenAdmissionPeriods: (
    now: string,
  ) => Effect.Effect<ReadonlyArray<AdmissionPeriodProjection>, AdmissionPeriodFailure>;
  readonly executePublicApplication: (
    input: PublicApplicationSubmitInput,
    context: PublicApplicationSubmitContext,
  ) => Effect.Effect<PublicApplicationSubmitResult, PublicApplicationError>;
  readonly listPublicApplicationCatalog: (
    context: PublicApplicationCatalogContext,
  ) => Effect.Effect<PublicApplicationCatalogHttpSource, PublicApplicationError>;
  readonly findPublicApplicationConfirmation: (
    applicationId: string,
  ) => Effect.Effect<PublicApplicationConfirmation, PublicApplicationError>;
  readonly readApplicantContacts: (
    applicationIds: ReadonlyArray<PublicApplicationId>,
  ) => Effect.Effect<ReadonlyArray<ApplicantContactProjection>, ApplicantContactProjectionFailure>;
  readonly readApplicantProgress: (
    personId: string,
    now: string,
  ) => Effect.Effect<ApplicantProgressResponse, PublicApplicationError>;
  /** Projects visible outcome scopes from supplied current authority; does not authenticate it. */
  readonly listAdmissionOutcomeScopes: (
    authority: OrganizationPersonAuthority,
  ) => Effect.Effect<AdmissionOutcomeScopes, AdmissionOutcomeOperationFailure>;
  /** Includes every application of the period. The caller conceals non-substitutes from members. */
  readonly readAdmissionOutcomes: (
    scope: AdmissionOutcomeScope,
  ) => Effect.Effect<AdmissionOutcomeBoard, AdmissionOutcomeOperationFailure>;
  /** Selects one application's entry. The caller checks scope and member visibility. */
  readonly readAdmissionOutcome: (
    applicationId: AdmissionOutcomeEntry["applicationId"],
  ) => Effect.Effect<AdmissionOutcomeEntry, AdmissionOutcomeOperationFailure>;
  /**
   * Runs inside the caller's transaction after current authority and receipt lookup.
   * Locks the application, reads the current entry, checks the transport precondition, and
   * appends the next outcome revision. Recording the current outcome again changes nothing.
   * The callback grants no authority and must not perform business writes.
   * Its failures and requirements propagate unchanged. Success precedes caller commit.
   */
  readonly recordAdmissionOutcome: <E, R>(
    input: {
      readonly applicationId: AdmissionOutcomeEntry["applicationId"];
      readonly command: AdmissionOutcomeCommand;
      readonly actor: PersonId;
      readonly now: string;
    },
    checkPrecondition: (current: AdmissionOutcomeEntry) => Effect.Effect<void, E, R>,
  ) => Effect.Effect<AdmissionOutcomeEntry, AdmissionOutcomeOperationFailure | E, R>;
}

export class Admissions extends Context.Service<Admissions, AdmissionsOperations>()(
  "@vektorprogrammet/domain/Admissions",
) {}
