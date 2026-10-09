import { isKnownSelfInterview } from "../recruitment/applicant-identity.js";
import { Record, flow, Result, Array, Match, Data, Effect, Predicate, Schema } from "effect";
import { DepartmentId, PersonId } from "../organization/schema.js";
import {
  RecruitmentInterviewId,
  RecruitmentInvitationId,
  RecruitmentInvitationResponseStateSchema,
} from "../recruitment/schema.js";
import { compareRfc3339Instants, Rfc3339InstantSchema } from "../time.js";

const TrimmedNonEmpty = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value.trim() === value, {
      message: "a trimmed non-empty string",
    }),
  ),
);

const RevisionSchema = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const EmptyRequirementParametersSchema = Schema.Record(Schema.String, Schema.Never);

export const ServicePrincipalId = TrimmedNonEmpty.pipe(Schema.brand("ServicePrincipalId"));

export type ServicePrincipalId = typeof ServicePrincipalId.Type;

export const CapabilityId = TrimmedNonEmpty.pipe(Schema.brand("CapabilityId"));

export type CapabilityId = typeof CapabilityId.Type;

export const GrantId = TrimmedNonEmpty.pipe(Schema.brand("GrantId"));

export type GrantId = typeof GrantId.Type;

export const AuthorityRef = TrimmedNonEmpty.pipe(Schema.brand("AuthorityRef"));

export type AuthorityRef = typeof AuthorityRef.Type;

export const AuthorityVersion = TrimmedNonEmpty.pipe(Schema.brand("AuthorityVersion"));

export type AuthorityVersion = typeof AuthorityVersion.Type;

export const AuthorizationInstant = Rfc3339InstantSchema.pipe(Schema.brand("AuthorizationInstant"));

export type AuthorizationInstant = typeof AuthorizationInstant.Type;

export const CAPABILITY_TYPES = {
  "contact.submit": { ruleTarget: false, objectCapability: true },
  approveReceipt: { ruleTarget: true, objectCapability: false },
  submitReceipt: { ruleTarget: true, objectCapability: false },
  reviewApplicants: { ruleTarget: true, objectCapability: false },
  "profile.read-self": { ruleTarget: false, objectCapability: false },
  "profile.update-self": { ruleTarget: false, objectCapability: false },
  "organization.read-team-interest": { ruleTarget: false, objectCapability: false },
  "organization.read-mailing-lists": { ruleTarget: false, objectCapability: false },
  "organization.create-department": { ruleTarget: false, objectCapability: false },
  "organization.create-team": { ruleTarget: false, objectCapability: false },
  "organization.manage-appointments": { ruleTarget: false, objectCapability: false },
  "organization.manage-delegations": { ruleTarget: false, objectCapability: false },
  "organization.create-field-of-study": { ruleTarget: false, objectCapability: false },
  "profile.read-directory": { ruleTarget: false, objectCapability: false },
  "schools.read-directory": { ruleTarget: false, objectCapability: false },
  "schools.manage": { ruleTarget: false, objectCapability: false },
  "recruitment.maintain": { ruleTarget: false, objectCapability: false },
  "admissions.outcomes.read": { ruleTarget: false, objectCapability: false },
  "admissions.outcomes.decide": { ruleTarget: false, objectCapability: false },
  "placements.self": { ruleTarget: false, objectCapability: false },
  "placements.manage": { ruleTarget: false, objectCapability: false },
  "placements.days-served": { ruleTarget: false, objectCapability: false },
  "certificates.issue": { ruleTarget: false, objectCapability: false },
  "onboarding.manage": { ruleTarget: false, objectCapability: false },
  "onboarding.claim": { ruleTarget: false, objectCapability: true },
  "admissions.read-periods": { ruleTarget: false, objectCapability: false },
  "admissions.read-applicant-progress": { ruleTarget: false, objectCapability: false },
  "admissions.create-period": { ruleTarget: false, objectCapability: false },
  "admissions.revise-period": { ruleTarget: false, objectCapability: false },
  "admissions.returning-assistant-options": { ruleTarget: false, objectCapability: false },
  "admissions.returning-assistant-register": { ruleTarget: false, objectCapability: false },
  "recruitment.invitation-response": { ruleTarget: false, objectCapability: true },
  "recruitment.read-interviews": { ruleTarget: false, objectCapability: false },
  "recruitment.read-interview-report": { ruleTarget: false, objectCapability: false },
  "recruitment.schedule-interview": { ruleTarget: false, objectCapability: false },
  "recruitment.conduct-interview": { ruleTarget: false, objectCapability: false },
  "receipts.manage-owned": { ruleTarget: false, objectCapability: false },
  "receipts.read-owned": { ruleTarget: false, objectCapability: false },
  settleReceipt: { ruleTarget: false, objectCapability: false },
  "content.read-workspace": { ruleTarget: false, objectCapability: false },
  "content.create-article": { ruleTarget: false, objectCapability: false },
  "content.read-article": { ruleTarget: false, objectCapability: false },
  "content.revise-article": { ruleTarget: false, objectCapability: false },
  "content.publish-article": { ruleTarget: false, objectCapability: false },
  "social-events.read-scope": { ruleTarget: false, objectCapability: false },
  "social-events.read": { ruleTarget: false, objectCapability: false },
  "social-events.create": { ruleTarget: false, objectCapability: false },
  "receipts.read-internal-evidence": { ruleTarget: false, objectCapability: false },
  "team-applications.read": { ruleTarget: false, objectCapability: false },
  "team-applications.manage": { ruleTarget: false, objectCapability: false },
} as const;

export const CAPABILITY_TYPE_IDS = Record.keys(CAPABILITY_TYPES);

export const CapabilityTypeId = Schema.Literals(CAPABILITY_TYPE_IDS).pipe(
  Schema.brand("CapabilityTypeId"),
);

export type CapabilityTypeId = typeof CapabilityTypeId.Type;

export const APPROVE_RECEIPT_CAPABILITY = CapabilityTypeId.make("approveReceipt");

export const OBJECT_CAPABILITY_TYPE_IDS: ReadonlyArray<CapabilityTypeId> = Array.filterMap(
  CAPABILITY_TYPE_IDS,
  (id) =>
    CAPABILITY_TYPES[id].objectCapability
      ? Result.succeed(CapabilityTypeId.make(id))
      : Result.failVoid,
);

export const SUBMIT_RECEIPT_CAPABILITY = CapabilityTypeId.make("submitReceipt");

export const INVITATION_RESPONSE_CAPABILITY = CapabilityTypeId.make(
  "recruitment.invitation-response",
);

export const READ_INTERNAL_RECEIPT_EVIDENCE_CAPABILITY = CapabilityTypeId.make(
  "receipts.read-internal-evidence",
);

export const SOCIAL_EVENTS_READ_SCOPE_CAPABILITY = CapabilityTypeId.make(
  "social-events.read-scope",
);

export const SOCIAL_EVENTS_READ_CAPABILITY = CapabilityTypeId.make("social-events.read");

export const SOCIAL_EVENTS_CREATE_CAPABILITY = CapabilityTypeId.make("social-events.create");

export const DOMAIN_IDS = {
  admissions: true,
  content: true,
  identity: true,
  organization: true,
  profile: true,
  receipts: true,
  recruitment: true,
  schools: true,
  "social-events": true,
  "team-applications": true,
  system: true,
} as const;

export const DOMAIN_ID_VALUES = Record.keys(DOMAIN_IDS);

export const DomainId = Schema.Literals(DOMAIN_ID_VALUES).pipe(Schema.brand("DomainId"));

export type DomainId = typeof DomainId.Type;

export const RECEIPT_DOMAIN_ID = DomainId.make("receipts");

export const SYSTEM_DOMAIN_ID = DomainId.make("system");

export const SOCIAL_EVENTS_DOMAIN_ID = DomainId.make("social-events");

export const RESOURCE_KINDS = {
  "identity-session": true,
  "person-profile": true,
  "organization-department": true,
  "organization-team": true,
  "organization-field-of-study": true,
  "organization-team-interest-registration": true,
  "organization-mailing-list": true,
  person: true,
  school: true,
  "admission-period": true,
  application: true,
  "recruitment-invitation-response": true,
  "recruitment-interview": true,
  receipt: true,
  "content-article": true,
} as const;

export const RESOURCE_KIND_VALUES = Record.keys(RESOURCE_KINDS);

export const ResourceKind = Schema.Literals(RESOURCE_KIND_VALUES).pipe(
  Schema.brand("ResourceKind"),
);

export type ResourceKind = typeof ResourceKind.Type;

export const RECEIPT_RESOURCE_KIND = ResourceKind.make("receipt");

export const RECRUITMENT_INVITATION_RESOURCE_KIND = ResourceKind.make(
  "recruitment-invitation-response",
);

export const ResourceId = TrimmedNonEmpty.pipe(Schema.brand("ResourceId"));

export type ResourceId = typeof ResourceId.Type;

export const REQUIREMENT_IDS = [
  "sessions.owner",
  "profile.owner",
  "organization.single-department-administrator",
  "organization.single-department-member",
  "onboarding.claim-token",
  "recruitment.interviewer-eligible",
  "recruitment.assigned-interviewer-or-administrator",
  "recruitment.assigned-interviewer",
  "recruitment.assigned-interviewer-or-co-interviewer",
  "recruitment.not-known-self",
  "recruitment.invitation-pending",
  "internal-evidence.enabled",
  "receipts.owner",
  "receipts.pending",
  "receipts.rejected",
  "receipts.approver-relationship",
  "content.draft",
  "content.revisable",
  "content.publishable",
  "content.unpublishable",
] as const;

export const RequirementId = Schema.Literals(REQUIREMENT_IDS).pipe(Schema.brand("RequirementId"));

const requirementRegistryKey = (id: RequirementId): (typeof REQUIREMENT_IDS)[number] => id;

export type RequirementId = typeof RequirementId.Type;

export const INTERNAL_EVIDENCE_ENABLED_REQUIREMENT = RequirementId.make(
  "internal-evidence.enabled",
);

export const RECEIPT_OWNER_REQUIREMENT = RequirementId.make("receipts.owner");

export const RECEIPT_PENDING_REQUIREMENT = RequirementId.make("receipts.pending");

export const RECEIPT_APPROVER_REQUIREMENT = RequirementId.make("receipts.approver-relationship");

export const SCOPE_RESOLVER_IDS = [
  "contact.department-recipient",
  "system.health",
  "identity.current-session",
  "identity.owned-sessions",
  "identity.session-by-id",
  "profile.current-person",
  "organization.public-departments",
  "organization.public-teams",
  "organization.public-field-of-studies",
  "organization.team-interest-registrations",
  "organization.mailing-lists",
  "organization.department-create",
  "organization.team-create",
  "organization.appointment-management",
  "organization.delegation-management",
  "organization.field-of-study-create",
  "profile.people-directory",
  "schools.directory",
  "schools.management",
  "recruitment.maintenance",
  "admissions.application-outcomes",
  "placements.explicit-department",
  "onboarding.application-department",
  "onboarding.claim",
  "admissions.public-open-periods",
  "admissions.public-application-options",
  "admissions.application-create",
  "admissions.public-application-by-id",
  "admissions.management-periods",
  "admissions.period-create",
  "admissions.period-by-id",
  "recruitment.invitation-response-by-capability",
  "recruitment.application-assignments",
  "recruitment.interviews",
  "recruitment.interview-report",
  "recruitment.application-by-id",
  "recruitment.interview-by-id",
  "receipts.create",
  "receipts.by-id",
  "receipts.owned",
  "receipts.approval-queue",
  "receipts.settlement-queue",
  "content.articles",
  "content.article-create",
  "content.article-by-id",
  "content.public-news",
  "content.public-news-by-slug",
  "social-events.scope",
  "social-events.list",
  "social-events.create",
  "team-applications.public-intake",
  "team-applications.public-intakes",
  "team-applications.application-create",
  "team-applications.team-applications",
  "team-applications.application-by-id",
  "team-applications.intake-by-team",
] as const;

export const ScopeResolverId = Schema.Literals(SCOPE_RESOLVER_IDS).pipe(
  Schema.brand("ScopeResolverId"),
);

const scopeResolverRegistryKey = (id: ScopeResolverId): (typeof SCOPE_RESOLVER_IDS)[number] => id;

export type ScopeResolverId = typeof ScopeResolverId.Type;

export const RECEIPT_BY_ID_SCOPE_RESOLVER = ScopeResolverId.make("receipts.by-id");

export const RECEIPT_APPROVAL_QUEUE_SCOPE_RESOLVER =
  ScopeResolverId.make("receipts.approval-queue");

export const SYSTEM_PUBLIC_SCOPE_RESOLVER = ScopeResolverId.make("system.health");

export const SOCIAL_EVENTS_SCOPE_RESOLVER = ScopeResolverId.make("social-events.scope");

export const SOCIAL_EVENTS_LIST_SCOPE_RESOLVER = ScopeResolverId.make("social-events.list");

export const SOCIAL_EVENTS_CREATE_SCOPE_RESOLVER = ScopeResolverId.make("social-events.create");

export const PrincipalSchema = Schema.TaggedUnion({
  Anonymous: {},
  Person: { personId: PersonId },
  ServicePrincipal: { servicePrincipalId: ServicePrincipalId },
  CapabilityHolder: { capabilityId: CapabilityId },
});

export type Principal = typeof PrincipalSchema.Type;

export type PrincipalKind = Principal["_tag"];

const NonAnonymousPrincipalSchema = Schema.Union([
  Schema.TaggedStruct("Person", { personId: PersonId }),
  Schema.TaggedStruct("ServicePrincipal", { servicePrincipalId: ServicePrincipalId }),
  Schema.TaggedStruct("CapabilityHolder", { capabilityId: CapabilityId }),
]);

export type NonAnonymousPrincipal = typeof NonAnonymousPrincipalSchema.Type;

export const PRINCIPAL_KINDS = [
  "Anonymous",
  "Person",
  "ServicePrincipal",
  "CapabilityHolder",
] as const;

export const PrincipalKindSchema = Schema.Literals(PRINCIPAL_KINDS);

export const CREDENTIAL_MECHANISM_KINDS = [
  "None",
  "BetterAuthCookie",
  "OAuthUserBearer",
  "OAuthServiceBearer",
  "ObjectCapability",
] as const;

export const CredentialMechanismSchema = Schema.TaggedUnion({
  None: {},
  BetterAuthCookie: {},
  OAuthUserBearer: {},
  OAuthServiceBearer: {},
  ObjectCapability: { capabilityType: CapabilityTypeId },
});

export type CredentialMechanism = typeof CredentialMechanismSchema.Type;

export const CredentialEvidenceRef = TrimmedNonEmpty.pipe(Schema.brand("CredentialEvidenceRef"));

export type CredentialEvidenceRef = typeof CredentialEvidenceRef.Type;

export const CredentialFailureReasonSchema = Schema.Literals([
  "Missing",
  "Malformed",
  "Invalid",
  "Expired",
  "Revoked",
  "WrongMechanism",
  "AmbiguousMechanism",
]);

export type CredentialFailureReason = typeof CredentialFailureReasonSchema.Type;

export const CredentialOutcomeSchema = Schema.TaggedUnion({
  Accepted: {
    mechanism: CredentialMechanismSchema,
    principal: PrincipalSchema,
    evidenceRef: CredentialEvidenceRef,
  },
  Rejected: {
    reason: CredentialFailureReasonSchema,
  },
});

export type CredentialOutcome = typeof CredentialOutcomeSchema.Type;

export const CapabilitySchema = Schema.Struct({ type: CapabilityTypeId });

export type Capability = typeof CapabilitySchema.Type;

const CapabilityListSchema = Schema.Array(CapabilitySchema).pipe(
  Schema.check(
    Schema.makeFilter(
      (capabilities) =>
        capabilities.length > 0 &&
        new Set(capabilities.map((capability) => capability.type)).size === capabilities.length,
      { message: "a non-empty capability list without duplicate types" },
    ),
  ),
);

export const CapabilityExpressionSchema = Schema.TaggedUnion({
  None: {},
  One: { capability: CapabilitySchema },
  All: { capabilities: CapabilityListSchema },
  Any: { capabilities: CapabilityListSchema },
});

export type CapabilityExpression = typeof CapabilityExpressionSchema.Type;

export const ResourceRefSchema = Schema.Struct({
  kind: ResourceKind,
  id: ResourceId,
});

export type ResourceRef = typeof ResourceRefSchema.Type;

type EncodedResourceRef = typeof ResourceRefSchema.Encoded;

export type Scope =
  | { readonly _tag: "Global" }
  | { readonly _tag: "Domain"; readonly domainId: DomainId }
  | { readonly _tag: "Department"; readonly departmentId: DepartmentId }
  | { readonly _tag: "Resource"; readonly resource: ResourceRef }
  | { readonly _tag: "And"; readonly left: Scope; readonly right: Scope }
  | { readonly _tag: "Or"; readonly left: Scope; readonly right: Scope };

export const Scope = Data.taggedEnum<Scope>();

type EncodedScope =
  | { readonly _tag: "Global" }
  | { readonly _tag: "Domain"; readonly domainId: typeof DomainId.Encoded }
  | { readonly _tag: "Department"; readonly departmentId: string }
  | { readonly _tag: "Resource"; readonly resource: EncodedResourceRef }
  | { readonly _tag: "And"; readonly left: EncodedScope; readonly right: EncodedScope }
  | { readonly _tag: "Or"; readonly left: EncodedScope; readonly right: EncodedScope };

const ScopeNodeSchema: Schema.Codec<Scope, EncodedScope> = Schema.TaggedUnion({
  Global: {},
  Domain: { domainId: DomainId },
  Department: { departmentId: DepartmentId },
  Resource: { resource: ResourceRefSchema },
  And: {
    left: Schema.suspend((): Schema.Codec<Scope, EncodedScope> => ScopeSchema),
    right: Schema.suspend((): Schema.Codec<Scope, EncodedScope> => ScopeSchema),
  },
  Or: {
    left: Schema.suspend((): Schema.Codec<Scope, EncodedScope> => ScopeSchema),
    right: Schema.suspend((): Schema.Codec<Scope, EncodedScope> => ScopeSchema),
  },
});

const scopeDepth = (scope: Scope): number =>
  Predicate.isTagged(scope, "And") || Predicate.isTagged(scope, "Or")
    ? 1 + Math.max(scopeDepth(scope.left), scopeDepth(scope.right))
    : 1;

export const ScopeSchema: Schema.Codec<Scope, EncodedScope> = ScopeNodeSchema.pipe(
  Schema.check(
    Schema.makeFilter((scope) => scopeDepth(scope) <= 16 && JSON.stringify(scope).length <= 4_096, {
      message: "a scope with at most 16 levels and 4096 encoded bytes",
    }),
  ),
);

export const ReceiptAccessFactsSchema = Schema.Struct({
  ownerPersonId: PersonId,
  state: Schema.String,
  approverPersonIds: Schema.Array(PersonId),
  approverServicePrincipalIds: Schema.Array(ServicePrincipalId),
  internalEvidenceEnabled: Schema.Boolean,
});

export type ReceiptAccessFacts = typeof ReceiptAccessFactsSchema.Type;

export const InvitationResponseAccessFactsSchema = Schema.Struct({
  capabilityId: CapabilityId,
  invitationId: RecruitmentInvitationId,
  interviewId: RecruitmentInterviewId,
  departmentId: DepartmentId,
  responseState: RecruitmentInvitationResponseStateSchema,
  responseRevision: RevisionSchema,
  supersededAt: Schema.NullOr(Rfc3339InstantSchema),
});

export type InvitationResponseAccessFacts = typeof InvitationResponseAccessFactsSchema.Type;

export interface CanonicalResourceContext<C = unknown> {
  readonly domainId: DomainId;
  readonly departmentId: DepartmentId | null;
  readonly resource: ResourceRef | null;
  readonly facts: C;
  readonly authorityVersion: AuthorityVersion;
}

export interface CanonicalScopeResolution<C = unknown> {
  readonly selection: "ExactlyOne" | "AllMatching";
  readonly contexts: ReadonlyArray<CanonicalResourceContext<C>>;
}

const ReceiptRequirementContextSchema = Schema.Struct({
  domainId: DomainId,
  departmentId: Schema.NullOr(DepartmentId),
  resource: Schema.NullOr(ResourceRefSchema),
  facts: ReceiptAccessFactsSchema,
  authorityVersion: AuthorityVersion,
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (context) =>
        context.domainId === RECEIPT_DOMAIN_ID &&
        context.resource !== null &&
        context.resource.kind === RECEIPT_RESOURCE_KIND,
      { message: "a canonical receipt resource context" },
    ),
  ),
);

const InvitationRequirementContextSchema = Schema.Struct({
  domainId: DomainId,
  departmentId: DepartmentId,
  resource: ResourceRefSchema,
  facts: InvitationResponseAccessFactsSchema,
  authorityVersion: AuthorityVersion,
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (context) =>
        context.domainId === "recruitment" &&
        context.resource.kind === RECRUITMENT_INVITATION_RESOURCE_KIND &&
        String(context.resource.id) === String(context.facts.invitationId) &&
        context.departmentId === context.facts.departmentId,
      { message: "a canonical recruitment invitation response context" },
    ),
  ),
);

const GenericRequirementContextSchema = Schema.Struct({
  domainId: DomainId,
  departmentId: Schema.NullOr(DepartmentId),
  resource: Schema.NullOr(ResourceRefSchema),
  facts: Schema.Record(Schema.String, Schema.Json),
  authorityVersion: AuthorityVersion,
});

type RegisteredRequirementEvaluation =
  | { readonly _tag: "Satisfied" }
  | { readonly _tag: "Failed"; readonly reason: string };

const RegisteredRequirementEvaluation = Data.taggedEnum<RegisteredRequirementEvaluation>();

type RequirementEvaluator<C = typeof GenericRequirementContextSchema.Type> = (
  parameters: typeof EmptyRequirementParametersSchema.Type,
  principal: Principal,
  context: C,
) => RegisteredRequirementEvaluation;

type RequirementContextSchema =
  | typeof ReceiptRequirementContextSchema
  | typeof InvitationRequirementContextSchema
  | typeof GenericRequirementContextSchema;

interface RequirementRegistration {
  readonly resolverIds: ReadonlyArray<ScopeResolverId>;
  readonly parameterSchema: typeof EmptyRequirementParametersSchema;
  readonly contextSchema: RequirementContextSchema;
  readonly evaluate: RequirementEvaluator<CanonicalResourceContext>;
}

const satisfied: RegisteredRequirementEvaluation = RegisteredRequirementEvaluation.Satisfied();

const failed = (reason: string): RegisteredRequirementEvaluation =>
  RegisteredRequirementEvaluation.Failed({ reason });

const personIdIn = (value: Schema.Json | undefined, personId: string): boolean =>
  Array.isArray(value) && value.some((candidate) => candidate === personId);

const ownedByPerson: RequirementEvaluator = (_parameters, principal, context) =>
  Predicate.isTagged(principal, "Person") && context.facts.ownerPersonId === principal.personId
    ? satisfied
    : failed("NotOwner");

const personListedBy =
  (key: string): RequirementEvaluator =>
  (_parameters, principal, context) =>
    Predicate.isTagged(principal, "Person") && personIdIn(context.facts[key], principal.personId)
      ? satisfied
      : failed("NotInScope");

const stateIs =
  (state: string): RequirementEvaluator =>
  (_parameters, _principal, context) =>
    context.facts.state === state ? satisfied : failed(`Not${state}`);

const registration = <C extends RequirementContextSchema>(
  resolverIds: ReadonlyArray<(typeof SCOPE_RESOLVER_IDS)[number]>,
  contextSchema: C,
  evaluate: RequirementEvaluator<C["Type"]>,
): RequirementRegistration => ({
  resolverIds: resolverIds.map((id) => ScopeResolverId.make(id)),
  parameterSchema: EmptyRequirementParametersSchema,
  contextSchema,
  evaluate: (parameters, principal, context) => {
    const decoded = Schema.decodeUnknownResult(contextSchema)(context);

    return Result.isSuccess(decoded)
      ? evaluate(parameters, principal, decoded.success)
      : failed("InvalidContext");
  },
});

export const REQUIREMENT_TYPES = {
  "sessions.owner": registration(
    ["identity.owned-sessions", "identity.session-by-id"],
    GenericRequirementContextSchema,
    ownedByPerson,
  ),
  "profile.owner": registration(
    ["profile.current-person"],
    GenericRequirementContextSchema,
    ownedByPerson,
  ),
  "organization.single-department-administrator": registration(
    [
      "recruitment.application-assignments",
      "recruitment.application-by-id",
      "recruitment.interview-report",
    ],
    GenericRequirementContextSchema,
    personListedBy("departmentAdministratorPersonIds"),
  ),
  "organization.single-department-member": registration(
    ["recruitment.interviews"],
    GenericRequirementContextSchema,
    personListedBy("departmentMemberPersonIds"),
  ),
  // The claim link is usable: the invitation it names is open, unexpired, and not yet linked.
  "onboarding.claim-token": registration(
    ["onboarding.claim"],
    GenericRequirementContextSchema,
    stateIs("Open"),
  ),
  "recruitment.interviewer-eligible": registration(
    ["recruitment.application-by-id"],
    GenericRequirementContextSchema,
    personListedBy("eligibleInterviewerPersonIds"),
  ),
  "recruitment.assigned-interviewer-or-administrator": registration(
    ["recruitment.interview-by-id"],
    GenericRequirementContextSchema,
    (_parameters, principal, context) =>
      Predicate.isTagged(principal, "Person") &&
      (personIdIn(context.facts.assignedInterviewerPersonIds, principal.personId) ||
        personIdIn(context.facts.departmentAdministratorPersonIds, principal.personId))
        ? satisfied
        : failed("NotAssignedInterviewerOrAdministrator"),
  ),
  "recruitment.assigned-interviewer": registration(
    ["recruitment.interview-by-id"],
    GenericRequirementContextSchema,
    personListedBy("assignedInterviewerPersonIds"),
  ),
  "recruitment.assigned-interviewer-or-co-interviewer": registration(
    ["recruitment.interview-by-id"],
    GenericRequirementContextSchema,
    personListedBy("interviewParticipantPersonIds"),
  ),
  "recruitment.not-known-self": registration(
    ["recruitment.interview-by-id"],
    GenericRequirementContextSchema,
    (_parameters, principal, context) => {
      const linked = context.facts.linkedApplicantPersonId;

      return Predicate.isTagged(principal, "Person") &&
        (linked === null || Schema.is(PersonId)(linked)) &&
        !isKnownSelfInterview(linked, principal.personId)
        ? satisfied
        : failed("KnownSelfOrMissingApplicantIdentity");
    },
  ),
  "recruitment.invitation-pending": registration(
    ["recruitment.invitation-response-by-capability"],
    InvitationRequirementContextSchema,
    (_parameters, _principal, context) => {
      const facts = context.facts;

      return facts.responseState === "Pending" && facts.supersededAt === null
        ? satisfied
        : failed("NotPending");
    },
  ),
  "internal-evidence.enabled": registration(
    ["receipts.by-id"],
    ReceiptRequirementContextSchema,
    (_parameters, _principal, context) =>
      context.facts.internalEvidenceEnabled ? satisfied : failed("Disabled"),
  ),
  "receipts.owner": registration(
    ["receipts.by-id", "receipts.owned"],
    ReceiptRequirementContextSchema,
    ownedByPerson,
  ),
  "receipts.rejected": registration(
    ["receipts.by-id"],
    ReceiptRequirementContextSchema,
    stateIs("Rejected"),
  ),
  "receipts.pending": registration(
    ["receipts.by-id", "receipts.approval-queue"],
    ReceiptRequirementContextSchema,
    stateIs("Pending"),
  ),
  "receipts.approver-relationship": registration(
    ["receipts.by-id", "receipts.approval-queue"],
    ReceiptRequirementContextSchema,
    (_parameters, principal, context) => {
      const facts = context.facts;

      return (Predicate.isTagged(principal, "Person") &&
        facts.approverPersonIds.includes(principal.personId)) ||
        (Predicate.isTagged(principal, "ServicePrincipal") &&
          facts.approverServicePrincipalIds.includes(principal.servicePrincipalId))
        ? satisfied
        : failed("NotApprover");
    },
  ),
  "content.draft": registration(
    ["content.article-by-id"],
    GenericRequirementContextSchema,
    stateIs("Draft"),
  ),
  "content.revisable": registration(
    ["content.article-by-id"],
    GenericRequirementContextSchema,
    (_parameters, _principal, context) =>
      context.facts.revisable === true ? satisfied : failed("NotRevisable"),
  ),
  "content.publishable": registration(
    ["content.article-by-id"],
    GenericRequirementContextSchema,
    (_parameters, _principal, context) =>
      context.facts.publishable === true ? satisfied : failed("NotPublishable"),
  ),
  "content.unpublishable": registration(
    ["content.article-by-id"],
    GenericRequirementContextSchema,
    (_parameters, _principal, context) =>
      context.facts.unpublishable === true ? satisfied : failed("NotUnpublishable"),
  ),
} as const satisfies Record<(typeof REQUIREMENT_IDS)[number], RequirementRegistration>;

interface ScopeResolverRegistration {
  readonly selection: "ExactlyOne" | "AllMatching";
  readonly requirements: ReadonlyArray<RequirementId>;
  readonly contextSchema: RequirementContextSchema;
}

const collectionResolvers = new Set<string>([
  "identity.owned-sessions",
  "organization.public-departments",
  "organization.public-teams",
  "organization.public-field-of-studies",
  "organization.team-interest-registrations",
  "organization.mailing-lists",
  "profile.people-directory",
  "schools.directory",
  "admissions.public-open-periods",
  "admissions.public-application-options",
  "admissions.management-periods",
  "recruitment.application-assignments",
  "recruitment.interview-report",
  "recruitment.interviews",
  "receipts.owned",
  "receipts.approval-queue",
  "receipts.settlement-queue",
  "content.articles",
  "content.public-news",
  "team-applications.public-intakes",
  "team-applications.team-applications",
]);

const resolverRequirements: Partial<
  Record<(typeof SCOPE_RESOLVER_IDS)[number], ReadonlyArray<(typeof REQUIREMENT_IDS)[number]>>
> = {
  "identity.owned-sessions": ["sessions.owner"],
  "identity.session-by-id": ["sessions.owner"],
  "profile.current-person": ["profile.owner"],
  "onboarding.claim": ["onboarding.claim-token"],
  "recruitment.invitation-response-by-capability": ["recruitment.invitation-pending"],
  "recruitment.application-assignments": ["organization.single-department-administrator"],
  "recruitment.interview-report": ["organization.single-department-administrator"],
  "recruitment.interviews": ["organization.single-department-member"],
  "recruitment.application-by-id": [
    "organization.single-department-administrator",
    "recruitment.interviewer-eligible",
  ],
  "recruitment.interview-by-id": [
    "recruitment.assigned-interviewer-or-administrator",
    "recruitment.assigned-interviewer",
    "recruitment.assigned-interviewer-or-co-interviewer",
    "recruitment.not-known-self",
  ],
  "receipts.by-id": [
    "internal-evidence.enabled",
    "receipts.owner",
    "receipts.pending",
    "receipts.rejected",
    "receipts.approver-relationship",
  ],
  "receipts.owned": ["receipts.owner"],
  "receipts.approval-queue": ["receipts.pending", "receipts.approver-relationship"],
  "content.article-by-id": [
    "content.draft",
    "content.revisable",
    "content.publishable",
    "content.unpublishable",
  ],
};

export const SCOPE_RESOLVERS = Schema.decodeUnknownSync(
  Schema.Record(
    Schema.Literals(SCOPE_RESOLVER_IDS),
    Schema.Struct({
      selection: Schema.Literals(["AllMatching", "ExactlyOne"]),
      requirements: Schema.Array(RequirementId),
      contextSchema: Schema.declare(
        (schema): schema is RequirementContextSchema =>
          schema === ReceiptRequirementContextSchema ||
          schema === InvitationRequirementContextSchema ||
          schema === GenericRequirementContextSchema,
      ),
    }),
  ),
)(
  Object.fromEntries(
    SCOPE_RESOLVER_IDS.map((id) => {
      const contextSchema =
        id === "receipts.by-id" ||
        id === "receipts.owned" ||
        id === "receipts.approval-queue" ||
        id === "receipts.settlement-queue"
          ? ReceiptRequirementContextSchema
          : id === "recruitment.invitation-response-by-capability"
            ? InvitationRequirementContextSchema
            : GenericRequirementContextSchema;

      return [
        id,
        {
          selection: collectionResolvers.has(id) ? "AllMatching" : "ExactlyOne",
          requirements: (resolverRequirements[id] ?? []).map((requirementId) =>
            RequirementId.make(requirementId),
          ),
          contextSchema,
        } satisfies ScopeResolverRegistration,
      ];
    }),
  ),
);

const registeredRequirementSchemas = REQUIREMENT_IDS.map((id) =>
  Schema.Struct({
    id: RequirementId.pipe(
      Schema.check(
        Schema.makeFilter((requirementId) => requirementId === id, {
          message: `requirement id ${id}`,
        }),
      ),
    ),
    parameters: REQUIREMENT_TYPES[id].parameterSchema,
  }),
);

export const TypedRequirementSchema = Schema.Union(registeredRequirementSchemas);

export type TypedRequirement = typeof TypedRequirementSchema.Type;

export type RequirementResult =
  | { readonly id: RequirementId; readonly _tag: "Satisfied" }
  | { readonly id: RequirementId; readonly _tag: "Failed"; readonly reason: string };

export const RequirementResult = Data.taggedEnum<RequirementResult>();

export const GrantSchema = Schema.Struct({
  grantId: GrantId,
  subject: NonAnonymousPrincipalSchema,
  capability: CapabilitySchema,
  scope: ScopeSchema,
  startAt: AuthorizationInstant,
  endAt: Schema.NullOr(AuthorizationInstant),
  requirements: Schema.Array(TypedRequirementSchema),
  source: AuthorityRef,
  revision: RevisionSchema,
}).pipe(
  Schema.check(
    Schema.makeFilter(
      (grant) => grant.endAt === null || compareRfc3339Instants(grant.endAt, grant.startAt) > 0,
      { message: "a half-open grant interval" },
    ),
  ),
);

export type Grant = typeof GrantSchema.Type;

export type RoleMacro = {
  readonly roleId: string;
  readonly grants: ReadonlyArray<Grant>;
};

export const AuthorizationModeSchema = Schema.Literals(["SnapshotRead", "Transaction"]);

export type AuthorizationMode = typeof AuthorizationModeSchema.Type;

export const ExposureSchema = Schema.Literals(["External", "Internal"]);

export type Exposure = typeof ExposureSchema.Type;

export const ConcealmentPolicySchema = Schema.TaggedUnion({
  Reveal: {},
  NotFound: {
    conceal: Schema.Array(
      Schema.Literals(["CredentialFailure", "PrincipalKind", "Capability", "Scope", "Requirement"]),
    ).pipe(
      Schema.check(
        Schema.makeFilter((values) => values.length > 0, {
          message: "a non-empty concealment list",
        }),
      ),
    ),
  },
});

export type ConcealmentPolicy = typeof ConcealmentPolicySchema.Type;

const AcceptedCredentialsSchema = Schema.Array(CredentialMechanismSchema).pipe(
  Schema.check(
    Schema.makeFilter((values) => values.length > 0, {
      message: "at least one accepted credential",
    }),
  ),
);

const PrincipalKindsSchema = Schema.Array(PrincipalKindSchema).pipe(
  Schema.check(
    Schema.makeFilter((values) => values.length > 0 && new Set(values).size === values.length, {
      message: "at least one principal kind without duplicates",
    }),
  ),
);

export const AccessSpecSchema = Schema.Struct({
  exposure: ExposureSchema,
  acceptedCredentials: AcceptedCredentialsSchema,
  principalKinds: PrincipalKindsSchema,
  capabilities: CapabilityExpressionSchema,
  requirements: Schema.Array(TypedRequirementSchema),
  canonicalScopeResolver: ScopeResolverId,
  concealment: ConcealmentPolicySchema,
  decisionTime: AuthorizationModeSchema,
});

export type AccessSpec = typeof AccessSpecSchema.Type;

const mechanismPrincipalKind = (mechanism: CredentialMechanism): PrincipalKind => {
  return Match.value(mechanism).pipe(
    Match.withReturnType<PrincipalKind>(),
    Match.tag("None", () => {
      return "Anonymous";
    }),
    Match.tag("BetterAuthCookie", "OAuthUserBearer", () => {
      return "Person";
    }),
    Match.tag("OAuthServiceBearer", () => {
      return "ServicePrincipal";
    }),
    Match.tag("ObjectCapability", () => {
      return "CapabilityHolder";
    }),
    Match.exhaustive,
  );
};

const sameCredentialMechanism = (left: CredentialMechanism, right: CredentialMechanism): boolean =>
  Predicate.isTagged(left, right._tag) &&
  (!Predicate.isTagged(left, "ObjectCapability") ||
    (Predicate.isTagged(right, "ObjectCapability") &&
      left.capabilityType === right.capabilityType));

/**
 * Whether an AccessSpec accepts a resolved credential: the spec declares its mechanism, and the
 * credential names the principal kind that mechanism resolves. This is the credential stage of
 * every access evaluation; a handler that authorizes in parts uses it for the same answer.
 */
export const credentialMatchesAccessSpec = (
  spec: AccessSpec,
  credential: Extract<CredentialOutcome, { readonly _tag: "Accepted" }>,
): boolean =>
  mechanismPrincipalKind(credential.mechanism) === credential.principal._tag &&
  spec.acceptedCredentials.some((accepted) =>
    sameCredentialMechanism(accepted, credential.mechanism),
  );

const capabilityTypesIn = (expression: CapabilityExpression): ReadonlyArray<CapabilityTypeId> => {
  return Match.value(expression).pipe(
    Match.withReturnType<ReadonlyArray<CapabilityTypeId>>(),
    Match.tag("None", () => {
      return [];
    }),
    Match.tag("One", (expression) => {
      return [expression.capability.type];
    }),
    Match.tag("All", "Any", (expression) => {
      return expression.capabilities.map((capability) => capability.type);
    }),
    Match.exhaustive,
  );
};

export const scopeResolverDeclaration = (resolverId: ScopeResolverId): ScopeResolverRegistration =>
  SCOPE_RESOLVERS[scopeResolverRegistryKey(resolverId)];

const stableRequirementKey = (requirement: TypedRequirement): string =>
  `${requirement.id}:${JSON.stringify(requirement.parameters)}`;

/** A requirement is served only by a scope resolver whose output is the requirement's input. */
const requirementRegistrationIssue = (
  resolverId: ScopeResolverId,
  requirementId: RequirementId,
): string | undefined => {
  const resolver = SCOPE_RESOLVERS[scopeResolverRegistryKey(resolverId)];
  const requirement = REQUIREMENT_TYPES[requirementRegistryKey(requirementId)];
  const registeredResolverIds: ReadonlyArray<ScopeResolverId> = requirement.resolverIds;
  const registeredRequirements: ReadonlyArray<string> = resolver.requirements;

  return registeredResolverIds.includes(resolverId) &&
    registeredRequirements.includes(requirementId) &&
    resolver.contextSchema === requirement.contextSchema
    ? undefined
    : `scope resolver ${resolverId} output schema does not match requirement ${requirementId} input schema`;
};

/** The first declaration rule that an AccessSpec breaks, checked in a fixed order. */
const accessSpecIssue = (spec: AccessSpec): string | undefined => {
  const anonymousOnly = spec.principalKinds.length === 1 && spec.principalKinds[0] === "Anonymous";

  if (anonymousOnly) {
    if (
      spec.acceptedCredentials.length !== 1 ||
      spec.acceptedCredentials[0]?._tag !== "None" ||
      !Predicate.isTagged(spec.capabilities, "None")
    ) {
      return "Anonymous access requires only None credentials and no capability";
    }
  } else if (spec.acceptedCredentials.some((mechanism) => Predicate.isTagged(mechanism, "None"))) {
    return "None credentials are valid only for Anonymous access";
  }

  const mechanismKinds = new Set(spec.acceptedCredentials.map(mechanismPrincipalKind));
  const unacceptedKind = spec.principalKinds.find((kind) => !mechanismKinds.has(kind));

  if (unacceptedKind !== undefined) {
    return `principal kind ${unacceptedKind} has no accepted credential mechanism`;
  }

  const unlistedKind = [...mechanismKinds].find((kind) => !spec.principalKinds.includes(kind));

  if (unlistedKind !== undefined) {
    return `credential mechanism resolves unlisted principal kind ${unlistedKind}`;
  }

  const capabilityTypes = capabilityTypesIn(spec.capabilities);

  if (
    spec.acceptedCredentials.some(
      (mechanism) =>
        Predicate.isTagged(mechanism, "ObjectCapability") &&
        !capabilityTypes.includes(mechanism.capabilityType),
    )
  ) {
    return "object capability credential must match an endpoint capability";
  }

  for (const requirement of spec.requirements) {
    const issue = requirementRegistrationIssue(spec.canonicalScopeResolver, requirement.id);

    if (issue !== undefined) return issue;
  }

  return undefined;
};

/** An AccessSpec declaration: the schema rejects one that breaks a declaration rule. */
const DeclaredAccessSpec = AccessSpecSchema.pipe(Schema.check(Schema.makeFilter(accessSpecIssue)));

export const makeAccessSpec = flow(
  Schema.decodeUnknownSync(DeclaredAccessSpec, { onExcessProperty: "error" }),
  (decoded): AccessSpec => {
    const requirementKeys = decoded.requirements.map(stableRequirementKey);

    const uniqueRequirements = decoded.requirements.filter(
      (_, index) => requirementKeys.indexOf(requirementKeys[index]!) === index,
    );

    return { ...decoded, requirements: uniqueRequirements };
  },
);

const stableScope = (scope: Scope): string => JSON.stringify(scope);

const canonicalScopeTree = (
  operator: "And" | "Or",
  members: ReadonlyArray<Scope>,
  start = 0,
  end = members.length,
): Scope => {
  if (end - start === 1) return members[start]!;
  const middle = start + Math.ceil((end - start) / 2);

  return Scope[operator]({
    left: canonicalScopeTree(operator, members, start, middle),
    right: canonicalScopeTree(operator, members, middle, end),
  });
};

export const normalizeScope = (scope: Scope): Scope => {
  if (!Predicate.isTagged(scope, "And") && !Predicate.isTagged(scope, "Or")) return scope;
  const operator = scope._tag;
  const members: Array<Scope> = [];

  const collect = (candidate: Scope): void => {
    if (Predicate.isTagged(candidate, operator)) {
      collect(candidate.left);
      collect(candidate.right);

      return;
    }

    members.push(normalizeScope(candidate));
  };

  collect(scope);

  const canonicalMembers = [
    ...new Map(
      members
        .map((member) => [stableScope(member), member] as const)
        .sort(([left], [right]) => left.localeCompare(right)),
    ).values(),
  ];

  return canonicalScopeTree(operator, canonicalMembers);
};

export const decodeGrant = flow(
  Schema.decodeUnknownSync(GrantSchema, { onExcessProperty: "error" }),
  (grant): Grant => {
    return { ...grant, scope: normalizeScope(grant.scope) };
  },
);

export const expandAuthorityMacros = (
  directGrants: ReadonlyArray<Grant>,
  roles: ReadonlyArray<RoleMacro>,
): ReadonlyArray<Grant> => [...directGrants, ...roles.flatMap((role) => role.grants)];

export const scopeMatches = (scope: Scope, context: CanonicalResourceContext): boolean => {
  return Match.value(scope).pipe(
    Match.withReturnType<boolean>(),
    Match.tag("Global", () => {
      return true;
    }),
    Match.tag("Domain", (scope) => {
      return scope.domainId === context.domainId;
    }),
    Match.tag("Department", (scope) => {
      return context.departmentId !== null && scope.departmentId === context.departmentId;
    }),
    Match.tag("Resource", (scope) => {
      return (
        context.resource !== null &&
        scope.resource.kind === context.resource.kind &&
        scope.resource.id === context.resource.id
      );
    }),
    Match.tag("And", (scope) => {
      return scopeMatches(scope.left, context) && scopeMatches(scope.right, context);
    }),
    Match.tag("Or", (scope) => {
      return scopeMatches(scope.left, context) || scopeMatches(scope.right, context);
    }),
    Match.exhaustive,
  );
};

const samePrincipal = (left: NonAnonymousPrincipal, right: Principal): boolean => {
  if (!Predicate.isTagged(left, right._tag)) return false;

  return Match.value(left).pipe(
    Match.withReturnType<boolean>(),
    Match.tag("Person", (left) => {
      return Predicate.isTagged(right, "Person") && left.personId === right.personId;
    }),
    Match.tag("ServicePrincipal", (left) => {
      return (
        Predicate.isTagged(right, "ServicePrincipal") &&
        left.servicePrincipalId === right.servicePrincipalId
      );
    }),
    Match.tag("CapabilityHolder", (left) => {
      return (
        Predicate.isTagged(right, "CapabilityHolder") && left.capabilityId === right.capabilityId
      );
    }),
    Match.exhaustive,
  );
};

const activeAt = (grant: Grant, instant: AuthorizationInstant): boolean =>
  compareRfc3339Instants(grant.startAt, instant) <= 0 &&
  (grant.endAt === null || compareRfc3339Instants(instant, grant.endAt) < 0);

export const evaluateRequirement = (
  requirement: TypedRequirement,
  principal: Principal,
  context: CanonicalResourceContext,
): RequirementResult => {
  const registration = REQUIREMENT_TYPES[requirementRegistryKey(requirement.id)];

  if (!Schema.is(registration.parameterSchema)(requirement.parameters)) {
    return RequirementResult.Failed({ id: requirement.id, reason: "InvalidParameters" });
  }

  const parameters = Schema.decodeSync(registration.parameterSchema)(requirement.parameters);

  const evaluation = registration.evaluate(parameters, principal, context);

  return { id: requirement.id, ...evaluation };
};

export type AccessDenialStage = "PrincipalKind" | "Capability" | "Scope" | "Requirement";

export type AccessDenialReason =
  | "PrincipalKindNotAccepted"
  | "CapabilityMissing"
  | "AuthorityInactive"
  | "NotInScope"
  | "RequirementFailed"
  | "InvalidScopeResolution"
  | "EmptyContextSet";

export type AccessDecision<C = unknown> =
  | {
      readonly _tag: "Allow";
      readonly principal: Principal;
      readonly resolution: CanonicalScopeResolution<C>;
      readonly authorizationInstant: AuthorizationInstant;
    }
  | {
      readonly _tag: "Deny";
      readonly stage: AccessDenialStage;
      readonly reason: AccessDenialReason;
    };

export type AccessEvaluation<C = unknown> =
  | { readonly _tag: "CredentialRejected"; readonly reason: CredentialFailureReason }
  | AccessDecision<C>;

interface AccessEvaluationDefinition extends Data.TaggedEnum.WithGenerics<1> {
  readonly taggedEnum: AccessEvaluation<this["A"]>;
}

export const AccessEvaluation = Data.taggedEnum<AccessEvaluationDefinition>();

type AccessDenial = Extract<AccessDecision, { readonly _tag: "Deny" }>;

const denied = (stage: AccessDenialStage, reason: AccessDenialReason): AccessDenial =>
  AccessEvaluation.Deny({ stage, reason });

const requirementsSatisfied = (
  requirements: ReadonlyArray<TypedRequirement>,
  principal: Principal,
  context: CanonicalResourceContext,
): boolean =>
  requirements.every((requirement) =>
    Predicate.isTagged(evaluateRequirement(requirement, principal, context), "Satisfied"),
  );

type ContextCapabilityResult = { readonly allowed: true } | { readonly denial: AccessDenial };

const capabilityForContext = (
  capability: Capability,
  principal: Principal,
  context: CanonicalResourceContext,
  grants: ReadonlyArray<Grant>,
  instant: AuthorizationInstant,
): ContextCapabilityResult => {
  const matchingCapability = grants.filter(
    (grant) => samePrincipal(grant.subject, principal) && grant.capability.type === capability.type,
  );

  if (matchingCapability.length === 0) {
    return { denial: denied("Capability", "CapabilityMissing") };
  }

  const active = matchingCapability.filter((grant) => activeAt(grant, instant));

  if (active.length === 0) return { denial: denied("Capability", "AuthorityInactive") };
  const scoped = active.filter((grant) => scopeMatches(grant.scope, context));

  if (scoped.length === 0) return { denial: denied("Scope", "NotInScope") };

  if (!scoped.some((grant) => requirementsSatisfied(grant.requirements, principal, context))) {
    return { denial: denied("Requirement", "RequirementFailed") };
  }

  return { allowed: true };
};

const expressionForContext = (
  expression: CapabilityExpression,
  principal: Principal,
  context: CanonicalResourceContext,
  grants: ReadonlyArray<Grant>,
  instant: AuthorizationInstant,
): ContextCapabilityResult => {
  return Match.value(expression).pipe(
    Match.withReturnType<ContextCapabilityResult>(),
    Match.tag("None", () => {
      return { allowed: true };
    }),
    Match.tag("One", (expression) => {
      return capabilityForContext(expression.capability, principal, context, grants, instant);
    }),
    Match.tag("All", (expression) => {
      for (const capability of expression.capabilities) {
        const result = capabilityForContext(capability, principal, context, grants, instant);

        if ("denial" in result) return result;
      }

      return { allowed: true };
    }),
    Match.tag("Any", (expression) => {
      let strongestDenial = denied("Capability", "CapabilityMissing");

      for (const capability of expression.capabilities) {
        const result = capabilityForContext(capability, principal, context, grants, instant);

        if ("allowed" in result) return result;

        if (
          Predicate.isTagged(result.denial, "Deny") &&
          (result.denial.stage === "Requirement" ||
            (result.denial.stage === "Scope" &&
              Predicate.isTagged(strongestDenial, "Deny") &&
              strongestDenial.stage === "Capability"))
        ) {
          strongestDenial = result.denial;
        }
      }

      return { denial: strongestDenial };
    }),
    Match.exhaustive,
  );
};

export const evaluateAccess = <C>(input: {
  readonly spec: AccessSpec;
  readonly credential: CredentialOutcome;
  readonly resolution: CanonicalScopeResolution<C>;
  readonly grants: ReadonlyArray<Grant>;
  readonly authorizationInstant: AuthorizationInstant;
}): AccessEvaluation<C> => {
  if (Predicate.isTagged(input.credential, "Rejected")) {
    return AccessEvaluation.CredentialRejected({ reason: input.credential.reason });
  }

  if (!credentialMatchesAccessSpec(input.spec, input.credential)) {
    return AccessEvaluation.CredentialRejected({ reason: "WrongMechanism" });
  }

  const principal = input.credential.principal;

  if (!input.spec.principalKinds.includes(principal._tag)) {
    return denied("PrincipalKind", "PrincipalKindNotAccepted");
  }

  if (
    input.resolution.selection !==
      scopeResolverDeclaration(input.spec.canonicalScopeResolver).selection ||
    (input.resolution.selection === "ExactlyOne" && input.resolution.contexts.length !== 1)
  ) {
    return denied("Scope", "InvalidScopeResolution");
  }

  const allowedContexts: Array<CanonicalResourceContext<C>> = [];
  let lastDenial = denied("Scope", "EmptyContextSet");

  for (const context of input.resolution.contexts) {
    const capability = expressionForContext(
      input.spec.capabilities,
      principal,
      context,
      input.grants,
      input.authorizationInstant,
    );

    if ("denial" in capability) {
      lastDenial = capability.denial;
      continue;
    }

    if (!requirementsSatisfied(input.spec.requirements, principal, context)) {
      lastDenial = denied("Requirement", "RequirementFailed");
      continue;
    }

    allowedContexts.push(context);
  }

  if (allowedContexts.length === 0) return lastDenial;

  return AccessEvaluation.Allow({
    principal,
    resolution: { ...input.resolution, contexts: allowedContexts },
    authorizationInstant: input.authorizationInstant,
  });
};

export interface AccessJourneyServices<I, C, E, R> {
  readonly now: Effect.Effect<AuthorizationInstant, E, R>;
  readonly resolveCredential: (
    instant: AuthorizationInstant,
  ) => Effect.Effect<CredentialOutcome, E, R>;
  readonly resolveScope: (
    input: I,
    principal: Principal,
    instant: AuthorizationInstant,
    mode: AuthorizationMode,
  ) => Effect.Effect<CanonicalScopeResolution<C>, E, R>;
  readonly resolveGrants: (
    principal: Principal,
    resolution: CanonicalScopeResolution<C>,
    instant: AuthorizationInstant,
    mode: AuthorizationMode,
  ) => Effect.Effect<ReadonlyArray<Grant>, E, R>;
}

export const evaluateAccessJourney = <I, C, E, R>(
  spec: AccessSpec,
  input: I,
  services: AccessJourneyServices<I, C, E, R>,
): Effect.Effect<AccessEvaluation<C>, E, R> =>
  Effect.gen(function* () {
    const authorizationInstant = yield* services.now;
    const credential = yield* services.resolveCredential(authorizationInstant);

    if (Predicate.isTagged(credential, "Rejected")) {
      return AccessEvaluation.CredentialRejected({ reason: credential.reason });
    }

    if (!credentialMatchesAccessSpec(spec, credential)) {
      return AccessEvaluation.CredentialRejected({ reason: "WrongMechanism" });
    }

    const resolution = yield* services.resolveScope(
      input,
      credential.principal,
      authorizationInstant,
      spec.decisionTime,
    );

    const grants = yield* services.resolveGrants(
      credential.principal,
      resolution,
      authorizationInstant,
      spec.decisionTime,
    );

    return evaluateAccess({ spec, credential, resolution, grants, authorizationInstant });
  });

const concealed = (
  policy: ConcealmentPolicy,
  stage: AccessDenialStage | "CredentialFailure",
): boolean => Predicate.isTagged(policy, "NotFound") && policy.conceal.includes(stage);

export const accessHttpStatus = (
  evaluation: AccessEvaluation,
  policy: ConcealmentPolicy,
): 200 | 401 | 403 | 404 => {
  if (Predicate.isTagged(evaluation, "Allow")) return 200;

  if (Predicate.isTagged(evaluation, "CredentialRejected")) {
    return concealed(policy, "CredentialFailure") ? 404 : 401;
  }

  return concealed(policy, evaluation.stage) ? 404 : 403;
};

export interface AccessTrace {
  readonly declarationId: string;
  readonly exposure: Exposure;
  readonly credentialMechanism: CredentialMechanism["_tag"];
  readonly credentialOutcome: "Accepted" | "Rejected";
  readonly principalKind: PrincipalKind | null;
  readonly scopeResolverId: ScopeResolverId | null;
  readonly domainId: DomainId | null;
  readonly departmentId: DepartmentId | null;
  readonly resourceKind: ResourceKind | null;
  readonly decisionTime: AuthorizationMode | null;
  readonly capabilityOutcome: "Satisfied" | "Failed" | null;
  readonly failedRequirementIds: ReadonlyArray<RequirementId>;
  readonly decision: "Allow" | "Deny" | null;
  readonly projectedStatus: number;
}

export const traceAccess = (input: {
  readonly declarationId: string;
  readonly spec: AccessSpec;
  readonly mechanism: CredentialMechanism;
  readonly credential: CredentialOutcome;
  readonly resolution: CanonicalScopeResolution;
  readonly grants: ReadonlyArray<Grant>;
  readonly evaluation: AccessEvaluation;
}): AccessTrace => {
  const accepted = Predicate.isTagged(input.credential, "Accepted");
  const principal = accepted ? input.credential.principal : null;
  const context = input.resolution.contexts[0];

  const failedRequirements =
    principal === null || context === undefined
      ? []
      : Array.filterMap(
          [...input.spec.requirements, ...input.grants.flatMap((grant) => grant.requirements)],
          (requirement) =>
            Predicate.isTagged(evaluateRequirement(requirement, principal, context), "Failed")
              ? Result.succeed(requirement.id)
              : Result.failVoid,
        )
          .filter((id, index, values) => values.indexOf(id) === index)
          .sort((left, right) => REQUIREMENT_IDS.indexOf(left) - REQUIREMENT_IDS.indexOf(right));

  const capabilityOutcome =
    !accepted || Predicate.isTagged(input.spec.capabilities, "None")
      ? null
      : Predicate.isTagged(input.evaluation, "Deny") &&
          (input.evaluation.stage === "Capability" || input.evaluation.stage === "Scope")
        ? "Failed"
        : "Satisfied";

  return {
    declarationId: input.declarationId,
    exposure: input.spec.exposure,
    credentialMechanism: input.mechanism._tag,
    credentialOutcome: accepted ? "Accepted" : "Rejected",
    principalKind: principal?._tag ?? null,
    scopeResolverId: accepted ? input.spec.canonicalScopeResolver : null,
    domainId: context?.domainId ?? null,
    departmentId: context?.departmentId ?? null,
    resourceKind: context?.resource?.kind ?? null,
    decisionTime: accepted ? input.spec.decisionTime : null,
    capabilityOutcome,
    failedRequirementIds: failedRequirements,
    decision: Predicate.isTagged(input.evaluation, "CredentialRejected")
      ? null
      : input.evaluation._tag,
    projectedStatus: accessHttpStatus(input.evaluation, input.spec.concealment),
  };
};

export const PUBLIC_SYSTEM_ACCESS = makeAccessSpec({
  exposure: "External",
  acceptedCredentials: [CredentialMechanismSchema.cases.None.make({})],
  principalKinds: ["Anonymous"],
  capabilities: CapabilityExpressionSchema.cases.None.make({}),
  requirements: [],
  canonicalScopeResolver: SYSTEM_PUBLIC_SCOPE_RESOLVER,
  concealment: ConcealmentPolicySchema.cases.Reveal.make({}),
  decisionTime: "SnapshotRead",
});

export const RECEIPT_APPROVAL_QUEUE_ACCESS = makeAccessSpec({
  exposure: "External",
  acceptedCredentials: [
    CredentialMechanismSchema.cases.BetterAuthCookie.make({}),
    CredentialMechanismSchema.cases.OAuthUserBearer.make({}),
    CredentialMechanismSchema.cases.OAuthServiceBearer.make({}),
  ],
  principalKinds: ["Person", "ServicePrincipal"],
  capabilities: CapabilityExpressionSchema.cases.One.make({
    capability: { type: APPROVE_RECEIPT_CAPABILITY },
  }),
  requirements: [{ id: RECEIPT_APPROVER_REQUIREMENT, parameters: {} }],
  canonicalScopeResolver: RECEIPT_APPROVAL_QUEUE_SCOPE_RESOLVER,
  concealment: ConcealmentPolicySchema.cases.Reveal.make({}),
  decisionTime: "SnapshotRead",
});

export const INTERNAL_RECEIPT_EVIDENCE_ACCESS = makeAccessSpec({
  exposure: "Internal",
  acceptedCredentials: [CredentialMechanismSchema.cases.BetterAuthCookie.make({})],
  principalKinds: ["Person"],
  capabilities: CapabilityExpressionSchema.cases.One.make({
    capability: { type: READ_INTERNAL_RECEIPT_EVIDENCE_CAPABILITY },
  }),
  requirements: [
    { id: INTERNAL_EVIDENCE_ENABLED_REQUIREMENT, parameters: {} },
    { id: RECEIPT_OWNER_REQUIREMENT, parameters: {} },
  ],
  canonicalScopeResolver: RECEIPT_BY_ID_SCOPE_RESOLVER,
  concealment: ConcealmentPolicySchema.cases.Reveal.make({}),
  decisionTime: "SnapshotRead",
});
