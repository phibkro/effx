import type { Receipt, ReceiptSettlementEvidence } from "./schema.js";

export interface ReceiptListItem extends Pick<
  Receipt,
  | "receiptId"
  | "visualId"
  | "ownerPersonId"
  | "departmentId"
  | "description"
  | "currency"
  | "status"
  | "receiptDate"
  | "approvedAt"
  | "revision"
> {
  readonly amountOre: string;
}

/** Approved, unsettled claims visible to the caller's settlement grant. */
export interface ReceiptSettlementQueueItem extends Omit<ReceiptListItem, "status" | "approvedAt"> {
  readonly status: "Approved";
  readonly approvedAt: string;
}

export interface ReceiptStatusTotal {
  readonly status: ReceiptListItem["status"];
  readonly receiptCount: string;
  readonly amountOre: string;
}

export interface OwnedReceiptProjectionItem extends ReceiptListItem {
  readonly submittedAt: Receipt["submittedAt"];
  readonly settlement: ReceiptSettlementEvidence | null;
}

export interface ReceiptLifecycleOutboxProjection {
  readonly effectId: string;
  readonly effectType: string;
  readonly commandId: string;
  readonly receiptId: string;
  readonly ordinal: number;
  readonly status: string;
  readonly attempts: number;
  readonly lastFailureTag: string | null;
}

export interface ReceiptLifecycleAuditProjection {
  readonly commandId: string;
  readonly receiptId: string;
  readonly action: string;
  readonly receiptRevision: number;
}

export interface ReceiptLifecycleEvidenceProjection {
  readonly receiptId: string;
  readonly file: {
    readonly fileRef: string;
    readonly objectKey: string;
    readonly contentType: string;
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly settlement: ReceiptSettlementEvidence | null;
  readonly outbox: ReadonlyArray<ReceiptLifecycleOutboxProjection>;
  readonly audit: ReadonlyArray<ReceiptLifecycleAuditProjection>;
}
