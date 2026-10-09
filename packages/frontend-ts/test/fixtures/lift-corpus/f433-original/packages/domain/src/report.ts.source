import { Record, Result, Array } from "effect";
import type { Dataset, DatasetInputSummary } from "./data.js";
import {
  REASON_CODES,
  type ReasonCode,
  type SDep2TeamResult,
  type TechnicalSample,
} from "./laws.js";

export interface DecodeFailureSummary {
  readonly file: string;
  readonly code: string;
  readonly count: number;
}

export interface ReportInputSummary extends Omit<DatasetInputSummary, "decodeFailures"> {
  readonly decodeFailures: ReadonlyArray<DecodeFailureSummary>;
}

export interface MachineReport extends Omit<SDep2TeamResult, "input"> {
  readonly formatVersion: "S-DEP-2-TEAM/v2";
  readonly input: ReportInputSummary;
}

const sourceLabel = (sample: TechnicalSample): string => `${sample.source}:${sample.id}`;

type ReasonCountsView = Pick<SDep2TeamResult, "reasonCounts">;

type ReasonSamplesView = Pick<SDep2TeamResult, "reasonSamples">;

const countRows = (result: ReasonCountsView): string =>
  Array.filterMap(REASON_CODES, (code) =>
    result.reasonCounts[code] > 0
      ? Result.succeed(`${code}=${result.reasonCounts[code]}`)
      : Result.failVoid,
  ).join(", ") || "none";

const samplesFor = (result: ReasonSamplesView, code: ReasonCode): string => {
  const samples = result.reasonSamples[code];

  return samples.length === 0 ? "none" : samples.map(sourceLabel).join(", ");
};

const summarizeDecodeFailures = (
  input: DatasetInputSummary,
): ReadonlyArray<DecodeFailureSummary> => {
  const counts = new Map<string, DecodeFailureSummary>();

  for (const failure of input.decodeFailures) {
    const key = `${failure.file}\u0000${failure.code}`;
    const current = counts.get(key);

    if (current === undefined) {
      counts.set(key, { file: failure.file, code: failure.code, count: 1 });
    } else {
      counts.set(key, { ...current, count: current.count + 1 });
    }
  }

  return [...counts.values()].sort(
    (left, right) => left.file.localeCompare(right.file) || left.code.localeCompare(right.code),
  );
};

const boundedReasonSamples = (
  result: ReasonSamplesView,
): Readonly<Record<ReasonCode, ReadonlyArray<TechnicalSample>>> =>
  Record.map(result.reasonSamples, (samples) => samples.slice(0, 3));

export const createMachineReport = (result: SDep2TeamResult): MachineReport => ({
  ...result,
  input: {
    files: result.input.files,
    decodeFailures: summarizeDecodeFailures(result.input),
    duplicateIds: result.input.duplicateIds,
  },
  formatVersion: "S-DEP-2-TEAM/v2",
  samples: result.samples.slice(0, 20),
  reasonSamples: boundedReasonSamples(result),
});

export const renderMarkdown = (report: MachineReport): string => {
  const lines = [
    `# ${report.lawId} conformance report`,
    "",
    `- **Status:** ${report.status}`,
    `- **Relation completeness:** ${report.relationCompleteness}`,
    `- **Person-authority completeness:** ${report.personCompleteness}`,
    `- **Checked edges:** ${report.checked}`,
    `- **Violations:** ${report.violations}`,
    `- **Drift:** ${report.drift}`,
    "",
    "## Provenance",
    "",
    `- Snapshot: \`${report.provenance.snapshot}\``,
    `- Files: ${report.provenance.files.join("; ")}`,
    `- Tables: ${report.provenance.tables.join("; ")}`,
    `- Scope: Team=${report.provenance.scope.team}; ExecutiveBoard=${report.provenance.scope.executiveBoard}`,
    `- PII boundary: ${report.provenance.pii}`,
    "",
    "## Relation counts",
    "",
    `- Departments: ${report.relation.departments}`,
    `- Teams: ${report.relation.teams}`,
    `- Team memberships: ${report.relation.teamMemberships}`,
    `- Accepted local edges: ${report.relation.localAcceptedEdges}`,
    `- Executive boards: ${report.relation.executiveBoards}`,
    `- Global memberships: ${report.relation.globalMemberships}`,
    `- Accepted global edges: ${report.relation.globalAcceptedEdges}`,
    `- Local users: ${report.relation.localUsers}`,
    `- Local multi-department users: ${report.relation.localMultiDepartmentUsers}`,
    `- Global users: ${report.relation.globalUsers}`,
    `- Global users also local: ${report.relation.globalUsersWithLocalMembership}`,
    `- Global users without local membership: ${report.relation.globalUsersWithoutLocalMembership}`,
    "",
    "## Person-authority comparison",
    "",
    `- Status: ${report.personComparison.status}`,
    `- Checked users: ${report.personComparison.checkedUsers}`,
    `- Missing authority users: ${report.personComparison.missingUsers}`,
    `- Mismatches: ${report.personComparison.mismatches}`,
    "",
    "## Reason counts",
    "",
    `- ${countRows(report)}`,
    "",
    "## Bounded technical samples",
    "",
    report.samples.length === 0
      ? "- none"
      : report.samples.map((sample) => `- ${sourceLabel(sample)}`).join("\n"),
    "",
    "## Reason sample IDs",
    "",
    ...Array.filterMap(REASON_CODES, (code) =>
      report.reasonCounts[code] > 0
        ? Result.succeed(`- ${code}: ${samplesFor(report, code)}`)
        : Result.failVoid,
    ),
    "",
    "## Input boundary",
    "",
    `- Files: ${report.input.files.map((file) => `${file.file}(${file.rows})`).join(", ")}`,
    `- Decode failures: ${
      report.input.decodeFailures
        .map(({ file, code, count }) => `${file}:${code}(${count})`)
        .join(", ") || "none"
    }`,
    `- Duplicate departments: ${report.input.duplicateIds.departments.length}`,
    `- Duplicate teams: ${report.input.duplicateIds.teams.length}`,
    `- Duplicate global boards: ${report.input.duplicateIds.executiveBoards.length}`,
    "",
    "The report contains aggregate counts, provenance, and bounded source-qualified technical row IDs only; no person-affiliation mapping is serialized.",
    "",
  ];

  return lines.join("\n");
};

export const reportForDataset = (dataset: Dataset, result: SDep2TeamResult): MachineReport =>
  createMachineReport({ ...result, input: dataset.input });
