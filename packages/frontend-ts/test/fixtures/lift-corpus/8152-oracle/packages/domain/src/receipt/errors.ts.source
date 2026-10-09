import { Match, Schema } from "effect";
import type { DecisionReason } from "../authz/decision.js";
import { DepartmentId, PersonId } from "../organization/schema.js";
import { Rfc3339InstantSchema } from "../time.js";

export class ReceiptDecodeError extends Schema.TaggedError<ReceiptDecodeError>()(
  "ReceiptDecodeError",
  { message: Schema.String },
) {}

export class UnauthenticatedActor extends Schema.TaggedError<UnauthenticatedActor>()(
  "UnauthenticatedActor",
  { message: Schema.String },
) {}

export class InactiveActor extends Schema.TaggedError<InactiveActor>()("InactiveActor", {
  personId: Schema.String,
}) {}

export class ReceiptNotFound extends Schema.TaggedError<ReceiptNotFound>()("ReceiptNotFound", {
  receiptId: Schema.String,
}) {}

export class ReceiptAlreadyExists extends Schema.TaggedError<ReceiptAlreadyExists>()(
  "ReceiptAlreadyExists",
  { receiptId: Schema.String },
) {}

export class ReceiptAlreadySettled extends Schema.TaggedError<ReceiptAlreadySettled>()(
  "ReceiptAlreadySettled",
  { receiptId: Schema.String },
) {}

export class DuplicateExternalSettlementReference extends Schema.TaggedError<DuplicateExternalSettlementReference>()(
  "DuplicateExternalSettlementReference",
  { externalAuthority: Schema.String, externalReference: Schema.String },
) {}

export class SettlementAfterRecordedAt extends Schema.TaggedError<SettlementAfterRecordedAt>()(
  "SettlementAfterRecordedAt",
  { settledAt: Rfc3339InstantSchema, recordedAt: Rfc3339InstantSchema },
) {}

export class ReceiptScopeDenied extends Schema.TaggedError<ReceiptScopeDenied>()(
  "ReceiptScopeDenied",
  { receiptId: Schema.String, departmentId: Schema.String },
) {}

export class ReceiptOwnerDenied extends Schema.TaggedError<ReceiptOwnerDenied>()(
  "ReceiptOwnerDenied",
  { receiptId: Schema.String, personId: Schema.String },
) {}

export class StaleReceiptRevision extends Schema.TaggedError<StaleReceiptRevision>()(
  "StaleReceiptRevision",
  { receiptId: Schema.String, expected: Schema.Int, actual: Schema.Int },
) {}

export class InvalidReceiptTransition extends Schema.TaggedError<InvalidReceiptTransition>()(
  "InvalidReceiptTransition",
  { receiptId: Schema.String, status: Schema.String, command: Schema.String },
) {}

export class DuplicateReceiptCommandConflict extends Schema.TaggedError<DuplicateReceiptCommandConflict>()(
  "DuplicateReceiptCommandConflict",
  { commandId: Schema.String },
) {}

export class ReceiptPersistenceError extends Schema.TaggedError<ReceiptPersistenceError>()(
  "ReceiptPersistenceError",
  {
    operation: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

const ReceiptComposedCapabilitySchema = Schema.Literals(["submitReceipt", "approveReceipt"]);

export type ReceiptComposedCapability = typeof ReceiptComposedCapabilitySchema.Type;

const ReceiptAuthorityRecordKindSchema = Schema.Literals([
  "PaymentAuthority",
  "ApprovalGrant",
  "SettlementGrant",
]);

export class ReceiptAuthorityRecordNotFound extends Schema.TaggedError<ReceiptAuthorityRecordNotFound>()(
  "ReceiptAuthorityRecordNotFound",
  { entity: ReceiptAuthorityRecordKindSchema, id: Schema.String },
) {}

export class ReceiptAuthorityWriteConflict extends Schema.TaggedError<ReceiptAuthorityWriteConflict>()(
  "ReceiptAuthorityWriteConflict",
  {
    entity: ReceiptAuthorityRecordKindSchema,
    id: Schema.String,
    expectedRevision: Schema.Int,
  },
) {}

export class AmbiguousParameterFill extends Schema.TaggedError<AmbiguousParameterFill>()(
  "AmbiguousParameterFill",
  { personId: PersonId, capabilityId: ReceiptComposedCapabilitySchema },
) {}

export class FailedComposedRequirement extends Schema.TaggedError<FailedComposedRequirement>()(
  "FailedComposedRequirement",
  { personId: PersonId, capabilityId: ReceiptComposedCapabilitySchema },
) {}

/**
 * Stable boundary from the pure composer's bounded denial reasons to Economy
 * failures. Tests may call this helper with typed stub Decisions; doing so
 * does not declare parameter or requirement effects in the persisted registry.
 */
export const receiptCompositionFailure = (
  reason: DecisionReason,
  personId: PersonId,
  capabilityId: ReceiptComposedCapability,
): AmbiguousParameterFill | FailedComposedRequirement | undefined =>
  Match.value(reason).pipe(
    Match.when("Ambiguous", () => new AmbiguousParameterFill({ personId, capabilityId })),
    Match.when(
      "RequirementFailed",
      () => new FailedComposedRequirement({ personId, capabilityId }),
    ),
    Match.orElse(() => undefined),
  );

export const ReceiptAuthorityOperationSchema = Schema.Literals([
  "Submission",
  "DepartmentApproval",
  "GlobalApproval",
  "DepartmentSettlement",
  "GlobalSettlement",
  "Owner",
]);

export type ReceiptAuthorityOperation = typeof ReceiptAuthorityOperationSchema.Type;

export class ReceiptAuthorityDenied extends Schema.TaggedError<ReceiptAuthorityDenied>()(
  "ReceiptAuthorityDenied",
  {
    personId: PersonId,
    operation: ReceiptAuthorityOperationSchema,
    departmentId: Schema.NullOr(DepartmentId),
  },
) {}

export class AmbiguousReceiptPaymentAuthority extends Schema.TaggedError<AmbiguousReceiptPaymentAuthority>()(
  "AmbiguousReceiptPaymentAuthority",
  {
    personId: PersonId,
    departmentIds: Schema.Array(DepartmentId),
  },
) {}

/** The request must select one department when several active payment
 *  authorities apply; Economy never picks a primary department. */
export class AmbiguousPaymentSelection extends Schema.TaggedError<AmbiguousPaymentSelection>()(
  "AmbiguousPaymentSelection",
  { personId: PersonId, departmentIds: Schema.Array(DepartmentId) },
) {}

export class ReceiptAuthorityProjectionMismatch extends Schema.TaggedError<ReceiptAuthorityProjectionMismatch>()(
  "ReceiptAuthorityProjectionMismatch",
  {
    personId: PersonId,
    authorizationInstant: Rfc3339InstantSchema,
    organizationPersonId: PersonId,
    organizationEvaluatedAt: Rfc3339InstantSchema,
  },
) {}

export type ReceiptAuthorityMappingError =
  | ReceiptAuthorityDenied
  | AmbiguousReceiptPaymentAuthority;

export type ReceiptAuthorityResolutionError =
  | ReceiptDecodeError
  | ReceiptPersistenceError
  | ReceiptAuthorityProjectionMismatch;

export type ReceiptApprovalListFailure =
  | ReceiptDecodeError
  | InactiveActor
  | ReceiptScopeDenied
  | AmbiguousParameterFill
  | FailedComposedRequirement
  | ReceiptPersistenceError;

/** Typed read boundary for one canonical receipt file in the approval scope. */
export type ReceiptApprovalFileReadFailure = ReceiptApprovalListFailure | ReceiptNotFound;

export type ReceiptSettlementListFailure = ReceiptDecodeError | ReceiptPersistenceError;

export type ReceiptSettlementReadFailure =
  | ReceiptDecodeError
  | ReceiptNotFound
  | ReceiptPersistenceError;

export type ReceiptSettlementFailure =
  | ReceiptDecodeError
  | ReceiptNotFound
  | ReceiptAlreadySettled
  | DuplicateExternalSettlementReference
  | SettlementAfterRecordedAt
  | StaleReceiptRevision
  | InvalidReceiptTransition
  | DuplicateReceiptCommandConflict
  | ReceiptPersistenceError;

export type ReceiptFailure =
  | ReceiptDecodeError
  | UnauthenticatedActor
  | InactiveActor
  | ReceiptNotFound
  | ReceiptAlreadyExists
  | ReceiptScopeDenied
  | ReceiptOwnerDenied
  | StaleReceiptRevision
  | InvalidReceiptTransition
  | DuplicateReceiptCommandConflict
  | ReceiptAuthorityDenied
  | AmbiguousPaymentSelection
  | AmbiguousParameterFill
  | FailedComposedRequirement
  | ReceiptPersistenceError;
