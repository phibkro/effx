import { Schema } from "effect";
import { Email, UserId } from "./schemas.ts";

export class UserNotFound extends Schema.TaggedError<
  UserNotFound,
  { readonly brand: unique symbol }
>()("UserNotFound", {
  id: UserId,
}) {}

export class EmailTaken extends Schema.TaggedError<EmailTaken, { readonly brand: unique symbol }>()(
  "EmailTaken",
  {
    email: Email,
  },
) {}
