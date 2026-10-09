import { Schema, Result, Array, Effect, type PlatformError } from "effect";
import { DomainFileSystem, joinPath, removeTree, writeTextFile } from "./runtime-services.js";
import {
  authorityFromEntries,
  buildDataset,
  DatasetInputError,
  loadDataset,
  loadPersonAuthority,
  type PersonAuthorityProjection,
  type RawDatasetInput,
} from "./data.js";
import { decodeDepartment, decodeTeam } from "./schema.js";
import {
  REASON_CODES,
  runSDep2Team,
  type LawStatus,
  type ReasonCode,
  type SDep2TeamResult,
} from "./laws.js";

export const FIXTURE_IDS = [
  "F-local-valid",
  "F-local-set-valued",
  "F-local-wrong",
  "F-local-null",
  "F-local-unresolved",
  "F-team-null",
  "F-team-dangling",
  "F-global-hovedstyret",
  "F-global-null",
  "F-global-dangling",
  "F-global-not-team",
  "F-zero-edges",
  "F-duplicate-targets",
  "F-input-decode",
  "F-input-missing",
] as const;

export type FixtureId = (typeof FIXTURE_IDS)[number];

export type FixtureStatus = LawStatus | "ERROR";

export interface FixtureObservation {
  readonly fixture: FixtureId;
  readonly expectedStatus: FixtureStatus;
  readonly observedStatus: FixtureStatus;
  readonly expectedReasonCodes: ReadonlyArray<ReasonCode>;
  readonly observedReasonCodes: ReadonlyArray<ReasonCode>;
  readonly checked: number;
  readonly violations: number;
  readonly relationCompleteness: "FULL" | "PARTIAL";
  readonly personCompleteness: "FULL" | "PARTIAL";
  readonly relation: SDep2TeamResult["relation"];
  readonly error?: { readonly code: string; readonly file: string };
  readonly passed: boolean;
}

interface FixtureDefinition {
  readonly id: FixtureId;
  readonly input?: RawDatasetInput;
  readonly personAuthority?: PersonAuthorityProjection;
  readonly expectedStatus: FixtureStatus;
  readonly expectedReasonCodes: ReadonlyArray<ReasonCode>;
  readonly predicate?: (result: SDep2TeamResult) => boolean;
  readonly runError?: () => Effect.Effect<
    DatasetInputError | undefined,
    PlatformError.PlatformError,
    DomainFileSystem
  >;
}

const input = (
  departments: ReadonlyArray<Schema.Json>,
  teams: ReadonlyArray<Schema.Json>,
  teamMemberships: ReadonlyArray<Schema.Json>,
  executiveBoards: ReadonlyArray<Schema.Json>,
  globalMemberships: ReadonlyArray<Schema.Json>,
): RawDatasetInput => ({ departments, teams, teamMemberships, executiveBoards, globalMemberships });

const localAuthority = (
  entries: ReadonlyArray<readonly [number, ReadonlyArray<number>]>,
): PersonAuthorityProjection => authorityFromEntries(entries);

const oneLocal = (
  departmentId: number | null = 10,
  userId = 1,
  teamId: number | null = 100,
): RawDatasetInput =>
  input(
    departmentId === null ? [{ id: 10 }] : [{ id: departmentId }],
    [{ id: 100, departmentId }],
    [{ id: 1, userId, teamId }],
    [],
    [],
  );

const fixtureDefinitions: ReadonlyArray<FixtureDefinition> = [
  {
    id: "F-local-valid",
    input: oneLocal(),
    personAuthority: localAuthority([[1, [10]]]),
    expectedStatus: "PASS",
    expectedReasonCodes: ["ACCEPT_LOCAL"],
    predicate: (result) =>
      result.relation.localAcceptedEdges === 1 &&
      result.relation.localMultiDepartmentUsers === 0 &&
      result.personCompleteness === "FULL",
  },
  {
    id: "F-local-set-valued",
    input: input(
      [{ id: 10 }, { id: 20 }],
      [
        { id: 100, departmentId: 10 },
        { id: 200, departmentId: 20 },
      ],
      [
        { id: 1, userId: 1, teamId: 100 },
        { id: 2, userId: 1, teamId: 200 },
      ],
      [],
      [],
    ),
    personAuthority: localAuthority([[1, [10, 20]]]),
    expectedStatus: "PASS",
    expectedReasonCodes: ["ACCEPT_LOCAL"],
    predicate: (result) =>
      result.relation.localAcceptedEdges === 2 &&
      result.relation.localMultiDepartmentUsers === 1 &&
      result.violations === 0 &&
      result.reasonCounts.LOCAL_DEPARTMENT_MISMATCH === 0,
  },
  {
    id: "F-local-wrong",
    input: oneLocal(10),
    personAuthority: localAuthority([[1, [20]]]),
    expectedStatus: "FAIL",
    expectedReasonCodes: ["ACCEPT_LOCAL", "LOCAL_DEPARTMENT_MISMATCH"],
    predicate: (result) =>
      result.relation.localAcceptedEdges === 1 && result.personComparison.mismatches === 1,
  },
  {
    id: "F-local-null",
    input: oneLocal(null),
    personAuthority: localAuthority([[1, []]]),
    expectedStatus: "FAIL",
    expectedReasonCodes: ["LOCAL_DEPARTMENT_NULL"],
    predicate: (result) => result.relation.localAcceptedEdges === 0,
  },
  {
    id: "F-local-unresolved",
    input: input(
      [{ id: 10 }],
      [{ id: 100, departmentId: 999999 }],
      [{ id: 1, userId: 1, teamId: 100 }],
      [],
      [],
    ),
    personAuthority: localAuthority([[1, []]]),
    expectedStatus: "FAIL",
    expectedReasonCodes: ["LOCAL_DEPARTMENT_UNRESOLVED"],
    predicate: (result) => result.relation.localAcceptedEdges === 0,
  },
  {
    id: "F-team-null",
    input: oneLocal(10, 1, null),
    personAuthority: localAuthority([[1, []]]),
    expectedStatus: "FAIL",
    expectedReasonCodes: ["TEAM_UNRESOLVED"],
    predicate: (result) => result.relation.localAcceptedEdges === 0,
  },
  {
    id: "F-team-dangling",
    input: input(
      [{ id: 10 }],
      [{ id: 100, departmentId: 10 }],
      [{ id: 1, userId: 1, teamId: 999999 }],
      [],
      [],
    ),
    personAuthority: localAuthority([[1, []]]),
    expectedStatus: "FAIL",
    expectedReasonCodes: ["TEAM_UNRESOLVED"],
    predicate: (result) => result.relation.localAcceptedEdges === 0,
  },
  {
    id: "F-global-hovedstyret",
    input: input([], [], [], [{ id: 700 }], [{ id: 1, userId: 1, boardId: 700 }]),
    personAuthority: localAuthority([[1, []]]),
    expectedStatus: "PASS",
    expectedReasonCodes: ["ACCEPT_GLOBAL"],
    predicate: (result) =>
      result.relation.globalAcceptedEdges === 1 &&
      result.relation.localAcceptedEdges === 0 &&
      result.relation.globalUsers === 1 &&
      result.relation.localUsers === 0,
  },
  {
    id: "F-global-null",
    input: input([], [], [], [{ id: 700 }], [{ id: 1, userId: 1, boardId: null }]),
    personAuthority: localAuthority([[1, []]]),
    expectedStatus: "FAIL",
    expectedReasonCodes: ["GLOBAL_UNRESOLVED"],
    predicate: (result) => result.relation.globalAcceptedEdges === 0,
  },
  {
    id: "F-global-dangling",
    input: input([], [], [], [{ id: 700 }], [{ id: 1, userId: 1, boardId: 999999 }]),
    personAuthority: localAuthority([[1, []]]),
    expectedStatus: "FAIL",
    expectedReasonCodes: ["GLOBAL_UNRESOLVED"],
    predicate: (result) => result.relation.globalAcceptedEdges === 0,
  },
  {
    id: "F-global-not-team",
    input: input(
      [{ id: 10 }],
      [{ id: 700, departmentId: 10 }],
      [{ id: 1, userId: 1, teamId: 700 }],
      [{ id: 700 }],
      [{ id: 2, userId: 1, boardId: 700 }],
    ),
    personAuthority: localAuthority([[1, [10]]]),
    expectedStatus: "PASS",
    expectedReasonCodes: ["ACCEPT_LOCAL", "ACCEPT_GLOBAL"],
    predicate: (result) =>
      result.relation.localAcceptedEdges === 1 &&
      result.relation.globalAcceptedEdges === 1 &&
      result.relation.globalUsersWithLocalMembership === 1 &&
      result.relation.localMultiDepartmentUsers === 0,
  },
  {
    id: "F-zero-edges",
    input: input([], [], [], [], []),
    personAuthority: localAuthority([]),
    expectedStatus: "INFO",
    expectedReasonCodes: [],
    predicate: (result) =>
      result.checked === 0 && result.relationCompleteness === "PARTIAL" && result.drift,
  },
  {
    id: "F-duplicate-targets",
    input: input(
      [{ id: 1 }, { id: 1 }, { id: 2 }],
      [
        { id: 5, departmentId: 2 },
        { id: 5, departmentId: 2 },
        { id: 6, departmentId: 1 },
      ],
      [
        { id: 1, userId: 1, teamId: 5 },
        { id: 2, userId: 2, teamId: 6 },
      ],
      [{ id: 9 }, { id: 9 }],
      [{ id: 3, userId: 3, boardId: 9 }],
    ),
    personAuthority: localAuthority([
      [1, []],
      [2, []],
      [3, []],
    ]),
    expectedStatus: "FAIL",
    expectedReasonCodes: [
      "TEAM_UNRESOLVED",
      "LOCAL_DEPARTMENT_UNRESOLVED",
      "GLOBAL_UNRESOLVED",
      "DUPLICATE_TEAM_ID",
      "DUPLICATE_DEPARTMENT_ID",
      "DUPLICATE_BOARD_ID",
    ],
    predicate: (result) => result.relationCompleteness === "PARTIAL" && result.drift,
  },
  {
    id: "F-input-decode",
    input: input(
      [{ id: 10 }],
      [
        { id: 100, departmentId: 1.5 },
        { id: 101, departmentId: 10, email: "not persisted" },
      ],
      [{ id: 1, userId: 1, teamId: 100 }],
      [],
      [],
    ),
    personAuthority: localAuthority([[1, []]]),
    expectedStatus: "FAIL",
    expectedReasonCodes: ["DECODE_FAILURE", "TEAM_UNRESOLVED"],
    predicate: (result) => {
      const teamFailureCodes = Array.filterMap(result.input.decodeFailures, (failure) =>
        failure.file === "team.json" ? Result.succeed(failure.code) : Result.failVoid,
      );

      const distinctCodes = new Set(teamFailureCodes);

      return (
        result.relationCompleteness === "PARTIAL" &&
        result.drift &&
        teamFailureCodes.length === 2 &&
        distinctCodes.size === 2 &&
        distinctCodes.has("INVALID_NULLABLE_INTEGER") &&
        distinctCodes.has("UNEXPECTED_FIELD")
      );
    },
  },
  {
    id: "F-input-missing",
    expectedStatus: "ERROR",
    expectedReasonCodes: [],
    runError: () =>
      Effect.acquireUseRelease(
        DomainFileSystem.use((fileSystem) =>
          fileSystem.makeTempDirectory("domain-f-input-missing-"),
        ),
        (directory) =>
          Effect.gen(function* () {
            const files = {
              "department.json": "[]",
              "team.json": "[]",
              "team_membership.json": "[]",
              "executive_board_membership.json": "[]",
            } satisfies Readonly<Record<string, string>>;

            for (const [file, contents] of Object.entries(files)) {
              const path = yield* joinPath(directory, file);
              yield* writeTextFile(path, contents);
            }

            return yield* loadDataset(directory).pipe(
              Effect.match({ onFailure: (error) => error, onSuccess: (): undefined => undefined }),
            );
          }),
        (directory) => removeTree(directory),
      ),
  },
];

const observedCodes = (result: SDep2TeamResult): ReadonlyArray<ReasonCode> =>
  REASON_CODES.filter((code) => result.reasonCounts[code] > 0);

const failedObservation = (
  fixture: FixtureDefinition,
  result: SDep2TeamResult | undefined,
  error: DatasetInputError | undefined,
): FixtureObservation => {
  const observedStatus: FixtureStatus = result?.status ?? "ERROR";
  const observedReasonCodes = result === undefined ? [] : observedCodes(result);
  const observedReasonSet = new Set(observedReasonCodes);
  const expectedReasonSet = new Set(fixture.expectedReasonCodes);

  const exactReasonCodes =
    observedReasonSet.size === observedReasonCodes.length &&
    expectedReasonSet.size === fixture.expectedReasonCodes.length &&
    observedReasonSet.size === expectedReasonSet.size &&
    [...observedReasonSet].every((code) => expectedReasonSet.has(code));

  const passed =
    observedStatus === fixture.expectedStatus &&
    exactReasonCodes &&
    (result === undefined
      ? error?.code === "MISSING_INPUT" && error.file === "executive_board.json"
      : (fixture.predicate?.(result) ?? true));

  return {
    fixture: fixture.id,
    expectedStatus: fixture.expectedStatus,
    observedStatus,
    expectedReasonCodes: fixture.expectedReasonCodes,
    observedReasonCodes,
    checked: result?.checked ?? 0,
    violations: result?.violations ?? 0,
    relationCompleteness: result?.relationCompleteness ?? "PARTIAL",
    personCompleteness: result?.personCompleteness ?? "PARTIAL",
    relation: result?.relation ?? {
      departments: 0,
      teams: 0,
      teamMemberships: 0,
      executiveBoards: 0,
      globalMemberships: 0,
      consideredEdges: 0,
      localAcceptedEdges: 0,
      globalAcceptedEdges: 0,
      localUsers: 0,
      localMultiDepartmentUsers: 0,
      globalUsers: 0,
      globalUsersWithLocalMembership: 0,
      globalUsersWithoutLocalMembership: 0,
    },
    error: error === undefined ? undefined : { code: error.code, file: error.file },
    passed,
  };
};

const assertBoundaryFixtures = (): Effect.Effect<
  void,
  PlatformError.PlatformError,
  DomainFileSystem
> =>
  Effect.gen(function* () {
    const unexpectedField = decodeDepartment({ id: 1, email: "not persisted" });

    if (unexpectedField.ok || unexpectedField.failure.code !== "UNEXPECTED_FIELD") {
      return yield* Effect.die(
        new Error("boundary fixture did not classify an excess field structurally"),
      );
    }

    const nullableNonInteger = decodeTeam({ id: 100, departmentId: 1.5 });

    if (nullableNonInteger.ok || nullableNonInteger.failure.code !== "INVALID_NULLABLE_INTEGER") {
      return yield* Effect.die(
        new Error("boundary fixture did not classify a nullable non-integer structurally"),
      );
    }

    yield* Effect.acquireUseRelease(
      DomainFileSystem.use((fileSystem) => fileSystem.makeTempDirectory("domain-schema-boundary-")),
      (directory) =>
        Effect.gen(function* () {
          const authorityPath = yield* joinPath(directory, "person-authority.json");

          const expectAuthorityFailure = (
            contents: string,
            expectedCode: string,
          ): Effect.Effect<void, never, DomainFileSystem> =>
            writeTextFile(authorityPath, contents).pipe(
              Effect.flatMap(() => loadPersonAuthority(authorityPath)),
              Effect.matchEffect({
                onFailure: (error) =>
                  error instanceof DatasetInputError && error.code === expectedCode
                    ? Effect.void
                    : Effect.die(new Error(`boundary fixture expected ${expectedCode}`)),
                onSuccess: () => Effect.die(new Error(`boundary fixture expected ${expectedCode}`)),
              }),
            );

          yield* expectAuthorityFailure("[", "INVALID_JSON");
          yield* expectAuthorityFailure(
            '[{"userId":1,"departmentIds":["not valid JSON"]}]',
            "INVALID_PERSON_AUTHORITY",
          );
        }),
      (directory) => removeTree(directory),
    );
  });

export const runSyntheticFixtures: Effect.Effect<
  ReadonlyArray<FixtureObservation>,
  PlatformError.PlatformError,
  DomainFileSystem
> = Effect.gen(function* () {
  yield* assertBoundaryFixtures();
  const observations: FixtureObservation[] = [];

  for (const fixture of fixtureDefinitions) {
    const runError = fixture.runError;

    if (runError !== undefined) {
      const error: DatasetInputError | undefined = yield* runError().pipe(
        Effect.catch((cause) =>
          Effect.succeed(
            cause instanceof DatasetInputError
              ? cause
              : new DatasetInputError({
                  code: "INVALID_ARGUMENT",
                  file: "fixture",
                  message: "INVALID_ARGUMENT:fixture",
                }),
          ),
        ),
      );

      observations.push(failedObservation(fixture, undefined, error));
      continue;
    }

    const input = fixture.input;

    if (input === undefined) {
      observations.push(failedObservation(fixture, undefined, undefined));
      continue;
    }

    const observation = buildDataset(input).pipe(
      Result.flatMap((dataset) =>
        Result.try({
          try: () =>
            failedObservation(
              fixture,
              runSDep2Team(dataset, {
                snapshotId: fixture.id,
                personAuthority: fixture.personAuthority,
              }),
              undefined,
            ),
          catch: () =>
            new DatasetInputError({
              code: "INVALID_ARGUMENT",
              file: "fixture",
              message: "INVALID_ARGUMENT:fixture",
            }),
        }),
      ),
      Result.getOrElse((safeError) => failedObservation(fixture, undefined, safeError)),
    );

    observations.push(observation);
  }

  return observations;
});

export const allFixturesPass = (observations: ReadonlyArray<FixtureObservation>): boolean =>
  observations.length === FIXTURE_IDS.length &&
  observations.every((observation) => observation.passed);
