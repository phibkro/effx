/**
 * Public and internal HTTP contracts for receipt lifecycle operations.
 *
 * @since 0.1.0
 */
import {
  INTERNAL_RECEIPT_EVIDENCE_ACCESS,
  RECEIPT_APPROVAL_QUEUE_ACCESS,
  makeAccessSpec,
  CredentialMechanismSchema,
  CapabilityExpressionSchema,
  CapabilityTypeId,
  ConcealmentPolicySchema,
} from "@vektorprogrammet/domain/authz";
import {
  ReceiptCursor,
  RECEIPT_PAGE_SIZE,
  Receipt,
  ReceiptId,
  ReceiptSettlementEvidenceSchema,
  ReceiptStatusSchema,
} from "@vektorprogrammet/domain/receipt";
import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi";
import { annotateAccessSpec, personNativeAccess } from "./access.js";
import {
  operationAnnotations,
  PersonOrServiceSecurity,
  PersonSecurity,
  SessionSecurity,
} from "./common.js";
import {
  InternalReadReceiptEvidenceProblem,
  ReceiptsApproveReceiptProblem,
  ReceiptsListReceiptsForApprovalProblem,
  ReceiptsListReceiptsForSettlementProblem,
  ReceiptsListReceiptsProblem,
  ReceiptsReadReceiptFileProblem,
  ReceiptsReadReceiptSettlementForFinanceProblem,
  ReceiptsRejectReceiptProblem,
  ReceiptsReopenReceiptProblem,
  ReceiptsReviseReceiptProblem,
  ReceiptsSettleReceiptProblem,
  ReceiptsSubmitReceiptProblem,
  ReceiptsWithdrawReceiptProblem,
} from "./endpoint-problems.js";
import {
  createdMutationResponse,
  endpointProblemResponses,
  entityMutationResponse,
  IdempotencyHeaders,
  IdempotencyIfMatchHeaders,
  internalNoStoreResponse,
  privateReadResponse,
  StrongETag,
} from "./http-semantics.js";
import {
  ApproveReceiptRequest,
  ReceiptResource,
  ReceiptSettlementEvidenceResource,
  RecordReceiptSettlementRequest,
  RejectReceiptRequest,
  ReopenReceiptRequest,
  ReviseReceiptMultipartV2,
  SubmitReceiptMultipartV2,
  WithdrawReceiptRequest,
} from "./v2-schemas.js";

export { ReceiptId };

const privateEntityMutationResponse = <S extends Schema.Top>(success: S) =>
  HttpApiSchema.WithHeaders(success, {
    "cache-control": Schema.Literal("private, no-store"),
    vary: Schema.Literal("Origin"),
    etag: StrongETag,
  });

const ReceiptSettlementQueueAccess = makeAccessSpec({
  exposure: "External",
  acceptedCredentials: [
    CredentialMechanismSchema.cases.BetterAuthCookie.make({}),
    CredentialMechanismSchema.cases.OAuthUserBearer.make({}),
  ],
  principalKinds: ["Person"],
  capabilities: CapabilityExpressionSchema.cases.One.make({
    capability: { type: CapabilityTypeId.make("settleReceipt") },
  }),
  requirements: [],
  canonicalScopeResolver: "receipts.settlement-queue",
  concealment: ConcealmentPolicySchema.cases.NotFound.make({ conceal: ["Capability", "Scope"] }),
  decisionTime: "SnapshotRead",
});

const ReceiptSettlementReadAccess = makeAccessSpec({
  exposure: "External",
  acceptedCredentials: [
    CredentialMechanismSchema.cases.BetterAuthCookie.make({}),
    CredentialMechanismSchema.cases.OAuthUserBearer.make({}),
  ],
  principalKinds: ["Person"],
  capabilities: CapabilityExpressionSchema.cases.One.make({
    capability: { type: CapabilityTypeId.make("settleReceipt") },
  }),
  requirements: [],
  canonicalScopeResolver: "receipts.by-id",
  concealment: ConcealmentPolicySchema.cases.NotFound.make({ conceal: ["Capability", "Scope"] }),
  decisionTime: "SnapshotRead",
});

const ReceiptSettlementMutationAccess = makeAccessSpec({
  exposure: "External",
  acceptedCredentials: [
    CredentialMechanismSchema.cases.BetterAuthCookie.make({}),
    CredentialMechanismSchema.cases.OAuthUserBearer.make({}),
  ],
  principalKinds: ["Person"],
  capabilities: CapabilityExpressionSchema.cases.One.make({
    capability: { type: CapabilityTypeId.make("settleReceipt") },
  }),
  requirements: [],
  canonicalScopeResolver: "receipts.by-id",
  concealment: ConcealmentPolicySchema.cases.NotFound.make({ conceal: ["Capability", "Scope"] }),
  decisionTime: "Transaction",
});

/**
 * Receipt list projection item.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const ReceiptListItemExample = {
  receiptId: "receipt-list",
  visualId: "LIST-1",
  ownerPersonId: "owner-list",
  departmentId: "1",
  amountOre: 1250,
  currency: "NOK",
  description: "list row",
  receiptDate: "2026-08-24",
  status: "Pending",
  approvedAt: null,
  settlement: null,
  revision: 2,
  etag: StrongETag.make('"vkr2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'),
} as const;

export const ReceiptListItem = Schema.Struct({
  receiptId: Schema.String,
  visualId: Schema.String,
  ownerPersonId: Schema.String,
  departmentId: Schema.String,
  amountOre: Schema.Int,
  currency: Schema.Literals(["NOK"]),
  description: Schema.String,
  receiptDate: Schema.String,
  status: ReceiptStatusSchema,
  revision: Schema.Int,
  approvedAt: Receipt.json.fields.approvedAt,
  settlement: Schema.NullOr(ReceiptSettlementEvidenceSchema),
  etag: StrongETag,
}).annotate({
  identifier: "ReceiptListItem",
  description: "Owner or approver receipt projection.",
  examples: [
    {
      receiptId: "receipt-list",
      visualId: "LIST-1",
      ownerPersonId: "owner-list",
      departmentId: "1",
      amountOre: 1250,
      currency: "NOK",
      description: "list row",
      receiptDate: "2026-08-24",
      status: "Pending",
      approvedAt: null,
      settlement: null,
      revision: 2,
      etag: StrongETag.make('"vkr2.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"'),
    },
  ],
});

/**
 * Receipt list envelope.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const ReceiptListResponse = Schema.Struct({
  items: Schema.Array(ReceiptListItem).pipe(Schema.check(Schema.isMaxLength(RECEIPT_PAGE_SIZE))),
  nextCursor: Schema.optional(ReceiptCursor),
}).annotate({
  identifier: "ReceiptListResponse",
  description: "One bounded receipt page and optional continuation.",
  examples: [
    {
      items: [ReceiptListItemExample],
    },
  ],
});

export const ReceiptApprovalQueueItem = Schema.Struct({
  receiptId: Schema.String,
  visualId: Schema.String,
  ownerPersonId: Schema.String,
  departmentId: Schema.String,
  amountOre: Schema.Int,
  currency: Schema.Literals(["NOK"]),
  description: Schema.String,
  receiptDate: Schema.String,
  status: ReceiptStatusSchema,
  revision: Schema.Int,
  etag: StrongETag,
  approvedAt: Receipt.json.fields.approvedAt,
}).annotate({
  identifier: "ReceiptApprovalQueueItem",
  description: "One receipt visible in the current approver queue.",
});

export const ReceiptApprovalQueueResponse = Schema.Struct({
  items: Schema.Array(ReceiptApprovalQueueItem).pipe(
    Schema.check(Schema.isMaxLength(RECEIPT_PAGE_SIZE)),
  ),
  nextCursor: Schema.optional(ReceiptCursor),
}).annotate({
  identifier: "ReceiptApprovalQueueResponse",
  description: "One bounded page of receipts in the current approver queue.",
});

export const ReceiptSettlementQueueItem = Schema.Struct({
  receiptId: Schema.String,
  visualId: Schema.String,
  ownerPersonId: Schema.String,
  departmentId: Schema.String,
  amountOre: Schema.Int,
  currency: Schema.Literal("NOK"),
  description: Schema.String,
  receiptDate: Schema.String,
  status: Schema.Literal("Approved"),
  approvedAt: Schema.String,
  revision: Schema.Int,
  etag: StrongETag,
}).annotate({
  identifier: "ReceiptSettlementQueueItem",
  description: "One approved, unsettled receipt visible in the current settlement scope.",
});

export const ReceiptSettlementQueueResponse = Schema.Struct({
  items: Schema.Array(ReceiptSettlementQueueItem).pipe(
    Schema.check(Schema.isMaxLength(RECEIPT_PAGE_SIZE)),
  ),
  nextCursor: Schema.optional(ReceiptCursor),
}).annotate({
  identifier: "ReceiptSettlementQueueResponse",
  description: "One bounded page of approved, unsettled receipts in the current settlement scope.",
});

/**
 * Internal receipt file/outbox/audit lifecycle evidence.
 *
 * @since 0.1.0
 * @category Schemas
 */
export const ReceiptLifecycleEvidenceResponse = Schema.Struct({
  receiptId: Schema.String,
  file: Schema.Struct({
    fileRef: Schema.String,
    objectKey: Schema.String,
    contentType: Schema.String,
    byteLength: Schema.Int,
    sha256: Schema.String,
  }),
  settlement: Schema.NullOr(ReceiptSettlementEvidenceSchema),
  outbox: Schema.Array(
    Schema.Struct({
      effectId: Schema.String,
      effectType: Schema.String,
      commandId: Schema.String,
      receiptId: Schema.String,
      ordinal: Schema.Int,
      status: Schema.String,
      attempts: Schema.Int,
      lastFailureTag: Schema.NullOr(Schema.String),
    }),
  ),
  audit: Schema.Array(
    Schema.Struct({
      commandId: Schema.String,
      receiptId: Schema.String,
      action: Schema.String,
      receiptRevision: Schema.Int,
    }),
  ),
}).annotate({
  identifier: "ReceiptLifecycleEvidenceResponse",
  description: "E2E-only receipt file, outbox, and audit evidence.",
});

const ReceiptStatusQuery = {
  cursor: Schema.optional(ReceiptCursor),
  status: Schema.optional(ReceiptStatusSchema),
};

const OwnerReceiptStatusQuery = {
  cursor: Schema.optional(ReceiptCursor),
  status: Schema.optional(Schema.Union([ReceiptStatusSchema, Schema.Array(ReceiptStatusSchema)])),
};

const ReceiptParams = { receiptId: ReceiptId };

const ReceiptFileContentType = Schema.Literals(["image/jpeg", "image/png", "application/pdf"]);

const ReceiptFileContentLength = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => /^[1-9]\d*$/u.test(value), {
      message: "a positive decimal byte length",
    }),
  ),
);

const ReceiptFileContentDisposition = Schema.Literals([
  'inline; filename="receipt.jpg"',
  'inline; filename="receipt.png"',
  'inline; filename="receipt.pdf"',
]);

const ReceiptPrivateFileResponse = HttpApiSchema.WithHeaders(
  Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  {
    "cache-control": Schema.Literal("private, no-store"),
    vary: Schema.Literal("Origin"),
    "content-type": ReceiptFileContentType,
    "content-length": ReceiptFileContentLength,
    "content-disposition": ReceiptFileContentDisposition,
    "x-content-type-options": Schema.Literal("nosniff"),
  },
);

/** @since 0.1.0 @category Endpoints */
export const SubmitReceiptEndpoint = HttpApiEndpoint.post("submitReceipt", "/api/receipts", {
  query: { departmentId: Schema.optional(Schema.String) },
  headers: IdempotencyHeaders,
  payload: SubmitReceiptMultipartV2,
  success: createdMutationResponse(ReceiptResource.pipe(HttpApiSchema.status(201))),
  error: endpointProblemResponses(ReceiptsSubmitReceiptProblem),
})
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "submitReceipt",
        canonicalScopeResolver: "receipts.create",
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Submit receipt",
      "Stages a receipt file and submits an idempotent command.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ReviseReceiptEndpoint = HttpApiEndpoint.patch(
  "reviseReceipt",
  "/api/receipts/:receiptId",
  {
    params: ReceiptParams,
    headers: IdempotencyIfMatchHeaders,
    payload: ReviseReceiptMultipartV2,
    success: entityMutationResponse(ReceiptResource),
    error: endpointProblemResponses(ReceiptsReviseReceiptProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "receipts.manage-owned",
        canonicalScopeResolver: "receipts.by-id",
        requirements: ["receipts.owner", "receipts.pending"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("Revise receipt", "Revises a pending owned receipt and optional file."),
  );

/** @since 0.1.0 @category Endpoints */
export const WithdrawReceiptEndpoint = HttpApiEndpoint.post(
  "withdrawReceipt",
  "/api/receipts/:receiptId:withdraw",
  {
    params: ReceiptParams,
    headers: IdempotencyIfMatchHeaders,
    payload: WithdrawReceiptRequest,
    success: entityMutationResponse(ReceiptResource),
    error: endpointProblemResponses(ReceiptsWithdrawReceiptProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "receipts.manage-owned",
        canonicalScopeResolver: "receipts.by-id",
        requirements: ["receipts.owner", "receipts.pending"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Withdraw receipt",
      "Withdraws a pending receipt owned by the current person.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ListReceiptsEndpoint = HttpApiEndpoint.get("listReceipts", "/api/receipts", {
  query: OwnerReceiptStatusQuery,
  success: privateReadResponse(ReceiptListResponse),
  error: endpointProblemResponses(ReceiptsListReceiptsProblem),
})
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "receipts.read-owned",
        canonicalScopeResolver: "receipts.owned",
        requirements: ["receipts.owner"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations("List owned receipts", "Lists receipts owned by the current person."),
  );

/** Owner-only, verified private bytes; storage identities are never public. */
export const ReadReceiptFileEndpoint = HttpApiEndpoint.get(
  "readReceiptFile",
  "/api/receipts/:receiptId/file",
  {
    params: ReceiptParams,
    success: ReceiptPrivateFileResponse,
    error: endpointProblemResponses(ReceiptsReadReceiptFileProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "receipts.read-owned",
        canonicalScopeResolver: "receipts.by-id",
        requirements: ["receipts.owner"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read owned receipt file",
      "Downloads verified private bytes for the canonical owner.",
    ),
  );

/**
 * Scoped approver-only receipt bytes. Terminal receipt files remain readable
 * while the current rule-aware approver relationship remains active.
 */
export const ReadReceiptFileForApprovalEndpoint = HttpApiEndpoint.get(
  "readReceiptFileForApproval",
  "/api/receipt-approval-queue/:receiptId/file",
  {
    params: ReceiptParams,
    success: ReceiptPrivateFileResponse,
    error: endpointProblemResponses(ReceiptsReadReceiptFileProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "approveReceipt",
        canonicalScopeResolver: "receipts.by-id",
        requirements: ["receipts.approver-relationship"],
        decisionTime: "SnapshotRead",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Read receipt file for approval",
      "Downloads verified private bytes for the current scoped approver.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ListReceiptsForApprovalEndpoint = HttpApiEndpoint.get(
  "listReceiptsForApproval",
  "/api/receipt-approval-queue",
  {
    query: ReceiptStatusQuery,
    success: privateReadResponse(ReceiptApprovalQueueResponse),
    error: endpointProblemResponses(ReceiptsListReceiptsForApprovalProblem),
  },
)
  .middleware(PersonOrServiceSecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, RECEIPT_APPROVAL_QUEUE_ACCESS))
  .annotateMerge(
    operationAnnotations(
      "List receipts for approval",
      "Lists receipts in the caller's approval scope.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ListReceiptsForSettlementEndpoint = HttpApiEndpoint.get(
  "listReceiptsForSettlement",
  "/api/receipt-settlement-queue",
  {
    query: { cursor: Schema.optional(ReceiptCursor) },
    success: privateReadResponse(ReceiptSettlementQueueResponse),
    error: endpointProblemResponses(ReceiptsListReceiptsForSettlementProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, ReceiptSettlementQueueAccess))
  .annotateMerge(
    operationAnnotations(
      "List receipts for settlement",
      "Lists approved, unsettled receipts visible to the current settlement grant.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ReadReceiptSettlementForFinanceEndpoint = HttpApiEndpoint.get(
  "readReceiptSettlementForFinance",
  "/api/receipt-settlement-queue/:receiptId",
  {
    params: ReceiptParams,
    success: privateReadResponse(ReceiptSettlementEvidenceResource),
    error: endpointProblemResponses(ReceiptsReadReceiptSettlementForFinanceProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, ReceiptSettlementReadAccess))
  .annotateMerge(
    operationAnnotations(
      "Read receipt settlement for finance",
      "Reads immutable settlement evidence visible to the current settlement grant.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const SettleReceiptEndpoint = HttpApiEndpoint.post(
  "settleReceipt",
  "/api/receipts/:receiptId:settle",
  {
    params: ReceiptParams,
    headers: IdempotencyIfMatchHeaders,
    payload: RecordReceiptSettlementRequest,
    success: privateEntityMutationResponse(ReceiptSettlementEvidenceResource),
    error: endpointProblemResponses(ReceiptsSettleReceiptProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) => annotateAccessSpec(endpoint, ReceiptSettlementMutationAccess))
  .annotateMerge(
    operationAnnotations(
      "Record receipt settlement",
      "Records immutable evidence for an externally settled approved receipt.",
    ),
  );

/** @since 0.1.0 @category Endpoints */
export const ApproveReceiptEndpoint = HttpApiEndpoint.post(
  "approveReceipt",
  "/api/receipts/:receiptId:approve",
  {
    params: ReceiptParams,
    headers: IdempotencyIfMatchHeaders,
    payload: ApproveReceiptRequest,
    success: entityMutationResponse(ReceiptResource),
    error: endpointProblemResponses(ReceiptsApproveReceiptProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "approveReceipt",
        canonicalScopeResolver: "receipts.by-id",
        requirements: ["receipts.pending", "receipts.approver-relationship"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(operationAnnotations("Approve receipt", "Approves a pending receipt."));

/** @since 0.1.0 @category Endpoints */
export const RejectReceiptEndpoint = HttpApiEndpoint.post(
  "rejectReceipt",
  "/api/receipts/:receiptId:reject",
  {
    params: ReceiptParams,
    headers: IdempotencyIfMatchHeaders,
    payload: RejectReceiptRequest,
    success: entityMutationResponse(ReceiptResource),
    error: endpointProblemResponses(ReceiptsRejectReceiptProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "approveReceipt",
        canonicalScopeResolver: "receipts.by-id",
        requirements: ["receipts.pending", "receipts.approver-relationship"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(operationAnnotations("Reject receipt", "Rejects a pending receipt."));

export const ReopenReceiptEndpoint = HttpApiEndpoint.post(
  "reopenReceipt",
  "/api/receipts/:receiptId:reopen",
  {
    params: ReceiptParams,
    headers: IdempotencyIfMatchHeaders,
    payload: ReopenReceiptRequest,
    success: entityMutationResponse(ReceiptResource),
    error: endpointProblemResponses(ReceiptsReopenReceiptProblem),
  },
)
  .middleware(PersonSecurity)
  .pipe((endpoint) =>
    annotateAccessSpec(
      endpoint,
      personNativeAccess({
        capability: "approveReceipt",
        canonicalScopeResolver: "receipts.by-id",
        requirements: ["receipts.rejected", "receipts.approver-relationship"],
        decisionTime: "Transaction",
      }),
    ),
  )
  .annotateMerge(
    operationAnnotations(
      "Reopen rejected receipt",
      "Reopens a rejected receipt for owner correction.",
    ),
  );

/**
 * Owner and approver receipt API.
 *
 * @since 0.1.0
 * @category Groups
 */
export class ReceiptsApi extends HttpApiGroup.make("receipts")
  .add(
    ReadReceiptFileEndpoint,
    ReadReceiptFileForApprovalEndpoint,
    SubmitReceiptEndpoint,
    ReviseReceiptEndpoint,
    WithdrawReceiptEndpoint,
    ListReceiptsEndpoint,
    ListReceiptsForApprovalEndpoint,
    ApproveReceiptEndpoint,
    ListReceiptsForSettlementEndpoint,
    ReadReceiptSettlementForFinanceEndpoint,
    SettleReceiptEndpoint,
    RejectReceiptEndpoint,
    ReopenReceiptEndpoint,
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "Receipts",
      description: "Receipt owner lifecycle and scoped approval operations.",
    }),
  ) {}

/** @since 0.1.0 @category Endpoints */
export const ReadReceiptEvidenceEndpoint = annotateAccessSpec(
  HttpApiEndpoint.get("readReceiptEvidence", "/api/receipt-lifecycle-evidence-records/:receiptId", {
    params: ReceiptParams,
    success: internalNoStoreResponse(ReceiptLifecycleEvidenceResponse),
    error: endpointProblemResponses(InternalReadReceiptEvidenceProblem, { cors: false }),
  })
    .middleware(SessionSecurity)
    .annotateMerge(
      operationAnnotations("Read receipt evidence", "Reads E2E-only receipt lifecycle evidence."),
    ),
  INTERNAL_RECEIPT_EVIDENCE_ACCESS,
);

/**
 * Internal evidence routes exist only in `InternalNativeApi`.
 * @since 0.1.0
 * @category Groups
 */
export class InternalReceiptsApi extends HttpApiGroup.make("internal")
  .add(ReadReceiptEvidenceEndpoint)
  .annotateMerge(
    OpenApi.annotations({
      title: "Internal evidence",
      description: "E2E-only evidence operations.",
      exclude: true,
    }),
  ) {}
