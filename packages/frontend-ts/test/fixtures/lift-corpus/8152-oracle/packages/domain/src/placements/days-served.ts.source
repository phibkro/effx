/**
 * Days served: per assistant, department, and semester, the calculated count and the dated
 * evidence behind it, and the attributable confirmations of school coordination
 * (docs/system.md#certificates).
 *
 * A day served is one distinct service date (Europe/Oslo) per person, department, and semester.
 * Only two sources count: the attendance recorded at completed dated service, and accepted
 * legacy workday totals, which count as totals and never become dates.
 */
import { Effect, Encoding, Order, Result, Schema } from "effect";
import { DepartmentId, PersonId, SemesterId } from "../organization/schema.js";
import { SchoolId } from "../schools/schema.js";
import { canonicalJsonBytes, sha256Hex } from "../shared-kernel/canonical-json.js";
import { Rfc3339InstantSchema } from "../time.js";
import { CertificateInvalidCursor } from "./certificate-failures.js";
import { IsoServiceDate } from "./schema.js";

/** Fixed page size of the assistant lists. */
export const DAYS_SERVED_PAGE_SIZE = 50;

/** No semester has more days than a leap year. */
export const DAYS_SERVED_MAXIMUM = 366;

const NonNegativeInt = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

/** A confirmed number of days served in one semester, zero included. */
export const DaysServedTotal = Schema.Int.pipe(
  Schema.check(Schema.isBetween({ minimum: 0, maximum: DAYS_SERVED_MAXIMUM })),
);

export type DaysServedTotal = typeof DaysServedTotal.Type;

export const Sha256Digest = Schema.String.pipe(Schema.check(Schema.isPattern(/^[a-f0-9]{64}$/)));

export const DaysServedSchool = Schema.Struct({ schoolId: SchoolId, name: Schema.String });

export type DaysServedSchool = typeof DaysServedSchool.Type;

/** One distinct service date and the schools of the completed dated service attended on it. */
export const DaysServedDate = Schema.Struct({
  serviceDate: IsoServiceDate,
  schools: Schema.Array(DaysServedSchool),
});

/** An accepted legacy workday total, reconciled at import. It counts as a total, never as dates. */
export const LegacyWorkdayTotal = Schema.Struct({
  school: DaysServedSchool,
  workdays: Schema.Int.pipe(Schema.check(Schema.isBetween({ minimum: 1, maximum: 8 }))),
});

export type LegacyWorkdayTotal = typeof LegacyWorkdayTotal.Type;

export const DaysServedEvidence = Schema.Struct({
  dates: Schema.Array(DaysServedDate),
  legacyTotals: Schema.Array(LegacyWorkdayTotal),
});

export type DaysServedEvidence = typeof DaysServedEvidence.Type;

/** One attended completed dated service: the only attendance that counts. */
export interface CountedAttendance {
  readonly serviceDate: string;
  readonly school: DaysServedSchool;
}

const bySchool = Order.combine(
  Order.mapInput(Order.String, (school: DaysServedSchool) => school.name),
  Order.mapInput(Order.Number, (school: DaysServedSchool) => school.schoolId),
);

const uniqueSchools = (schools: Iterable<DaysServedSchool>): ReadonlyArray<DaysServedSchool> =>
  [...new Map([...schools].map((school) => [school.schoolId, school] as const)).values()].toSorted(
    bySchool,
  );

/**
 * The evidence of one person, department, and semester. Attendance on one date counts once,
 * however many blocks or commitments it covers; the date keeps every school of that day.
 */
export const daysServedEvidence = (
  attendance: ReadonlyArray<CountedAttendance>,
  legacyTotals: ReadonlyArray<LegacyWorkdayTotal>,
): DaysServedEvidence => {
  const byDate = new Map<string, Array<DaysServedSchool>>();

  for (const { serviceDate, school } of attendance) {
    const schools = byDate.get(serviceDate);

    if (schools === undefined) byDate.set(serviceDate, [school]);
    else schools.push(school);
  }

  return {
    dates: [...byDate.entries()]
      .map(([serviceDate, schools]) => ({ serviceDate, schools: uniqueSchools(schools) }))
      .toSorted(Order.mapInput(Order.String, (date) => date.serviceDate)),
    legacyTotals: legacyTotals.toSorted(
      Order.combine(
        Order.mapInput(bySchool, (total: LegacyWorkdayTotal) => total.school),
        Order.mapInput(Order.Number, (total: LegacyWorkdayTotal) => total.workdays),
      ),
    ),
  };
};

/** The calculated count: the distinct service dates plus the accepted legacy totals. */
export const calculatedDaysServed = (evidence: DaysServedEvidence): number =>
  evidence.dates.length +
  evidence.legacyTotals.reduce((total, legacy) => total + legacy.workdays, 0);

/** The schools that the evidence names, as a certificate lists them. */
export const evidenceSchools = (evidence: DaysServedEvidence): ReadonlyArray<DaysServedSchool> =>
  uniqueSchools([
    ...evidence.dates.flatMap((date) => date.schools),
    ...evidence.legacyTotals.map((legacy) => legacy.school),
  ]);

const encodeEvidence = Schema.encodeSync(DaysServedEvidence);

/** The digest of the evidence, so a precondition notices evidence that changed since a read. */
export const daysServedEvidenceSha256 = (evidence: DaysServedEvidence): string =>
  sha256Hex(canonicalJsonBytes(encodeEvidence(evidence)));

export const DaysServedConfirmationId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^days-served-confirmation-[a-f0-9]{64}$/)),
  Schema.brand("DaysServedConfirmationId"),
);

export type DaysServedConfirmationId = typeof DaysServedConfirmationId.Type;

/**
 * One attributable confirmation. A correction is a later confirmation with the next revision;
 * the earlier one stays as history.
 */
export const DaysServedConfirmation = Schema.Struct({
  confirmationId: DaysServedConfirmationId,
  revision: Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(1))),
  total: DaysServedTotal,
  calculated: NonNegativeInt,
  confirmedAt: Rfc3339InstantSchema,
  confirmedBy: PersonId,
  confirmedByName: Schema.String,
});

export type DaysServedConfirmation = typeof DaysServedConfirmation.Type;

/** One assistant in one department and semester: the evidence, its count, and the confirmation. */
export const DaysServedEntry = Schema.Struct({
  personId: PersonId,
  firstName: Schema.String,
  lastName: Schema.String,
  departmentId: DepartmentId,
  semesterId: SemesterId,
  evidence: DaysServedEvidence,
  calculated: NonNegativeInt,
  revision: NonNegativeInt,
  confirmation: Schema.NullOr(DaysServedConfirmation),
});

export type DaysServedEntry = typeof DaysServedEntry.Type;

/** The version that a confirmation's precondition compares: the revision and the evidence. */
export const daysServedEntryVersion = (entry: Pick<DaysServedEntry, "revision" | "evidence">) =>
  `${entry.revision}.${daysServedEvidenceSha256(entry.evidence)}`;

/** Confirms the calculated count, or adjusts it, for one assistant. */
export const ConfirmDaysServedCommand = Schema.Struct({
  commandId: Sha256Digest,
  departmentId: DepartmentId,
  semesterId: SemesterId,
  personId: PersonId,
  total: DaysServedTotal,
});

export type ConfirmDaysServedCommand = typeof ConfirmDaysServedCommand.Type;

/** Where an assistant list continues: the last listed name and person. */
export const AssistantCursorPosition = Schema.Struct({
  lastName: Schema.String,
  firstName: Schema.String,
  personId: PersonId,
});

export type AssistantCursorPosition = typeof AssistantCursorPosition.Type;

const CursorTuple = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Literal("assistant-v1"),
    AssistantCursorPosition.fields.lastName,
    AssistantCursorPosition.fields.firstName,
    AssistantCursorPosition.fields.personId,
  ]),
);

const encodeCursorTuple = Schema.encodeSync(CursorTuple);

/** Opaque continuation of a name-ordered assistant list. */
export const AssistantCursor = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2048),
    Schema.makeFilter((value) => /^[A-Za-z0-9+/]+={0,2}$/u.test(value)),
  ),
);

export const decodeAssistantCursor = (
  cursor: string,
): Effect.Effect<AssistantCursorPosition, CertificateInvalidCursor> =>
  Effect.gen(function* () {
    yield* Schema.decodeEffect(AssistantCursor)(cursor);

    const text = yield* Encoding.decodeBase64String(cursor).pipe(
      Result.match({ onSuccess: Effect.succeed, onFailure: Effect.fail }),
    );

    const [, lastName, firstName, personId] = yield* Schema.decodeEffect(CursorTuple)(text);

    return { lastName, firstName, personId };
  }).pipe(Effect.mapError(() => new CertificateInvalidCursor()));

export interface AssistantPage<A> {
  readonly items: ReadonlyArray<A>;
  readonly nextCursor?: string;
}

/** Keeps one page of rows read one past the page and names the continuation of the next. */
export const assistantPage = <A>(
  rows: ReadonlyArray<A>,
  position: (row: A) => AssistantCursorPosition,
): AssistantPage<A> => {
  const last = rows[DAYS_SERVED_PAGE_SIZE - 1];

  if (rows.length <= DAYS_SERVED_PAGE_SIZE || last === undefined) return { items: rows };

  const { lastName, firstName, personId } = position(last);

  return {
    items: rows.slice(0, DAYS_SERVED_PAGE_SIZE),
    nextCursor: Encoding.encodeBase64(
      encodeCursorTuple(["assistant-v1", lastName, firstName, personId]),
    ),
  };
};
