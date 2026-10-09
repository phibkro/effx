import { Array, Record } from "effect";
import type { Dataset, PersonAuthorityProjection } from "./data.js";

export const LAW_ID = "S-DEP-2-TEAM" as const;

export const LAW_STATEMENT =
  "Every retained TeamMembership resolves through Team.department to a local Department, while every retained ExecutiveBoardMembership resolves through the separate Global Hovedstyret container." as const;

const reasonDefaults = {
  ACCEPT_LOCAL: 0,
  ACCEPT_GLOBAL: 0,
  TEAM_UNRESOLVED: 0,
  LOCAL_DEPARTMENT_NULL: 0,
  LOCAL_DEPARTMENT_UNRESOLVED: 0,
  GLOBAL_UNRESOLVED: 0,
  LOCAL_DEPARTMENT_MISMATCH: 0,
  DECODE_FAILURE: 0,
  DUPLICATE_DEPARTMENT_ID: 0,
  DUPLICATE_TEAM_ID: 0,
  DUPLICATE_BOARD_ID: 0,
  PERSON_AUTHORITY_UNAVAILABLE: 0,
  PERSON_AUTHORITY_MISSING: 0,
};

export const REASON_CODES = Record.keys(reasonDefaults);

export type ReasonCode = (typeof REASON_CODES)[number];

export type LawStatus = "PASS" | "FAIL" | "INFO";

export type Completeness = "FULL" | "PARTIAL";

export interface TechnicalSample {
  readonly source: "team_membership" | "executive_board_membership";
  readonly id: number;
}

export interface RelationCounts {
  readonly departments: number;
  readonly teams: number;
  readonly teamMemberships: number;
  readonly executiveBoards: number;
  readonly globalMemberships: number;
  readonly consideredEdges: number;
  readonly localAcceptedEdges: number;
  readonly globalAcceptedEdges: number;
  readonly localUsers: number;
  readonly localMultiDepartmentUsers: number;
  readonly globalUsers: number;
  readonly globalUsersWithLocalMembership: number;
  readonly globalUsersWithoutLocalMembership: number;
}

export interface PersonComparison {
  readonly status: "FULL" | "PARTIAL" | "UNAVAILABLE";
  readonly checkedUsers: number;
  readonly missingUsers: number;
  readonly mismatches: number;
}

export interface SDep2TeamResult {
  readonly lawId: typeof LAW_ID;
  readonly statement: typeof LAW_STATEMENT;
  readonly status: LawStatus;
  readonly relationCompleteness: Completeness;
  readonly personCompleteness: Completeness;
  readonly personComparison: PersonComparison;
  readonly checked: number;
  readonly violations: number;
  readonly drift: boolean;
  readonly reasonCounts: Readonly<Record<ReasonCode, number>>;
  readonly reasonSamples: Readonly<Record<ReasonCode, ReadonlyArray<TechnicalSample>>>;
  readonly samples: ReadonlyArray<TechnicalSample>;
  readonly relation: RelationCounts;
  readonly provenance: {
    readonly snapshot: string;
    readonly hash?: string;
    readonly files: ReadonlyArray<string>;
    readonly tables: ReadonlyArray<string>;
    readonly scope: { readonly team: "Local"; readonly executiveBoard: "Global" };
    readonly pii: "none";
  };
  readonly input: Dataset["input"];
}

export interface SDep2TeamOptions {
  readonly snapshotId?: string;
  readonly snapshotHash?: string;
  readonly personAuthority?: PersonAuthorityProjection;
}

const createReasonCounts = () => ({ ...reasonDefaults });

const createReasonSamples = () => Record.map(reasonDefaults, () => Array.empty<TechnicalSample>());

const increment = (counts: Record<ReasonCode, number>, code: ReasonCode): void => {
  counts[code] += 1;
};

const addSample = (
  samples: Record<ReasonCode, TechnicalSample[]>,
  allSamples: TechnicalSample[],
  code: ReasonCode,
  sample: TechnicalSample,
): void => {
  const reasonSamples = samples[code];

  if (reasonSamples.length < 3) reasonSamples.push(sample);

  if (
    allSamples.length < 20 &&
    !allSamples.some((item) => item.source === sample.source && item.id === sample.id)
  ) {
    allSamples.push(sample);
  }
};

const sourceFiles = [
  "team_membership.json→team.json→department.json",
  "executive_board_membership.json→executive_board.json",
] as const;

export const runSDep2Team = (dataset: Dataset, options: SDep2TeamOptions = {}): SDep2TeamResult => {
  const reasonCounts = createReasonCounts();
  const reasonSamples = createReasonSamples();
  const allSamples: TechnicalSample[] = [];
  const localDepartmentsByUser = new Map<number, Set<number>>();
  const globalUsers = new Set<number>();
  let localAcceptedEdges = 0;
  let globalAcceptedEdges = 0;
  let violations = 0;
  let personMissing = 0;
  let personMismatches = 0;
  const checkedUsers = new Set<number>();

  dataset.decodeFailures.forEach(() => {
    increment(reasonCounts, "DECODE_FAILURE");
  });

  const recordRelationFailure = (code: ReasonCode, sample: TechnicalSample): void => {
    increment(reasonCounts, code);
    addSample(reasonSamples, allSamples, code, sample);
    violations += 1;
  };

  const recordRelationSuccess = (
    code: "ACCEPT_LOCAL" | "ACCEPT_GLOBAL",
    sample: TechnicalSample,
  ): void => {
    increment(reasonCounts, code);
    addSample(reasonSamples, allSamples, code, sample);
  };

  for (const membership of dataset.teamMemberships) {
    const sample: TechnicalSample = { source: "team_membership", id: membership.id };
    const teamId = membership.teamId;

    if (teamId === null) {
      recordRelationFailure("TEAM_UNRESOLVED", sample);
      continue;
    }

    if (dataset.duplicateIds.teams.includes(teamId)) {
      increment(reasonCounts, "DUPLICATE_TEAM_ID");
      addSample(reasonSamples, allSamples, "DUPLICATE_TEAM_ID", sample);
      recordRelationFailure("TEAM_UNRESOLVED", sample);
      continue;
    }

    const team = dataset.teamById.get(teamId);

    if (team === undefined) {
      recordRelationFailure("TEAM_UNRESOLVED", sample);
      continue;
    }

    const departmentId = team.departmentId;

    if (departmentId === null) {
      recordRelationFailure("LOCAL_DEPARTMENT_NULL", sample);
      continue;
    }

    if (dataset.duplicateIds.departments.includes(departmentId)) {
      increment(reasonCounts, "DUPLICATE_DEPARTMENT_ID");
      addSample(reasonSamples, allSamples, "DUPLICATE_DEPARTMENT_ID", sample);
      recordRelationFailure("LOCAL_DEPARTMENT_UNRESOLVED", sample);
      continue;
    }

    if (!dataset.departmentById.has(departmentId)) {
      recordRelationFailure("LOCAL_DEPARTMENT_UNRESOLVED", sample);
      continue;
    }

    recordRelationSuccess("ACCEPT_LOCAL", sample);
    localAcceptedEdges += 1;
    const departmentSet = localDepartmentsByUser.get(membership.userId) ?? new Set<number>();
    departmentSet.add(departmentId);
    localDepartmentsByUser.set(membership.userId, departmentSet);
    checkedUsers.add(membership.userId);

    if (options.personAuthority === undefined) {
      continue;
    }

    const authorized = options.personAuthority.departmentIdsByUser.get(membership.userId);

    if (authorized === undefined) {
      personMissing += 1;
      increment(reasonCounts, "PERSON_AUTHORITY_MISSING");
      addSample(reasonSamples, allSamples, "PERSON_AUTHORITY_MISSING", sample);
      continue;
    }

    if (!authorized.has(departmentId)) {
      personMismatches += 1;
      increment(reasonCounts, "LOCAL_DEPARTMENT_MISMATCH");
      addSample(reasonSamples, allSamples, "LOCAL_DEPARTMENT_MISMATCH", sample);
      violations += 1;
    }
  }

  for (const membership of dataset.globalMemberships) {
    const sample: TechnicalSample = { source: "executive_board_membership", id: membership.id };
    const boardId = membership.boardId;

    if (boardId === null) {
      recordRelationFailure("GLOBAL_UNRESOLVED", sample);
      continue;
    }

    if (dataset.duplicateIds.executiveBoards.includes(boardId)) {
      increment(reasonCounts, "DUPLICATE_BOARD_ID");
      addSample(reasonSamples, allSamples, "DUPLICATE_BOARD_ID", sample);
      recordRelationFailure("GLOBAL_UNRESOLVED", sample);
      continue;
    }

    if (!dataset.executiveBoardById.has(boardId)) {
      recordRelationFailure("GLOBAL_UNRESOLVED", sample);
      continue;
    }

    recordRelationSuccess("ACCEPT_GLOBAL", sample);
    globalAcceptedEdges += 1;
    globalUsers.add(membership.userId);
  }

  if (options.personAuthority === undefined) {
    increment(reasonCounts, "PERSON_AUTHORITY_UNAVAILABLE");
  }

  const localUsers = new Set(localDepartmentsByUser.keys());

  const localMultiDepartmentUsers = [...localDepartmentsByUser.values()].filter(
    (departments) => departments.size > 1,
  ).length;

  const globalUsersWithLocalMembership = [...globalUsers].filter((userId) =>
    localUsers.has(userId),
  ).length;

  const globalUsersWithoutLocalMembership = globalUsers.size - globalUsersWithLocalMembership;
  const checked = dataset.teamMemberships.length + dataset.globalMemberships.length;

  const unresolvedCoverage =
    reasonCounts.TEAM_UNRESOLVED > 0 ||
    reasonCounts.LOCAL_DEPARTMENT_NULL > 0 ||
    reasonCounts.LOCAL_DEPARTMENT_UNRESOLVED > 0 ||
    reasonCounts.GLOBAL_UNRESOLVED > 0;

  const relationCompleteness: Completeness =
    dataset.decodeFailures.length === 0 &&
    dataset.duplicateIds.departments.length === 0 &&
    dataset.duplicateIds.teams.length === 0 &&
    dataset.duplicateIds.executiveBoards.length === 0 &&
    !unresolvedCoverage &&
    checked > 0
      ? "FULL"
      : "PARTIAL";

  const personCompleteness: Completeness =
    options.personAuthority === undefined || personMissing > 0 ? "PARTIAL" : "FULL";

  const personStatus: PersonComparison["status"] =
    options.personAuthority === undefined ? "UNAVAILABLE" : personCompleteness;

  const status: LawStatus =
    violations > 0
      ? "FAIL"
      : relationCompleteness === "FULL" && personCompleteness === "FULL"
        ? "PASS"
        : "INFO";

  const drift = status !== "PASS";

  let provenance: SDep2TeamResult["provenance"] = {
    snapshot: options.snapshotId ?? "unspecified",
    files: sourceFiles,
    tables: [
      "team_membership.team_id→team.department_id→department.id",
      "executive_board_membership.board_id→executive_board.id",
    ],
    scope: { team: "Local", executiveBoard: "Global" },
    pii: "none",
  };

  if (options.snapshotHash !== undefined)
    provenance = { ...provenance, hash: options.snapshotHash };

  return {
    lawId: LAW_ID,
    statement: LAW_STATEMENT,
    status,
    relationCompleteness,
    personCompleteness,
    personComparison: {
      status: personStatus,
      checkedUsers: checkedUsers.size,
      missingUsers: personMissing,
      mismatches: personMismatches,
    },
    checked,
    violations,
    drift,
    reasonCounts,
    reasonSamples: reasonSamples,
    samples: allSamples,
    relation: {
      departments: dataset.departments.length,
      teams: dataset.teams.length,
      teamMemberships: dataset.teamMemberships.length,
      executiveBoards: dataset.executiveBoards.length,
      globalMemberships: dataset.globalMemberships.length,
      consideredEdges: checked,
      localAcceptedEdges,
      globalAcceptedEdges,
      localUsers: localUsers.size,
      localMultiDepartmentUsers,
      globalUsers: globalUsers.size,
      globalUsersWithLocalMembership,
      globalUsersWithoutLocalMembership,
    },
    provenance,
    input: dataset.input,
  };
};
