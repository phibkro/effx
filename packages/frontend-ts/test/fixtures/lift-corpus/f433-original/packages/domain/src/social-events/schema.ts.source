import { Schema } from "effect";
import { DepartmentId, PersonId, SemesterId } from "../organization/schema.js";
import { compareRfc3339Instants, Rfc3339InstantSchema } from "../time.js";

const TrimmedNonEmpty = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value.trim() === value, {
      message: "a trimmed non-empty string",
    }),
  ),
);

const RevisionZero = Schema.Literal(0);

type EventTimes = {
  readonly startAt: string;
  readonly endAt: string;
};

const orderedEventTimes = Schema.makeFilter(
  (value: EventTimes) => compareRfc3339Instants(value.endAt, value.startAt) >= 0,
  { message: "an end time at or after the start time" },
);

const orderedSemesterTimes = Schema.makeFilter(
  (value: EventTimes) => compareRfc3339Instants(value.endAt, value.startAt) > 0,
  { message: "a semester end time after the start time" },
);

/** Opaque server-issued social-event identity. */
export const SocialEventId = Schema.NonEmptyString.pipe(Schema.brand("SocialEventId"));

export type SocialEventId = typeof SocialEventId.Type;

/** Native HTTP-derived command identity retained by social-event provenance. */
export const SocialEventCommandId = TrimmedNonEmpty.pipe(Schema.brand("SocialEventCommandId"));

export type SocialEventCommandId = typeof SocialEventCommandId.Type;

export const SocialEventAudience = Schema.Literals(["TeamMembers", "AssistantsAndTeamMembers"]);

export type SocialEventAudience = typeof SocialEventAudience.Type;

const SocialEventTitle = Schema.String.pipe(
  Schema.check(
    Schema.makeFilter((value) => value.length > 0 && value.trim() === value, {
      message: "a trimmed non-empty title",
    }),
    Schema.isMaxLength(255),
  ),
);

const SocialEventDescription = Schema.String.pipe(Schema.check(Schema.isMaxLength(5_000)));

const SocialEventLink = Schema.NullOr(
  Schema.String.pipe(
    Schema.check(
      Schema.makeFilter((value) => value.trim() === value, { message: "a trimmed link" }),
      Schema.isMaxLength(250),
    ),
  ),
);

const SocialEventRequestFields = {
  departmentId: DepartmentId,
  semesterId: SemesterId,
  audience: SocialEventAudience,
  title: SocialEventTitle,
  description: SocialEventDescription,
  link: SocialEventLink,
  startAt: Rfc3339InstantSchema,
  endAt: Rfc3339InstantSchema,
} as const;

/** Strict external create body; the server issues identity and revision. */
export const CreateSocialEventRequest = Schema.Struct(SocialEventRequestFields)
  .pipe(Schema.check(orderedEventTimes))
  .annotate({ identifier: "CreateSocialEventRequest" });

export type CreateSocialEventRequest = typeof CreateSocialEventRequest.Type;

/** Canonical, immutable initial social-event representation. */
export const SocialEventResource = Schema.Struct({
  eventId: SocialEventId,
  revision: RevisionZero,
  ...SocialEventRequestFields,
})
  .pipe(Schema.check(orderedEventTimes))
  .annotate({ identifier: "SocialEventResource" });

export type SocialEventResource = typeof SocialEventResource.Type;

export const SocialEventScope = Schema.Struct({
  departmentId: DepartmentId,
  semesterId: SemesterId,
}).annotate({ identifier: "SocialEventScope" });

export type SocialEventScope = typeof SocialEventScope.Type;

export const SocialEventObservedAt = Rfc3339InstantSchema.pipe(
  Schema.brand("SocialEventObservedAt"),
);

export type SocialEventObservedAt = typeof SocialEventObservedAt.Type;

export const SocialEventDepartmentResource = Schema.Struct({
  departmentId: DepartmentId,
  name: Schema.String,
});

export type SocialEventDepartmentResource = typeof SocialEventDepartmentResource.Type;

export const SocialEventSemesterResource = Schema.Struct({
  semesterId: SemesterId,
  startAt: Rfc3339InstantSchema,
  endAt: Rfc3339InstantSchema,
}).pipe(Schema.check(orderedSemesterTimes));

export type SocialEventSemesterResource = typeof SocialEventSemesterResource.Type;

export const SocialEventScopeResource = Schema.Struct({
  observedAt: SocialEventObservedAt,
  departments: Schema.Array(SocialEventDepartmentResource),
  semesters: Schema.Array(SocialEventSemesterResource),
}).annotate({ identifier: "SocialEventScopeResource" });

export type SocialEventScopeResource = typeof SocialEventScopeResource.Type;

export const SocialEventListResource = Schema.Struct({
  observedAt: SocialEventObservedAt,
  departmentId: DepartmentId,
  semesterId: SemesterId,
  events: Schema.Array(SocialEventResource),
}).annotate({ identifier: "SocialEventListResource" });

export type SocialEventListResource = typeof SocialEventListResource.Type;

/** Caller-owned transaction input for one first-accepted create command. */
export const CreateSocialEventCommand = Schema.Struct({
  commandId: SocialEventCommandId,
  actorPersonId: PersonId,
  occurredAt: Rfc3339InstantSchema,
  eventId: SocialEventId,
  request: CreateSocialEventRequest,
}).annotate({ identifier: "CreateSocialEventCommand" });

export type CreateSocialEventCommand = typeof CreateSocialEventCommand.Type;
