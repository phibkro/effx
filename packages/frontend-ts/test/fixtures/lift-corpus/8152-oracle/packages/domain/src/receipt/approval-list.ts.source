import { Predicate } from "effect";
import {
  PrincipalSchema,
  AuthorityVersion,
  RECEIPT_DOMAIN_ID,
  RECEIPT_RESOURCE_KIND,
  ResourceId,
  type CanonicalResourceContext,
  type ReceiptAccessFacts,
} from "../authz/access.js";
import { allow, deny, type Decision, type DecisionReason } from "../authz/decision.js";
import { composeCapabilityEvidence } from "../authz/rules.js";
import type { AuthzRule, AuthzTagAssignment } from "../authz/schema.js";
import type { OrganizationPersonAuthority } from "../organization/authority.js";
import type { DepartmentId } from "../organization/schema.js";
import {
  projectReceiptAuthority,
  selectReceiptApprovalGrant,
  type ReceiptAuthority,
} from "./authority.js";
import type { ReceiptListItem } from "./projections.js";

export type ReceiptApprovalCandidate = Pick<
  ReceiptListItem,
  "receiptId" | "ownerPersonId" | "departmentId" | "status" | "revision"
>;

export type ReceiptApprovalSelection = {
  readonly receiptIds: ReadonlyArray<string>;
};

const compareText = (left: string, right: string): -1 | 0 | 1 =>
  left < right ? -1 : left > right ? 1 : 0;

const isCanonicalApproverRelationship = (
  organization: OrganizationPersonAuthority,
  departmentId: DepartmentId,
): boolean =>
  organization.globalAdministrator === "Active" ||
  organization.memberships.some(
    (membership) => membership.active && membership.departmentId === departmentId,
  );

const receiptAuthorityVersion = (
  receipt: ReceiptApprovalCandidate,
  organization: OrganizationPersonAuthority,
  directAuthority: ReceiptAuthority,
  rules: ReadonlyArray<AuthzRule>,
): AuthorityVersion =>
  AuthorityVersion.make(
    [
      `receipt:${receipt.receiptId}:${receipt.revision}`,
      `organization:${organization.globalAdministrator}`,
      ...organization.memberships
        .map(
          (membership) =>
            `membership:${membership.membershipId}:${membership.active ? "active" : "inactive"}`,
        )
        .sort(compareText),
      ...directAuthority.approvalGrants
        .map((grant) => `grant:${grant.approvalGrantId}:${grant.revision}:${grant.active}`)
        .sort(compareText),
      ...rules.map((rule) => `rule:${rule.ruleId}:${rule.revision}`).sort(compareText),
    ].join("|"),
  );

export const makeReceiptApprovalContext = (
  receipt: ReceiptApprovalCandidate,
  organization: OrganizationPersonAuthority,
  directAuthority: ReceiptAuthority,
  rules: ReadonlyArray<AuthzRule>,
): CanonicalResourceContext<ReceiptAccessFacts> => ({
  domainId: RECEIPT_DOMAIN_ID,
  departmentId: receipt.departmentId,
  resource: {
    kind: RECEIPT_RESOURCE_KIND,
    id: ResourceId.make(receipt.receiptId),
  },
  facts: {
    ownerPersonId: receipt.ownerPersonId,
    state: receipt.status,
    approverPersonIds: isCanonicalApproverRelationship(organization, receipt.departmentId)
      ? [directAuthority.personId]
      : [],
    approverServicePrincipalIds: [],
    internalEvidenceEnabled: false,
  },
  authorityVersion: receiptAuthorityVersion(receipt, organization, directAuthority, rules),
});

/**
 * Evaluates every collection row against its canonical receipt context. The
 * result never widens one accepted row into department-wide visibility.
 */
export interface ReceiptApprovalSelectionEvidence {
  readonly receiptIds: ReadonlyArray<string>;
  readonly candidateSeen: boolean;
  readonly denialReason: DecisionReason | undefined;
  readonly inactiveGrantSeen: boolean;
}

export const evaluateReceiptApprovalCandidates = (
  organization: OrganizationPersonAuthority,
  directAuthority: ReceiptAuthority,
  candidates: ReadonlyArray<ReceiptApprovalCandidate>,
  rules: ReadonlyArray<AuthzRule>,
  tagAssignments: ReadonlyArray<AuthzTagAssignment>,
): ReceiptApprovalSelectionEvidence => {
  const directEvidence = { approvalGrants: directAuthority.approvalGrants };
  const receiptIds: string[] = [];
  let denialReason: DecisionReason | undefined;
  let inactiveGrantSeen = directAuthority.approvalGrants.length > 0;

  for (const receipt of candidates) {
    const context = makeReceiptApprovalContext(receipt, organization, directAuthority, rules);

    const composition = composeCapabilityEvidence("approveReceipt", directEvidence, rules, {
      principal: PrincipalSchema.cases.Person.make({ personId: directAuthority.personId }),
      authorizationInstant: directAuthority.evaluatedAt,
      context,
      tagAssignments,
    });

    if (Predicate.isTagged(composition.decision, "Deny")) {
      denialReason ??= composition.decision.reason;
      continue;
    }

    const authority = projectReceiptAuthority(
      organization,
      [],
      composition.decision.value.approvalGrants ?? [],
    );

    const selected = selectReceiptApprovalGrant(authority, receipt.departmentId);

    if (selected?.active === true) {
      receiptIds.push(receipt.receiptId);
    } else {
      inactiveGrantSeen ||= selected !== undefined;
    }
  }

  return { receiptIds, candidateSeen: candidates.length > 0, denialReason, inactiveGrantSeen };
};

export const receiptApprovalSelectionDecision = (
  directAuthority: ReceiptAuthority,
  evidence: ReceiptApprovalSelectionEvidence,
): Decision<ReceiptApprovalSelection> => {
  if (directAuthority.organizationAuthority !== "Active") return deny("AuthorityInactive");

  if (!evidence.candidateSeen) {
    return directAuthority.approvalGrants.some(({ active }) => active)
      ? allow({ receiptIds: [] })
      : deny(directAuthority.approvalGrants.length > 0 ? "AuthorityInactive" : "NotInScope");
  }

  if (evidence.receiptIds.length > 0) return allow({ receiptIds: evidence.receiptIds });

  if (evidence.denialReason !== undefined) return deny(evidence.denialReason);

  return deny(evidence.inactiveGrantSeen ? "AuthorityInactive" : "NotInScope");
};

export const selectAuthorizedReceiptApprovals = (
  organization: OrganizationPersonAuthority,
  directAuthority: ReceiptAuthority,
  candidates: ReadonlyArray<ReceiptApprovalCandidate>,
  rules: ReadonlyArray<AuthzRule>,
  tagAssignments: ReadonlyArray<AuthzTagAssignment>,
): Decision<ReceiptApprovalSelection> =>
  receiptApprovalSelectionDecision(
    directAuthority,
    evaluateReceiptApprovalCandidates(
      organization,
      directAuthority,
      candidates,
      rules,
      tagAssignments,
    ),
  );

const isPendingReceiptRequirement = (rule: AuthzRule): boolean =>
  rule.effectKind === "requirement" && rule.params.requirementId === "receipts.pending";

/**
 * Applies the queue's rule-aware approver relationship to one canonical
 * receipt while deliberately excluding the decision-only pending requirement.
 */
export const selectAuthorizedReceiptFileForApproval = (
  organization: OrganizationPersonAuthority,
  directAuthority: ReceiptAuthority,
  candidate: ReceiptApprovalCandidate,
  rules: ReadonlyArray<AuthzRule>,
  tagAssignments: ReadonlyArray<AuthzTagAssignment>,
): Decision<ReceiptApprovalSelection> =>
  selectAuthorizedReceiptApprovals(
    organization,
    directAuthority,
    [candidate],
    rules.filter((rule) => !isPendingReceiptRequirement(rule)),
    tagAssignments,
  );
