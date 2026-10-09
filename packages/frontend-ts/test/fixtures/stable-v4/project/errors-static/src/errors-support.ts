import { Schema } from "effect";

/** The supported dotted-error shape: a class holding a static error Schema value. */
export class UserErrors {
  static readonly UserNotFound = Schema.TaggedStruct("UserNotFound", { id: Schema.String });
}

export const ReadUserInput = Schema.Struct({ id: Schema.String });

export const UserRow = Schema.Struct({ id: Schema.String, email: Schema.String });
