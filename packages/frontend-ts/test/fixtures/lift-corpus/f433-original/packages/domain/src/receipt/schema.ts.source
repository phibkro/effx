/**
 * Public schemas for receipt commands, lifecycle state, settlement evidence,
 * and observations.
 *
 * @since 0.1.0
 */
import { DateTime, Schema } from "effect";
import { Model } from "effect/unstable/schema";
import { DepartmentId, PersonId } from "../organization/schema.js";
import { isRfc3339Instant, Rfc3339InstantSchema } from "../time.js";

const NonEmpty = Schema.String.pipe(Schema.check(Schema.isMinLength(1)));

const TrimmedNonEmpty = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value.trim() === value, {
      message: "a trimmed non-empty string",
    }),
  ),
);

const Sha256Hex = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value: string) => /^[a-f0-9]{64}$/.test(value), {
      message: "a lowercase SHA-256 digest",
    }),
  ),
);

export const isIsoDate = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  return DateTime.formatIsoDateUtc(DateTime.makeUnsafe(Date.UTC(year, month - 1, day))) === value;
};

export const isIsoInstant = isRfc3339Instant;

const IsoDate = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isIsoDate, { message: "a valid YYYY-MM-DD date" })),
);

const IsoInstant = Rfc3339InstantSchema;

const PositiveOre = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
);

const PositiveOreFromText = Schema.FiniteFromString.pipe(
  Schema.check(
    Schema.makeFilter(Number.isSafeInteger, { message: "an integer" }),
    Schema.isGreaterThan(0),
    Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
  ),
);

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const ReceiptId = NonEmpty.pipe(Schema.brand("ReceiptId"));

export type ReceiptId = typeof ReceiptId.Type;

export const ReceiptVisualId = NonEmpty.pipe(Schema.brand("ReceiptVisualId"));

export type ReceiptVisualId = typeof ReceiptVisualId.Type;

export const ReceiptSettlementId = NonEmpty.pipe(Schema.brand("ReceiptSettlementId"));

export type ReceiptSettlementId = typeof ReceiptSettlementId.Type;

export const ReceiptCommandPrincipalSchema = Schema.Struct({
  personId: PersonId,
  authorizationInstant: IsoInstant,
});

export type ReceiptCommandPrincipal = typeof ReceiptCommandPrincipalSchema.Type;

export const ReceiptSubmissionAllocationSchema = Schema.Struct({
  receiptId: ReceiptId,
  visualId: ReceiptVisualId,
});

export type ReceiptSubmissionAllocation = typeof ReceiptSubmissionAllocationSchema.Type;

export const ReceiptDecisionContextSchema = Schema.Struct({
  receiptId: ReceiptId,
  visualId: ReceiptVisualId,
  now: IsoInstant,
});

export const ReceiptStatusSchema = Schema.Literals([
  "Pending",
  "Approved",
  "Rejected",
  "Withdrawn",
]);

export type ReceiptStatus = typeof ReceiptStatusSchema.Type;

export const ApprovalScopeSchema = Schema.TaggedUnion({
  None: {},
  Department: { departmentId: DepartmentId },
  Global: {},
});

export type ApprovalScope = typeof ApprovalScopeSchema.Type;

export const ReceiptActorSchema = Schema.Struct({
  personId: PersonId,
  departmentId: DepartmentId,
  active: Schema.Boolean,
  approvalScope: ApprovalScopeSchema,
});

export type ReceiptActor = typeof ReceiptActorSchema.Type;

export const ReceiptSettlementActorSchema = Schema.Struct({
  personId: PersonId,
  active: Schema.Boolean,
  settlementScope: Schema.TaggedUnion({
    Department: { departmentId: DepartmentId },
    Global: {},
  }),
});

export type ReceiptSettlementActor = typeof ReceiptSettlementActorSchema.Type;

const ReceiptFileIdentityFields = {
  fileRef: NonEmpty,
  objectKey: NonEmpty,
  contentType: Schema.Literals(["image/jpeg", "image/png", "application/pdf"]),
  sha256: Sha256Hex,
} as const;

const distinctReceiptFileIdentity = Schema.makeFilter(
  (file: { readonly fileRef: string; readonly objectKey: string }) =>
    file.fileRef !== file.objectKey,
  { message: "different staging and committed object identities" },
);

export const ReceiptFileSchema = Schema.Struct({
  ...ReceiptFileIdentityFields,
  byteLength: PositiveOre,
}).pipe(Schema.check(distinctReceiptFileIdentity));

/** The largest receipt file, in bytes, that intake accepts: 10 MiB. */
export const RECEIPT_FILE_MAX_BYTES = 10 * 1024 * 1024;

const ReceiptFileSelectSchema = Schema.Struct({
  ...ReceiptFileIdentityFields,
  byteLength: PositiveOreFromText,
}).pipe(Schema.check(distinctReceiptFileIdentity));

export type ReceiptFile = typeof ReceiptFileSchema.Type;

const ReceiptPayloadFields = {
  description: Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(5000))),
  amountOre: PositiveOre,
  receiptDate: IsoDate,
};

const ReceiptFileSelectionSchema = Schema.Union([
  ReceiptFileSchema,
  Schema.TaggedUnion({
    KeepCurrentFile: {},
  }),
]);

export type ReceiptFileSelection = typeof ReceiptFileSelectionSchema.Type;

export const ReceiptCommandRequestSchema = Schema.TaggedUnion({
  SubmitReceipt: {
    commandId: NonEmpty,
    departmentId: Schema.optionalKey(DepartmentId),
    ...ReceiptPayloadFields,
    file: ReceiptFileSchema,
  },
  RevisePendingReceipt: {
    commandId: NonEmpty,
    receiptId: ReceiptId,
    expectedRevision: Revision,
    ...ReceiptPayloadFields,
    file: ReceiptFileSelectionSchema,
  },
  WithdrawPendingReceipt: {
    commandId: NonEmpty,
    receiptId: ReceiptId,
    expectedRevision: Revision,
  },
  ApproveReceipt: {
    commandId: NonEmpty,
    receiptId: ReceiptId,
    expectedRevision: Revision,
  },
  RejectReceipt: {
    commandId: NonEmpty,
    receiptId: ReceiptId,
    expectedRevision: Revision,
  },
  ReopenRejectedReceipt: {
    commandId: NonEmpty,
    receiptId: ReceiptId,
    expectedRevision: Revision,
  },
});

export type ReceiptCommandRequest = typeof ReceiptCommandRequestSchema.Type;

export const ReceiptSettlementCommandRequestSchema = Schema.TaggedUnion({
  RecordReceiptSettlement: {
    commandId: NonEmpty,
    receiptId: ReceiptId,
    expectedRevision: Revision,
    externalAuthority: TrimmedNonEmpty,
    externalReference: TrimmedNonEmpty,
    settledAt: IsoInstant,
  },
});

export type ReceiptSettlementCommandRequest = typeof ReceiptSettlementCommandRequestSchema.Type;

export class Receipt extends Model.Class<Receipt>("Receipt")({
  receiptId: Model.Field({
    select: ReceiptId,
    insert: ReceiptId,
    json: ReceiptId,
  }),
  visualId: Model.Field({
    select: ReceiptVisualId,
    insert: ReceiptVisualId,
    json: ReceiptVisualId,
  }),
  ownerPersonId: Model.Field({
    select: PersonId,
    insert: PersonId,
    json: PersonId,
  }),
  departmentId: Model.Field({
    select: DepartmentId,
    insert: DepartmentId,
    json: DepartmentId,
  }),
  amountOre: Model.Field({
    select: PositiveOreFromText,
    insert: PositiveOre,
    update: PositiveOre,
    json: PositiveOre,
    jsonCreate: PositiveOre,
    jsonUpdate: PositiveOre,
  }),
  currency: Model.Field({
    select: Schema.Literal("NOK"),
    insert: Schema.Literal("NOK"),
    json: Schema.Literal("NOK"),
  }),
  description: ReceiptPayloadFields.description,
  receiptDate: ReceiptPayloadFields.receiptDate,
  submittedAt: Model.Field({
    select: IsoInstant,
    insert: IsoInstant,
    json: IsoInstant,
  }),
  status: Model.Field({
    select: ReceiptStatusSchema,
    insert: ReceiptStatusSchema,
    update: ReceiptStatusSchema,
    json: ReceiptStatusSchema,
  }),
  approvedAt: Model.Field({
    select: Schema.NullOr(IsoInstant),
    insert: Schema.NullOr(IsoInstant),
    update: Schema.NullOr(IsoInstant),
    json: Schema.NullOr(IsoInstant),
  }),
  paymentAccountCiphertext: Model.Field({
    select: NonEmpty,
    insert: NonEmpty,
  }),
  file: Model.Field({
    select: ReceiptFileSelectSchema,
    insert: ReceiptFileSchema,
    update: ReceiptFileSchema,
  }),
  revision: Model.Field({
    select: Revision,
    insert: Revision,
    update: Revision,
    json: Revision,
  }),
}) {}

const ReceiptSettlementEvidenceFields = {
  settlementId: ReceiptSettlementId,
  receiptId: ReceiptId,
  currency: Schema.Literal("NOK"),
  paymentDestinationFingerprint: Sha256Hex,
  externalAuthority: TrimmedNonEmpty,
  externalReference: TrimmedNonEmpty,
  settledAt: IsoInstant,
  recordedByPersonId: PersonId,
  recordedAt: IsoInstant,
  receiptRevision: Revision,
} as const;

/** Immutable evidence recorded after an external settlement has completed. */
export const ReceiptSettlementEvidenceSchema = Schema.Struct({
  ...ReceiptSettlementEvidenceFields,
  amountOre: PositiveOre,
});

export type ReceiptSettlementEvidence = typeof ReceiptSettlementEvidenceSchema.Type;

/** PostgreSQL selection form which decodes bigint text into the public number. */
export const ReceiptSettlementEvidenceSelectSchema = Schema.Struct({
  ...ReceiptSettlementEvidenceFields,
  amountOre: PositiveOreFromText,
});

export const ReceiptObservationSchema = Schema.Struct({
  commandId: NonEmpty,
  receiptId: ReceiptId,
  visualId: ReceiptVisualId,
  status: ReceiptStatusSchema,
  revision: Revision,
  replayed: Schema.Boolean,
});

export type ReceiptObservation = typeof ReceiptObservationSchema.Type;

export const ReceiptSettlementObservationSchema = Schema.Struct({
  commandId: NonEmpty,
  receiptId: ReceiptId,
  settlementId: ReceiptSettlementId,
  revision: Revision,
  replayed: Schema.Boolean,
});

export type ReceiptSettlementObservation = typeof ReceiptSettlementObservationSchema.Type;

export const LegacyReceiptFileSchema = Schema.Struct({
  fileRef: Schema.String,
  objectKey: Schema.String,
  contentType: Schema.String,
  byteLength: Schema.Finite,
  sha256: Schema.String,
});

export const LegacyReceiptRowSchema = Schema.Struct({
  sourcePrimaryKey: NonEmpty,
  ownerPersonId: Schema.NullOr(PersonId),
  departmentId: Schema.NullOr(DepartmentId),
  visualId: Schema.NullOr(NonEmpty),
  amountDecimal: NonEmpty,
  description: NonEmpty,
  receiptDate: NonEmpty,
  submittedAt: NonEmpty,
  status: NonEmpty,
  refundDate: Schema.NullOr(NonEmpty),
  paymentAccountCiphertext: Schema.NullOr(NonEmpty),
  file: Schema.NullOr(LegacyReceiptFileSchema),
});

export type LegacyReceiptRow = typeof LegacyReceiptRowSchema.Type;
