import { Data, Predicate, Schema } from "effect";
import {
  isIsoDate,
  isIsoInstant,
  ReceiptId,
  ReceiptVisualId,
  type LegacyReceiptRow,
  type Receipt,
  type ReceiptFile,
  type ReceiptStatus,
} from "./schema.js";
import { normalizeRfc3339Instant } from "../time.js";

export const ReceiptQuarantineReason = Schema.Literals([
  "InvalidSourceRow",
  "UnsafeFilePath",
  "FileDigestMismatch",
  "SourceDigestMismatch",
  "UnresolvedOwner",
  "UnresolvedDepartment",
  "MissingVisualId",
  "DuplicateVisualId",
  "SourceIdentityCollision",
  "InvalidDestinationIdentity",
  "DestinationIdentityCollision",
  "InvalidAmount",
  "UnsupportedFile",
  "InvalidFileIdentity",
  "UnreadableFile",
  "InvalidDescription",
  "InvalidReceiptDate",
  "InvalidSubmittedAt",
  "UnknownStatus",
  "RefundDateContradiction",
  "MissingPaymentAccount",
  "MissingFile",
]);

export type ReceiptQuarantineReason = typeof ReceiptQuarantineReason.Type;

export interface ReceiptImportProvenance {
  readonly sourceRepository: string;
  readonly sourceRevision: string;
  readonly snapshotId: string;
  readonly sourceWatermark: string;
  readonly transformationRevision: string;
  readonly sourceDigest: string;
  readonly destinationIdentity: string;
}

export type ReceiptImportResult =
  | {
      readonly _tag: "AcceptedReceiptImport";
      readonly sourcePrimaryKey: string;
      readonly sourceOccurrence: number;
      readonly targetSemanticIdentity: string;
      readonly receipt: Receipt;
      readonly provenance: ReceiptImportProvenance;
      readonly reconciliation: "Pending";
    }
  | {
      readonly _tag: "QuarantinedReceiptImport";
      readonly sourcePrimaryKey: string;
      readonly sourceOccurrence: number;
      readonly targetSemanticIdentity: string;
      readonly reasons: ReadonlyArray<ReceiptQuarantineReason>;
      readonly provenance: ReceiptImportProvenance;
      readonly reconciliation: "NotApplicable";
    };

export const ReceiptImportResult = Data.taggedEnum<ReceiptImportResult>();

const exactOre = (value: string): number | undefined => {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value);

  if (match === null) return undefined;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? "").padEnd(2, "0");
  const ore = whole * 100 + Number(fraction);

  return Number.isSafeInteger(ore) && ore > 0 ? ore : undefined;
};

const status = (value: string): ReceiptStatus | undefined => {
  switch (value) {
    case "pending":
      return "Pending";
    case "refunded":
      return "Approved";
    case "rejected":
      return "Rejected";
    default:
      return undefined;
  }
};

const validLegacyFile = (file: NonNullable<LegacyReceiptRow["file"]>): file is ReceiptFile =>
  file.fileRef.length > 0 &&
  file.objectKey.length > 0 &&
  file.fileRef !== file.objectKey &&
  (file.contentType === "image/jpeg" ||
    file.contentType === "image/png" ||
    file.contentType === "application/pdf") &&
  Number.isSafeInteger(file.byteLength) &&
  file.byteLength > 0 &&
  /^[a-f0-9]{64}$/.test(file.sha256);

const importReceiptOccurrence = (
  row: LegacyReceiptRow,
  receiptId: string,
  provenance: ReceiptImportProvenance,
  sourceOccurrence: number,
): ReceiptImportResult => {
  const targetSemanticIdentity =
    row.visualId !== null && row.visualId.length > 0
      ? row.visualId
      : provenance.destinationIdentity.length > 0
        ? provenance.destinationIdentity
        : row.sourcePrimaryKey;

  const reasons: ReceiptQuarantineReason[] = [];
  const amountOre = exactOre(row.amountDecimal);
  const importedStatus = status(row.status);

  if (row.ownerPersonId === null || row.ownerPersonId.length === 0) {
    reasons.push("UnresolvedOwner");
  }

  if (row.departmentId === null || row.departmentId.length === 0) {
    reasons.push("UnresolvedDepartment");
  }

  if (row.visualId === null || row.visualId.length === 0) reasons.push("MissingVisualId");

  if (receiptId.length === 0 || provenance.destinationIdentity !== receiptId) {
    reasons.push("InvalidDestinationIdentity");
  }

  if (amountOre === undefined) reasons.push("InvalidAmount");

  if (row.description.length === 0 || row.description.length > 5000) {
    reasons.push("InvalidDescription");
  }

  if (!isIsoDate(row.receiptDate)) reasons.push("InvalidReceiptDate");

  if (!isIsoInstant(row.submittedAt)) reasons.push("InvalidSubmittedAt");

  if (importedStatus === undefined) reasons.push("UnknownStatus");

  if (
    (importedStatus === "Approved" && (row.refundDate === null || !isIsoInstant(row.refundDate))) ||
    (importedStatus !== undefined && importedStatus !== "Approved" && row.refundDate !== null)
  ) {
    reasons.push("RefundDateContradiction");
  }

  if (row.paymentAccountCiphertext === null || row.paymentAccountCiphertext.length === 0) {
    reasons.push("MissingPaymentAccount");
  }

  if (row.file === null) {
    reasons.push("MissingFile");
  } else {
    if (
      row.file.contentType !== "image/jpeg" &&
      row.file.contentType !== "image/png" &&
      row.file.contentType !== "application/pdf"
    ) {
      reasons.push("UnsupportedFile");
    }

    if (row.file.fileRef === row.file.objectKey) {
      reasons.push("InvalidFileIdentity");
    } else if (!validLegacyFile(row.file) && !reasons.includes("UnsupportedFile")) {
      reasons.push("UnreadableFile");
    }
  }

  if (
    reasons.length > 0 ||
    row.ownerPersonId === null ||
    row.departmentId === null ||
    row.visualId === null ||
    amountOre === undefined ||
    importedStatus === undefined ||
    row.paymentAccountCiphertext === null ||
    row.file === null ||
    !validLegacyFile(row.file)
  ) {
    return ReceiptImportResult.QuarantinedReceiptImport({
      sourcePrimaryKey: row.sourcePrimaryKey,
      sourceOccurrence,
      targetSemanticIdentity,
      reasons,
      provenance,
      reconciliation: "NotApplicable",
    });
  }

  return ReceiptImportResult.AcceptedReceiptImport({
    sourcePrimaryKey: row.sourcePrimaryKey,
    sourceOccurrence,
    targetSemanticIdentity,
    receipt: {
      receiptId: ReceiptId.make(receiptId),
      visualId: ReceiptVisualId.make(row.visualId),
      ownerPersonId: row.ownerPersonId,
      departmentId: row.departmentId,
      amountOre,
      currency: "NOK",
      description: row.description,
      receiptDate: row.receiptDate,
      submittedAt: normalizeRfc3339Instant(row.submittedAt),
      status: importedStatus,
      approvedAt: importedStatus === "Approved" ? normalizeRfc3339Instant(row.refundDate!) : null,
      paymentAccountCiphertext: row.paymentAccountCiphertext,
      file: row.file,
      revision: 0,
    },
    provenance,
    reconciliation: "Pending",
  });
};

/** Imports one legacy row as the first occurrence of its source identity. */
export const importLegacyReceipt = (
  row: LegacyReceiptRow,
  receiptId: string,
  provenance: ReceiptImportProvenance,
): ReceiptImportResult => importReceiptOccurrence(row, receiptId, provenance, 0);

export interface LegacyReceiptImportInput {
  readonly row: LegacyReceiptRow;
  readonly receiptId: string;
  readonly provenance: ReceiptImportProvenance;
}

export const importLegacyReceipts = (
  inputs: ReadonlyArray<LegacyReceiptImportInput>,
): ReadonlyArray<ReceiptImportResult> => {
  const sourceKeyCounts = new Map<string, number>();
  const visualIdCounts = new Map<string, number>();
  const destinationIdentityCounts = new Map<string, number>();

  for (const { row, receiptId } of inputs) {
    sourceKeyCounts.set(row.sourcePrimaryKey, (sourceKeyCounts.get(row.sourcePrimaryKey) ?? 0) + 1);

    if (row.visualId !== null) {
      visualIdCounts.set(row.visualId, (visualIdCounts.get(row.visualId) ?? 0) + 1);
    }

    destinationIdentityCounts.set(receiptId, (destinationIdentityCounts.get(receiptId) ?? 0) + 1);
  }

  const sourceKeyOccurrences = new Map<string, number>();

  return inputs.map(({ row, receiptId, provenance }) => {
    const sourceOccurrence = sourceKeyOccurrences.get(row.sourcePrimaryKey) ?? 0;
    sourceKeyOccurrences.set(row.sourcePrimaryKey, sourceOccurrence + 1);
    const result = importReceiptOccurrence(row, receiptId, provenance, sourceOccurrence);
    const duplicateReasons: ReceiptQuarantineReason[] = [];

    if ((sourceKeyCounts.get(row.sourcePrimaryKey) ?? 0) > 1) {
      duplicateReasons.push("SourceIdentityCollision");
    }

    if (row.visualId !== null && (visualIdCounts.get(row.visualId) ?? 0) > 1) {
      duplicateReasons.push("DuplicateVisualId");
    }

    if ((destinationIdentityCounts.get(receiptId) ?? 0) > 1) {
      duplicateReasons.push("DestinationIdentityCollision");
    }

    if (duplicateReasons.length === 0) return result;

    return ReceiptImportResult.QuarantinedReceiptImport({
      sourcePrimaryKey: row.sourcePrimaryKey,
      sourceOccurrence,
      targetSemanticIdentity: result.targetSemanticIdentity,
      reasons: Predicate.isTagged(result, "QuarantinedReceiptImport")
        ? [...result.reasons, ...duplicateReasons]
        : duplicateReasons,
      provenance,
      reconciliation: "NotApplicable",
    });
  });
};
