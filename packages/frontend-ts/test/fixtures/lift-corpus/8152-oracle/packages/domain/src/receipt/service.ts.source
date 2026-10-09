/**
 * Portable Economy service contract for receipt lifecycle and settlement operations.
 *
 * @since 0.1.0
 */
import { Data, Context, Effect } from "effect";
import type { ReceiptPage } from "./pagination.js";
import type { OrganizationAuthorityInstant } from "../organization/authority.js";
import type { DepartmentId, PersonId } from "../organization/schema.js";
import type { ReceiptAuxiliaryEffects } from "./auxiliary-service.js";
import type {
  ReceiptDecodeError,
  ReceiptApprovalFileReadFailure,
  ReceiptApprovalListFailure,
  ReceiptFailure,
  ReceiptNotFound,
  ReceiptPersistenceError,
  ReceiptSettlementFailure,
  ReceiptSettlementListFailure,
  ReceiptSettlementReadFailure,
} from "./errors.js";
import type { ReceiptFileService } from "./file-service.js";
import type { ReceiptOutboxDeliveryResult } from "./outbox.js";
import type {
  OwnedReceiptProjectionItem,
  ReceiptLifecycleEvidenceProjection,
  ReceiptListItem,
  ReceiptSettlementQueueItem,
  ReceiptStatusTotal,
} from "./projections.js";
import {
  type ReceiptSettlementCommandRequest,
  type Receipt,
  type ReceiptActor,
  type ReceiptCommandPrincipal,
  type ReceiptFile,
  type ReceiptId,
  type ReceiptObservation,
  type ReceiptSettlementEvidence,
  type ReceiptSettlementObservation,
  type ReceiptStatus,
  type ReceiptSubmissionAllocation,
  type ReceiptCommandRequest,
} from "./schema.js";

export interface ReceiptTransactionResult {
  readonly observation: ReceiptObservation;
  readonly receipt: Receipt;
  readonly replayed: boolean;
  readonly outboxCount: number;
}

export interface ReceiptSettlementTransactionResult {
  readonly observation: ReceiptSettlementObservation;
  readonly receipt: Receipt;
  readonly settlement: ReceiptSettlementEvidence;
  readonly replayed: boolean;
  readonly outboxCount: number;
}

type ExistingReceiptMutation = Exclude<ReceiptCommandRequest["_tag"], "SubmitReceipt">;

export type ReceiptMutationAuthorizationTarget = Data.TaggedEnum<
  {
    readonly SubmitReceipt: { readonly departmentId?: DepartmentId };
  } & {
    readonly [Action in ExistingReceiptMutation]: { readonly receiptId: string };
  }
>;

export const ReceiptMutationAuthorizationTarget =
  Data.taggedEnum<ReceiptMutationAuthorizationTarget>();

export type ReceiptMutationAuthorization = Data.TaggedEnum<
  {
    readonly SubmitReceipt: {
      readonly principal: ReceiptCommandPrincipal;
      readonly actor: ReceiptActor;
      readonly departmentId: DepartmentId;
      readonly paymentAccountCiphertext: string;
    };
  } & {
    readonly [Action in ExistingReceiptMutation]: {
      readonly principal: ReceiptCommandPrincipal;
      readonly actor: ReceiptActor;
      readonly current: Receipt;
    };
  }
>;

export const ReceiptMutationAuthorization = Data.taggedEnum<ReceiptMutationAuthorization>();

export interface EconomyOperations {
  readonly executeReceipt: (
    input: ReceiptCommandRequest,
    principal: ReceiptCommandPrincipal,
    allocation?: ReceiptSubmissionAllocation,
  ) => Effect.Effect<ReceiptTransactionResult, ReceiptFailure>;
  /**
   * Resolves current authority for one mutation target on the caller's
   * transaction connection. The returned witness is valid only in that
   * transaction and does not apply a lifecycle transition.
   */
  readonly authorizeReceiptMutation: (
    target: ReceiptMutationAuthorizationTarget,
    principal: ReceiptCommandPrincipal,
  ) => Effect.Effect<ReceiptMutationAuthorization, ReceiptFailure>;
  readonly executeAuthorizedReceipt: (
    input: ReceiptCommandRequest,
    authorization: ReceiptMutationAuthorization,
    allocation?: ReceiptSubmissionAllocation,
  ) => Effect.Effect<ReceiptTransactionResult, ReceiptFailure>;
  /** Reads the revision under current settlement authority on the caller's transaction. */
  readonly readReceiptSettlementRevision: (
    receiptId: ReceiptId,
    principal: ReceiptCommandPrincipal,
  ) => Effect.Effect<Receipt["revision"], ReceiptSettlementFailure>;
  readonly recordReceiptSettlement: (
    input: ReceiptSettlementCommandRequest,
    principal: ReceiptCommandPrincipal,
  ) => Effect.Effect<ReceiptSettlementTransactionResult, ReceiptSettlementFailure>;
  readonly listOwnedReceipts: (
    ownerPersonId: string,
    status?: ReceiptStatus,
    after?: string,
  ) => Effect.Effect<
    ReceiptPage<OwnedReceiptProjectionItem>,
    ReceiptPersistenceError | ReceiptDecodeError
  >;
  readonly listReceiptsForApproval: (
    personId: PersonId,
    authorizationInstant: OrganizationAuthorityInstant,
    status?: ReceiptStatus,
    after?: string,
  ) => Effect.Effect<ReceiptPage<ReceiptListItem>, ReceiptApprovalListFailure>;
  readonly listReceiptsForSettlement: (
    personId: PersonId,
    authorizationInstant: OrganizationAuthorityInstant,
    after?: string,
  ) => Effect.Effect<ReceiptPage<ReceiptSettlementQueueItem>, ReceiptSettlementListFailure>;
  /**
   * Resolves one approved receipt's private-file metadata on the caller-owned
   * repeatable-read, read-only transaction. The caller authenticates in that
   * same transaction before invoking this read.
   */
  readonly readReceiptFileForApproval: (
    receiptId: string,
    personId: PersonId,
    authorizationInstant: OrganizationAuthorityInstant,
  ) => Effect.Effect<ReceiptFile, ReceiptApprovalFileReadFailure>;
  readonly readReceiptSettlementForFinance: (
    receiptId: string,
    personId: PersonId,
    authorizationInstant: OrganizationAuthorityInstant,
  ) => Effect.Effect<ReceiptSettlementEvidence, ReceiptSettlementReadFailure>;
  readonly readReceiptLifecycleEvidence: (
    receiptId: string,
    ownerPersonId: string,
  ) => Effect.Effect<ReceiptLifecycleEvidenceProjection, ReceiptPersistenceError | ReceiptNotFound>;
  readonly receiptStatusTotals: Effect.Effect<
    ReadonlyArray<ReceiptStatusTotal>,
    ReceiptPersistenceError
  >;
  readonly listStaleOutboxClaims: (
    claimedBefore: string,
    receiptId?: string,
  ) => Effect.Effect<ReadonlyArray<string>, ReceiptPersistenceError>;
  readonly recoverStaleOutboxClaim: (
    claimId: string,
    claimedBefore: string,
  ) => Effect.Effect<number, ReceiptPersistenceError>;
  readonly deliverNextOutboxEffect: (
    claimId: string,
    claimedAt: string,
    receiptId?: string,
  ) => Effect.Effect<
    ReceiptOutboxDeliveryResult,
    ReceiptPersistenceError,
    ReceiptFileService | ReceiptAuxiliaryEffects
  >;
}

export class Economy extends Context.Service<Economy, EconomyOperations>()(
  "@vektorprogrammet/domain/Economy",
) {}
