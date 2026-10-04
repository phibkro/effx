import { Schema } from "effect";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));

export const Email = Schema.String;

export const GetUserInput = Schema.Struct({ id: UserId });

export const ChangeEmailInput = Schema.Struct({ id: UserId, email: Email });
