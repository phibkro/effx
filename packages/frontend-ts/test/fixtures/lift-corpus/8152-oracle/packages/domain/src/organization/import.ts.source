import { flow, Match, Array, Predicate, Effect, Schema } from "effect";
import { canonicalJson, sha256Hex } from "../shared-kernel/index.js";
import { normalizeRfc3339Instant } from "../time.js";
import {
  Department,
  DepartmentId,
  Membership,
  MembershipInvariantSchema,
  MembershipId,
  PersonId,
  PositionId,
  SemesterId,
  Team,
  TeamId,
  isRfc3339,
} from "./schema.js";
import { OrganizationImportError } from "./errors.js";

const BooleanFlag = Schema.Union([Schema.Boolean, Schema.Literals([0, 1])]);

const OptionalBooleanFlag = Schema.optional(BooleanFlag);

const OptionalNullableInteger = Schema.optional(Schema.NullOr(Schema.Int));

const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String));

export const LegacyDepartmentRowSchema = Schema.Struct({
  id: Schema.Int,
  name: Schema.optional(Schema.String),
  shortName: Schema.optional(Schema.String),
  email: Schema.optional(Schema.String),
  address: Schema.optional(Schema.NullOr(Schema.String)),
  city: Schema.optional(Schema.String),
  latitude: Schema.optional(Schema.NullOr(Schema.String)),
  longitude: Schema.optional(Schema.NullOr(Schema.String)),
  slackChannel: Schema.optional(Schema.NullOr(Schema.String)),
  logoPath: Schema.optional(Schema.NullOr(Schema.String)),
  active: Schema.optional(Schema.Boolean),
});

export type LegacyDepartmentRow = typeof LegacyDepartmentRowSchema.Type;

export const LegacyTeamRowSchema = Schema.Struct({
  id: Schema.Int,
  departmentId: Schema.NullOr(Schema.Int),
  name: Schema.optional(Schema.String),
  email: Schema.optional(Schema.NullOr(Schema.String)),
  description: Schema.optional(Schema.NullOr(Schema.String)),
  shortDescription: Schema.optional(Schema.NullOr(Schema.String)),
  acceptApplication: Schema.optional(Schema.NullOr(Schema.Boolean)),
  deadline: Schema.optional(Schema.NullOr(Schema.String)),
  active: Schema.optional(Schema.Boolean),
});

export type LegacyTeamRow = typeof LegacyTeamRowSchema.Type;

export const LegacyMembershipRowSchema = Schema.Struct({
  id: Schema.Int,
  userId: Schema.Int,
  teamId: Schema.NullOr(Schema.Int),
  deletedTeamName: OptionalNullableString,
  startAt: Schema.optional(Schema.String),
  endAt: Schema.optional(Schema.NullOr(Schema.String)),
  startSemesterId: OptionalNullableInteger,
  endSemesterId: OptionalNullableInteger,
  positionId: OptionalNullableInteger,
  isTeamLeader: OptionalBooleanFlag,
  isLeader: OptionalBooleanFlag,
  isSuspended: OptionalBooleanFlag,
  isActive: OptionalBooleanFlag,
});

export type LegacyMembershipRow = typeof LegacyMembershipRowSchema.Type;

export interface LegacyOrganizationSnapshot {
  readonly identities: OrganizationImportIdentities;
  readonly sourceRepository: string;
  readonly sourceRevision: string;
  readonly snapshotId: string;
  readonly transformationRevision: string;
  readonly departments: ReadonlyArray<Schema.Json>;
  readonly teams: ReadonlyArray<Schema.Json>;
  readonly memberships: ReadonlyArray<Schema.Json>;
}

export interface OrganizationImportIdentities {
  readonly persons: Readonly<Record<string, string>>;
  readonly departments: Readonly<Record<string, string>>;
  readonly teams: Readonly<Record<string, string>>;
  readonly memberships: Readonly<Record<string, string>>;
  readonly positions: Readonly<Record<string, string>>;
}

export const ORGANIZATION_IMPORT_REASONS = [
  "IDENTITY_UNRESOLVED",
  "PERSON_UNRESOLVED",
  "POSITION_UNRESOLVED",
  "INVALID_AUTHORITY_FLAGS",
  "DECODE_FAILURE",
  "MISSING_DEPARTMENT_FIELD",
  "MISSING_TEAM_FIELD",
  "DEPARTMENT_UNRESOLVED",
  "DUPLICATE_DEPARTMENT",
  "DUPLICATE_TEAM",
  "DUPLICATE_MEMBERSHIP",
  "TEAM_UNRESOLVED",
  "MISSING_TEMPORAL_INTERVAL",
  "DESTINATION_IDENTITY_COLLISION",
  "INVALID_TEMPORAL_INTERVAL",
  "NULL_TEAM_WITHOUT_HISTORICAL_NAME",
  "LIVE_TEAM_WITH_HISTORICAL_NAME",
  "INVALID_TEAM_DEADLINE",
] as const;

export type OrganizationImportReason = (typeof ORGANIZATION_IMPORT_REASONS)[number];

export interface OrganizationQuarantine {
  readonly sourceKind: "department" | "team" | "membership";
  readonly sourcePrimaryKey: string;
  readonly sourceOccurrence: number;
  readonly targetSemanticIdentity: string;
  readonly reason: OrganizationImportReason;
  readonly raw: Schema.Json;
}

export interface LegacyMembershipSourceMetadata {
  readonly startSemesterId: number | null;
  readonly endSemesterId: number | null;
}

export interface OrganizationImportLedgerEntry {
  readonly sourceRepository: string;
  readonly sourceRevision: string;
  readonly sourceKind: OrganizationQuarantine["sourceKind"];
  readonly snapshotId: string;
  readonly sourceOccurrence: number;
  readonly sourceRaw: Schema.Json;
  readonly sourcePrimaryKey: string;
  readonly transformationRevision: string;
  readonly targetSemanticIdentity: string;
  readonly destinationIdentity: string | null;
  readonly result: "Accepted" | "Quarantined";
  readonly reason: OrganizationImportReason | null;
  readonly sourceMetadata: LegacyMembershipSourceMetadata | null;
}

export interface OrganizationImportResult {
  readonly departments: ReadonlyArray<Department>;
  readonly teams: ReadonlyArray<Team>;
  readonly memberships: ReadonlyArray<Membership>;
  readonly quarantined: ReadonlyArray<OrganizationQuarantine>;
  readonly ledger: ReadonlyArray<OrganizationImportLedgerEntry>;
}

const encodeDepartment = Schema.encodeSync(Department);

const encodeTeam = Schema.encodeSync(Team);

const encodeMembership = Schema.encodeSync(Membership);

/** The result with its models encoded, so digests and byte comparisons see stored values. */
export const encodedOrganizationImportResult = (result: OrganizationImportResult) => ({
  ...result,
  departments: result.departments.map((department) => encodeDepartment(department)),
  teams: result.teams.map((team) => encodeTeam(team)),
  memberships: result.memberships.map((membership) => encodeMembership(membership)),
});

type DecodeOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly message: string };

const decode = <A>(
  schema: Schema.ConstraintDecoder<A, never>,
  input: Schema.Json,
): DecodeOutcome<A> => {
  try {
    return {
      ok: true,
      value: Schema.decodeSync(schema)(input, { onExcessProperty: "error" }),
    };
  } catch (cause) {
    return { ok: false, message: String(cause) };
  }
};

const nonEmpty = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim().length > 0;

const bool = (value: boolean | 0 | 1 | undefined, fallback: boolean): boolean =>
  value === undefined ? fallback : value === true || value === 1;

const canonicalInstant = normalizeRfc3339Instant;

const safeCanonicalRaw = Match.type<unknown>().pipe(
  Match.when(Predicate.isUndefined, () => "unsupported:undefined"),
  Match.when(Predicate.isBigInt, (raw) => `unsupported:bigint:${raw.toString()}`),
  Match.when(Predicate.isSymbol, (raw) => `unsupported:symbol:${raw.description ?? ""}`),
  Match.when(Predicate.isFunction, (raw) => `unsupported:function:${raw.name}`),
  Match.orElse((raw) => {
    try {
      return `json:${canonicalJson(raw)}`;
    } catch {
      return `unsupported:${Object.prototype.toString.call(raw)}`;
    }
  }),
);

const rawEvidence = flow(
  safeCanonicalRaw,
  (encoded): Schema.Json =>
    encoded.startsWith("json:") ? JSON.parse(encoded.slice(5)) : { unsupported: encoded },
);

const unknownSourcePrimaryKey = (raw: Schema.Json, occurrences: Map<string, number>): string => {
  const digest = sha256Hex(new TextEncoder().encode(safeCanonicalRaw(raw)));
  const occurrence = occurrences.get(digest) ?? 0;
  occurrences.set(digest, occurrence + 1);

  return `unknown:${digest}:${occurrence}`;
};

const orderedRaw = (rows: ReadonlyArray<Schema.Json>): ReadonlyArray<Schema.Json> =>
  [...rows].sort((left, right) => safeCanonicalRaw(left).localeCompare(safeCanonicalRaw(right)));

const sourceId = (value: number): string => String(value);

const legacyMembershipSourceMetadata = (
  raw: Schema.Json,
): LegacyMembershipSourceMetadata | null => {
  if (!Predicate.isObjectOrArray(raw)) return null;

  return {
    startSemesterId:
      Predicate.hasProperty(raw, "startSemesterId") &&
      Predicate.isNumber(raw.startSemesterId) &&
      Number.isInteger(raw.startSemesterId)
        ? raw.startSemesterId
        : null,
    endSemesterId:
      Predicate.hasProperty(raw, "endSemesterId") &&
      Predicate.isNumber(raw.endSemesterId) &&
      Number.isInteger(raw.endSemesterId)
        ? raw.endSemesterId
        : null,
  };
};

const quarantine = (
  output: {
    readonly quarantined: OrganizationQuarantine[];
    readonly ledger: OrganizationImportLedgerEntry[];
  },
  snapshot: LegacyOrganizationSnapshot,
  sourceKind: OrganizationQuarantine["sourceKind"],
  sourcePrimaryKey: string,
  targetSemanticIdentity: string,
  reason: OrganizationImportReason,
  raw: Schema.Json,
  sourceOccurrence = 0,
): void => {
  output.quarantined.push({
    sourceKind,
    sourcePrimaryKey,
    sourceOccurrence,
    targetSemanticIdentity,
    reason,
    raw: rawEvidence(raw),
  });
  output.ledger.push({
    sourceRepository: snapshot.sourceRepository,
    sourceRevision: snapshot.sourceRevision,
    snapshotId: snapshot.snapshotId,
    sourceKind,
    sourcePrimaryKey,
    sourceOccurrence,
    sourceRaw: rawEvidence(raw),
    transformationRevision: snapshot.transformationRevision,
    targetSemanticIdentity,
    destinationIdentity: null,
    result: "Quarantined",
    reason,
    sourceMetadata: sourceKind === "membership" ? legacyMembershipSourceMetadata(raw) : null,
  });
};

const accepted = (
  output: { readonly ledger: OrganizationImportLedgerEntry[] },
  snapshot: LegacyOrganizationSnapshot,
  sourceKind: OrganizationQuarantine["sourceKind"],
  sourcePrimaryKey: string,
  targetSemanticIdentity: string,
  destinationIdentity: string,
  sourceRaw: Schema.Json,
  sourceMetadata: LegacyMembershipSourceMetadata | null = null,
  sourceOccurrence = 0,
): void => {
  output.ledger.push({
    sourceRepository: snapshot.sourceRepository,
    sourceRevision: snapshot.sourceRevision,
    snapshotId: snapshot.snapshotId,
    sourceKind,
    sourcePrimaryKey,
    sourceOccurrence,
    sourceRaw: rawEvidence(sourceRaw),
    transformationRevision: snapshot.transformationRevision,
    targetSemanticIdentity,
    destinationIdentity,
    result: "Accepted",
    reason: null,
    sourceMetadata,
  });
};

const departmentFromLegacy = (
  row: LegacyDepartmentRow,
  identities: OrganizationImportIdentities,
): Department | undefined => {
  if (
    !nonEmpty(row.name) ||
    !nonEmpty(row.shortName) ||
    !nonEmpty(row.email) ||
    !nonEmpty(row.city)
  ) {
    return undefined;
  }

  const candidate = {
    departmentId: DepartmentId.make(identities.departments[sourceId(row.id)]!),
    name: row.name,
    shortName: row.shortName,
    email: row.email,
    address: row.address ?? null,
    city: row.city,
    latitude: row.latitude ?? null,
    longitude: row.longitude ?? null,
    slackChannel: row.slackChannel ?? null,
    logoPath: row.logoPath ?? null,
    active: row.active ?? true,
    revision: 0,
  };

  const decoded = decode(Department, candidate);

  return decoded.ok ? decoded.value : undefined;
};

const teamFromLegacy = (
  row: LegacyTeamRow,
  departments: ReadonlySet<number>,
  identities: OrganizationImportIdentities,
) => {
  if (row.departmentId === null || !departments.has(row.departmentId) || !nonEmpty(row.name)) {
    return { reason: "MISSING_TEAM_FIELD" as const };
  }

  if (row.deadline !== undefined && row.deadline !== null && !isRfc3339(row.deadline)) {
    return { reason: "INVALID_TEAM_DEADLINE" as const };
  }

  const candidate = {
    teamId: TeamId.make(identities.teams[sourceId(row.id)]!),
    departmentId: DepartmentId.make(identities.departments[sourceId(row.departmentId)]!),
    name: row.name,
    email: row.email ?? null,
    description: row.description ?? null,
    shortDescription: row.shortDescription ?? null,
    acceptApplication: row.acceptApplication ?? null,
    deadline:
      row.deadline === null || row.deadline === undefined ? null : canonicalInstant(row.deadline),
    active: row.active ?? true,
    revision: 0,
  };

  const decoded = decode(Team, candidate);

  return decoded.ok ? { team: decoded.value } : { reason: "MISSING_TEAM_FIELD" as const };
};

const membershipFromLegacy = (
  row: LegacyMembershipRow,
  teams: ReadonlySet<number>,
  identities: OrganizationImportIdentities,
) => {
  if (!identities.persons[sourceId(row.userId)]) return { reason: "PERSON_UNRESOLVED" as const };

  if (!identities.memberships[sourceId(row.id)]) return { reason: "IDENTITY_UNRESOLVED" as const };

  if (row.positionId != null && !identities.positions[sourceId(row.positionId)])
    return { reason: "POSITION_UNRESOLVED" as const };

  if (
    row.isTeamLeader !== undefined &&
    row.isLeader !== undefined &&
    bool(row.isTeamLeader, false) !== bool(row.isLeader, false)
  )
    return { reason: "INVALID_AUTHORITY_FLAGS" as const };

  if (row.startAt === undefined || row.startAt.length === 0) {
    return { reason: "MISSING_TEMPORAL_INTERVAL" as const };
  }

  if (
    !isRfc3339(row.startAt) ||
    (row.endAt !== null && row.endAt !== undefined && !isRfc3339(row.endAt))
  ) {
    return { reason: "INVALID_TEMPORAL_INTERVAL" as const };
  }

  const legacyTeamId = row.teamId;
  const teamId = legacyTeamId === null ? null : (identities.teams[sourceId(legacyTeamId)] ?? null);

  if (legacyTeamId !== null && (!teams.has(legacyTeamId) || !teamId))
    return { reason: "TEAM_UNRESOLVED" as const };
  const deletedTeamName = row.deletedTeamName ?? null;

  if (teamId === null && !nonEmpty(deletedTeamName)) {
    return { reason: "NULL_TEAM_WITHOUT_HISTORICAL_NAME" as const };
  }

  if (teamId !== null && deletedTeamName !== null) {
    return { reason: "LIVE_TEAM_WITH_HISTORICAL_NAME" as const };
  }

  const candidate = {
    membershipId: MembershipId.make(identities.memberships[sourceId(row.id)]!),
    personId: PersonId.make(identities.persons[sourceId(row.userId)]!),
    teamId,
    deletedTeamName,
    startAt: canonicalInstant(row.startAt),
    endAt: row.endAt === null || row.endAt === undefined ? null : canonicalInstant(row.endAt),
    positionId:
      row.positionId === null || row.positionId === undefined
        ? null
        : PositionId.make(identities.positions[sourceId(row.positionId)]!),
    isTeamLeader: bool(row.isTeamLeader ?? row.isLeader, false),
    isSuspended: bool(row.isSuspended, false),
    revision: 0,
  };

  const decoded = decode(MembershipInvariantSchema, candidate);

  return decoded.ok
    ? { membership: decoded.value }
    : { reason: "INVALID_TEMPORAL_INTERVAL" as const };
};

export const importLegacyOrganization = (
  snapshot: LegacyOrganizationSnapshot,
): OrganizationImportResult => {
  const output = {
    departments: Array.empty<Department>(),
    teams: Array.empty<Team>(),
    memberships: Array.empty<Membership>(),
    quarantined: Array.empty<OrganizationQuarantine>(),
    ledger: Array.empty<OrganizationImportLedgerEntry>(),
  };

  const orderedDepartments = orderedRaw(snapshot.departments);
  const departmentIdCounts = new Map<number, number>();

  for (const raw of orderedDepartments) {
    const decoded = decode(LegacyDepartmentRowSchema, raw);

    if (decoded.ok) {
      departmentIdCounts.set(decoded.value.id, (departmentIdCounts.get(decoded.value.id) ?? 0) + 1);
    }
  }

  const unknownDepartmentOccurrences = new Map<string, number>();
  const departmentIdOccurrences = new Map<number, number>();
  const acceptedDepartmentIds = new Set<number>();

  for (const raw of orderedDepartments) {
    const decoded = decode(LegacyDepartmentRowSchema, raw);

    const sourcePrimaryKey = decoded.ok
      ? sourceId(decoded.value.id)
      : unknownSourcePrimaryKey(raw, unknownDepartmentOccurrences);

    if (!decoded.ok) {
      quarantine(
        output,
        snapshot,
        "department",
        sourcePrimaryKey,
        `department:${sourcePrimaryKey}`,
        "DECODE_FAILURE",
        raw,
      );
      continue;
    }

    const target = `department:${sourcePrimaryKey}`;
    const sourceOccurrence = departmentIdOccurrences.get(decoded.value.id) ?? 0;
    departmentIdOccurrences.set(decoded.value.id, sourceOccurrence + 1);

    if ((departmentIdCounts.get(decoded.value.id) ?? 0) > 1) {
      quarantine(
        output,
        snapshot,
        "department",
        sourcePrimaryKey,
        target,
        "DUPLICATE_DEPARTMENT",
        raw,
        sourceOccurrence,
      );
      continue;
    }

    if (!snapshot.identities.departments[sourcePrimaryKey]) {
      quarantine(
        output,
        snapshot,
        "department",
        sourcePrimaryKey,
        target,
        "IDENTITY_UNRESOLVED",
        raw,
      );
      continue;
    }

    const department = departmentFromLegacy(decoded.value, snapshot.identities);

    if (department === undefined) {
      quarantine(
        output,
        snapshot,
        "department",
        sourcePrimaryKey,
        target,
        "MISSING_DEPARTMENT_FIELD",
        raw,
      );
      continue;
    }

    acceptedDepartmentIds.add(decoded.value.id);
    output.departments.push(department);
    accepted(
      output,
      snapshot,
      "department",
      sourcePrimaryKey,
      target,
      department.departmentId,
      raw,
    );
  }

  const orderedTeams = orderedRaw(snapshot.teams);
  const teamIdCounts = new Map<number, number>();

  for (const raw of orderedTeams) {
    const decoded = decode(LegacyTeamRowSchema, raw);

    if (decoded.ok) {
      teamIdCounts.set(decoded.value.id, (teamIdCounts.get(decoded.value.id) ?? 0) + 1);
    }
  }

  const unknownTeamOccurrences = new Map<string, number>();
  const teamIdOccurrences = new Map<number, number>();
  const acceptedTeamIds = new Set<number>();

  for (const raw of orderedTeams) {
    const decoded = decode(LegacyTeamRowSchema, raw);

    const sourcePrimaryKey = decoded.ok
      ? sourceId(decoded.value.id)
      : unknownSourcePrimaryKey(raw, unknownTeamOccurrences);

    if (!decoded.ok) {
      quarantine(
        output,
        snapshot,
        "team",
        sourcePrimaryKey,
        `team:${sourcePrimaryKey}`,
        "DECODE_FAILURE",
        raw,
      );
      continue;
    }

    const target = `team:${sourcePrimaryKey}`;
    const sourceOccurrence = teamIdOccurrences.get(decoded.value.id) ?? 0;
    teamIdOccurrences.set(decoded.value.id, sourceOccurrence + 1);

    if ((teamIdCounts.get(decoded.value.id) ?? 0) > 1) {
      quarantine(
        output,
        snapshot,
        "team",
        sourcePrimaryKey,
        target,
        "DUPLICATE_TEAM",
        raw,
        sourceOccurrence,
      );
      continue;
    }

    if (
      decoded.value.departmentId !== null &&
      !acceptedDepartmentIds.has(decoded.value.departmentId)
    ) {
      quarantine(output, snapshot, "team", sourcePrimaryKey, target, "DEPARTMENT_UNRESOLVED", raw);
      continue;
    }

    if (!snapshot.identities.teams[sourcePrimaryKey]) {
      quarantine(output, snapshot, "team", sourcePrimaryKey, target, "IDENTITY_UNRESOLVED", raw);
      continue;
    }

    const teamDecision = teamFromLegacy(decoded.value, acceptedDepartmentIds, snapshot.identities);

    if (teamDecision.team === undefined) {
      quarantine(
        output,
        snapshot,
        "team",
        sourcePrimaryKey,
        target,
        teamDecision.reason ?? "MISSING_TEAM_FIELD",
        raw,
      );
      continue;
    }

    const team = teamDecision.team;
    acceptedTeamIds.add(decoded.value.id);
    output.teams.push(team);
    accepted(output, snapshot, "team", sourcePrimaryKey, target, team.teamId, raw);
  }

  const membershipRows: Array<{ readonly row: LegacyMembershipRow; readonly raw: Schema.Json }> =
    [];

  const unknownMembershipOccurrences = new Map<string, number>();

  for (const raw of orderedRaw(snapshot.memberships)) {
    const decoded = decode(LegacyMembershipRowSchema, raw);

    if (!decoded.ok) {
      const sourcePrimaryKey = unknownSourcePrimaryKey(raw, unknownMembershipOccurrences);
      quarantine(
        output,
        snapshot,
        "membership",
        sourcePrimaryKey,
        `membership:${sourcePrimaryKey}`,
        "DECODE_FAILURE",
        raw,
      );
      continue;
    }

    membershipRows.push({ row: decoded.value, raw });
  }

  membershipRows.sort(
    (left, right) =>
      left.row.id - right.row.id ||
      safeCanonicalRaw(left.raw).localeCompare(safeCanonicalRaw(right.raw)),
  );
  const membershipSourceIdCounts = new Map<number, number>();
  const membershipSemanticIdentityCounts = new Map<string, number>();

  const semanticIdentityOf = (row: LegacyMembershipRow): string => {
    const position =
      row.positionId === null || row.positionId === undefined
        ? "null"
        : (snapshot.identities.positions[sourceId(row.positionId)] ??
          `unresolved:${row.positionId}`);

    const team =
      row.teamId === null
        ? `historical:${row.deletedTeamName ?? "null"}`
        : (snapshot.identities.teams[sourceId(row.teamId)] ?? `unresolved:${row.teamId}`);

    const startAt =
      row.startAt === undefined || !isRfc3339(row.startAt)
        ? "missing"
        : canonicalInstant(row.startAt);

    return canonicalJson([
      snapshot.identities.persons[sourceId(row.userId)] ?? `unresolved:${row.userId}`,
      team,
      startAt,
      position,
    ]);
  };

  for (const { row } of membershipRows) {
    membershipSourceIdCounts.set(row.id, (membershipSourceIdCounts.get(row.id) ?? 0) + 1);
    const semanticIdentity = semanticIdentityOf(row);
    membershipSemanticIdentityCounts.set(
      semanticIdentity,
      (membershipSemanticIdentityCounts.get(semanticIdentity) ?? 0) + 1,
    );
  }

  const membershipSourceIdOccurrences = new Map<number, number>();

  for (const { row, raw } of membershipRows) {
    const sourcePrimaryKey = sourceId(row.id);
    const sourceOccurrence = membershipSourceIdOccurrences.get(row.id) ?? 0;
    membershipSourceIdOccurrences.set(row.id, sourceOccurrence + 1);
    const semanticIdentity = semanticIdentityOf(row);

    if (
      (membershipSourceIdCounts.get(row.id) ?? 0) > 1 ||
      (membershipSemanticIdentityCounts.get(semanticIdentity) ?? 0) > 1
    ) {
      quarantine(
        output,
        snapshot,
        "membership",
        sourcePrimaryKey,
        semanticIdentity,
        "DUPLICATE_MEMBERSHIP",
        raw,
        sourceOccurrence,
      );
      continue;
    }

    const decision = membershipFromLegacy(row, acceptedTeamIds, snapshot.identities);

    if (decision.membership === undefined) {
      quarantine(
        output,
        snapshot,
        "membership",
        sourcePrimaryKey,
        semanticIdentity,
        decision.reason ?? "DECODE_FAILURE",
        raw,
      );
      continue;
    }

    output.memberships.push(decision.membership);
    accepted(
      output,
      snapshot,
      "membership",
      sourcePrimaryKey,
      semanticIdentity,
      decision.membership.membershipId,
      raw,
      legacyMembershipSourceMetadata(raw),
    );
  }

  return output;
};

export const importLegacyOrganizationEffect = (
  snapshot: LegacyOrganizationSnapshot,
): Effect.Effect<OrganizationImportResult, OrganizationImportError> =>
  Effect.try({
    try: () => importLegacyOrganization(snapshot),
    catch: (cause) =>
      new OrganizationImportError({
        operation: "import legacy organization",
        message: String(cause),
      }),
  });

export const legacySemesterId = (value: number): SemesterId => SemesterId.make(sourceId(value));
