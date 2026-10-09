import { Data, Predicate, Result, Schema } from "effect";
import { DepartmentId, PersonId } from "../organization/schema.js";
import { canonicalJsonBytes, sha256Hex } from "../shared-kernel/index.js";

const Id = Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,256}$/)));

const Label = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(1024)));

const Digest = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)));

const ReviewedInstant = Schema.String.pipe(
  Schema.check(
    Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/),
  ),
);

const bounded = <S extends Schema.Constraint>(schema: S) =>
  Schema.Array(schema).pipe(Schema.check(Schema.isMaxLength(100000)));

/** Raw source values stay intact. Account custody uses a keyed commitment only. */
export const ReceiptSourceRow = Schema.Struct({
  sourcePrimaryKey: Id,
  sourceUserId: Schema.NullOr(Id),
  visualId: Schema.NullOr(Schema.String),
  amountDecimal: Schema.String,
  description: Schema.String,
  receiptDate: Schema.String,
  submittedAt: Schema.NullOr(Schema.String),
  status: Schema.String,
  refundDate: Schema.NullOr(Schema.String),
  picturePath: Schema.NullOr(Schema.String),
  accountCommitment: Schema.NullOr(Label),
});

export type ReceiptSourceRow = typeof ReceiptSourceRow.Type;

const CommonEntry = {
  sourcePrimaryKey: Id,
  sourceRowDigest: Digest,
  evidenceRef: Label,
};

export const ReceiptReviewEntry = Schema.Union([
  Schema.TaggedStruct("Excluded", {
    ...CommonEntry,
    reason: Label,
  }),
  Schema.TaggedStruct("Import", {
    ...CommonEntry,
    person: Schema.NullOr(
      Schema.Struct({ occurrenceId: Id, sourceUserId: Id, personId: PersonId }),
    ),
    department: Schema.Struct({ sourceDepartmentId: Id, departmentId: DepartmentId }),
    // The classifier, not the envelope decoder, quarantines invalid dates.
    receiptDate: Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/))),
    submittedAt: ReviewedInstant,
    approvedAt: Schema.NullOr(ReviewedInstant),
    file: Schema.Struct({
      path: Label,
      sha256: Digest,
      byteLength: Schema.Int.pipe(
        Schema.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
      ),
      contentType: Schema.Literals(["application/pdf", "image/png", "image/jpeg"]),
    }),
    payment: Schema.Struct({ commitment: Schema.NullOr(Label), evidenceRef: Label }),
  }),
]);

export type ReceiptReviewEntry = typeof ReceiptReviewEntry.Type;

export const ReceiptReview = Schema.Struct({
  sourceRepository: Label,
  sourceRevision: Id,
  receiptSourceRevision: Digest,
  snapshotId: Id,
  sourceWatermark: Label,
  transformationRevision: Id,
  personSnapshotKey: Digest,
  referenceSnapshotId: Id,
  referenceDigest: Digest,
  attestedBy: Id,
  evidenceRef: Label,
  entries: bounded(ReceiptReviewEntry),
});

export type ReceiptReview = typeof ReceiptReview.Type;

export const ReviewedReceiptSnapshot = Schema.Struct({
  review: ReceiptReview,
  rows: bounded(ReceiptSourceRow),
});

export type ReviewedReceiptSnapshot = typeof ReviewedReceiptSnapshot.Type;

export class ReceiptCohortFailure extends Data.TaggedError("ReceiptCohortFailure")<{
  readonly code: string;
}> {}

export const receiptEvidenceDigest = (value: Schema.Json): string =>
  sha256Hex(canonicalJsonBytes(value));

export const receiptSourceRowDigest = (row: ReceiptSourceRow): string => receiptEvidenceDigest(row);

/** Row order is not evidence; every source identity and raw value is. */
export const receiptSourceRevision = (rows: readonly ReceiptSourceRow[]): string =>
  receiptEvidenceDigest(
    [...rows].sort((left, right) =>
      left.sourcePrimaryKey < right.sourcePrimaryKey
        ? -1
        : left.sourcePrimaryKey > right.sourcePrimaryKey
          ? 1
          : 0,
    ),
  );

export const decodeReviewedReceiptSnapshot = (
  input: Schema.Json,
): Result.Result<ReviewedReceiptSnapshot, ReceiptCohortFailure> =>
  Result.gen(function* () {
    const invalidReview = () => new ReceiptCohortFailure({ code: "InvalidReview" });

    const snapshot = yield* Schema.decodeUnknownResult(ReviewedReceiptSnapshot)(input, {
      onExcessProperty: "error",
    }).pipe(Result.mapError(() => new ReceiptCohortFailure({ code: "InvalidSnapshot" })));

    const entries = new Map(
      snapshot.review.entries.map((entry) => [entry.sourcePrimaryKey, entry]),
    );

    const sourceIds = new Set(snapshot.rows.map((row) => row.sourcePrimaryKey));

    if (
      entries.size !== snapshot.review.entries.length ||
      sourceIds.size !== snapshot.rows.length ||
      entries.size !== sourceIds.size ||
      receiptSourceRevision(snapshot.rows) !== snapshot.review.receiptSourceRevision
    )
      return yield* Result.fail(invalidReview());

    for (const row of snapshot.rows) {
      const entry = entries.get(row.sourcePrimaryKey);

      if (!entry || entry.sourceRowDigest !== receiptSourceRowDigest(row))
        return yield* Result.fail(invalidReview());

      if (Predicate.isTagged(entry, "Excluded")) continue;

      if (
        (entry.person !== null && entry.person.sourceUserId !== row.sourceUserId) ||
        entry.payment.commitment !== row.accountCommitment ||
        (row.status === "refunded" && entry.approvedAt === null) ||
        ((row.status === "pending" || row.status === "rejected") && entry.approvedAt !== null)
      )
        return yield* Result.fail(invalidReview());
    }

    return snapshot;
  });
