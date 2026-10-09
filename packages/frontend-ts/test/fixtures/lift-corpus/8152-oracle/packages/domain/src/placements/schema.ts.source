import { Schema } from "effect";
import { DepartmentId, PersonId, SemesterId } from "../organization/index.js";
import { SchoolId } from "../schools/index.js";
import { isIsoDate } from "../receipt/index.js";

export const PlacementScope = Schema.Struct({ departmentId: DepartmentId, semesterId: SemesterId });

export const AffiliationScope = Schema.Struct({ departmentId: DepartmentId });

export const AffiliationStatus = Schema.Literals(["Absent", "Pending", "Active", "Inactive"]);

export const Affiliation = Schema.Struct({
  personId: PersonId,
  departmentId: DepartmentId,
  status: AffiliationStatus,
  revision: Schema.Int,
});

export const TeachingDay = Schema.Literals([
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
]);

export const TeachingBlock = Schema.Literals(["1", "2"]);

export const IsoServiceDate = Schema.String.pipe(
  Schema.check(Schema.makeFilter(isIsoDate, { message: "a valid YYYY-MM-DD date" })),
);

export const PlacementValues = Schema.Struct({
  schoolId: SchoolId,
  day: TeachingDay,
  workdays: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 8 }))),
  block: Schema.Literals(["1", "2", "Both"]),
});

export const PlacementId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^placement-[a-f0-9]{64}$/)),
);

export const Placement = Schema.Struct({
  ...PlacementScope.fields,
  ...PlacementValues.fields,
  placementId: PlacementId,
  personId: PersonId,
  active: Schema.Boolean,
  revision: Schema.Int,
  firstName: Schema.String,
  lastName: Schema.String,
  schoolName: Schema.String,
});

const NonNegativeCount = Schema.Int.pipe(
  Schema.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(2_147_483_647)),
);

export const SchoolServiceDemand = Schema.Struct({
  schoolId: SchoolId,
  day: TeachingDay,
  block: TeachingBlock,
  requiredVolunteers: NonNegativeCount,
  revision: Schema.Int,
});

export const SchoolServiceProposalId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^school-service-proposal-[a-f0-9]{64}$/)),
);

export const SchoolServiceCommitmentId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^school-service-commitment-[a-f0-9]{64}$/)),
);

export const SchoolServiceTime = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)),
);

export const SchoolServiceEvidenceText = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.trim().length > 0 && value.length <= 500, {
      message: "nonblank text of at most 500 characters",
    }),
  ),
);

export const SchoolServiceOccurrenceId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^school-service-occurrence-[a-f0-9]{64}$/)),
);

export const SchoolServiceAbsenceId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^school-service-absence-[a-f0-9]{64}$/)),
);

export const SchoolServiceCoverageId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^school-service-coverage-[a-f0-9]{64}$/)),
);

export const SchoolServiceClosureId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^school-service-closure-[a-f0-9]{64}$/)),
);

export const SchoolServiceProposalAssignment = Schema.Struct({
  placementId: PlacementId,
  personId: PersonId,
  firstName: Schema.String,
  lastName: Schema.String,
  schoolId: SchoolId,
  schoolName: Schema.String,
  day: TeachingDay,
  block: TeachingBlock,
});

export const SchoolServiceExceptionCode = Schema.Literals([
  "DemandUnfilled",
  "DemandExceeded",
  "AssignmentWithoutDemand",
]);

export const SchoolServiceProposalException = Schema.Struct({
  exceptionId: Schema.String,
  code: SchoolServiceExceptionCode,
  schoolId: SchoolId,
  schoolName: Schema.String,
  day: TeachingDay,
  block: TeachingBlock,
  requiredVolunteers: NonNegativeCount,
  assignedVolunteers: NonNegativeCount,
});

export const SchoolServiceProposal = Schema.Struct({
  proposalId: SchoolServiceProposalId,
  status: Schema.Literals(["Draft", "Confirmed"]),
  revision: Schema.Int,
  createdAt: Schema.String,
  createdBy: PersonId,
  confirmedAt: Schema.NullOr(Schema.String),
  confirmedBy: Schema.NullOr(PersonId),
  demands: Schema.Array(SchoolServiceDemand),
  assignments: Schema.Array(SchoolServiceProposalAssignment),
  exceptions: Schema.Array(SchoolServiceProposalException),
  reviewedExceptionIds: Schema.Array(Schema.String),
});

export const SchoolServiceNotificationRequest = Schema.TaggedStruct(
  "NotifySchoolServiceRosterConfirmed",
  {
    effectId: Schema.String,
    proposalId: SchoolServiceProposalId,
    personId: PersonId,
    departmentId: DepartmentId,
    semesterId: SemesterId,
    assignments: Schema.Array(SchoolServiceProposalAssignment),
    confirmedAt: Schema.String,
  },
);

export type SchoolServiceNotificationRequest = typeof SchoolServiceNotificationRequest.Type;

export const SchoolServiceNotification = Schema.Struct({
  effectId: Schema.String,
  proposalId: SchoolServiceProposalId,
  personId: PersonId,
  status: Schema.Literals(["Pending", "Processing", "Delivered", "Failed", "Quarantined"]),
  attempts: NonNegativeCount,
  deliveredAt: Schema.NullOr(Schema.String),
  lastFailureTag: Schema.NullOr(Schema.String),
});

export const SchoolServiceDecision = Schema.Struct({
  outcome: Schema.Literals(["Completed", "Cancelled", "Unfulfilled"]),
  decidedAt: Schema.String,
  decidedBy: PersonId,
  evidenceSource: SchoolServiceEvidenceText,
  reason: Schema.NullOr(SchoolServiceEvidenceText),
  attendedPersonIds: Schema.Array(PersonId),
  occurrenceId: Schema.NullOr(SchoolServiceOccurrenceId),
});

export const SchoolServiceCommitment = Schema.Struct({
  commitmentId: SchoolServiceCommitmentId,
  proposalId: SchoolServiceProposalId,
  ...PlacementScope.fields,
  schoolId: SchoolId,
  schoolName: Schema.String,
  day: TeachingDay,
  block: TeachingBlock,
  serviceDate: IsoServiceDate,
  startTime: SchoolServiceTime,
  endTime: SchoolServiceTime,
  requiredVolunteers: Schema.Int.pipe(Schema.check(Schema.isGreaterThan(0))),
  assignments: Schema.Array(SchoolServiceProposalAssignment),
  createdAt: Schema.String,
  createdBy: PersonId,
  decision: Schema.NullOr(SchoolServiceDecision),
  overdue: Schema.Boolean,
});

export const SchoolServiceOccurrence = Schema.Struct({
  commitmentId: Schema.NullOr(SchoolServiceCommitmentId),
  occurrenceId: SchoolServiceOccurrenceId,
  proposalId: SchoolServiceProposalId,
  schoolId: SchoolId,
  schoolName: Schema.String,
  day: TeachingDay,
  block: TeachingBlock,
  occurredOn: IsoServiceDate,
  attendedPersonIds: Schema.Array(PersonId),
  recordedAt: Schema.String,
  recordedBy: PersonId,
});

export const SchoolServiceAbsence = Schema.Struct({
  absenceId: SchoolServiceAbsenceId,
  commitmentId: Schema.NullOr(SchoolServiceCommitmentId),
  proposalId: SchoolServiceProposalId,
  departmentId: DepartmentId,
  semesterId: SemesterId,
  personId: PersonId,
  schoolId: SchoolId,
  schoolName: Schema.String,
  day: TeachingDay,
  block: TeachingBlock,
  serviceDate: IsoServiceDate,
  reporterPersonId: PersonId,
  reportedAt: Schema.String,
});

/** A placed assistant or an admitted substitute on call, as known when coverage was recorded. */
export const CoverageCovererKind = Schema.Literals(["Assistant", "Substitute"]);

/**
 * Names the person who covered one absence on its service date. It is a recorded fact, not an
 * offer: the people involved agree on cover outside the system.
 */
export const SchoolServiceCoverage = Schema.Struct({
  coverageId: SchoolServiceCoverageId,
  absenceId: SchoolServiceAbsenceId,
  coveringPersonId: PersonId,
  coveringFirstName: Schema.String,
  coveringLastName: Schema.String,
  covererKind: CoverageCovererKind,
  recordedByPersonId: PersonId,
  recordedAt: Schema.String,
});

export const SchoolServiceClosure = Schema.Struct({
  closureId: SchoolServiceClosureId,
  absenceId: SchoolServiceAbsenceId,
  occurrenceId: Schema.NullOr(SchoolServiceOccurrenceId),
  scheduledPersonId: PersonId,
  outcome: Schema.Literals(["Covered", "Uncovered"]),
  coverageId: Schema.NullOr(SchoolServiceCoverageId),
  coveringPersonId: Schema.NullOr(PersonId),
  closedByPersonId: PersonId,
  closedAt: Schema.String,
});

export const ConfirmedRosterSlot = Schema.Struct({
  proposalId: SchoolServiceProposalId,
  schoolId: SchoolId,
  schoolName: Schema.String,
  day: TeachingDay,
  block: TeachingBlock,
});

export const CoverageRosterAssignment = Schema.Struct({
  proposalId: SchoolServiceProposalId,
  ...SchoolServiceProposalAssignment.fields,
});

/** A person who can be named in a coverage record for the scope. Conflicts are checked on record. */
export const CoverageCoverer = Schema.Struct({
  personId: PersonId,
  firstName: Schema.String,
  lastName: Schema.String,
  kind: CoverageCovererKind,
});

export const OwnCoverageView = Schema.Struct({
  ...PlacementScope.fields,
  personId: PersonId,
  placements: Schema.Array(Placement),
  rosterSlots: Schema.Array(ConfirmedRosterSlot),
  commitments: Schema.Array(SchoolServiceCommitment),
  absences: Schema.Array(SchoolServiceAbsence),
  coverage: Schema.Array(SchoolServiceCoverage),
  coverers: Schema.Array(CoverageCoverer),
});

export const CoverageBoard = Schema.Struct({
  ...PlacementScope.fields,
  rosterAssignments: Schema.Array(CoverageRosterAssignment),
  commitments: Schema.Array(SchoolServiceCommitment),
  absences: Schema.Array(SchoolServiceAbsence),
  coverage: Schema.Array(SchoolServiceCoverage),
  coverers: Schema.Array(CoverageCoverer),
  closures: Schema.Array(SchoolServiceClosure),
  occurrences: Schema.Array(SchoolServiceOccurrence),
});

export const PlacementBoard = Schema.Struct({
  ...PlacementScope.fields,
  affiliations: Schema.Array(
    Schema.Struct({ ...Affiliation.fields, firstName: Schema.String, lastName: Schema.String }),
  ),
  placements: Schema.Array(Placement),
  schools: Schema.Array(Schema.Struct({ schoolId: SchoolId, name: Schema.String })),
  demands: Schema.Array(SchoolServiceDemand),
  proposal: Schema.NullOr(SchoolServiceProposal),
  notifications: Schema.Array(SchoolServiceNotification),
  commitments: Schema.Array(SchoolServiceCommitment),
  occurrences: Schema.Array(SchoolServiceOccurrence),
});

export const PlacementScopes = Schema.Struct({
  departments: Schema.Array(
    Schema.Struct({ departmentId: DepartmentId, name: Schema.String, canManage: Schema.Boolean }),
  ),
  semesters: Schema.Array(
    Schema.Struct({ semesterId: SemesterId, startAt: Schema.String, endAt: Schema.String }),
  ),
});

export const OwnAffiliationCommand = Schema.Struct({
  action: Schema.Literals(["Request", "Withdraw"]),
});

const RecordCoverageCommand = Schema.Struct({
  action: Schema.Literal("RecordCoverage"),
  absenceId: SchoolServiceAbsenceId,
  coveringPersonId: PersonId,
});

const WithdrawCoverageCommand = Schema.Struct({
  action: Schema.Literal("WithdrawCoverage"),
  absenceId: SchoolServiceAbsenceId,
});

export const OwnCoverageCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("ReportAbsence"),
    commitmentId: SchoolServiceCommitmentId,
  }),
  RecordCoverageCommand,
  WithdrawCoverageCommand,
]);

export const CoverageCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("ReportAbsenceForVolunteer"),
    personId: PersonId,
    commitmentId: SchoolServiceCommitmentId,
  }),
  RecordCoverageCommand,
  WithdrawCoverageCommand,
  Schema.Struct({
    action: Schema.Literal("CompleteService"),
    commitmentId: SchoolServiceCommitmentId,
    evidenceSource: SchoolServiceEvidenceText,
  }),
  Schema.Struct({
    action: Schema.Literal("CancelService"),
    commitmentId: SchoolServiceCommitmentId,
    reason: SchoolServiceEvidenceText,
    evidenceSource: SchoolServiceEvidenceText,
  }),
  Schema.Struct({
    action: Schema.Literal("MarkUnfulfilledService"),
    commitmentId: SchoolServiceCommitmentId,
    reason: SchoolServiceEvidenceText,
    evidenceSource: SchoolServiceEvidenceText,
  }),
]);

export const PlacementCommand = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("Affiliation"),
    personId: PersonId,
    transition: Schema.Literals(["Establish", "Reject", "Revoke"]),
  }),
  Schema.Struct({
    action: Schema.Literal("Create"),
    personId: PersonId,
    ...PlacementValues.fields,
  }),
  Schema.Struct({
    action: Schema.Literal("Edit"),
    placementId: PlacementId,
    ...PlacementValues.fields,
  }),
  Schema.Struct({ action: Schema.Literal("Remove"), placementId: PlacementId }),
  Schema.Struct({
    action: Schema.Literal("SetDemand"),
    schoolId: SchoolId,
    day: TeachingDay,
    block: TeachingBlock,
    requiredVolunteers: NonNegativeCount,
  }),
  Schema.Struct({ action: Schema.Literal("GenerateProposal") }),
  Schema.Struct({
    action: Schema.Literal("ConfirmProposal"),
    proposalId: SchoolServiceProposalId,
    reviewedExceptionIds: Schema.Array(Schema.String),
  }),
  Schema.Struct({
    action: Schema.Literal("ScheduleService"),
    proposalId: SchoolServiceProposalId,
    schoolId: SchoolId,
    day: TeachingDay,
    block: TeachingBlock,
    serviceDate: IsoServiceDate,
    startTime: SchoolServiceTime,
    endTime: SchoolServiceTime,
  }),
]);

export type PlacementScope = typeof PlacementScope.Type;

export type Affiliation = typeof Affiliation.Type;

export type Placement = typeof Placement.Type;

export type PlacementBoard = typeof PlacementBoard.Type;

export type SchoolServiceCommitment = typeof SchoolServiceCommitment.Type;

export type SchoolServiceDecision = typeof SchoolServiceDecision.Type;

export type SchoolServiceDemand = typeof SchoolServiceDemand.Type;

export type SchoolServiceProposal = typeof SchoolServiceProposal.Type;

export type SchoolServiceProposalAssignment = typeof SchoolServiceProposalAssignment.Type;

export type SchoolServiceProposalException = typeof SchoolServiceProposalException.Type;

export type SchoolServiceAbsence = typeof SchoolServiceAbsence.Type;

export type SchoolServiceCoverage = typeof SchoolServiceCoverage.Type;

export type SchoolServiceClosure = typeof SchoolServiceClosure.Type;

export type ConfirmedRosterSlot = typeof ConfirmedRosterSlot.Type;

export type CoverageRosterAssignment = typeof CoverageRosterAssignment.Type;

export type CoverageCoverer = typeof CoverageCoverer.Type;

export type OwnCoverageView = typeof OwnCoverageView.Type;

export type CoverageBoard = typeof CoverageBoard.Type;

export type PlacementCommand = typeof PlacementCommand.Type;

export type OwnAffiliationCommand = typeof OwnAffiliationCommand.Type;

export type OwnCoverageCommand = typeof OwnCoverageCommand.Type;

export type CoverageCommand = typeof CoverageCommand.Type;
