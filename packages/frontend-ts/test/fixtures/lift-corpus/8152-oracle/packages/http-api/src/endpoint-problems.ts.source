/** Generated from the frozen 0080.1 endpoint-specific Problem Details table. */
import { Schema, Struct } from "effect";
import {
  endpointProblemResponses,
  NativeProblemRegistry,
  problemUnion,
  type NativeProblemCode,
  type ProblemResponse,
} from "./http-semantics.js";

/** Problems for `system.health`. */
export const SystemHealthProblem = problemUnion("SystemHealthProblem", [
  "request.malformed",
  "internal.error",
  "health.unavailable",
]);

/** Problems for `system.readSession`. */
export const SystemReadSessionProblem = problemUnion("SystemReadSessionProblem", [
  "request.malformed",
  "internal.error",
  "identity.unavailable",
]);

/** Problems for `system.deleteSession`. */
export const SystemDeleteSessionProblem = problemUnion("SystemDeleteSessionProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
]);

/** Problems for `system.listSessions`. */
export const SystemListSessionsProblem = problemUnion("SystemListSessionsProblem", [
  "request.malformed",
  "header.malformed",
  "internal.error",
  "identity.unavailable",
]);

/** Problems for `system.deleteOwnedSession`. */
export const SystemDeleteOwnedSessionProblem = problemUnion("SystemDeleteOwnedSessionProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "resource.not-found",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
]);

/** Problems for `system.revokeOtherSessions`. */
export const SystemRevokeOtherSessionsProblem = problemUnion("SystemRevokeOtherSessionsProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
]);

/** Problems for `system.revokeAllSessions`. */
export const SystemRevokeAllSessionsProblem = problemUnion("SystemRevokeAllSessionsProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
]);

/** The Profile read problem codes are shared by the current and effx contracts. */
export const ProfileReadOwnProfileCodes = [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "profile.not-found",
  "profile.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `profile.readOwnProfile`. */
export const ProfileReadOwnProfileProblem = problemUnion(
  "ProfileReadOwnProfileProblem",
  ProfileReadOwnProfileCodes,
);

/** The Profile mutation problem codes are shared by the current and effx contracts. */
export const ProfileUpdateOwnProfileCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "validation.no-change",
  "validation.field-not-deletable",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "transaction.conflict",
  "internal.error",
  "profile.not-found",
  "profile.unavailable",
  "idempotency.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `profile.updateOwnProfile`. */
export const ProfileUpdateOwnProfileProblem = problemUnion(
  "ProfileUpdateOwnProfileProblem",
  ProfileUpdateOwnProfileCodes,
);

const nativeProblemCode = Schema.Literals(Struct.keys(NativeProblemRegistry));

const decodeProblemCodes = Schema.decodeUnknownSync(
  Schema.TupleWithRest(Schema.Tuple([nativeProblemCode]), [nativeProblemCode]),
);

function deriveNativeProblems<
  const Codes extends readonly [NativeProblemCode, ...NativeProblemCode[]],
>(identifier: string, codes: Codes): ReadonlyArray<ProblemResponse<Codes[number]>>;
function deriveNativeProblems(
  identifier: string,
  codes: ReadonlyArray<string>,
): ReadonlyArray<Schema.Top>;
function deriveNativeProblems(identifier: string, codes: ReadonlyArray<string>) {
  return endpointProblemResponses(problemUnion(identifier, decodeProblemCodes(codes)));
}

/** Derives response schemas from the one native problem registry and a declared code tuple. */
export const nativeProblems = deriveNativeProblems;

/** Ordered local problems for `organization.listDepartments`. */
export const OrganizationListDepartmentsCodes = [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "internal.error",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const OrganizationListDepartmentsProblem = problemUnion(
  "OrganizationListDepartmentsProblem",
  OrganizationListDepartmentsCodes,
);

/** Ordered local problems for `organization.listTeams`. */
export const OrganizationListTeamsCodes = [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "internal.error",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const OrganizationListTeamsProblem = problemUnion(
  "OrganizationListTeamsProblem",
  OrganizationListTeamsCodes,
);

/** Ordered local problems for `organization.listFieldOfStudies`. */
export const OrganizationListFieldOfStudiesCodes = [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "internal.error",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const OrganizationListFieldOfStudiesProblem = problemUnion(
  "OrganizationListFieldOfStudiesProblem",
  OrganizationListFieldOfStudiesCodes,
);

/** Ordered local problems for `organization.listTeamInterest`. */
export const OrganizationListTeamInterestCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "organization.invalid-reference",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const OrganizationListTeamInterestProblem = problemUnion(
  "OrganizationListTeamInterestProblem",
  OrganizationListTeamInterestCodes,
);

/** Ordered local problems for `organization.listMailingLists`. */
export const OrganizationListMailingListsCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "organization.invalid-reference",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const OrganizationListMailingListsProblem = problemUnion(
  "OrganizationListMailingListsProblem",
  OrganizationListMailingListsCodes,
);

/** Ordered local problems for `organization.createDepartment`. */
export const OrganizationCreateDepartmentCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
  "organization.invalid-reference",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const OrganizationCreateDepartmentProblem = problemUnion(
  "OrganizationCreateDepartmentProblem",
  OrganizationCreateDepartmentCodes,
);

/** Ordered local problems for `organization.createTeam`. */
export const OrganizationCreateTeamCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
  "organization.invalid-reference",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const OrganizationCreateTeamProblem = problemUnion(
  "OrganizationCreateTeamProblem",
  OrganizationCreateTeamCodes,
);

/** Ordered local problems for `organization.createFieldOfStudy`. */
export const OrganizationCreateFieldOfStudyCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
  "organization.invalid-reference",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const OrganizationCreateFieldOfStudyProblem = problemUnion(
  "OrganizationCreateFieldOfStudyProblem",
  OrganizationCreateFieldOfStudyCodes,
);

/** The five organization management operations share this ordered lifecycle union. */
export const OrganizationLifecycleCodes = [
  "authority.denied",
  "origin.denied",
  "resource.not-found",
  "precondition.failed",
  "validation.failed",
  "request.malformed",
  "request.too-large",
  "idempotency-key.invalid",
  "idempotency.digest-conflict",
  "idempotency.in-flight",
  "idempotency.response-expired",
  "transaction.conflict",
  "internal.error",
  "idempotency.unavailable",
  "organization.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const OrganizationLifecycleProblem = problemUnion(
  "OrganizationLifecycleProblem",
  OrganizationLifecycleCodes,
);

/** The People directory problem codes remain its one endpoint-owned list. */
export const DirectoryListPeopleCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "directory.cursor-malformed",
  "directory.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const DirectoryListPeopleProblem = problemUnion(
  "DirectoryListPeopleProblem",
  DirectoryListPeopleCodes,
);

/** The Schools directory problem codes remain its one endpoint-owned list. */
export const DirectoryListSchoolsCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "schools.invalid-department",
  "schools.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const DirectoryListSchoolsProblem = problemUnion(
  "DirectoryListSchoolsProblem",
  DirectoryListSchoolsCodes,
);

/** Management read and command share the frozen Schools administration problem set. */
export const SchoolAdministrationCodes = [
  "authority.denied",
  "origin.denied",
  "request.malformed",
  "request.too-large",
  "media-type.unsupported",
  "header.malformed",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "resource.not-found",
  "precondition.failed",
  "schools.invalid-command",
  "schools.association-in-use",
  "schools.inactive",
  "schools.capacity-exists",
  "schools.unavailable",
  "idempotency.unavailable",
  "internal.error",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

export const SchoolAdministrationProblem = problemUnion(
  "SchoolAdministrationProblem",
  SchoolAdministrationCodes,
);

/** Problems for `admissions.listOpenAdmissionPeriods`. */
export const AdmissionsListOpenAdmissionPeriodsProblem = problemUnion(
  "AdmissionsListOpenAdmissionPeriodsProblem",
  [
    "request.malformed",
    "header.malformed",
    "precondition.invalid",
    "precondition.failed",
    "internal.error",
    "admissions.unavailable",
  ],
);

/** Problems for `admissions.listApplicationOptions`. */
export const AdmissionsListApplicationOptionsProblem = problemUnion(
  "AdmissionsListApplicationOptionsProblem",
  [
    "request.malformed",
    "header.malformed",
    "precondition.invalid",
    "precondition.failed",
    "internal.error",
    "admissions.unavailable",
  ],
);

/** Problems for the current person's applicant progress projection. */
export const AdmissionsReadApplicantProgressProblem = problemUnion(
  "AdmissionsReadApplicantProgressProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "admissions.unavailable",
  ],
);

/** Problems for returning-assistant options and registration. */
export const AdmissionsReadReturningAssistantOptionsProblem = problemUnion(
  "AdmissionsReadReturningAssistantOptionsProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "validation.failed",
    "returning.identity-missing",
    "returning.identity-ambiguous",
    "returning.history-missing",
    "returning.study-invalid",
    "returning.period-unavailable",
    "internal.error",
    "returning.unavailable",
  ],
);

export const AdmissionsRegisterReturningAssistantProblem = problemUnion(
  "AdmissionsRegisterReturningAssistantProblem",
  [
    "request.malformed",
    "header.malformed",
    "idempotency-key.invalid",
    "authority.denied",
    "origin.denied",
    "idempotency.in-flight",
    "idempotency.digest-conflict",
    "idempotency.response-expired",
    "transaction.conflict",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "returning.identity-missing",
    "returning.identity-ambiguous",
    "returning.history-missing",
    "returning.study-invalid",
    "returning.period-unavailable",
    "returning.team-scope-denied",
    "returning.revision-conflict",
    "internal.error",
    "dependency.unavailable",
    "idempotency.unavailable",
    "returning.unavailable",
  ],
);

/** Problems for `admissions.submitApplication`. */
export const AdmissionsSubmitApplicationProblem = problemUnion(
  "AdmissionsSubmitApplicationProblem",
  [
    "request.malformed",
    "header.malformed",
    "idempotency-key.invalid",
    "idempotency.in-flight",
    "idempotency.digest-conflict",
    "idempotency.response-expired",
    "transaction.conflict",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "internal.error",
    "dependency.unavailable",
    "idempotency.unavailable",
    "application.no-eligible-period",
    "application.ambiguous-period",
    "application.duplicate",
    "application.invalid-field-of-study",
    "rate-limit.exceeded",
  ],
);

/** Problems for `admissions.readApplicationConfirmation`. */
export const AdmissionsReadApplicationConfirmationProblem = problemUnion(
  "AdmissionsReadApplicationConfirmationProblem",
  [
    "request.malformed",
    "header.malformed",
    "internal.error",
    "application.not-found",
    "admissions.unavailable",
  ],
);

/** Problems for `admissions.listAdmissionPeriods`. */
export const AdmissionsListAdmissionPeriodsProblem = problemUnion(
  "AdmissionsListAdmissionPeriodsProblem",
  [
    "request.malformed",
    "header.malformed",
    "precondition.invalid",
    "precondition.failed",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "admissions.unavailable",
  ],
);

/** Problems for `admissions.createAdmissionPeriod`. */
export const AdmissionsCreateAdmissionPeriodProblem = problemUnion(
  "AdmissionsCreateAdmissionPeriodProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "idempotency-key.invalid",
    "idempotency.in-flight",
    "idempotency.digest-conflict",
    "idempotency.response-expired",
    "transaction.conflict",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "internal.error",
    "dependency.unavailable",
    "idempotency.unavailable",
    "admission-period.already-exists",
    "admission-period.invalid-window",
  ],
);

/** Problems for `admissions.reviseAdmissionPeriod`. */
export const AdmissionsReviseAdmissionPeriodProblem = problemUnion(
  "AdmissionsReviseAdmissionPeriodProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "idempotency-key.invalid",
    "idempotency.in-flight",
    "idempotency.digest-conflict",
    "idempotency.response-expired",
    "transaction.conflict",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "validation.no-change",
    "validation.field-not-deletable",
    "precondition.invalid",
    "precondition.failed",
    "precondition.required",
    "internal.error",
    "dependency.unavailable",
    "idempotency.unavailable",
    "admission-period.not-found",
    "admission-period.invalid-window",
  ],
);

/** Problems for `recruitment.readInvitationResponse`. */
export const RecruitmentReadInvitationResponseProblem = problemUnion(
  "RecruitmentReadInvitationResponseProblem",
  [
    "request.malformed",
    "header.malformed",
    "precondition.invalid",
    "precondition.failed",
    "resource.not-found",
    "internal.error",
    "recruitment.unavailable",
  ],
);

/** Problems for `recruitment.confirmInvitation`. */
export const RecruitmentConfirmInvitationProblem = problemUnion(
  "RecruitmentConfirmInvitationProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "resource.not-found",
    "precondition.invalid",
    "precondition.failed",
    "precondition.required",
    "internal.error",
    "dependency.unavailable",
    "invitation.already-responded",
  ],
);

/** Problems for `recruitment.rejectInvitation`. */
export const RecruitmentRejectInvitationProblem = problemUnion(
  "RecruitmentRejectInvitationProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "resource.not-found",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "precondition.invalid",
    "precondition.failed",
    "precondition.required",
    "internal.error",
    "dependency.unavailable",
    "invitation.already-responded",
  ],
);

/** Problems for `recruitment.requestNewInvitationTime`. */
export const RecruitmentRequestNewInvitationTimeProblem = problemUnion(
  "RecruitmentRequestNewInvitationTimeProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "resource.not-found",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "precondition.invalid",
    "precondition.failed",
    "precondition.required",
    "internal.error",
    "dependency.unavailable",
    "invitation.already-responded",
  ],
);

/** Problems for `recruitment.readAssignmentBoard`. */
export const RecruitmentReadAssignmentBoardProblem = problemUnion(
  "RecruitmentReadAssignmentBoardProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "recruitment.admission-period-not-found",
    "application.ambiguous-period",
    "recruitment.unavailable",
  ],
);

/** Problems for `recruitment.readSchedulingBoard`. */
export const RecruitmentReadSchedulingBoardProblem = problemUnion(
  "RecruitmentReadSchedulingBoardProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "recruitment.unavailable",
  ],
);

/** Problems for the dedicated completed-interview report. */
export const RecruitmentReadInterviewReportProblem = problemUnion(
  "RecruitmentReadInterviewReportProblem",
  [
    "request.malformed",
    "header.malformed",
    "validation.failed",
    "authority.denied",
    "origin.denied",
    "transaction.conflict",
    "internal.error",
    "recruitment.unavailable",
  ],
);

/** Problems for `recruitment.createApplicationInterview`. */
export const RecruitmentCreateApplicationInterviewProblem = problemUnion(
  "RecruitmentCreateApplicationInterviewProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "idempotency-key.invalid",
    "idempotency.in-flight",
    "idempotency.digest-conflict",
    "idempotency.response-expired",
    "transaction.conflict",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "internal.error",
    "dependency.unavailable",
    "idempotency.unavailable",
    "recruitment.admission-period-not-found",
    "recruitment.application-not-found",
    "application.ambiguous-period",
    "recruitment.interview-schema-not-found",
    "recruitment.application-already-assigned",
    "recruitment.interview-schema-inactive",
  ],
);

/** Problems for `recruitment.scheduleInterview`. */
export const RecruitmentScheduleInterviewProblem = problemUnion(
  "RecruitmentScheduleInterviewProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "idempotency-key.invalid",
    "idempotency.in-flight",
    "idempotency.digest-conflict",
    "idempotency.response-expired",
    "transaction.conflict",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "precondition.invalid",
    "precondition.failed",
    "precondition.required",
    "internal.error",
    "dependency.unavailable",
    "idempotency.unavailable",
    "recruitment.interview-not-found",
    "recruitment.already-scheduled",
    "recruitment.schedule-in-past",
  ],
);

/** Problems for `recruitment.readInterviewConduct`. */
export const RecruitmentReadInterviewConductProblem = problemUnion(
  "RecruitmentReadInterviewConductProblem",
  [
    "request.malformed",
    "header.malformed",
    "precondition.invalid",
    "precondition.failed",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "recruitment.interview-not-found",
    "recruitment.interview-not-scheduled",
    "recruitment.invitation-not-accepted",
    "recruitment.unavailable",
  ],
);

/** Problems for `recruitment.finalizeInterview`. */
export const RecruitmentFinalizeInterviewProblem = problemUnion(
  "RecruitmentFinalizeInterviewProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "idempotency-key.invalid",
    "idempotency.in-flight",
    "idempotency.digest-conflict",
    "idempotency.response-expired",
    "transaction.conflict",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "precondition.invalid",
    "precondition.failed",
    "precondition.required",
    "internal.error",
    "dependency.unavailable",
    "idempotency.unavailable",
    "recruitment.interview-not-found",
    "recruitment.already-finalized",
    "recruitment.already-cancelled",
    "recruitment.interview-not-scheduled",
    "recruitment.invitation-not-accepted",
    "recruitment.conduct-invalid",
  ],
);

/** Problems for `recruitment.correctInterviewAssessment`. */
export const RecruitmentCorrectInterviewAssessmentProblem = problemUnion(
  "RecruitmentCorrectInterviewAssessmentProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "idempotency-key.invalid",
    "idempotency.in-flight",
    "idempotency.digest-conflict",
    "idempotency.response-expired",
    "transaction.conflict",
    "request.too-large",
    "media-type.unsupported",
    "validation.failed",
    "precondition.invalid",
    "precondition.failed",
    "precondition.required",
    "internal.error",
    "dependency.unavailable",
    "idempotency.unavailable",
    "recruitment.interview-not-found",
    "recruitment.already-finalized",
    "recruitment.already-cancelled",
    "recruitment.interview-not-scheduled",
    "recruitment.invitation-not-accepted",
    "recruitment.conduct-invalid",
  ],
);

/** Problems for `recruitment.cancelInterview`. */
export const RecruitmentCancelInterviewProblem = problemUnion("RecruitmentCancelInterviewProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
  "recruitment.interview-not-found",
  "recruitment.already-finalized",
  "recruitment.already-cancelled",
  "recruitment.interview-not-scheduled",
]);

/** Problems for `receipts.submitReceipt`. */
export const ReceiptsSubmitReceiptProblem = problemUnion("ReceiptsSubmitReceiptProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "internal.error",
  "dependency.unavailable",
  "receipts.unavailable",
  "idempotency.unavailable",
  "transaction.conflict",
  "receipt.already-exists",
  "receipt.file-not-staged",
]);

/** Problems for `receipts.reviseReceipt`. */
export const ReceiptsReviseReceiptProblem = problemUnion("ReceiptsReviseReceiptProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "validation.no-change",
  "validation.field-not-deletable",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "internal.error",
  "dependency.unavailable",
  "receipts.unavailable",
  "idempotency.unavailable",
  "transaction.conflict",
  "receipt.not-found",
  "receipt.invalid-transition",
  "receipt.file-not-staged",
]);

/** Problems for `receipts.withdrawReceipt`. */
export const ReceiptsWithdrawReceiptProblem = problemUnion("ReceiptsWithdrawReceiptProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "internal.error",
  "dependency.unavailable",
  "receipts.unavailable",
  "idempotency.unavailable",
  "transaction.conflict",
  "receipt.not-found",
  "receipt.invalid-transition",
]);

/** Problems for `receipts.listReceipts`. */
export const ReceiptsListReceiptsProblem = problemUnion("ReceiptsListReceiptsProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "receipts.unavailable",
]);

/** Problems for `receipts.listReceiptsForApproval`. */
export const ReceiptsListReceiptsForApprovalProblem = problemUnion(
  "ReceiptsListReceiptsForApprovalProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "receipts.unavailable",
  ],
);

/** Problems for `receipts.listReceiptsForSettlement`. */
export const ReceiptsListReceiptsForSettlementProblem = problemUnion(
  "ReceiptsListReceiptsForSettlementProblem",
  [
    "request.malformed",
    "header.malformed",
    "origin.denied",
    "internal.error",
    "receipts.unavailable",
  ],
);

/** Problems for `receipts.readReceiptSettlementForFinance`. */
export const ReceiptsReadReceiptSettlementForFinanceProblem = problemUnion(
  "ReceiptsReadReceiptSettlementForFinanceProblem",
  [
    "request.malformed",
    "header.malformed",
    "origin.denied",
    "receipt.not-found",
    "internal.error",
    "receipts.unavailable",
  ],
);

/** Problems for `receipts.settleReceipt`. */
export const ReceiptsSettleReceiptProblem = problemUnion("ReceiptsSettleReceiptProblem", [
  "request.malformed",
  "header.malformed",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "settlement.after-recorded-at",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "receipt.already-settled",
  "receipt.invalid-transition",
  "settlement.external-reference-conflict",
  "receipt.not-found",
  "internal.error",
  "dependency.unavailable",
  "receipts.unavailable",
  "idempotency.unavailable",
  "transaction.conflict",
]);

/** Problems for `receipts.approveReceipt`. */
export const ReceiptsApproveReceiptProblem = problemUnion("ReceiptsApproveReceiptProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "internal.error",
  "dependency.unavailable",
  "receipts.unavailable",
  "idempotency.unavailable",
  "transaction.conflict",
  "receipt.not-found",
  "receipt.invalid-transition",
]);

/** Problems for `receipts.rejectReceipt`. */
export const ReceiptsRejectReceiptProblem = problemUnion("ReceiptsRejectReceiptProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "internal.error",
  "dependency.unavailable",
  "receipts.unavailable",
  "idempotency.unavailable",
  "transaction.conflict",
  "receipt.not-found",
  "receipt.invalid-transition",
]);

/** Problems for `receipts.reopenReceipt`. */
export const ReceiptsReopenReceiptProblem = problemUnion("ReceiptsReopenReceiptProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "internal.error",
  "dependency.unavailable",
  "receipts.unavailable",
  "idempotency.unavailable",
  "transaction.conflict",
  "receipt.not-found",
  "receipt.invalid-transition",
]);

/** The ordered codes for generated content.readContentWorkspace. */
export const ContentReadContentWorkspaceCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "content.department-not-found",
  "content.integrity-error",
  "content.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `content.readContentWorkspace`. */
export const ContentReadContentWorkspaceProblem = problemUnion(
  "ContentReadContentWorkspaceProblem",
  ContentReadContentWorkspaceCodes,
);

/** The ordered codes for generated content.createArticle. */
export const ContentCreateArticleCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
  "content.slug-conflict",
  "content.department-not-found",
  "content.integrity-error",
  "content.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `content.createArticle`. */
export const ContentCreateArticleProblem = problemUnion(
  "ContentCreateArticleProblem",
  ContentCreateArticleCodes,
);

/** The ordered codes for generated content.readArticle. */
export const ContentReadArticleCodes = [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "content.article-not-found",
  "content.integrity-error",
  "content.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `content.readArticle`. */
export const ContentReadArticleProblem = problemUnion(
  "ContentReadArticleProblem",
  ContentReadArticleCodes,
);

/** The ordered codes for generated content.reviseArticle. */
export const ContentReviseArticleCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "validation.no-change",
  "validation.field-not-deletable",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
  "content.article-not-found",
  "content.slug-conflict",
  "content.department-not-found",
  "content.integrity-error",
  "content.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `content.reviseArticle`. */
export const ContentReviseArticleProblem = problemUnion(
  "ContentReviseArticleProblem",
  ContentReviseArticleCodes,
);

/** The ordered codes for generated content.publishArticle. */
export const ContentPublishArticleCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
  "content.article-not-found",
  "content.lifecycle-conflict",
  "content.integrity-error",
  "content.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `content.publishArticle`. */
export const ContentPublishArticleProblem = problemUnion(
  "ContentPublishArticleProblem",
  ContentPublishArticleCodes,
);

/** The ordered codes for generated content.unpublishArticle. */
export const ContentUnpublishArticleCodes = [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "idempotency-key.invalid",
  "idempotency.in-flight",
  "idempotency.digest-conflict",
  "idempotency.response-expired",
  "transaction.conflict",
  "request.too-large",
  "media-type.unsupported",
  "validation.failed",
  "precondition.invalid",
  "precondition.failed",
  "precondition.required",
  "internal.error",
  "dependency.unavailable",
  "idempotency.unavailable",
  "content.article-not-found",
  "content.lifecycle-conflict",
  "content.integrity-error",
  "content.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `content.unpublishArticle`. */
export const ContentUnpublishArticleProblem = problemUnion(
  "ContentUnpublishArticleProblem",
  ContentUnpublishArticleCodes,
);

/** The ordered codes for generated content.listNews. */
export const ContentListNewsCodes = [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "internal.error",
  "content.department-not-found",
  "content.integrity-error",
  "content.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `content.listNews`. */
export const ContentListNewsProblem = problemUnion("ContentListNewsProblem", ContentListNewsCodes);

/** The ordered codes for generated content.readNewsArticle. */
export const ContentReadNewsArticleCodes = [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "internal.error",
  "content.article-not-found",
  "content.integrity-error",
  "content.unavailable",
] as const satisfies readonly [NativeProblemCode, ...NativeProblemCode[]];

/** Problems for `content.readNewsArticle`. */
export const ContentReadNewsArticleProblem = problemUnion(
  "ContentReadNewsArticleProblem",
  ContentReadNewsArticleCodes,
);

/** Problems for `internal.readReceiptEvidence`. */
export const InternalReadReceiptEvidenceProblem = problemUnion(
  "InternalReadReceiptEvidenceProblem",
  [
    "request.malformed",
    "header.malformed",
    "credential.missing",
    "credential.invalid",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "receipt.not-found",
    "receipts.unavailable",
  ],
);

/** Problems for `receipts.readReceiptFile`. */
export const ReceiptsReadReceiptFileProblem = problemUnion("ReceiptsReadReceiptFileProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "resource.not-found",
  "internal.error",
  "receipts.unavailable",
]);
