import { Result, Array, Predicate, Context, Data, Effect, Schema } from "effect";
import { DepartmentId, PersonId } from "../organization/schema.js";
import {
  ReceiptId,
  ReceiptStatusSchema,
  ReceiptVisualId,
  type ReceiptStatus,
} from "../receipt/schema.js";
import { compareRfc3339Instants } from "../time.js";
import {
  CredentialMechanismSchema,
  Scope,
  PrincipalSchema,
  APPROVE_RECEIPT_CAPABILITY,
  AuthorityRef,
  AuthorizationInstant,
  AuthorityVersion,
  CredentialEvidenceRef,
  evaluateAccess,
  RECEIPT_APPROVAL_QUEUE_ACCESS,
  AccessEvaluation,
  type CanonicalResourceContext,
  type Grant,
  GrantId,
  decodeGrant,
  RECEIPT_DOMAIN_ID,
  RECEIPT_RESOURCE_KIND,
  type ReceiptAccessFacts,
  ResourceId,
  ServicePrincipalId,
} from "./access.js";
import { composeCapabilityEvidence } from "./rules.js";
import type { AuthzRule } from "./schema.js";

const TrimmedNonEmpty = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value.trim() === value, {
      message: "a trimmed non-empty string",
    }),
  ),
);

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const NATIVE_API_PROTECTED_RESOURCE = "urn:vektorprogrammet:native-api" as const;

export const RECEIPT_APPROVAL_QUEUE_OPERATION = "receipts.listReceiptsForApproval" as const;

export const OAuthClientId = TrimmedNonEmpty.pipe(Schema.brand("OAuthClientId"));

export type OAuthClientId = typeof OAuthClientId.Type;

export const ServicePrincipalReceiptGrantSchema = Schema.Struct({
  grantId: GrantId,
  servicePrincipalId: ServicePrincipalId,
  clientId: OAuthClientId,
  protectedResource: Schema.Literal(NATIVE_API_PROTECTED_RESOURCE),
  operationId: Schema.Literal(RECEIPT_APPROVAL_QUEUE_OPERATION),
  capabilityId: Schema.Literal("approveReceipt"),
  resourceKind: Schema.Literal("receipt"),
  receiptId: ReceiptId,
  startAt: AuthorizationInstant,
  endAt: Schema.NullOr(AuthorizationInstant),
  revokedAt: Schema.NullOr(AuthorizationInstant),
  revision: Revision,
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (grant) =>
        (grant.endAt === null || compareRfc3339Instants(grant.endAt, grant.startAt) > 0) &&
        (grant.revokedAt === null || compareRfc3339Instants(grant.revokedAt, grant.startAt) >= 0),
      { message: "an ordered service-principal receipt grant" },
    ),
  ),
);

export type ServicePrincipalReceiptGrant = typeof ServicePrincipalReceiptGrantSchema.Type;

export const AcceptedOAuthServiceCredential = Schema.TaggedStruct("Accepted", {
  mechanism: CredentialMechanismSchema.cases.OAuthServiceBearer,
  principal: PrincipalSchema.cases.ServicePrincipal,
  evidenceRef: CredentialEvidenceRef,
});

export type AcceptedOAuthServiceCredential = typeof AcceptedOAuthServiceCredential.Type;

export const ServicePrincipalReceiptCandidateSchema = Schema.Struct({
  receiptId: ReceiptId,
  visualId: ReceiptVisualId,
  ownerPersonId: PersonId,
  departmentId: DepartmentId,
  amountOre: Schema.String,
  currency: Schema.Literal("NOK"),
  description: Schema.String,
  receiptDate: Schema.String,
  status: ReceiptStatusSchema,
  approvedAt: Schema.NullOr(Schema.String),
  revision: Revision,
});

export type ServicePrincipalReceiptCandidate = typeof ServicePrincipalReceiptCandidateSchema.Type;

export type ServicePrincipalReceiptGrantCandidate = {
  readonly grant: ServicePrincipalReceiptGrant;
  readonly receipt: ServicePrincipalReceiptCandidate;
};

export type ServicePrincipalReceiptGrantAuthority = {
  readonly servicePrincipalId: ServicePrincipalId;
  readonly clientId: OAuthClientId;
  readonly protectedResource: typeof NATIVE_API_PROTECTED_RESOURCE;
  readonly candidates: ReadonlyArray<ServicePrincipalReceiptGrantCandidate>;
  readonly nextCursor?: string;
  readonly rules: ReadonlyArray<AuthzRule>;
};

const BoundedAuditText = TrimmedNonEmpty.pipe(Schema.check(Schema.isMaxLength(160)));

export const ServicePrincipalGrantAuditContextSchema = Schema.Struct({
  eventId: BoundedAuditText,
  occurredAt: AuthorizationInstant,
  operatorActor: BoundedAuditText,
  requestCorrelation: BoundedAuditText,
});

export type ServicePrincipalGrantAuditContext = typeof ServicePrincipalGrantAuditContextSchema.Type;

export const CreateServicePrincipalGrantInputSchema = Schema.Struct({
  grant: ServicePrincipalReceiptGrantSchema,
  audit: ServicePrincipalGrantAuditContextSchema,
});

export type CreateServicePrincipalGrantInput = typeof CreateServicePrincipalGrantInputSchema.Type;

export const EndServicePrincipalGrantInputSchema = Schema.Struct({
  grantId: GrantId,
  endAt: AuthorizationInstant,
  expectedRevision: Revision,
  audit: ServicePrincipalGrantAuditContextSchema,
});

export type EndServicePrincipalGrantInput = typeof EndServicePrincipalGrantInputSchema.Type;

export const RevokeServicePrincipalGrantInputSchema = Schema.Struct({
  grantId: GrantId,
  revokedAt: AuthorizationInstant,
  expectedRevision: Revision,
  audit: ServicePrincipalGrantAuditContextSchema,
});

export type RevokeServicePrincipalGrantInput = typeof RevokeServicePrincipalGrantInputSchema.Type;

export class ServicePrincipalGrantAuthorityError extends Data.TaggedError(
  "ServicePrincipalGrantAuthorityError",
)<{
  readonly reason:
    | "InvalidCredentialEvidence"
    | "CurrentBindingRejected"
    | "MutationRejected"
    | "PersistenceFailure";
  readonly message: string;
}> {}

export interface ServicePrincipalGrantAuthorityOperations {
  readonly readReceiptApprovalCandidates: (
    credential: AcceptedOAuthServiceCredential,
    authorizationInstant: AuthorizationInstant,
    status?: ReceiptStatus,
    after?: string,
  ) => Effect.Effect<ServicePrincipalReceiptGrantAuthority, ServicePrincipalGrantAuthorityError>;
  readonly createGrant: (
    input: CreateServicePrincipalGrantInput,
  ) => Effect.Effect<ServicePrincipalReceiptGrant, ServicePrincipalGrantAuthorityError>;
  readonly endGrant: (
    input: EndServicePrincipalGrantInput,
  ) => Effect.Effect<ServicePrincipalReceiptGrant, ServicePrincipalGrantAuthorityError>;
  readonly revokeGrant: (
    input: RevokeServicePrincipalGrantInput,
  ) => Effect.Effect<ServicePrincipalReceiptGrant, ServicePrincipalGrantAuthorityError>;
}

export class ServicePrincipalGrantAuthority extends Context.Service<
  ServicePrincipalGrantAuthority,
  ServicePrincipalGrantAuthorityOperations
>()("@vektorprogrammet/domain/ServicePrincipalGrantAuthority") {}

export const makeServicePrincipalReceiptGrant = Schema.decodeUnknownSync(
  ServicePrincipalReceiptGrantSchema,
  {
    onExcessProperty: "error",
  },
);

export const composeServicePrincipalReceiptRuleRequirements = (
  authority: ServicePrincipalReceiptGrantAuthority,
  context: CanonicalResourceContext<ReceiptAccessFacts>,
  authorizationInstant: AuthorizationInstant,
) =>
  composeCapabilityEvidence("approveReceipt", {}, authority.rules, {
    principal: PrincipalSchema.cases.ServicePrincipal.make({
      servicePrincipalId: authority.servicePrincipalId,
    }),
    authorizationInstant,
    context,
    tagAssignments: [],
  });

export const evaluateServicePrincipalReceiptApprovalAccess = (
  credential: AcceptedOAuthServiceCredential,
  authority: ServicePrincipalReceiptGrantAuthority,
  authorizationInstant: AuthorizationInstant,
): AccessEvaluation<ReceiptAccessFacts> => {
  if (
    credential.principal.servicePrincipalId !== authority.servicePrincipalId ||
    authority.protectedResource !== NATIVE_API_PROTECTED_RESOURCE
  ) {
    return AccessEvaluation.Deny({ stage: "PrincipalKind", reason: "PrincipalKindNotAccepted" });
  }

  const candidateByReceipt = new Map<string, ServicePrincipalReceiptGrantCandidate>();
  const activeGrants: Array<ServicePrincipalReceiptGrant> = [];

  for (const candidate of authority.candidates) {
    const grant = candidate.grant;

    if (
      grant.servicePrincipalId !== authority.servicePrincipalId ||
      grant.clientId !== authority.clientId ||
      grant.protectedResource !== authority.protectedResource ||
      grant.operationId !== RECEIPT_APPROVAL_QUEUE_OPERATION ||
      grant.capabilityId !== "approveReceipt" ||
      grant.resourceKind !== RECEIPT_RESOURCE_KIND ||
      grant.receiptId !== candidate.receipt.receiptId ||
      !servicePrincipalReceiptGrantActiveAt(grant, authorizationInstant)
    ) {
      continue;
    }

    activeGrants.push(grant);

    if (!candidateByReceipt.has(candidate.receipt.receiptId)) {
      candidateByReceipt.set(candidate.receipt.receiptId, candidate);
    }
  }

  if (activeGrants.length === 0) {
    return AccessEvaluation.Deny({ stage: "Capability", reason: "CapabilityMissing" });
  }

  const contexts = [...candidateByReceipt.values()]
    .sort((left, right) => compareText(left.receipt.receiptId, right.receipt.receiptId))
    .map(({ receipt }) => ({
      domainId: RECEIPT_DOMAIN_ID,
      departmentId: receipt.departmentId,
      resource: {
        kind: RECEIPT_RESOURCE_KIND,
        id: ResourceId.make(receipt.receiptId),
      },
      facts: {
        ownerPersonId: receipt.ownerPersonId,
        state: receipt.status,
        approverPersonIds: [],
        approverServicePrincipalIds: [authority.servicePrincipalId],
        internalEvidenceEnabled: false,
      },
      authorityVersion: AuthorityVersion.make(
        [
          `service-principal:${authority.servicePrincipalId}`,
          `client:${authority.clientId}`,
          `receipt:${receipt.receiptId}:${receipt.revision}`,
          ...Array.filterMap(activeGrants, (grant) =>
            grant.receiptId === receipt.receiptId
              ? Result.succeed(`grant:${grant.grantId}:${grant.revision}`)
              : Result.failVoid,
          ).sort(compareText),
          ...authority.rules
            .map((rule) => `rule:${rule.ruleId}:${rule.revision}`)
            .sort(compareText),
        ].join("|"),
      ),
    }));

  const baseEvaluation = evaluateAccess({
    spec: RECEIPT_APPROVAL_QUEUE_ACCESS,
    credential,
    resolution: {
      selection: "AllMatching",
      contexts,
    },
    grants: activeGrants
      .sort((left, right) => compareText(left.grantId, right.grantId))
      .map(servicePrincipalReceiptGrantToAccessGrant),
    authorizationInstant,
  });

  if (!Predicate.isTagged(baseEvaluation, "Allow")) return baseEvaluation;

  const allowedContexts = baseEvaluation.resolution.contexts.filter((context) => {
    const composition = composeServicePrincipalReceiptRuleRequirements(
      authority,
      context,
      authorizationInstant,
    );

    return Predicate.isTagged(composition.decision, "Allow");
  });

  if (allowedContexts.length === 0) {
    return AccessEvaluation.Deny({ stage: "Requirement", reason: "RequirementFailed" });
  }

  return {
    ...baseEvaluation,
    resolution: {
      ...baseEvaluation.resolution,
      contexts: allowedContexts,
    },
  };
};

export const servicePrincipalReceiptGrantActiveAt = (
  grant: ServicePrincipalReceiptGrant,
  authorizationInstant: AuthorizationInstant,
): boolean =>
  grant.revokedAt === null &&
  compareRfc3339Instants(grant.startAt, authorizationInstant) <= 0 &&
  (grant.endAt === null || compareRfc3339Instants(authorizationInstant, grant.endAt) < 0);

export const servicePrincipalReceiptGrantToAccessGrant = (
  grant: ServicePrincipalReceiptGrant,
): Grant =>
  decodeGrant({
    grantId: grant.grantId,
    subject: PrincipalSchema.cases.ServicePrincipal.make({
      servicePrincipalId: grant.servicePrincipalId,
    }),
    capability: { type: APPROVE_RECEIPT_CAPABILITY },
    scope: Scope.Resource({
      resource: {
        kind: RECEIPT_RESOURCE_KIND,
        id: ResourceId.make(grant.receiptId),
      },
    }),
    startAt: grant.startAt,
    endAt: grant.endAt,
    requirements: [],
    source: AuthorityRef.make(`service-principal-grant:${grant.grantId}`),
    revision: grant.revision,
  });

const compareText = (left: string, right: string): -1 | 0 | 1 =>
  left < right ? -1 : left > right ? 1 : 0;

export const activeServicePrincipalReceiptGrants = (
  grants: ReadonlyArray<ServicePrincipalReceiptGrant>,
  servicePrincipalId: ServicePrincipalId,
  authorizationInstant: AuthorizationInstant,
): ReadonlyArray<ServicePrincipalReceiptGrant> =>
  [
    ...new Map(
      Array.filterMap(grants, (grant) =>
        grant.servicePrincipalId === servicePrincipalId &&
        servicePrincipalReceiptGrantActiveAt(grant, authorizationInstant)
          ? Result.succeed([grant.grantId, grant] as const)
          : Result.failVoid,
      ),
    ).values(),
  ].sort((left, right) => compareText(left.grantId, right.grantId));

export const servicePrincipalApproverIdsForContext = (
  grants: ReadonlyArray<ServicePrincipalReceiptGrant>,
  context: CanonicalResourceContext,
  authorizationInstant: AuthorizationInstant,
): ReadonlyArray<ServicePrincipalId> => {
  if (context.resource === null || context.resource.kind !== RECEIPT_RESOURCE_KIND) return [];

  return [
    ...new Set(
      Array.filterMap(grants, (grant) =>
        servicePrincipalReceiptGrantActiveAt(grant, authorizationInstant) &&
        ResourceId.make(grant.receiptId) === context.resource?.id
          ? Result.succeed(grant.servicePrincipalId)
          : Result.failVoid,
      ),
    ),
  ].sort(compareText);
};
