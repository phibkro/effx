/** Generated from the frozen 0080.1 endpoint-specific Problem Details table. */
import { problemUnion } from "./http-semantics.js";

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

/** Problems for `profile.readOwnProfile`. */
export const ProfileReadOwnProfileProblem = problemUnion("ProfileReadOwnProfileProblem", [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "profile.not-found",
  "profile.unavailable",
]);

/** Problems for `profile.updateOwnProfile`. */
export const ProfileUpdateOwnProfileProblem = problemUnion("ProfileUpdateOwnProfileProblem", [
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
]);

/** Problems for `organization.listDepartments`. */
export const OrganizationListDepartmentsProblem = problemUnion(
  "OrganizationListDepartmentsProblem",
  [
    "request.malformed",
    "header.malformed",
    "precondition.invalid",
    "precondition.failed",
    "internal.error",
    "organization.unavailable",
  ],
);

/** Problems for `organization.listTeams`. */
export const OrganizationListTeamsProblem = problemUnion("OrganizationListTeamsProblem", [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "internal.error",
  "organization.unavailable",
]);

/** Problems for `organization.listFieldOfStudies`. */
export const OrganizationListFieldOfStudiesProblem = problemUnion(
  "OrganizationListFieldOfStudiesProblem",
  [
    "request.malformed",
    "header.malformed",
    "precondition.invalid",
    "precondition.failed",
    "internal.error",
    "organization.unavailable",
  ],
);

/** Problems for `organization.listTeamInterest`. */
export const OrganizationListTeamInterestProblem = problemUnion(
  "OrganizationListTeamInterestProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "organization.invalid-reference",
    "organization.unavailable",
  ],
);

/** Problems for `organization.listMailingLists`. */
export const OrganizationListMailingListsProblem = problemUnion(
  "OrganizationListMailingListsProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "organization.invalid-reference",
    "organization.unavailable",
  ],
);

/** Problems for `organization.createDepartment`. */
export const OrganizationCreateDepartmentProblem = problemUnion(
  "OrganizationCreateDepartmentProblem",
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
    "organization.invalid-reference",
    "organization.unavailable",
  ],
);

/** Problems for `organization.createTeam`. */
export const OrganizationCreateTeamProblem = problemUnion("OrganizationCreateTeamProblem", [
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
]);

/** Problems for `organization.createFieldOfStudy`. */
export const OrganizationCreateFieldOfStudyProblem = problemUnion(
  "OrganizationCreateFieldOfStudyProblem",
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
    "organization.invalid-reference",
    "organization.unavailable",
  ],
);

/** Problems for `directory.listPeople`. */
export const DirectoryListPeopleProblem = problemUnion("DirectoryListPeopleProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "directory.cursor-malformed",
  "directory.unavailable",
]);

/** Problems for `directory.listSchools`. */
export const DirectoryListSchoolsProblem = problemUnion("DirectoryListSchoolsProblem", [
  "request.malformed",
  "header.malformed",
  "authority.denied",
  "origin.denied",
  "internal.error",
  "schools.invalid-department",
  "schools.unavailable",
]);

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

/** Problems for `content.readContentWorkspace`. */
export const ContentReadContentWorkspaceProblem = problemUnion(
  "ContentReadContentWorkspaceProblem",
  [
    "request.malformed",
    "header.malformed",
    "authority.denied",
    "origin.denied",
    "internal.error",
    "content.department-not-found",
    "content.integrity-error",
    "content.unavailable",
  ],
);

/** Problems for `content.createArticle`. */
export const ContentCreateArticleProblem = problemUnion("ContentCreateArticleProblem", [
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
]);

/** Problems for `content.readArticle`. */
export const ContentReadArticleProblem = problemUnion("ContentReadArticleProblem", [
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
]);

/** Problems for `content.reviseArticle`. */
export const ContentReviseArticleProblem = problemUnion("ContentReviseArticleProblem", [
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
]);

/** Problems for `content.publishArticle`. */
export const ContentPublishArticleProblem = problemUnion("ContentPublishArticleProblem", [
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
]);

/** Problems for `content.unpublishArticle`. */
export const ContentUnpublishArticleProblem = problemUnion("ContentUnpublishArticleProblem", [
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
]);

/** Problems for `content.listNews`. */
export const ContentListNewsProblem = problemUnion("ContentListNewsProblem", [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "internal.error",
  "content.department-not-found",
  "content.integrity-error",
  "content.unavailable",
]);

/** Problems for `content.readNewsArticle`. */
export const ContentReadNewsArticleProblem = problemUnion("ContentReadNewsArticleProblem", [
  "request.malformed",
  "header.malformed",
  "precondition.invalid",
  "precondition.failed",
  "internal.error",
  "content.article-not-found",
  "content.integrity-error",
  "content.unavailable",
]);

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
