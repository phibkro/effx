import { Schema } from "effect";
import { DepartmentId, PersonId, SemesterId } from "../organization/index.js";
import { SchoolId } from "../schools/index.js";
import { isRfc3339Instant } from "../time.js";

const Id = Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,128}$/)));

const Label = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(256)),
);

const Digest = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)));

const CurrentAssignmentMapping = Schema.Struct({
  sourceAssignmentId: Id,
  sourceUserId: Id,
  sourceDepartmentId: Id,
  sourceSemesterId: Id,
  sourceSchoolId: Id,
  personId: PersonId,
  departmentId: DepartmentId,
  semesterId: SemesterId,
  schoolId: SchoolId,
});

const CurrentAssignmentSnapshotFields = {
  sourceRepository: Label,
  sourceRevision: Id,
  snapshotId: Id,
  sourceWatermark: Id,
  snapshotDigest: Digest,
  transformationRevision: Id,
  occurrences: Schema.Array(Schema.Struct({ occurrenceId: Id, row: Schema.Unknown })).pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(1000)),
  ),
  mappings: Schema.Array(CurrentAssignmentMapping).pipe(Schema.check(Schema.isMaxLength(1000))),
};

export const CurrentAssignmentSnapshot = Schema.Struct({
  ...CurrentAssignmentSnapshotFields,
  synthetic: Schema.Literal(true),
});

export type CurrentAssignmentSnapshot = typeof CurrentAssignmentSnapshot.Type;

export const CurrentAssignmentReview = Schema.Struct({
  sourceRevision: Id,
  sourceWatermark: Id,
  sourceSemesterId: Id,
  asOf: Schema.String.pipe(
    Schema.check(Schema.makeFilter((value) => isRfc3339Instant(value + "T00:00:00Z"))),
  ),
  attestedBy: Id,
  evidenceRef: Id,
  assignments: Schema.Array(
    Schema.Struct({
      sourceAssignmentId: Id,
      sourceRowDigest: Digest,
      active: Schema.Boolean,
      affiliationEvidenceRef: Id,
      placementEvidenceRef: Id,
      bothBlocksShareDay: Schema.optional(Schema.Literal(true)),
    }),
  ).pipe(Schema.check(Schema.isMinLength(1)), Schema.check(Schema.isMaxLength(1000))),
}).pipe(
  Schema.check(
    Schema.makeFilter(
      ({ assignments }) =>
        new Set(assignments.map(({ sourceAssignmentId }) => sourceAssignmentId)).size ===
        assignments.length,
    ),
  ),
);

export type CurrentAssignmentReview = typeof CurrentAssignmentReview.Type;

export const ReconciledCurrentAssignmentSnapshot = Schema.Struct({
  ...CurrentAssignmentSnapshotFields,
  synthetic: Schema.Literal(false),
  review: CurrentAssignmentReview,
  referenceDigest: Digest,
  personSnapshotKey: Digest,
});

export type ReconciledCurrentAssignmentSnapshot = typeof ReconciledCurrentAssignmentSnapshot.Type;
