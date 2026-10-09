import { Effect, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";
import { isRfc3339Instant } from "../time.js";
import { TeamApplicationInvalidCursor } from "./errors.js";
import { TeamApplicationId } from "./schema.js";

/** Fixed staff page size. */
export const TEAM_APPLICATION_PAGE_SIZE = 50;

const TeamApplicationCursorPosition = Schema.Struct({
  timestamp: Schema.String.pipe(
    Schema.check(
      Schema.makeFilter(
        (value) =>
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/u.test(value) &&
          isRfc3339Instant(`${value.slice(0, 23)}Z`),
      ),
    ),
  ),
  applicationId: TeamApplicationId,
});

export type TeamApplicationCursorPosition = typeof TeamApplicationCursorPosition.Type;

const CursorTuple = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Literal("team-application-v1"),
    TeamApplicationCursorPosition.fields.timestamp,
    TeamApplicationCursorPosition.fields.applicationId,
  ]),
);

/** Opaque continuation of the newest-first staff page order. */
export const TeamApplicationCursor = Schema.String.pipe(
  Schema.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(256),
    Schema.makeFilter((value) => /^[A-Za-z0-9+/]+={0,2}$/u.test(value)),
  ),
);

export type TeamApplicationPage<A> = {
  readonly items: ReadonlyArray<A>;
  readonly nextCursor?: string;
};

export const decodeTeamApplicationCursor = (
  cursor: string,
): Effect.Effect<TeamApplicationCursorPosition, TeamApplicationInvalidCursor> =>
  Effect.gen(function* () {
    yield* Schema.decodeEffect(TeamApplicationCursor)(cursor);

    const text = yield* Base64.decodeString(cursor).pipe(
      Result.match({ onSuccess: Effect.succeed, onFailure: Effect.fail }),
    );

    const [, timestamp, applicationId] = yield* Schema.decodeEffect(CursorTuple)(text);

    return { timestamp, applicationId };
  }).pipe(Effect.mapError(() => new TeamApplicationInvalidCursor()));

/** Keeps one page and encodes the last kept row when a further row was read. */
export const teamApplicationPage = <A>(
  rows: ReadonlyArray<A>,
  position: (row: A) => TeamApplicationCursorPosition,
): TeamApplicationPage<A> => {
  if (rows.length <= TEAM_APPLICATION_PAGE_SIZE) return { items: rows };

  const last = position(rows[TEAM_APPLICATION_PAGE_SIZE - 1]!);

  return {
    items: rows.slice(0, TEAM_APPLICATION_PAGE_SIZE),
    nextCursor: Base64.encode(
      JSON.stringify(["team-application-v1", last.timestamp, last.applicationId]),
    ),
  };
};
