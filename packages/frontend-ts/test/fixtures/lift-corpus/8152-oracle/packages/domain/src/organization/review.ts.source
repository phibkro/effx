import { Data, Result, Schema } from "effect";
import { canonicalJsonBytes, sha256Hex } from "../shared-kernel/index.js";
import { compareRfc3339Instants, Rfc3339InstantSchema } from "../time.js";
import { appointmentStateAt } from "./lifecycle.js";
import { DepartmentId, PersonId } from "./schema.js";

const Id = Schema.String.pipe(Schema.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,128}$/)));

const Label = Schema.String.pipe(Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256)));

const Digest = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)));

const Kind = Schema.Literals(["TeamMembership", "BoardMembership"]);

const bounded = <S extends Schema.Constraint>(schema: S) =>
  Schema.Array(schema).pipe(Schema.check(Schema.isMaxLength(10000)));

export const OrganizationReview = Schema.Struct({
  sourceRevision: Id,
  sourceWatermark: Id,
  asOf: Rfc3339InstantSchema,
  attestedBy: Id,
  evidenceRef: Id,
  memberships: bounded(
    Schema.Union([
      Schema.Struct({
        sourceKind: Kind,
        sourceId: Id,
        sourceRowDigest: Digest,
        decision: Schema.Literal("Excluded"),
        evidenceRef: Id,
      }),
      Schema.Struct({
        sourceKind: Kind,
        sourceId: Id,
        sourceRowDigest: Digest,
        decision: Schema.Literals(["Historical", "Current", "Future"]),
        startAt: Rfc3339InstantSchema,
        endAt: Schema.NullOr(Rfc3339InstantSchema),
        evidenceRef: Id,
      }),
    ]),
  ),
});

export type OrganizationReview = typeof OrganizationReview.Type;

const Occurrence = Schema.Struct({
  occurrenceId: Id,
  sourceKind: Kind,
  sourceId: Id,
  sourceRowDigest: Digest,
  row: Schema.Json,
});

export type OrganizationSourceOccurrence = typeof Occurrence.Type;

export const ReviewedOrganizationSnapshot = Schema.Struct({
  sourceRepository: Label,
  sourceRevision: Id,
  snapshotId: Id,
  sourceWatermark: Id,
  transformationRevision: Id,
  snapshotDigest: Digest,
  referenceDigest: Digest,
  personSnapshotKey: Digest,
  review: OrganizationReview,
  departments: bounded(Schema.Json),
  teams: bounded(Schema.Json),
  boards: bounded(Schema.Json),
  positions: bounded(Schema.Json),
  occurrences: bounded(Occurrence).pipe(Schema.check(Schema.isMinLength(1))),
  mappings: Schema.Struct({
    persons: bounded(Schema.Struct({ sourceUserId: Id, personId: PersonId })),
    departments: bounded(Schema.Struct({ sourceDepartmentId: Id, departmentId: DepartmentId })),
  }),
});

export type ReviewedOrganizationSnapshot = typeof ReviewedOrganizationSnapshot.Type;

export class OrganizationCohortFailure extends Data.TaggedError("OrganizationCohortFailure")<{
  readonly code:
    | "InvalidSnapshot"
    | "InvalidReview"
    | "SnapshotConflict"
    | "SourceConflict"
    | "ReferenceProvenanceConflict"
    | "PersonSnapshotConflict"
    | "NoAcceptedAppointments";
}> {
  override get message(): string {
    return this.code;
  }
}

export const organizationEvidenceDigest = (value: Schema.Json): string =>
  sha256Hex(canonicalJsonBytes(value));

/** The evidence digest of a snapshot without its own digest field. */
export const organizationSnapshotDigest = (snapshot: Schema.JsonObject): string =>
  organizationEvidenceDigest(
    Object.fromEntries(Object.entries(snapshot).filter(([key]) => key !== "snapshotDigest")),
  );

export const reviewedOrganizationTargetId = (
  kind: "Team" | "Board" | "Position" | "TeamMembership" | "BoardMembership",
  sourceRepository: string,
  sourceId: string,
): string => `org-${organizationEvidenceDigest([kind, sourceRepository, sourceId])}`;

const invalidReview = () => new OrganizationCohortFailure({ code: "InvalidReview" });

const invalidSnapshot = () => new OrganizationCohortFailure({ code: "InvalidSnapshot" });

export const validateOrganizationReview = (
  input: Schema.Json,
  occurrences: ReadonlyArray<OrganizationSourceOccurrence>,
): Result.Result<OrganizationReview, OrganizationCohortFailure> =>
  Result.gen(function* () {
    const review = yield* Schema.decodeUnknownResult(OrganizationReview)(input, {
      onExcessProperty: "error",
    }).pipe(Result.mapError(invalidReview));

    const keys = new Set<string>();

    const entries = new Map(
      review.memberships.map((entry) => [
        JSON.stringify([entry.sourceKind, entry.sourceId]),
        entry,
      ]),
    );

    if (entries.size !== review.memberships.length || entries.size !== occurrences.length)
      return yield* Result.fail(invalidReview());

    for (const occurrence of occurrences) {
      const key = JSON.stringify([occurrence.sourceKind, occurrence.sourceId]);
      const entry = entries.get(key);

      if (
        keys.has(key) ||
        !entry ||
        entry.sourceRowDigest !== occurrence.sourceRowDigest ||
        occurrence.sourceRowDigest !== organizationEvidenceDigest(occurrence.row)
      )
        return yield* Result.fail(invalidReview());
      keys.add(key);

      if (entry.decision === "Excluded") {
        continue;
      }

      if (
        entry.startAt === undefined ||
        entry.endAt === undefined ||
        (entry.endAt !== null && compareRfc3339Instants(entry.endAt, entry.startAt) <= 0)
      )
        return yield* Result.fail(invalidReview());

      const state = appointmentStateAt(
        { startAt: entry.startAt, endAt: entry.endAt, suspended: false },
        review.asOf,
      );

      if (state !== (entry.decision === "Historical" ? "Ended" : entry.decision))
        return yield* Result.fail(invalidReview());
    }

    return review;
  });

export const decodeReviewedOrganizationSnapshot = (
  input: Schema.Json,
): Result.Result<ReviewedOrganizationSnapshot, OrganizationCohortFailure> =>
  Result.gen(function* () {
    const snapshot = yield* Schema.decodeUnknownResult(ReviewedOrganizationSnapshot)(input, {
      onExcessProperty: "error",
    }).pipe(Result.mapError(invalidSnapshot));

    if (
      organizationSnapshotDigest(snapshot) !== snapshot.snapshotDigest ||
      new Set(snapshot.occurrences.map((row) => row.occurrenceId)).size !==
        snapshot.occurrences.length ||
      new Set(snapshot.mappings.persons.map((row) => row.sourceUserId)).size !==
        snapshot.mappings.persons.length ||
      new Set(snapshot.mappings.departments.map((row) => row.sourceDepartmentId)).size !==
        snapshot.mappings.departments.length
    )
      return yield* Result.fail(invalidSnapshot());

    if (
      snapshot.review.sourceRevision !== snapshot.sourceRevision ||
      snapshot.review.sourceWatermark !== snapshot.sourceWatermark
    )
      return yield* Result.fail(invalidReview());
    yield* validateOrganizationReview(snapshot.review, snapshot.occurrences);

    return snapshot;
  });
