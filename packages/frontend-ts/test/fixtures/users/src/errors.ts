import { Schema } from "effect";
import { Email, UserId } from "./schemas.ts";

export class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: UserId,
}) {}

export class EmailTaken extends Schema.TaggedError<EmailTaken>()("EmailTaken", {
  email: Email,
}) {}
