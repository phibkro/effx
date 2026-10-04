import { Schema } from "effect";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));

export const Email = Schema.NonEmptyString;

export const GetUserInput = Schema.Struct({ id: UserId });

export const ChangeEmailInput = Schema.Struct({ id: UserId, email: Email });

export const UserPublic = Schema.Struct({ id: UserId, displayName: Schema.String });

export const UserSelf = Schema.Struct({ id: UserId, email: Email, displayName: Schema.String });

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: UserId,
}) {}

export class EmailTaken extends Schema.TaggedError<EmailTaken>()("EmailTaken", {
  email: Email,
}) {}
