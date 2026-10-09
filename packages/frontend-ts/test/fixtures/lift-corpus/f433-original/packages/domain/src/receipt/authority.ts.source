import { Scope } from "../authz/access.js";
import { DelegationArea, type Delegation } from "../authz/delegation.js";
import { delegationsReaching } from "../authz/reach.js";
import { Effect, Schema } from "effect";
import type { OrganizationPersonAuthority } from "../organization/authority.js";
import { DepartmentId, PersonId } from "../organization/schema.js";
import { compareRfc3339Instants, Rfc3339InstantSchema } from "../time.js";
import {
  AmbiguousReceiptPaymentAuthority,
  ReceiptAuthorityDenied,
  ReceiptNotFound,
  ReceiptScopeDenied,
  type ReceiptAuthorityMappingError,
} from "./errors.js";
import {
  ApprovalScopeSchema,
  ReceiptActorSchema,
  type ReceiptActor,
  type ReceiptSettlementActor,
} from "./schema.js";

const NonEmpty = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value.trim() === value, {
      message: "a trimmed non-empty string",
    }),
  ),
);

const Revision = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

export const ReceiptPaymentAuthorityId = NonEmpty.pipe(Schema.brand("ReceiptPaymentAuthorityId"));

export type ReceiptPaymentAuthorityId = typeof ReceiptPaymentAuthorityId.Type;

export const ReceiptApprovalGrantId = NonEmpty.pipe(Schema.brand("ReceiptApprovalGrantId"));

export type ReceiptApprovalGrantId = typeof ReceiptApprovalGrantId.Type;

export const ReceiptSettlementGrantId = NonEmpty.pipe(Schema.brand("ReceiptSettlementGrantId"));

export type ReceiptSettlementGrantId = typeof ReceiptSettlementGrantId.Type;

export const ReceiptAuthorityInstantSchema = Rfc3339InstantSchema;

export type ReceiptAuthorityInstant = typeof ReceiptAuthorityInstantSchema.Type;

export const ReceiptApprovalGrantScopeSchema = Schema.TaggedUnion({
  Department: { departmentId: DepartmentId },
  Global: {},
});

export type ReceiptApprovalGrantScope = typeof ReceiptApprovalGrantScopeSchema.Type;

export const ReceiptSettlementGrantScopeSchema = Schema.TaggedUnion({
  Department: { departmentId: DepartmentId },
  Global: {},
});

export type ReceiptSettlementGrantScope = typeof ReceiptSettlementGrantScopeSchema.Type;

const ReceiptPaymentAuthorityFields = {
  paymentAuthorityId: ReceiptPaymentAuthorityId,
  personId: PersonId,
  departmentId: DepartmentId,
  paymentAccountCiphertext: NonEmpty,
  startAt: ReceiptAuthorityInstantSchema,
  endAt: Schema.NullOr(ReceiptAuthorityInstantSchema),
  revision: Revision,
} as const;

const ReceiptApprovalGrantFields = {
  approvalGrantId: ReceiptApprovalGrantId,
  personId: PersonId,
  scope: ReceiptApprovalGrantScopeSchema,
  startAt: ReceiptAuthorityInstantSchema,
  endAt: Schema.NullOr(ReceiptAuthorityInstantSchema),
  revision: Revision,
} as const;

const ReceiptSettlementGrantFields = {
  settlementGrantId: ReceiptSettlementGrantId,
  personId: PersonId,
  scope: ReceiptSettlementGrantScopeSchema,
  startAt: ReceiptAuthorityInstantSchema,
  endAt: Schema.NullOr(ReceiptAuthorityInstantSchema),
  revision: Revision,
} as const;

const orderedAuthorityInterval = Schema.makeFilter(
  (authority: { readonly startAt: string; readonly endAt: string | null }) =>
    authority.endAt === null || compareRfc3339Instants(authority.endAt, authority.startAt) > 0,
  { message: "a half-open Receipt authority interval" },
);

export const ReceiptPaymentAuthoritySchema = Schema.Struct(ReceiptPaymentAuthorityFields).pipe(
  Schema.check(orderedAuthorityInterval),
);

export type ReceiptPaymentAuthority = typeof ReceiptPaymentAuthoritySchema.Type;

export const ReceiptApprovalGrantSchema = Schema.Struct(ReceiptApprovalGrantFields).pipe(
  Schema.check(orderedAuthorityInterval),
);

export type ReceiptApprovalGrant = typeof ReceiptApprovalGrantSchema.Type;

export const ReceiptSettlementGrantSchema = Schema.Struct(ReceiptSettlementGrantFields).pipe(
  Schema.check(orderedAuthorityInterval),
);

export type ReceiptSettlementGrant = typeof ReceiptSettlementGrantSchema.Type;

export const CreateReceiptPaymentAuthorityInputSchema = Schema.Struct({
  paymentAuthorityId: ReceiptPaymentAuthorityId,
  personId: PersonId,
  departmentId: DepartmentId,
  paymentAccountCiphertext: NonEmpty,
  startAt: ReceiptAuthorityInstantSchema,
  endAt: Schema.NullOr(ReceiptAuthorityInstantSchema),
}).pipe(Schema.check(orderedAuthorityInterval));

export type CreateReceiptPaymentAuthorityInput =
  typeof CreateReceiptPaymentAuthorityInputSchema.Type;

export const EndReceiptPaymentAuthorityInputSchema = Schema.Struct({
  paymentAuthorityId: ReceiptPaymentAuthorityId,
  endAt: ReceiptAuthorityInstantSchema,
  expectedRevision: Revision,
});

export type EndReceiptPaymentAuthorityInput = typeof EndReceiptPaymentAuthorityInputSchema.Type;

export const RemoveReceiptPaymentAuthorityInputSchema = Schema.Struct({
  paymentAuthorityId: ReceiptPaymentAuthorityId,
  expectedRevision: Revision,
});

export type RemoveReceiptPaymentAuthorityInput =
  typeof RemoveReceiptPaymentAuthorityInputSchema.Type;

export const CreateReceiptApprovalGrantInputSchema = Schema.Struct({
  approvalGrantId: ReceiptApprovalGrantId,
  personId: PersonId,
  scope: ReceiptApprovalGrantScopeSchema,
  startAt: ReceiptAuthorityInstantSchema,
  endAt: Schema.NullOr(ReceiptAuthorityInstantSchema),
}).pipe(Schema.check(orderedAuthorityInterval));

export type CreateReceiptApprovalGrantInput = typeof CreateReceiptApprovalGrantInputSchema.Type;

export const EndReceiptApprovalGrantInputSchema = Schema.Struct({
  approvalGrantId: ReceiptApprovalGrantId,
  endAt: ReceiptAuthorityInstantSchema,
  expectedRevision: Revision,
});

export type EndReceiptApprovalGrantInput = typeof EndReceiptApprovalGrantInputSchema.Type;

export const RemoveReceiptApprovalGrantInputSchema = Schema.Struct({
  approvalGrantId: ReceiptApprovalGrantId,
  expectedRevision: Revision,
});

export type RemoveReceiptApprovalGrantInput = typeof RemoveReceiptApprovalGrantInputSchema.Type;

export const CreateReceiptSettlementGrantInputSchema = Schema.Struct({
  settlementGrantId: ReceiptSettlementGrantId,
  personId: PersonId,
  scope: ReceiptSettlementGrantScopeSchema,
  startAt: ReceiptAuthorityInstantSchema,
  endAt: Schema.NullOr(ReceiptAuthorityInstantSchema),
}).pipe(Schema.check(orderedAuthorityInterval));

export type CreateReceiptSettlementGrantInput = typeof CreateReceiptSettlementGrantInputSchema.Type;

export const EndReceiptSettlementGrantInputSchema = Schema.Struct({
  settlementGrantId: ReceiptSettlementGrantId,
  endAt: ReceiptAuthorityInstantSchema,
  expectedRevision: Revision,
});

export type EndReceiptSettlementGrantInput = typeof EndReceiptSettlementGrantInputSchema.Type;

export const RemoveReceiptSettlementGrantInputSchema = Schema.Struct({
  settlementGrantId: ReceiptSettlementGrantId,
  expectedRevision: Revision,
});

export type RemoveReceiptSettlementGrantInput = typeof RemoveReceiptSettlementGrantInputSchema.Type;

export const ResolvedReceiptPaymentAuthoritySchema = Schema.Struct({
  ...ReceiptPaymentAuthorityFields,
  active: Schema.Boolean,
}).pipe(Schema.check(orderedAuthorityInterval));

export type ResolvedReceiptPaymentAuthority = typeof ResolvedReceiptPaymentAuthoritySchema.Type;

export const ResolvedReceiptApprovalGrantSchema = Schema.Struct({
  ...ReceiptApprovalGrantFields,
  active: Schema.Boolean,
}).pipe(Schema.check(orderedAuthorityInterval));

export type ResolvedReceiptApprovalGrant = typeof ResolvedReceiptApprovalGrantSchema.Type;

export const ResolvedReceiptSettlementGrantSchema = Schema.Struct({
  ...ReceiptSettlementGrantFields,
  active: Schema.Boolean,
}).pipe(Schema.check(orderedAuthorityInterval));

export type ResolvedReceiptSettlementGrant = typeof ResolvedReceiptSettlementGrantSchema.Type;

export const ReceiptOrganizationAuthorityStatusSchema = Schema.Literals([
  "Active",
  "Inactive",
  "Absent",
]);

export type ReceiptOrganizationAuthorityStatus =
  typeof ReceiptOrganizationAuthorityStatusSchema.Type;

export const ReceiptAuthoritySchema = Schema.Struct({
  personId: PersonId,
  evaluatedAt: ReceiptAuthorityInstantSchema,
  organizationAuthority: ReceiptOrganizationAuthorityStatusSchema,
  paymentAuthorities: Schema.Array(ResolvedReceiptPaymentAuthoritySchema),
  approvalGrants: Schema.Array(ResolvedReceiptApprovalGrantSchema),
  settlementGrants: Schema.Array(ResolvedReceiptSettlementGrantSchema),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (authority) =>
        authority.paymentAuthorities.every((payment) => payment.personId === authority.personId) &&
        authority.approvalGrants.every((grant) => grant.personId === authority.personId) &&
        authority.settlementGrants.every((grant) => grant.personId === authority.personId),
      { message: "Receipt authority records for the projected person" },
    ),
  ),
);

export type ReceiptAuthority = typeof ReceiptAuthoritySchema.Type;

export const ReceiptSubmissionPrincipalSchema = Schema.Struct({
  actor: ReceiptActorSchema,
  paymentAccountCiphertext: NonEmpty,
});

export type ReceiptSubmissionPrincipal = typeof ReceiptSubmissionPrincipalSchema.Type;

export const ReceiptOwnerPrincipalSchema = Schema.Struct({
  personId: PersonId,
  active: Schema.Boolean,
});

export type ReceiptOwnerPrincipal = typeof ReceiptOwnerPrincipalSchema.Type;

const compareText = (left: string, right: string): -1 | 0 | 1 =>
  left < right ? -1 : left > right ? 1 : 0;

const intervalContains = (
  authority: { readonly startAt: string; readonly endAt: string | null },
  instant: string,
): boolean =>
  compareRfc3339Instants(authority.startAt, instant) <= 0 &&
  (authority.endAt === null || compareRfc3339Instants(instant, authority.endAt) < 0);

const organizationStatus = (
  authority: OrganizationPersonAuthority,
): ReceiptOrganizationAuthorityStatus => {
  if (
    authority.globalAdministrator === "Active" ||
    authority.memberships.some((membership) => membership.active)
  ) {
    return "Active";
  }

  return authority.globalAdministrator === "Inactive" || authority.memberships.length > 0
    ? "Inactive"
    : "Absent";
};

const activeOrganizationAuthorityInDepartment = (
  authority: OrganizationPersonAuthority,
  departmentId: DepartmentId,
): boolean =>
  authority.globalAdministrator === "Active" ||
  authority.memberships.some(
    (membership) => membership.active && membership.departmentId === departmentId,
  );

/** The Economy fact that one reaching delegation stands for, keyed by the delegation. */
const delegatedFact = (delegation: Delegation) => ({
  scope: DelegationArea.guards.Department(delegation.area)
    ? Scope.Department({ departmentId: delegation.area.departmentId })
    : Scope.Global(),
  startAt: delegation.startAt,
  endAt: delegation.endAt,
  revision: delegation.revision,
});

/**
 * Combines canonical Economy records with one same-instant Organization projection. The
 * economy team's national delegations reach here (O8-15): every current member of the team
 * approves through `receipts.approve`, and only its current leaders, the finance lead, settle
 * through the leaders-only `receipts.settle`. Each reaching delegation becomes one approval or
 * settlement fact keyed `delegation:<id>`, beside the person's own Economy grants.
 */
export const projectReceiptAuthority = (
  organization: OrganizationPersonAuthority,
  paymentAuthorities: ReadonlyArray<ReceiptPaymentAuthority>,
  directApprovalGrants: ReadonlyArray<ReceiptApprovalGrant>,
  directSettlementGrants: ReadonlyArray<ReceiptSettlementGrant> = [],
): ReceiptAuthority => {
  const approvalGrants: Array<ReceiptApprovalGrant> = [...directApprovalGrants];

  for (const delegation of delegationsReaching(organization, "receipts.approve")) {
    const approvalGrantId = ReceiptApprovalGrantId.make(`delegation:${delegation.delegationId}`);

    if (approvalGrants.some((grant) => grant.approvalGrantId === approvalGrantId)) continue;
    approvalGrants.push({
      ...delegatedFact(delegation),
      approvalGrantId,
      personId: organization.personId,
    });
  }

  const settlementGrants: Array<ReceiptSettlementGrant> = [...directSettlementGrants];

  for (const delegation of delegationsReaching(organization, "receipts.settle")) {
    const settlementGrantId = ReceiptSettlementGrantId.make(
      `delegation:${delegation.delegationId}`,
    );

    if (settlementGrants.some((grant) => grant.settlementGrantId === settlementGrantId)) continue;
    settlementGrants.push({
      ...delegatedFact(delegation),
      settlementGrantId,
      personId: organization.personId,
    });
  }

  const projectedPayments: Array<ResolvedReceiptPaymentAuthority> = [];

  for (const authority of paymentAuthorities) {
    if (authority.personId !== organization.personId) continue;
    projectedPayments.push({
      ...authority,
      active:
        intervalContains(authority, organization.evaluatedAt) &&
        activeOrganizationAuthorityInDepartment(organization, authority.departmentId),
    });
  }

  projectedPayments.sort(
    (left, right) =>
      compareText(left.departmentId, right.departmentId) ||
      compareRfc3339Instants(left.startAt, right.startAt) ||
      compareText(left.paymentAuthorityId, right.paymentAuthorityId),
  );

  const resolvedOrganizationStatus = organizationStatus(organization);
  const projectedGrants: Array<ResolvedReceiptApprovalGrant> = [];

  for (const grant of approvalGrants) {
    if (grant.personId !== organization.personId) continue;
    projectedGrants.push({
      ...grant,
      active:
        intervalContains(grant, organization.evaluatedAt) &&
        (ReceiptApprovalGrantScopeSchema.guards.Global(grant.scope)
          ? resolvedOrganizationStatus === "Active"
          : activeOrganizationAuthorityInDepartment(organization, grant.scope.departmentId)),
    });
  }

  projectedGrants.sort(
    (left, right) =>
      compareText(left.scope._tag, right.scope._tag) ||
      compareText(
        ReceiptApprovalGrantScopeSchema.guards.Department(left.scope)
          ? left.scope.departmentId
          : "",
        ReceiptApprovalGrantScopeSchema.guards.Department(right.scope)
          ? right.scope.departmentId
          : "",
      ) ||
      compareRfc3339Instants(left.startAt, right.startAt) ||
      compareText(left.approvalGrantId, right.approvalGrantId),
  );

  const projectedSettlementGrants: Array<ResolvedReceiptSettlementGrant> = [];

  for (const grant of settlementGrants) {
    if (grant.personId !== organization.personId) continue;
    projectedSettlementGrants.push({
      ...grant,
      active:
        intervalContains(grant, organization.evaluatedAt) &&
        (ReceiptApprovalGrantScopeSchema.guards.Global(grant.scope)
          ? resolvedOrganizationStatus === "Active"
          : activeOrganizationAuthorityInDepartment(organization, grant.scope.departmentId)),
    });
  }

  projectedSettlementGrants.sort(
    (left, right) =>
      compareText(left.scope._tag, right.scope._tag) ||
      compareText(
        ReceiptApprovalGrantScopeSchema.guards.Department(left.scope)
          ? left.scope.departmentId
          : "",
        ReceiptApprovalGrantScopeSchema.guards.Department(right.scope)
          ? right.scope.departmentId
          : "",
      ) ||
      compareRfc3339Instants(left.startAt, right.startAt) ||
      compareText(left.settlementGrantId, right.settlementGrantId),
  );

  return {
    personId: organization.personId,
    evaluatedAt: organization.evaluatedAt,
    organizationAuthority: resolvedOrganizationStatus,
    paymentAuthorities: projectedPayments,
    approvalGrants: projectedGrants,
    settlementGrants: projectedSettlementGrants,
  };
};

type TemporalAuthority = {
  readonly startAt: string;
  readonly endAt: string | null;
};

const temporalCandidateKind = (authority: TemporalAuthority, instant: string): 0 | 1 | 2 => {
  if (intervalContains(authority, instant)) return 0;

  return compareRfc3339Instants(authority.startAt, instant) <= 0 ? 1 : 2;
};

const preferTemporalCandidate = <A extends TemporalAuthority>(
  current: A | undefined,
  candidate: A,
  instant: string,
): A => {
  if (current === undefined) return candidate;
  const currentKind = temporalCandidateKind(current, instant);
  const candidateKind = temporalCandidateKind(candidate, instant);

  if (candidateKind < currentKind) return candidate;

  if (candidateKind > currentKind || candidateKind === 0) return current;
  const starts = compareRfc3339Instants(candidate.startAt, current.startAt);

  return candidateKind === 1
    ? starts > 0
      ? candidate
      : current
    : starts < 0
      ? candidate
      : current;
};

const deny = (
  authority: ReceiptAuthority,
  operation: "Submission" | "DepartmentApproval" | "GlobalApproval" | "Owner",
  departmentId: DepartmentId | null,
): ReceiptAuthorityDenied =>
  new ReceiptAuthorityDenied({ personId: authority.personId, operation, departmentId });

const ambiguousPayment = (
  authority: ReceiptAuthority,
  payments: ReadonlyArray<ResolvedReceiptPaymentAuthority>,
): AmbiguousReceiptPaymentAuthority =>
  new AmbiguousReceiptPaymentAuthority({
    personId: authority.personId,
    departmentIds: payments
      .map((payment) => payment.departmentId)
      .sort((left, right) => compareText(left, right)),
  });

export const mapReceiptSubmissionPrincipal = (
  authority: ReceiptAuthority,
  departmentId?: DepartmentId,
): Effect.Effect<ReceiptSubmissionPrincipal, ReceiptAuthorityMappingError> => {
  const candidatesByDepartment = new Map<DepartmentId, ResolvedReceiptPaymentAuthority>();

  for (const payment of authority.paymentAuthorities) {
    candidatesByDepartment.set(
      payment.departmentId,
      preferTemporalCandidate(
        candidatesByDepartment.get(payment.departmentId),
        payment,
        authority.evaluatedAt,
      ),
    );
  }

  let selected: ResolvedReceiptPaymentAuthority | undefined;

  if (departmentId !== undefined) {
    selected = candidatesByDepartment.get(departmentId);
  } else {
    const candidates = Array.from(candidatesByDepartment.values());
    const active = candidates.filter((payment) => payment.active);

    if (active.length > 1) return Effect.fail(ambiguousPayment(authority, active));

    if (active.length === 1) {
      selected = active[0];
    } else {
      if (candidates.length > 1) return Effect.fail(ambiguousPayment(authority, candidates));
      selected = candidates[0];
    }
  }

  if (selected === undefined) {
    return Effect.fail(deny(authority, "Submission", departmentId ?? null));
  }

  return Effect.succeed({
    actor: {
      personId: authority.personId,
      departmentId: selected.departmentId,
      active: selected.active,
      approvalScope: ApprovalScopeSchema.cases.None.make({}),
    },
    paymentAccountCiphertext: selected.paymentAccountCiphertext,
  });
};

export const mapReceiptDepartmentApprovalActor = (
  authority: ReceiptAuthority,
  departmentId: DepartmentId,
): Effect.Effect<ReceiptActor, ReceiptAuthorityDenied> => {
  let selected: ResolvedReceiptApprovalGrant | undefined;

  for (const grant of authority.approvalGrants) {
    if (
      !ReceiptApprovalGrantScopeSchema.guards.Department(grant.scope) ||
      grant.scope.departmentId !== departmentId
    )
      continue;
    selected = preferTemporalCandidate(selected, grant, authority.evaluatedAt);
  }

  if (selected === undefined)
    return Effect.fail(deny(authority, "DepartmentApproval", departmentId));

  return Effect.succeed({
    personId: authority.personId,
    departmentId,
    active: selected.active,
    approvalScope: Scope.Department({ departmentId }),
  });
};

export interface ReceiptGlobalApprovalPrincipal {
  readonly personId: PersonId;
  readonly active: boolean;
}

export const mapReceiptGlobalApprovalPrincipal = (
  authority: ReceiptAuthority,
): Effect.Effect<ReceiptGlobalApprovalPrincipal, ReceiptAuthorityDenied> => {
  let selected: ResolvedReceiptApprovalGrant | undefined;

  for (const grant of authority.approvalGrants) {
    if (!ReceiptApprovalGrantScopeSchema.guards.Global(grant.scope)) continue;
    selected = preferTemporalCandidate(selected, grant, authority.evaluatedAt);
  }

  if (selected === undefined) return Effect.fail(deny(authority, "GlobalApproval", null));

  return Effect.succeed({ personId: principalPersonId(authority), active: selected.active });
};

const principalPersonId = (authority: ReceiptAuthority): PersonId => authority.personId;

export const mapReceiptGlobalApprovalActor = (
  authority: ReceiptAuthority,
  receiptDepartmentId: DepartmentId,
): Effect.Effect<ReceiptActor, ReceiptAuthorityDenied> =>
  mapReceiptGlobalApprovalPrincipal(authority).pipe(
    Effect.map((principal) => ({
      personId: principal.personId,
      departmentId: receiptDepartmentId,
      active: principal.active,
      approvalScope: Scope.Global(),
    })),
  );

/**
 * Selects the same grant used by a protected approval command for one
 * canonical receipt department.
 */
export const selectReceiptApprovalGrant = (
  authority: ReceiptAuthority,
  receiptDepartmentId: DepartmentId,
): ResolvedReceiptApprovalGrant | undefined => {
  let global: ResolvedReceiptApprovalGrant | undefined;
  let department: ResolvedReceiptApprovalGrant | undefined;

  for (const grant of authority.approvalGrants) {
    if (ReceiptApprovalGrantScopeSchema.guards.Global(grant.scope)) {
      global = preferTemporalCandidate(global, grant, authority.evaluatedAt);
    } else if (grant.scope.departmentId === receiptDepartmentId) {
      department = preferTemporalCandidate(department, grant, authority.evaluatedAt);
    }
  }

  return global?.active === true
    ? global
    : department?.active === true
      ? department
      : (global ?? department);
};

/**
 * Existing receipt approval derives its only department scope from the locked
 * receipt. Active global authority wins, then active authority for that
 * department; known inactive authority remains an inactive actor.
 */
export const mapReceiptApprovalActor = (
  authority: ReceiptAuthority,
  receiptDepartmentId: DepartmentId,
): Effect.Effect<ReceiptActor, ReceiptAuthorityDenied> => {
  const selected = selectReceiptApprovalGrant(authority, receiptDepartmentId);

  if (selected === undefined)
    return Effect.fail(deny(authority, "DepartmentApproval", receiptDepartmentId));

  return Effect.succeed({
    personId: authority.personId,
    departmentId: receiptDepartmentId,
    active: selected.active,
    approvalScope: ReceiptApprovalGrantScopeSchema.guards.Global(selected.scope)
      ? Scope.Global()
      : Scope.Department({ departmentId: receiptDepartmentId }),
  });
};

/**
 * An existing Receipt owns the department that selects approval authority.
 * Absence of an applicable grant is therefore a scope denial, not an
 * authority-projection denial.
 */
export const mapExistingReceiptApprovalActor = (
  authority: ReceiptAuthority,
  receiptId: string,
  receiptDepartmentId: DepartmentId,
): Effect.Effect<ReceiptActor, ReceiptScopeDenied> =>
  mapReceiptApprovalActor(authority, receiptDepartmentId).pipe(
    Effect.mapError(
      () =>
        new ReceiptScopeDenied({
          receiptId,
          departmentId: receiptDepartmentId,
        }),
    ),
  );

/** Selects an active global grant first, then the receipt's department grant. */
export const selectReceiptSettlementGrant = (
  authority: ReceiptAuthority,
  receiptDepartmentId: DepartmentId,
): ResolvedReceiptSettlementGrant | undefined => {
  let global: ResolvedReceiptSettlementGrant | undefined;
  let department: ResolvedReceiptSettlementGrant | undefined;

  for (const grant of authority.settlementGrants) {
    if (ReceiptApprovalGrantScopeSchema.guards.Global(grant.scope)) {
      global = preferTemporalCandidate(global, grant, authority.evaluatedAt);
    } else if (grant.scope.departmentId === receiptDepartmentId) {
      department = preferTemporalCandidate(department, grant, authority.evaluatedAt);
    }
  }

  return global?.active === true
    ? global
    : department?.active === true
      ? department
      : (global ?? department);
};

/**
 * Settlement scope is intentionally concealed. An absent, inactive, or
 * out-of-scope grant is indistinguishable from an unknown receipt.
 */
export const mapExistingReceiptSettlementActor = (
  authority: ReceiptAuthority,
  receiptId: string,
  receiptDepartmentId: DepartmentId,
): Effect.Effect<ReceiptSettlementActor, ReceiptNotFound> => {
  const selected = selectReceiptSettlementGrant(authority, receiptDepartmentId);

  if (selected?.active !== true) return Effect.fail(new ReceiptNotFound({ receiptId }));

  return Effect.succeed({
    personId: authority.personId,
    active: true,
    settlementScope: ReceiptApprovalGrantScopeSchema.guards.Global(selected.scope)
      ? Scope.Global()
      : Scope.Department({ departmentId: receiptDepartmentId }),
  });
};

/** Owner lists use this person-keyed result and never select one department. */
export const mapReceiptOwnerPrincipal = (
  authority: ReceiptAuthority,
): Effect.Effect<ReceiptOwnerPrincipal, ReceiptAuthorityDenied> =>
  authority.organizationAuthority === "Absent"
    ? Effect.fail(deny(authority, "Owner", null))
    : Effect.succeed({
        personId: authority.personId,
        active: authority.organizationAuthority === "Active",
      });

/** Existing receipt transitions supply the receipt's immutable department. */
export const mapReceiptOwnerActor = (
  authority: ReceiptAuthority,
  receiptDepartmentId: DepartmentId,
): Effect.Effect<ReceiptActor, ReceiptAuthorityDenied> =>
  mapReceiptOwnerPrincipal(authority).pipe(
    Effect.map((principal) => ({
      personId: principal.personId,
      departmentId: receiptDepartmentId,
      active: principal.active,
      approvalScope: ApprovalScopeSchema.cases.None.make({}),
    })),
  );
