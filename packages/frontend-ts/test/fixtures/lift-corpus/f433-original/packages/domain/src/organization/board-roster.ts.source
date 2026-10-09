/**
 * The rosters of the boards that issue certificates: Styret of an independent department and
 * Hovedstyret. A roster lists the appointed seats and the seats that current team leadership
 * derives, as of the request instant. The derived seats are a projection, never stored.
 */
import { Data, Schema } from "effect";
import { Rfc3339InstantSchema } from "../time.js";
import { AppointmentTarget } from "./lifecycle.js";
import { DepartmentId, PersonId, TeamId } from "./schema.js";

const Text = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(250), Schema.isPattern(/\S/)),
);

/** One seat on a board: an appointment on the board, or a seat derived from a team leadership. */
export const BoardRosterSeat = Schema.TaggedUnion({
  AppointedSeat: {
    personId: PersonId,
    name: Text,
    appointmentId: Text,
    position: Schema.NullOr(Text),
  },
  DerivedSeat: {
    personId: PersonId,
    name: Text,
    sourceAppointmentId: Text,
    sourceTeamId: TeamId,
    sourceTeamName: Text,
  },
});

export type BoardRosterSeat = typeof BoardRosterSeat.Type;

export const BoardRoster = Schema.Struct({
  target: AppointmentTarget,
  name: Text,
  departmentId: Schema.NullOr(DepartmentId),
  seats: Schema.Array(BoardRosterSeat),
});

export type BoardRoster = typeof BoardRoster.Type;

/** The rosters of the certificate-issuing boards that the reader can already read. */
export const BoardRosters = Schema.Struct({
  evaluatedAt: Rfc3339InstantSchema,
  boards: Schema.Array(BoardRoster),
});

export type BoardRosters = typeof BoardRosters.Type;

/** What authorizes an issuer: an appointed seat, a derived seat, or the global-administrator grant. */
export const IssuerBasisKind = Schema.Literals(["BoardSeat", "DerivedSeat", "GlobalAdministrator"]);

export type IssuerBasisKind = typeof IssuerBasisKind.Type;

const SeatTitle = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(600), Schema.isPattern(/\S/)),
);

/** The issuer as a certificate prints them: their name and the title of the authorizing seat. */
export const CertificateIssuer = Schema.Struct({
  personId: PersonId,
  name: Text,
  seatTitle: SeatTitle,
  basis: IssuerBasisKind,
});

export type CertificateIssuer = typeof CertificateIssuer.Type;

/** The facts of the authorizing seat that its title names. */
export type IssuerSeatFacts = Data.TaggedEnum<{
  BoardSeat: { readonly position: string | null; readonly boardName: string };
  DerivedSeat: { readonly position: string | null; readonly teamName: string };
  GlobalAdministrator: {};
}>;

export const IssuerSeatFacts = Data.taggedEnum<IssuerSeatFacts>();

/**
 * The title that a certificate prints under the issuer's name: the position and board of an
 * appointed seat, the leadership and team of a derived seat, or the global-administrator grant.
 */
export const issuerSeatTitle = (facts: IssuerSeatFacts): string =>
  IssuerSeatFacts.$match(facts, {
    BoardSeat: ({ position, boardName }) => `${position ?? "Styremedlem"}, ${boardName}`,
    DerivedSeat: ({ position, teamName }) => `${position ?? "Leder"}, ${teamName}`,
    GlobalAdministrator: () => "Global administrator",
  });
