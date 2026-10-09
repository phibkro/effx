import { Context, Data, type Effect } from "effect";
import type { DepartmentId, OrganizationPersonAuthority, PersonId } from "../organization/index.js";
import type {
  CertificateCommandTarget,
  CertificateAssistant,
  CertificateIssue,
  CertificatePreview,
  CertificatePrincipal,
  CertificateScopes,
  CertificateSemesterScope,
  IssueCertificateCommand,
} from "./certificate.js";
import type {
  CertificateAuthorizationFailure,
  CertificateCommandFailure,
  CertificateReadFailure,
  DaysServedCommandFailure,
} from "./certificate-failures.js";
import type { AssistantPage, ConfirmDaysServedCommand, DaysServedEntry } from "./days-served.js";
import type { PlacementFailure } from "./policy.js";
import type { PlacementDraft } from "./scheduler.js";
import type {
  Affiliation,
  CoverageBoard,
  CoverageCommand,
  OwnAffiliationCommand,
  OwnCoverageCommand,
  OwnCoverageView,
  PlacementBoard,
  PlacementCommand,
  PlacementScope,
  PlacementScopes,
} from "./schema.js";

/** A database failure. Callers must not expose the internal cause to clients. */
export class PlacementPersistenceError extends Data.TaggedError("PlacementPersistenceError")<{
  readonly code: "internal.error" | "transaction.conflict";
  readonly status: 409 | 500;
  readonly cause: unknown;
}> {}

export type PlacementOperationFailure = PlacementFailure | PlacementPersistenceError;

export type PlacementMutation =
  | {
      readonly mode: "affiliation";
      readonly scope: { readonly departmentId: DepartmentId };
      readonly command: OwnAffiliationCommand;
    }
  | { readonly mode: "board"; readonly scope: PlacementScope; readonly command: PlacementCommand }
  | {
      readonly mode: "ownCoverage";
      readonly scope: PlacementScope;
      readonly command: OwnCoverageCommand;
    }
  | {
      readonly mode: "coverage";
      readonly scope: PlacementScope;
      readonly command: CoverageCommand;
    };

export type PlacementSnapshot = Affiliation | PlacementBoard | OwnCoverageView | CoverageBoard;

export interface PlacementExecution {
  readonly mutation: PlacementMutation;
  readonly actor: PersonId;
  readonly now: string;
  readonly commandId: string;
}

/** One page of the assistants of a department and semester, with the scope's labels. */
export interface DaysServedPage extends AssistantPage<DaysServedEntry> {
  readonly departmentName: string;
  readonly semester: CertificateSemesterScope;
}

/** One page of the assistants with service facts in a department. */
export interface CertificateAssistantPage extends AssistantPage<CertificateAssistant> {
  readonly departmentName: string;
}

/**
 * Trusted server operations, not an authentication boundary. The placement operations expect
 * callers to authorize reads and writes before invocation. The days-served and certificate
 * operations resolve the principal's current Organization authority themselves, on the caller's
 * transaction connection; commands hold their locks, facts, and history in that transaction.
 * The concrete Layer captures Database; execute also retains callback requirements.
 */
export interface PlacementsOperations {
  /** Projects management availability from supplied authority; does not authenticate it. */
  readonly listScopes: (
    authority: OrganizationPersonAuthority,
  ) => Effect.Effect<typeof PlacementScopes.Type, PlacementOperationFailure>;
  /** Returns Absent at revision zero when a known department has no affiliation. */
  readonly readOwnAffiliation: (
    personId: PersonId,
    departmentId: DepartmentId,
  ) => Effect.Effect<Affiliation, PlacementOperationFailure>;
  /**
   * Drafts placements for the scoped board after caller authorization. The draft reads
   * demand, placements, capacity plans, and current availability, and writes nothing;
   * the same facts give the same draft.
   */
  readonly readDraft: (
    scope: PlacementScope,
  ) => Effect.Effect<PlacementDraft, PlacementOperationFailure>;
  /** Reads the scoped board after caller authorization. */
  readonly readBoard: (
    scope: PlacementScope,
  ) => Effect.Effect<PlacementBoard, PlacementOperationFailure>;
  /**
   * Reads one person's coverage after caller authorization.
   * Current placements include only active rows for that person, department, and semester.
   * Placements, confirmed roster slots, and dated commitments remain separate facts.
   * Commitments are those where the person is scheduled or covers a recorded absence.
   * Coverers are listed only while the person has an absence in an open commitment.
   */
  readonly readOwnCoverage: (
    scope: PlacementScope,
    personId: PersonId,
  ) => Effect.Effect<OwnCoverageView, PlacementOperationFailure>;
  /** Reads coordinator coverage after caller authorization. Coverage lists current records only. */
  readonly readCoverageBoard: (
    scope: PlacementScope,
  ) => Effect.Effect<CoverageBoard, PlacementOperationFailure>;
  /**
   * Runs on the caller's transaction after current authority and receipt lookup.
   * Holds the department lock across the snapshot precondition, transition,
   * audit, history, and outbox writes. The callback checks a transport-owned
   * precondition; it does not authorize the command or perform business writes.
   * Success returns a snapshot before the caller commits its transaction.
   * Callback failures propagate unchanged; execute does not retry or deliver notifications.
   */
  readonly execute: <E, R>(
    input: PlacementExecution,
    checkPrecondition: (current: PlacementSnapshot) => Effect.Effect<void, E, R>,
  ) => Effect.Effect<PlacementSnapshot, PlacementOperationFailure | E, R>;
  /**
   * The departments where the principal confirms days served or issues certificates. Either
   * capability in one department grants the read; a principal with neither is denied.
   */
  readonly readCertificateScopes: (
    principal: CertificatePrincipal,
  ) => Effect.Effect<CertificateScopes, CertificateReadFailure>;
  /**
   * One bounded page of the assistants of a department and semester: everyone with counted
   * attendance, an accepted legacy total, an active placement, or a confirmation there. Requires
   * `placements.days-served` in the department.
   */
  readonly readDaysServed: (
    principal: CertificatePrincipal,
    scope: PlacementScope,
    cursor?: string,
  ) => Effect.Effect<DaysServedPage, CertificateReadFailure>;
  /**
   * Resolves the principal's current authority for one days-served or certificate command on the
   * caller's transaction, with the command's locks, before a stored response can replay.
   */
  readonly authorizeCertificateCommand: (
    principal: CertificatePrincipal,
    target: CertificateCommandTarget,
  ) => Effect.Effect<void, CertificateAuthorizationFailure>;
  /**
   * Appends the next confirmation of one assistant's total under the department lock, after the
   * transport precondition on the fresh entry. Never changes an earlier confirmation or a service
   * fact. The callback grants no authority and must not write business state.
   */
  readonly confirmDaysServed: <E, R>(
    principal: CertificatePrincipal,
    command: ConfirmDaysServedCommand,
    checkPrecondition: (current: DaysServedEntry) => Effect.Effect<void, E, R>,
  ) => Effect.Effect<DaysServedEntry, DaysServedCommandFailure | E, R>;
  /** One bounded page of the assistants with service facts in a department; issuers only. */
  readonly listCertificates: (
    principal: CertificatePrincipal,
    departmentId: DepartmentId,
    cursor?: string,
  ) => Effect.Effect<CertificateAssistantPage, CertificateReadFailure>;
  /** The certificate that the principal would issue now, and the semesters it leaves out. */
  readonly readCertificate: (
    principal: CertificatePrincipal,
    departmentId: DepartmentId,
    personId: PersonId,
  ) => Effect.Effect<CertificatePreview, CertificateReadFailure>;
  /**
   * Records one issue of the current certificate under the department lock, after the transport
   * precondition on the fresh preview: who, when, the authorizing seat, and the content hash.
   */
  readonly issueCertificate: <E, R>(
    principal: CertificatePrincipal,
    command: IssueCertificateCommand,
    checkPrecondition: (current: CertificatePreview) => Effect.Effect<void, E, R>,
  ) => Effect.Effect<CertificateIssue, CertificateCommandFailure | E, R>;
}

/** The portable service key. The server entry point supplies its database-backed Layer. */
export class Placements extends Context.Service<Placements, PlacementsOperations>()(
  "@vektorprogrammet/domain/Placements",
) {}
