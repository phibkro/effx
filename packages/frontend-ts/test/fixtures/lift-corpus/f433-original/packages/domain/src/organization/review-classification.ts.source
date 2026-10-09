import { flow, Option, Predicate, Result, Schema } from "effect";
import { normalizeRfc3339Instant } from "../time.js";
import { canonicalJson } from "../shared-kernel/index.js";
import {
  importLegacyOrganization,
  type LegacyDepartmentRow,
  type OrganizationImportIdentities,
} from "./import.js";
import { Appointment, OrganizationLifecycleCommand, transitionAppointment } from "./lifecycle.js";
import { MembershipId, PersonId, type Membership } from "./schema.js";
import {
  organizationEvidenceDigest,
  reviewedOrganizationTargetId,
  type OrganizationSourceOccurrence,
  type ReviewedOrganizationSnapshot,
} from "./review.js";

export interface ReviewedOrganizationOccurrence {
  readonly occurrenceId: string;
  readonly result: "Accepted" | "Quarantined" | "Excluded";
  readonly reason: string;
  readonly targetId: string | null;
}

export interface ReviewedOrganizationAppointment {
  readonly occurrence: OrganizationSourceOccurrence;
  readonly membership: Membership;
  readonly boardId: string | null;
  readonly positionName: string | null;
  readonly sourceDigest: string;
}

const rawObject = flow(
  Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Json)),
  Option.getOrElse((): Record<string, Schema.Json> => ({})),
);

const integer = (value: Schema.Json): Schema.Json =>
  Predicate.isString(value) && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))
    ? Number(value)
    : value;

const flag = (value: Schema.Json): Schema.Json =>
  value === "0" || value === 0 ? false : value === "1" || value === 1 ? true : value;

/**
 * A legacy id as comparable text, so numeric and text ids compare alike. `String` prints every
 * composite JSON value as `[object Object]`, so a composite value keeps its canonical JSON.
 */
const idText = (value: Schema.Json | undefined): string =>
  Predicate.isString(value) ||
  Predicate.isNumber(value) ||
  Predicate.isBoolean(value) ||
  Predicate.isNullish(value)
    ? String(value)
    : canonicalJson(value);

const normalizeRow = (input: Schema.Json): Record<string, Schema.Json> =>
  Object.fromEntries(
    Object.entries(rawObject(input)).map(([key, value]) => [
      key,
      [
        "id",
        "userId",
        "departmentId",
        "teamId",
        "boardId",
        "positionId",
        "startSemesterId",
        "endSemesterId",
      ].includes(key)
        ? integer(value)
        : ["active", "isTeamLeader", "isLeader", "isSuspended", "isActive"].includes(key)
          ? flag(value)
          : value,
    ]),
  );

const NamedRow = Schema.Struct({
  id: Schema.Int,
  name: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(250), Schema.isPattern(/\S/)),
  ),
});

const BoardRow = Schema.Struct({
  id: Schema.Int,
  userId: Schema.Int,
  boardId: Schema.Int,
  positionName: Schema.NullOr(
    Schema.String.pipe(
      Schema.check(Schema.isMinLength(1), Schema.isMaxLength(250), Schema.isPattern(/\S/)),
    ),
  ),
});

const uniqueNamedRows = (rows: ReadonlyArray<Schema.Json>) => {
  const valid: Array<typeof NamedRow.Type> = [];
  const counts = new Map<number, number>();
  const decode = Schema.decodeUnknownOption(NamedRow);

  for (const raw of rows) {
    const row = decode(normalizeRow(raw));

    if (Option.isNone(row)) continue;
    valid.push(row.value);
    counts.set(row.value.id, (counts.get(row.value.id) ?? 0) + 1);
  }

  return valid.filter((row) => counts.get(row.id) === 1);
};

export const organizationOccurrenceSourceDigest = (
  snapshot: ReviewedOrganizationSnapshot,
  occurrence: OrganizationSourceOccurrence,
): string => {
  const row = rawObject(occurrence.row);

  const unit =
    (occurrence.sourceKind === "TeamMembership" ? snapshot.teams : snapshot.boards).find(
      (raw) =>
        idText(rawObject(raw).id) ===
        idText(occurrence.sourceKind === "TeamMembership" ? row.teamId : row.boardId),
    ) ?? null;

  const position =
    occurrence.sourceKind === "TeamMembership" && row.positionId != null
      ? (snapshot.positions.find((raw) => idText(rawObject(raw).id) === idText(row.positionId)) ??
        null)
      : null;

  const personMapping =
    snapshot.mappings.persons.find(
      (mapping) => mapping.sourceUserId === `legacy-user:${idText(row.userId)}`,
    ) ?? null;

  const departmentMapping =
    snapshot.mappings.departments.find(
      (mapping) =>
        mapping.sourceDepartmentId === `legacy-department:${idText(rawObject(unit).departmentId)}`,
    ) ?? null;

  return organizationEvidenceDigest({
    sourceKind: occurrence.sourceKind,
    sourceId: occurrence.sourceId,
    row: occurrence.row,
    sourceRowDigest: occurrence.sourceRowDigest,
    review:
      snapshot.review.memberships.find(
        (review) =>
          review.sourceKind === occurrence.sourceKind && review.sourceId === occurrence.sourceId,
      ) ?? null,
    asOf: snapshot.review.asOf,
    attestedBy: snapshot.review.attestedBy,
    evidenceRef: snapshot.review.evidenceRef,
    transformationRevision: snapshot.transformationRevision,
    personMapping,
    departmentMapping,
    unit,
    position,
  });
};

/** Accepted identity evidence is resolved before the shared classifier sees any membership. */
export const classifyReviewedOrganization = (
  snapshot: ReviewedOrganizationSnapshot,
  acceptedPersons: Readonly<Record<string, string>>,
  departments: ReadonlyArray<LegacyDepartmentRow>,
) => {
  const repo = snapshot.sourceRepository;

  const identities: OrganizationImportIdentities = {
    persons: acceptedPersons,
    departments: Object.fromEntries(
      snapshot.mappings.departments.map((row) => [
        row.sourceDepartmentId.replace(/^legacy-department:/, ""),
        row.departmentId,
      ]),
    ),
    teams: Object.fromEntries(
      snapshot.teams.map((raw) => [
        idText(rawObject(raw).id),
        reviewedOrganizationTargetId("Team", repo, idText(rawObject(raw).id)),
      ]),
    ),
    memberships: Object.fromEntries(
      snapshot.occurrences
        .filter((row) => row.sourceKind === "TeamMembership")
        .map((row) => [
          row.sourceId,
          reviewedOrganizationTargetId(row.sourceKind, repo, row.sourceId),
        ]),
    ),
    positions: Object.fromEntries(
      uniqueNamedRows(snapshot.positions).map((row) => [
        row.id,
        reviewedOrganizationTargetId("Position", repo, String(row.id)),
      ]),
    ),
  };

  const reviews = new Map(
    snapshot.review.memberships.map((row) => [canonicalJson([row.sourceKind, row.sourceId]), row]),
  );

  const positions = new Map(uniqueNamedRows(snapshot.positions).map((row) => [row.id, row.name]));

  const boards = uniqueNamedRows(snapshot.boards).map((row) => ({
    ...row,
    boardId: reviewedOrganizationTargetId("Board", repo, String(row.id)),
  }));

  const projected = snapshot.occurrences.map((occurrence) => {
    const review = reviews.get(canonicalJson([occurrence.sourceKind, occurrence.sourceId]))!;
    const row: Record<string, Schema.Json> = normalizeRow(occurrence.row);

    if (review.decision !== "Excluded") {
      row.startAt = review.startAt;
      row.endAt = review.endAt;
    }

    return { occurrence, review, row };
  });

  const eligibleTeam = projected.filter(
    (item) =>
      item.occurrence.sourceKind === "TeamMembership" &&
      item.review.decision !== "Excluded" &&
      idText(item.row.id) === item.occurrence.sourceId &&
      (item.review.decision === "Historical" ||
        (Predicate.isBoolean(item.row.isTeamLeader) && Predicate.isBoolean(item.row.isSuspended))),
  );

  const classified = importLegacyOrganization({
    ...snapshot,
    identities,
    departments: departments,
    teams: snapshot.teams.map((raw) => {
      const team = normalizeRow(raw);

      return { ...team, active: team.active ?? null };
    }),
    memberships: eligibleTeam.map((item) => item.row),
  });

  const memberships = new Map<string, Membership>(
    classified.memberships.map((row) => [row.membershipId, row]),
  );

  const outcomes: ReviewedOrganizationOccurrence[] = [];
  const appointments: ReviewedOrganizationAppointment[] = [];

  for (const item of projected) {
    const { occurrence, review, row } = item;
    const targetId = reviewedOrganizationTargetId(occurrence.sourceKind, repo, occurrence.sourceId);

    const reject = (reason: string) =>
      outcomes.push({
        occurrenceId: occurrence.occurrenceId,
        result: "Quarantined",
        reason,
        targetId: null,
      });

    if (review.decision === "Excluded") {
      outcomes.push({
        occurrenceId: occurrence.occurrenceId,
        result: "Excluded",
        reason: "Excluded",
        targetId: null,
      });
      continue;
    }

    if (
      idText(row.id) !== occurrence.sourceId ||
      !Predicate.isNumber(row.id) ||
      !Number.isSafeInteger(row.id) ||
      row.id <= 0 ||
      !Predicate.isNumber(row.userId) ||
      !Number.isSafeInteger(row.userId) ||
      row.userId <= 0
    ) {
      reject("InvalidRow");
      continue;
    }

    if (!acceptedPersons[String(row.userId)]) {
      reject("PersonReconciliationMissing");
      continue;
    }

    let membership: Membership | undefined;
    let boardId: string | null = null;
    let positionName: string | null = null;

    if (occurrence.sourceKind === "TeamMembership") {
      membership = memberships.get(targetId);

      if (!membership) {
        const reason = classified.ledger.find(
          (entry) =>
            entry.sourceKind === "membership" && entry.sourcePrimaryKey === occurrence.sourceId,
        )?.reason;

        reject(
          reason === "DUPLICATE_MEMBERSHIP"
            ? "DuplicateTarget"
            : reason === "TEAM_UNRESOLVED" || reason === "POSITION_UNRESOLVED"
              ? "ReferenceMissing"
              : "InvalidRow",
        );
        continue;
      }

      positionName =
        row.positionId == null ? null : (positions.get(Number(row.positionId)) ?? null);

      // Detached history has no native AppointmentTarget. MembershipInvariantSchema owns it.
      if (membership.teamId !== null) {
        const next = transitionAppointment(
          undefined,
          OrganizationLifecycleCommand.cases.Appoint.make({
            commandId: occurrence.occurrenceId,
            reason: review.evidenceRef,
            personId: membership.personId,
            target: { kind: "Team", id: membership.teamId },
            position: positionName,
            leadership: membership.isTeamLeader,
            startAt: membership.startAt,
            endAt: membership.endAt,
          }),
          targetId,
          snapshot.review.asOf,
        );

        if (Result.isFailure(next)) {
          reject("InvalidRow");
          continue;
        }
      }
    } else {
      const decoded = Schema.decodeUnknownOption(BoardRow)(row);

      if (Option.isNone(decoded)) {
        reject("InvalidRow");
        continue;
      }

      const board = boards.find((board) => board.id === decoded.value.boardId);

      if (!board) {
        reject("ReferenceMissing");
        continue;
      }

      boardId = board.boardId;
      positionName = decoded.value.positionName;

      const candidate = transitionAppointment(
        undefined,
        OrganizationLifecycleCommand.cases.Appoint.make({
          commandId: occurrence.occurrenceId,
          reason: review.evidenceRef,
          personId: PersonId.make(acceptedPersons[String(decoded.value.userId)]!),
          target: { kind: "NationalBoard", id: boardId },
          position: positionName,
          leadership: false,
          startAt: normalizeRfc3339Instant(review.startAt!),
          endAt: review.endAt === null ? null : normalizeRfc3339Instant(review.endAt!),
        }),
        targetId,
        snapshot.review.asOf,
      );

      if (
        Result.isFailure(candidate) ||
        Option.isNone(Schema.decodeOption(Appointment)(candidate.success))
      ) {
        reject("InvalidRow");
        continue;
      }

      const value = candidate.success;
      membership = {
        membershipId: MembershipId.make(targetId),
        personId: value.personId,
        teamId: null,
        deletedTeamName: null,
        positionId: null,
        startAt: value.startAt,
        endAt: value.endAt,
        isTeamLeader: false,
        isSuspended: false,
        revision: 0,
      };
    }

    const sourceDigest = organizationOccurrenceSourceDigest(snapshot, occurrence);
    appointments.push({ occurrence, membership, boardId, positionName, sourceDigest });
    outcomes.push({
      occurrenceId: occurrence.occurrenceId,
      result: "Accepted",
      reason: "Imported",
      targetId,
    });
  }

  const targets = new Map<string, number>();

  const semantic = (item: ReviewedOrganizationAppointment) =>
    canonicalJson([
      item.membership.personId,
      item.membership.teamId,
      item.boardId,
      item.membership.deletedTeamName,
      item.membership.startAt,
      item.boardId === null && item.membership.positionId !== null
        ? item.membership.positionId
        : item.positionName,
    ]);

  for (const item of appointments)
    targets.set(semantic(item), (targets.get(semantic(item)) ?? 0) + 1);

  const duplicates = new Set<string>();

  for (const item of appointments)
    if (targets.get(semantic(item))! > 1) duplicates.add(item.occurrence.occurrenceId);

  return {
    teams: classified.teams,
    boards,
    appointments: appointments.filter((item) => !duplicates.has(item.occurrence.occurrenceId)),
    outcomes: outcomes.map((item) =>
      duplicates.has(item.occurrenceId)
        ? { ...item, result: "Quarantined" as const, reason: "DuplicateTarget", targetId: null }
        : item,
    ),
  };
};
