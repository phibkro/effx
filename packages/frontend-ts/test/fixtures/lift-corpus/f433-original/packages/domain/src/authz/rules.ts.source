import { Result, Array, Match, Data, Predicate } from "effect";
import type { PersonId } from "../organization/schema.js";
import {
  ReceiptApprovalGrantId,
  ReceiptPaymentAuthorityId,
  type ReceiptApprovalGrant,
  type ReceiptPaymentAuthority,
} from "../receipt/authority.js";
import { compareRfc3339Instants } from "../time.js";
import {
  Scope,
  evaluateRequirement,
  RECEIPT_APPROVER_REQUIREMENT,
  RECEIPT_PENDING_REQUIREMENT,
  type CanonicalResourceContext,
  type Principal,
  type RequirementResult,
  type TypedRequirement,
} from "./access.js";
import { allow, deny, type Decision } from "./decision.js";
import {
  CAPABILITY_IDS,
  type AuthzCapabilityId,
  type AuthzRule,
  type AuthzRuleId,
  type AuthzTagAssignment,
} from "./schema.js";

export type AuthzApplicabilityFacts<C = unknown> = {
  readonly principal: Principal;
  readonly authorizationInstant: string;
  readonly context: CanonicalResourceContext<C>;
  readonly tagAssignments: ReadonlyArray<AuthzTagAssignment>;
};

export const isAuthzIntervalActive = (
  interval: { readonly startAt: string; readonly endAt: string | null },
  authorizationInstant: string,
): boolean =>
  compareRfc3339Instants(interval.startAt, authorizationInstant) <= 0 &&
  (interval.endAt === null || compareRfc3339Instants(authorizationInstant, interval.endAt) < 0);

export const isAuthzTagAssignmentActive = (
  assignment: AuthzTagAssignment,
  personId: PersonId,
  authorizationInstant: string,
): boolean =>
  assignment.personId === personId && isAuthzIntervalActive(assignment, authorizationInstant);

export const authzRuleSubjectApplies = (
  rule: AuthzRule,
  principal: Principal,
  authorizationInstant: string,
  tagAssignments: ReadonlyArray<AuthzTagAssignment>,
): boolean => {
  const subject = rule.subject;

  return Match.value(subject).pipe(
    Match.withReturnType<boolean>(),
    Match.tag("Person", (subject) => {
      return Predicate.isTagged(principal, "Person") && subject.personId === principal.personId;
    }),
    Match.tag("ServicePrincipal", (subject) => {
      return (
        Predicate.isTagged(principal, "ServicePrincipal") &&
        subject.servicePrincipalId === principal.servicePrincipalId
      );
    }),
    Match.tag("Tag", (subject) => {
      return (
        Predicate.isTagged(principal, "Person") &&
        tagAssignments.some(
          (assignment) =>
            assignment.tagId === subject.tagId &&
            isAuthzTagAssignmentActive(assignment, principal.personId, authorizationInstant),
        )
      );
    }),
    Match.exhaustive,
  );
};

export const authzRuleScopeApplies = (
  rule: AuthzRule,
  context: CanonicalResourceContext,
): boolean => {
  return Match.value(rule.scope).pipe(
    Match.withReturnType<boolean>(),
    Match.tag("Global", () => {
      return true;
    }),
    Match.tag("Domain", (matchedValue) => {
      return context.domainId === matchedValue.domainId;
    }),
    Match.tag("Department", (matchedValue) => {
      return context.departmentId === matchedValue.departmentId;
    }),
    Match.tag("Resource", (matchedValue) => {
      return (
        context.resource !== null &&
        context.resource.kind === matchedValue.resource.kind &&
        context.resource.id === matchedValue.resource.id
      );
    }),
    Match.exhaustive,
  );
};

export const isAuthzRuleApplicable = (rule: AuthzRule, facts: AuthzApplicabilityFacts): boolean =>
  isAuthzIntervalActive(rule, facts.authorizationInstant) &&
  authzRuleSubjectApplies(
    rule,
    facts.principal,
    facts.authorizationInstant,
    facts.tagAssignments,
  ) &&
  authzRuleScopeApplies(rule, facts.context);

export const applicableAuthzRules = (
  rules: ReadonlyArray<AuthzRule>,
  facts: AuthzApplicabilityFacts,
): ReadonlyArray<AuthzRule> => rules.filter((rule) => isAuthzRuleApplicable(rule, facts));

const compareText = (left: string, right: string): -1 | 0 | 1 =>
  left < right ? -1 : left > right ? 1 : 0;

export type RuleReceptiveEvidence = {
  readonly approvalGrants?: ReadonlyArray<ReceiptApprovalGrant>;
  readonly paymentAuthorities?: ReadonlyArray<ReceiptPaymentAuthority>;
};

type ApprovalContribution = {
  readonly ruleId: AuthzRuleId;
  readonly fact: ReceiptApprovalGrant;
};

type PaymentContribution = {
  readonly ruleId: AuthzRuleId;
  readonly fact: ReceiptPaymentAuthority;
};

export type RuleRequirementContribution = {
  readonly requirement: TypedRequirement;
  readonly sourceRuleId: AuthzRuleId;
};

export type EvaluatedRuleRequirement = {
  readonly requirement: TypedRequirement;
  readonly result: RequirementResult;
  readonly sourceRuleIds: ReadonlyArray<AuthzRuleId>;
};

export type CapabilityRequirementResult =
  | {
      readonly _tag: "Satisfied";
      readonly requirements: ReadonlyArray<EvaluatedRuleRequirement>;
    }
  | {
      readonly _tag: "Failed";
      readonly requirements: ReadonlyArray<EvaluatedRuleRequirement>;
      readonly failed: EvaluatedRuleRequirement;
    }
  | {
      readonly _tag: "Ambiguous";
      readonly requirementId: string;
      readonly sourceRuleIds: ReadonlyArray<AuthzRuleId>;
    };

export const CapabilityRequirementResult = Data.taggedEnum<CapabilityRequirementResult>();

const stableParameters = (parameters: TypedRequirement["parameters"]): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(parameters).sort(([left], [right]) => compareText(left, right)),
    ),
  );

export const evaluateCapabilityRequirements = (
  capabilityId: AuthzCapabilityId,
  contributions: ReadonlyArray<RuleRequirementContribution>,
  principal: Principal,
  context: CanonicalResourceContext,
): CapabilityRequirementResult => {
  const declaredOrder = CAPABILITY_IDS[capabilityId].requirementSlots;

  const orderedIds = [...new Set(contributions.map(({ requirement }) => requirement.id))].sort(
    (left, right) => {
      const leftIndex = declaredOrder.findIndex((id) => id === left);
      const rightIndex = declaredOrder.findIndex((id) => id === right);

      return leftIndex - rightIndex || compareText(left, right);
    },
  );

  const requirements: EvaluatedRuleRequirement[] = [];

  for (const requirementId of orderedIds) {
    const matching = contributions.filter(({ requirement }) => requirement.id === requirementId);

    const parameterValues = [
      ...new Set(matching.map(({ requirement }) => stableParameters(requirement.parameters))),
    ];

    const sourceRuleIds = [...new Set(matching.map(({ sourceRuleId }) => sourceRuleId))].sort(
      compareText,
    );

    if (parameterValues.length !== 1) {
      return CapabilityRequirementResult.Ambiguous({ requirementId, sourceRuleIds });
    }

    const requirement = matching[0]!.requirement;

    const evaluated = {
      requirement,
      result: evaluateRequirement(requirement, principal, context),
      sourceRuleIds,
    };

    requirements.push(evaluated);

    if (Predicate.isTagged(evaluated.result, "Failed")) {
      return CapabilityRequirementResult.Failed({ requirements, failed: evaluated });
    }
  }

  return CapabilityRequirementResult.Satisfied({ requirements });
};

export type ComposedCapabilityEvidence = {
  readonly evidence: RuleReceptiveEvidence;
  readonly requirements: CapabilityRequirementResult;
  readonly decision: Decision<RuleReceptiveEvidence>;
  readonly contributingRuleIds: ReadonlyArray<AuthzRuleId>;
};

const ruleFactId = (ruleId: AuthzRuleId): string => `authz-rule:${ruleId}`;

/**
 * Re-filters every supplied rule against the full request facts, then extends
 * direct evidence only through frozen receptive slots. With no contributing
 * rule, `evidence` and the allowed Decision value are the original object.
 */
export const composeCapabilityEvidence = (
  capabilityId: AuthzCapabilityId,
  directEvidence: RuleReceptiveEvidence,
  rules: ReadonlyArray<AuthzRule>,
  requestFacts: AuthzApplicabilityFacts,
): ComposedCapabilityEvidence => {
  const applicableRules = [
    ...new Map(
      Array.filterMap(applicableAuthzRules(rules, requestFacts), (rule) =>
        rule.capabilityId === capabilityId
          ? Result.succeed([rule.ruleId, rule] as const)
          : Result.failVoid,
      ),
    ).values(),
  ].sort((left, right) => compareText(left.ruleId, right.ruleId));

  const approvalContributions: Array<ApprovalContribution> = [];
  const paymentContributions: Array<PaymentContribution> = [];
  const requirementContributions: Array<RuleRequirementContribution> = [];

  for (const rule of applicableRules) {
    if (Predicate.isTagged(rule.subject, "ServicePrincipal") && rule.effectKind !== "requirement")
      continue;

    if (rule.effectKind === "requirement") {
      if (
        rule.capabilityId !== "approveReceipt" ||
        !CAPABILITY_IDS.approveReceipt.requirementSlots.includes(rule.params.requirementId)
      ) {
        continue;
      }

      requirementContributions.push({
        requirement: {
          id:
            rule.params.requirementId === "receipts.pending"
              ? RECEIPT_PENDING_REQUIREMENT
              : RECEIPT_APPROVER_REQUIREMENT,
          parameters: rule.params.parameters,
        },
        sourceRuleId: rule.ruleId,
      });
      continue;
    }

    if (rule.effectKind !== "delegate" || !Predicate.isTagged(requestFacts.principal, "Person"))
      continue;

    if (
      rule.capabilityId === "approveReceipt" &&
      CAPABILITY_IDS.approveReceipt.receptiveEvidenceSlots.includes(rule.params.slot)
    ) {
      if (rule.params.slot === "EconomyDepartmentApprovalGrant") {
        if (requestFacts.context.departmentId === null) continue;
        approvalContributions.push({
          ruleId: rule.ruleId,
          fact: {
            approvalGrantId: ReceiptApprovalGrantId.make(ruleFactId(rule.ruleId)),
            personId: requestFacts.principal.personId,
            scope: Scope.Department({ departmentId: requestFacts.context.departmentId }),
            startAt: rule.startAt,
            endAt: rule.endAt,
            revision: rule.revision,
          },
        });
      } else {
        approvalContributions.push({
          ruleId: rule.ruleId,
          fact: {
            approvalGrantId: ReceiptApprovalGrantId.make(ruleFactId(rule.ruleId)),
            personId: requestFacts.principal.personId,
            scope: Scope.Global(),
            startAt: rule.startAt,
            endAt: rule.endAt,
            revision: rule.revision,
          },
        });
      }

      continue;
    }

    if (
      rule.capabilityId === "submitReceipt" &&
      rule.params.slot === "EconomyPaymentAuthority" &&
      CAPABILITY_IDS.submitReceipt.receptiveEvidenceSlots.includes(rule.params.slot) &&
      requestFacts.context.departmentId !== null
    ) {
      paymentContributions.push({
        ruleId: rule.ruleId,
        fact: {
          paymentAuthorityId: ReceiptPaymentAuthorityId.make(ruleFactId(rule.ruleId)),
          personId: requestFacts.principal.personId,
          departmentId: requestFacts.context.departmentId,
          paymentAccountCiphertext: rule.params.paymentAccountCiphertext,
          startAt: rule.startAt,
          endAt: rule.endAt,
          revision: rule.revision,
        },
      });
    }
  }

  const hasGeneratedEvidence = approvalContributions.length > 0 || paymentContributions.length > 0;

  let evidence: RuleReceptiveEvidence = directEvidence;

  if (hasGeneratedEvidence) {
    evidence = {};

    if (directEvidence.approvalGrants !== undefined || approvalContributions.length > 0) {
      evidence = {
        ...evidence,
        approvalGrants: [
          ...(directEvidence.approvalGrants ?? []),
          ...approvalContributions.map(({ fact }) => fact),
        ],
      };
    }

    if (directEvidence.paymentAuthorities !== undefined || paymentContributions.length > 0) {
      evidence = {
        ...evidence,
        paymentAuthorities: [
          ...(directEvidence.paymentAuthorities ?? []),
          ...paymentContributions.map(({ fact }) => fact),
        ],
      };
    }
  }

  const requirements = evaluateCapabilityRequirements(
    capabilityId,
    requirementContributions,
    requestFacts.principal,
    requestFacts.context,
  );

  const decision = Predicate.isTagged(requirements, "Ambiguous")
    ? deny<RuleReceptiveEvidence>("Ambiguous")
    : Predicate.isTagged(requirements, "Failed")
      ? deny<RuleReceptiveEvidence>("RequirementFailed")
      : allow(evidence);

  const contributingRuleIds = [
    ...new Set(
      [
        ...approvalContributions.map(({ ruleId }) => ruleId),
        ...paymentContributions.map(({ ruleId }) => ruleId),
        ...requirementContributions.map(({ sourceRuleId }) => sourceRuleId),
      ].sort(compareText),
    ),
  ];

  return { evidence, requirements, decision, contributingRuleIds };
};
