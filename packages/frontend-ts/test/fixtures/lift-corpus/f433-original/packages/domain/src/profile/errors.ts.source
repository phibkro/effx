import { Schema } from "effect";
import { PersonId } from "../organization/schema.js";
import { ProfileCommandId } from "./schema.js";

export class ProfileDecodeError extends Schema.TaggedError<ProfileDecodeError>()(
  "ProfileDecodeError",
  { message: Schema.String },
) {}

export class ProfileQueryLimitExceeded extends Schema.TaggedError<ProfileQueryLimitExceeded>()(
  "ProfileQueryLimitExceeded",
  { limit: Schema.Int },
) {}

export class ProfileNotFound extends Schema.TaggedError<ProfileNotFound>()("ProfileNotFound", {
  personId: PersonId,
}) {}

export class ProfileContactNotFound extends Schema.TaggedError<ProfileContactNotFound>()(
  "ProfileContactNotFound",
  {
    personId: PersonId,
  },
) {}

export class ProfileStaleRevision extends Schema.TaggedError<ProfileStaleRevision>()(
  "ProfileStaleRevision",
  {
    personId: PersonId,
    expectedNameRevision: Schema.Int,
    actualNameRevision: Schema.Int,
    expectedContactRevision: Schema.Int,
    actualContactRevision: Schema.Int,
  },
) {}

export class ProfileCommandConflict extends Schema.TaggedError<ProfileCommandConflict>()(
  "ProfileCommandConflict",
  { commandId: ProfileCommandId },
) {}

export class ProfilePersistenceError extends Schema.TaggedError<ProfilePersistenceError>()(
  "ProfilePersistenceError",
  { operation: Schema.String, message: Schema.String },
) {}

export type ProfileFailure =
  | ProfileDecodeError
  | ProfileQueryLimitExceeded
  | ProfileNotFound
  | ProfileContactNotFound
  | ProfileStaleRevision
  | ProfileCommandConflict
  | ProfilePersistenceError;
