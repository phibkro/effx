import { flow, Predicate, Data, Effect, Schema } from "effect";
import { DomainId, ResourceRefSchema, ServicePrincipalId } from "./access.js";
import { DepartmentId, PersonId } from "../organization/schema.js";
import { compareRfc3339Instants, Rfc3339InstantSchema } from "../time.js";

const TrimmedNonEmpty = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value.trim() === value, {
      message: "a trimmed non-empty string",
    }),
  ),
);

export const AuthzRevisionSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export type AuthzRevision = typeof AuthzRevisionSchema.Type;

export const AuthzRuleId = TrimmedNonEmpty.pipe(Schema.brand("AuthzRuleId"));

export type AuthzRuleId = typeof AuthzRuleId.Type;

export const AuthzTagId = TrimmedNonEmpty.pipe(Schema.brand("AuthzTagId"));

export type AuthzTagId = typeof AuthzTagId.Type;

export const AuthzTagAssignmentId = TrimmedNonEmpty.pipe(Schema.brand("AuthzTagAssignmentId"));

export type AuthzTagAssignmentId = typeof AuthzTagAssignmentId.Type;

export const AuthzTagNameSchema = TrimmedNonEmpty;

export type AuthzTagName = typeof AuthzTagNameSchema.Type;

export const AuthzCapabilityIdSchema = Schema.Literals([
  "approveReceipt",
  "submitReceipt",
  "reviewApplicants",
]);

export type AuthzCapabilityId = typeof AuthzCapabilityIdSchema.Type;

export const AuthzRuleEffectKindSchema = Schema.Literals(["delegate", "requirement"]);

export type AuthzRuleEffectKind = typeof AuthzRuleEffectKindSchema.Type;

export const AuthzEvidenceSlotSchema = Schema.Literals([
  "EconomyDepartmentApprovalGrant",
  "EconomyGlobalReceiptApprovalGrant",
  "EconomyPaymentAuthority",
]);

export type AuthzEvidenceSlot = typeof AuthzEvidenceSlotSchema.Type;

export const EconomyDepartmentApprovalDelegateParamsSchema = Schema.Struct({
  slot: Schema.Literals(["EconomyDepartmentApprovalGrant"]),
});

export type EconomyDepartmentApprovalDelegateParams =
  typeof EconomyDepartmentApprovalDelegateParamsSchema.Type;

export const EconomyGlobalReceiptApprovalDelegateParamsSchema = Schema.Struct({
  slot: Schema.Literals(["EconomyGlobalReceiptApprovalGrant"]),
});

export type EconomyGlobalReceiptApprovalDelegateParams =
  typeof EconomyGlobalReceiptApprovalDelegateParamsSchema.Type;

export const EconomyPaymentAuthorityDelegateParamsSchema = Schema.Struct({
  slot: Schema.Literals(["EconomyPaymentAuthority"]),
  paymentAccountCiphertext: TrimmedNonEmpty,
});

export type EconomyPaymentAuthorityDelegateParams =
  typeof EconomyPaymentAuthorityDelegateParamsSchema.Type;

const EmptyRequirementParametersSchema = Schema.Record(Schema.String, Schema.Never);

export const ReceiptPendingRequirementParamsSchema = Schema.Struct({
  requirementId: Schema.Literals(["receipts.pending"]),
  parameters: EmptyRequirementParametersSchema,
});

export type ReceiptPendingRequirementParams = typeof ReceiptPendingRequirementParamsSchema.Type;

export const ReceiptApproverRelationshipRequirementParamsSchema = Schema.Struct({
  requirementId: Schema.Literals(["receipts.approver-relationship"]),
  parameters: EmptyRequirementParametersSchema,
});

export type ReceiptApproverRelationshipRequirementParams =
  typeof ReceiptApproverRelationshipRequirementParamsSchema.Type;

export const AuthzRuleSubjectSchema = Schema.TaggedUnion({
  Person: { personId: PersonId },
  Tag: { tagId: AuthzTagId },
  ServicePrincipal: { servicePrincipalId: ServicePrincipalId },
});

export type AuthzRuleSubject = typeof AuthzRuleSubjectSchema.Type;

export const AuthzRuleScopeSchema = Schema.TaggedUnion({
  Global: {},
  Domain: { domainId: DomainId },
  Department: { departmentId: DepartmentId },
  Resource: { resource: ResourceRefSchema },
});

export type AuthzRuleScope = typeof AuthzRuleScopeSchema.Type;

export type AuthzCapabilityDeclaration = {
  readonly receptiveEvidenceSlots: ReadonlyArray<AuthzEvidenceSlot>;
  readonly parameterSlots: ReadonlyArray<string>;
  readonly requirementSlots: ReadonlyArray<string>;
  readonly acceptedEffects: ReadonlyArray<AuthzRuleEffectKind>;
};

/** Frozen rule-receptive surface. Operator data cannot add a slot. */
export const CAPABILITY_IDS = {
  approveReceipt: {
    receptiveEvidenceSlots: ["EconomyDepartmentApprovalGrant", "EconomyGlobalReceiptApprovalGrant"],
    parameterSlots: [],
    requirementSlots: ["receipts.pending", "receipts.approver-relationship"],
    acceptedEffects: ["delegate", "requirement"],
  },
  submitReceipt: {
    receptiveEvidenceSlots: ["EconomyPaymentAuthority"],
    parameterSlots: [],
    requirementSlots: [],
    acceptedEffects: ["delegate"],
  },
  reviewApplicants: {
    receptiveEvidenceSlots: [],
    parameterSlots: [],
    requirementSlots: [],
    acceptedEffects: [],
  },
} as const satisfies Record<AuthzCapabilityId, AuthzCapabilityDeclaration>;

export const AuthzLockModeSchema = Schema.Literals(["None", "ForShare"]);

export type AuthzLockMode = typeof AuthzLockModeSchema.Type;

/**
 * Shared authorization read/write lock identity and protected row order.
 * Database adapters select the PostgreSQL advisory-lock primitive.
 */
export const AUTHZ_LOCK_PROTOCOL = {
  advisoryKey: "vektorprogrammet:authz-rules:v1",
  rowOrder: [
    "public.authz_tag_assignments",
    "public.service_principal_grants",
    "public.authz_rules",
  ],
} as const;

const AuthzRuleCommonFields = {
  ruleId: AuthzRuleId,
  subject: AuthzRuleSubjectSchema,
  scope: AuthzRuleScopeSchema,
  startAt: Rfc3339InstantSchema,
  endAt: Schema.NullOr(Rfc3339InstantSchema),
  revision: AuthzRevisionSchema,
} as const;

const ApproveReceiptDepartmentDelegateRuleSchema = Schema.Struct({
  ...AuthzRuleCommonFields,
  capabilityId: Schema.Literals(["approveReceipt"]),
  effectKind: Schema.Literals(["delegate"]),
  params: EconomyDepartmentApprovalDelegateParamsSchema,
});

const ApproveReceiptGlobalDelegateRuleSchema = Schema.Struct({
  ...AuthzRuleCommonFields,
  capabilityId: Schema.Literals(["approveReceipt"]),
  effectKind: Schema.Literals(["delegate"]),
  params: EconomyGlobalReceiptApprovalDelegateParamsSchema,
});

const ApproveReceiptPendingRequirementRuleSchema = Schema.Struct({
  ...AuthzRuleCommonFields,
  capabilityId: Schema.Literals(["approveReceipt"]),
  effectKind: Schema.Literals(["requirement"]),
  params: ReceiptPendingRequirementParamsSchema,
});

const ApproveReceiptApproverRelationshipRequirementRuleSchema = Schema.Struct({
  ...AuthzRuleCommonFields,
  capabilityId: Schema.Literals(["approveReceipt"]),
  effectKind: Schema.Literals(["requirement"]),
  params: ReceiptApproverRelationshipRequirementParamsSchema,
});

const SubmitReceiptPaymentDelegateRuleSchema = Schema.Struct({
  ...AuthzRuleCommonFields,
  capabilityId: Schema.Literals(["submitReceipt"]),
  effectKind: Schema.Literals(["delegate"]),
  params: EconomyPaymentAuthorityDelegateParamsSchema,
});

export const AuthzRuleSchema = Schema.Union([
  ApproveReceiptDepartmentDelegateRuleSchema,
  ApproveReceiptGlobalDelegateRuleSchema,
  ApproveReceiptPendingRequirementRuleSchema,
  ApproveReceiptApproverRelationshipRequirementRuleSchema,
  SubmitReceiptPaymentDelegateRuleSchema,
]).pipe(
  Schema.check(
    Schema.makeFilter(
      (rule) => {
        if (!Predicate.isTagged(rule.subject, "ServicePrincipal")) {
          return !Predicate.isTagged(rule.scope, "Resource");
        }

        return (
          rule.capabilityId === "approveReceipt" &&
          rule.effectKind === "requirement" &&
          Predicate.isTagged(rule.scope, "Resource") &&
          rule.scope.resource.kind === "receipt" &&
          (rule.params.requirementId === "receipts.pending" ||
            rule.params.requirementId === "receipts.approver-relationship")
        );
      },
      {
        message:
          "service-principal rules are resource-scoped receipt requirements and never delegates",
      },
    ),
    Schema.makeFilter(
      (rule) => rule.endAt === null || compareRfc3339Instants(rule.startAt, rule.endAt) < 0,
      { message: "an authorization rule interval must be half-open and ordered" },
    ),
  ),
);

export type AuthzRule = typeof AuthzRuleSchema.Type;

export const AuthzTagSchema = Schema.Struct({
  tagId: AuthzTagId,
  name: AuthzTagNameSchema,
  revision: AuthzRevisionSchema,
});

export type AuthzTag = typeof AuthzTagSchema.Type;

const orderedInterval = Schema.makeFilter(
  (value: { readonly startAt: string; readonly endAt: string | null }) =>
    value.endAt === null || compareRfc3339Instants(value.endAt, value.startAt) > 0,
  { message: "a half-open authorization interval" },
);

export const AuthzTagAssignmentSchema = Schema.Struct({
  assignmentId: AuthzTagAssignmentId,
  tagId: AuthzTagId,
  personId: PersonId,
  startAt: Rfc3339InstantSchema,
  endAt: Schema.NullOr(Rfc3339InstantSchema),
  revision: AuthzRevisionSchema,
}).pipe(Schema.check(orderedInterval));

export type AuthzTagAssignment = typeof AuthzTagAssignmentSchema.Type;

export const EndAuthzRuleInputSchema = Schema.Struct({
  ruleId: AuthzRuleId,
  endAt: Rfc3339InstantSchema,
  expectedRevision: AuthzRevisionSchema,
});

export type EndAuthzRuleInput = typeof EndAuthzRuleInputSchema.Type;

export const RemoveAuthzRuleInputSchema = Schema.Struct({
  ruleId: AuthzRuleId,
  expectedRevision: AuthzRevisionSchema,
});

export type RemoveAuthzRuleInput = typeof RemoveAuthzRuleInputSchema.Type;

export const EndAuthzTagAssignmentInputSchema = Schema.Struct({
  assignmentId: AuthzTagAssignmentId,
  endAt: Rfc3339InstantSchema,
  expectedRevision: AuthzRevisionSchema,
});

export type EndAuthzTagAssignmentInput = typeof EndAuthzTagAssignmentInputSchema.Type;

export const RemoveAuthzTagAssignmentInputSchema = Schema.Struct({
  assignmentId: AuthzTagAssignmentId,
  expectedRevision: AuthzRevisionSchema,
});

export type RemoveAuthzTagAssignmentInput = typeof RemoveAuthzTagAssignmentInputSchema.Type;

export const RemoveAuthzTagInputSchema = Schema.Struct({
  tagId: AuthzTagId,
  expectedRevision: AuthzRevisionSchema,
});

export type RemoveAuthzTagInput = typeof RemoveAuthzTagInputSchema.Type;

export type AuthzValidationEntity =
  | "AuthzRule"
  | "AuthzTag"
  | "AuthzTagAssignment"
  | "AuthzRuleId"
  | "AuthzTagId"
  | "AuthzTagAssignmentId"
  | "Principal"
  | "AuthzCapabilityId"
  | "AuthzRequestScope"
  | "AuthzLockMode"
  | "EndAuthzRuleInput"
  | "RemoveAuthzRuleInput"
  | "EndAuthzTagAssignmentInput"
  | "RemoveAuthzTagAssignmentInput"
  | "RemoveAuthzTagInput"
  | "AuthorizationInstant";

export class AuthzValidationError extends Data.TaggedError("AuthzValidationError")<{
  readonly entity: AuthzValidationEntity;
  readonly message: string;
}> {}

const validationError = (entity: AuthzValidationEntity, cause: unknown) =>
  new AuthzValidationError({ entity, message: String(cause) });

export const decodeAuthzRule = flow(
  Schema.decodeUnknownEffect(AuthzRuleSchema, { onExcessProperty: "error" }),
  Effect.mapError((cause) => validationError("AuthzRule", cause)),
);

export const decodeAuthzTag = flow(
  Schema.decodeUnknownEffect(AuthzTagSchema, { onExcessProperty: "error" }),
  Effect.mapError((cause) => validationError("AuthzTag", cause)),
);

export const decodeAuthzTagAssignment = flow(
  Schema.decodeUnknownEffect(AuthzTagAssignmentSchema, {
    onExcessProperty: "error",
  }),
  Effect.mapError((cause) => validationError("AuthzTagAssignment", cause)),
);
