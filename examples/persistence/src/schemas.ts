import { Schema } from "effect";
import { UserId } from "@effx-examples/users/schemas";

export const SetDisplayNameInput = Schema.Struct({ id: UserId, displayName: Schema.String });
