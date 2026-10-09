/**
 * Certificates: one cumulative certificate per assistant and department. It lists every semester
 * of the department whose confirmed total is above zero, with the confirmed schools and days, and
 * it names the issuer and the seat that authorizes them (docs/system.md#certificates).
 */
import { Data, Option, Order, Schema } from "effect";
import { CertificateIssuer } from "../organization/board-roster.js";
import { DepartmentId, PersonId, SemesterId } from "../organization/schema.js";
import { canonicalJsonBytes, sha256Hex } from "../shared-kernel/canonical-json.js";
import { Rfc3339InstantSchema } from "../time.js";
import {
  DAYS_SERVED_MAXIMUM,
  DaysServedTotal,
  type DaysServedSchool,
  Sha256Digest,
} from "./days-served.js";
import { IsoServiceDate } from "./schema.js";

const NonNegativeInt = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

/** A reader resolved from the request credential at one instant. */
export interface CertificatePrincipal {
  readonly personId: PersonId;
  readonly authorizationInstant: string;
}

/** One semester on a certificate: its Oslo dates, the confirmed schools, and the confirmed days. */
export const CertificateSemester = Schema.Struct({
  semesterId: SemesterId,
  startsOn: IsoServiceDate,
  endsOn: IsoServiceDate,
  schools: Schema.Array(Schema.String),
  days: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ minimum: 1, maximum: DAYS_SERVED_MAXIMUM })),
  ),
});

export type CertificateSemester = typeof CertificateSemester.Type;

/** What a certificate states. Its digest is the content hash that every issue records. */
export const CertificateContent = Schema.Struct({
  personId: PersonId,
  assistantName: Schema.String,
  departmentId: DepartmentId,
  departmentName: Schema.String,
  semesters: Schema.Array(CertificateSemester).pipe(Schema.check(Schema.isMinLength(1))),
});

export type CertificateContent = typeof CertificateContent.Type;

/** One semester of an assistant in a department, as the certificate decision reads it. */
export interface SemesterService {
  readonly semesterId: SemesterId;
  readonly startsOn: string;
  readonly endsOn: string;
  /** The current confirmation: its total and the schools of the evidence it confirmed. */
  readonly confirmed: Option.Option<{
    readonly total: number;
    readonly schools: ReadonlyArray<DaysServedSchool>;
  }>;
  /** The calculated count of the current evidence. */
  readonly calculated: number;
}

/**
 * Whether a semester appears on the certificate. Only a confirmed total above zero does; a
 * confirmed zero is no service, and an unconfirmed semester is absent until it is confirmed.
 */
export const CertificateSemesterStatus = Schema.Struct({
  semesterId: SemesterId,
  startsOn: IsoServiceDate,
  endsOn: IsoServiceDate,
  status: Schema.Literals(["Included", "ConfirmedZero", "Unconfirmed"]),
  total: Schema.NullOr(DaysServedTotal),
  calculated: NonNegativeInt,
  schools: Schema.Array(Schema.String),
});

export type CertificateSemesterStatus = typeof CertificateSemesterStatus.Type;

const bySemester = Order.combine(
  Order.mapInput(Order.String, (service: SemesterService) => service.startsOn),
  Order.mapInput(Order.String, (service: SemesterService) => service.semesterId),
);

/** Every semester of the assistant in the department, oldest first, with its certificate status. */
export const certificateSemesterStatuses = (
  services: ReadonlyArray<SemesterService>,
): ReadonlyArray<CertificateSemesterStatus> =>
  services.toSorted(bySemester).map((service) =>
    Option.match(service.confirmed, {
      onNone: () => ({
        semesterId: service.semesterId,
        startsOn: service.startsOn,
        endsOn: service.endsOn,
        status: "Unconfirmed" as const,
        total: null,
        calculated: service.calculated,
        schools: [],
      }),
      onSome: ({ total, schools }) => ({
        semesterId: service.semesterId,
        startsOn: service.startsOn,
        endsOn: service.endsOn,
        status: total > 0 ? ("Included" as const) : ("ConfirmedZero" as const),
        total,
        calculated: service.calculated,
        schools: schools.map((school) => school.name),
      }),
    }),
  );

/**
 * The certificate of one assistant in one department: the included semesters only, each with its
 * confirmed total. None when no semester is included.
 */
export const certificateContent = (input: {
  readonly personId: PersonId;
  readonly assistantName: string;
  readonly departmentId: DepartmentId;
  readonly departmentName: string;
  readonly services: ReadonlyArray<SemesterService>;
}): Option.Option<CertificateContent> => {
  const semesters = certificateSemesterStatuses(input.services).flatMap((status) =>
    status.status === "Included" && status.total !== null
      ? [
          {
            semesterId: status.semesterId,
            startsOn: status.startsOn,
            endsOn: status.endsOn,
            schools: status.schools,
            days: status.total,
          },
        ]
      : [],
  );

  return semesters.length === 0
    ? Option.none()
    : Option.some({
        personId: input.personId,
        assistantName: input.assistantName,
        departmentId: input.departmentId,
        departmentName: input.departmentName,
        semesters,
      });
};

const encodeContent = Schema.encodeSync(CertificateContent);

/** The content hash: the same content always has the same hash, whoever issues it and when. */
export const certificateContentSha256 = (content: CertificateContent): string =>
  sha256Hex(canonicalJsonBytes(encodeContent(content)));

/** What the issuer sees before download: every semester's status and the certificate to issue. */
export const CertificatePreview = Schema.Struct({
  personId: PersonId,
  assistantName: Schema.String,
  departmentId: DepartmentId,
  departmentName: Schema.String,
  semesters: Schema.Array(CertificateSemesterStatus),
  content: Schema.NullOr(CertificateContent),
  contentSha256: Schema.NullOr(Sha256Digest),
  issuer: CertificateIssuer,
});

export type CertificatePreview = typeof CertificatePreview.Type;

export const CertificateIssueId = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^certificate-issue-[a-f0-9]{64}$/)),
  Schema.brand("CertificateIssueId"),
);

export type CertificateIssueId = typeof CertificateIssueId.Type;

/** One recorded issue: who issued which content, when, under which seat. */
export const CertificateIssue = Schema.Struct({
  issueId: CertificateIssueId,
  content: CertificateContent,
  contentSha256: Sha256Digest,
  issuedAt: Rfc3339InstantSchema,
  issuedOn: IsoServiceDate,
  issuer: CertificateIssuer,
});

export type CertificateIssue = typeof CertificateIssue.Type;

export const IssueCertificateCommand = Schema.Struct({
  commandId: Sha256Digest,
  departmentId: DepartmentId,
  personId: PersonId,
});

export type IssueCertificateCommand = typeof IssueCertificateCommand.Type;

/** One assistant with service facts in a department, and how many semesters a certificate lists. */
export const CertificateAssistant = Schema.Struct({
  personId: PersonId,
  firstName: Schema.String,
  lastName: Schema.String,
  includedSemesters: NonNegativeInt,
  unconfirmedSemesters: NonNegativeInt,
});

export type CertificateAssistant = typeof CertificateAssistant.Type;

/** The command whose authority a request resolves before a stored response can replay. */
export type CertificateCommandTarget = Data.TaggedEnum<{
  ConfirmDaysServed: { readonly departmentId: DepartmentId; readonly semesterId: SemesterId };
  IssueCertificate: { readonly departmentId: DepartmentId; readonly personId: PersonId };
}>;

export const CertificateCommandTarget = Data.taggedEnum<CertificateCommandTarget>();

/** A semester with its bounds, as the scope choice and the days-served list name it. */
export const CertificateSemesterScope = Schema.Struct({
  semesterId: SemesterId,
  startAt: Rfc3339InstantSchema,
  endAt: Rfc3339InstantSchema,
});

export type CertificateSemesterScope = typeof CertificateSemesterScope.Type;

/** The departments where the reader confirms days served or issues certificates, and the semesters. */
export const CertificateScopes = Schema.Struct({
  departments: Schema.Array(
    Schema.Struct({
      departmentId: DepartmentId,
      name: Schema.String,
      confirmDaysServed: Schema.Boolean,
      issueCertificates: Schema.Boolean,
    }),
  ),
  semesters: Schema.Array(CertificateSemesterScope),
});

export type CertificateScopes = typeof CertificateScopes.Type;
