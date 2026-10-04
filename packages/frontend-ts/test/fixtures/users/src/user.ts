import { Schema } from "effect";
import { PersistentModel } from "@effx/runtime";
import { Email, UserId } from "./schemas.ts";

@PersistentModel({ table: "users", focus: { email: ["email"] } })
export class User extends Schema.Class<User>("User")({
  id: UserId,
  email: Email,
  displayName: Schema.String,
}) {
  static readonly Public = Schema.Struct({ id: UserId, displayName: Schema.String });
  static readonly Self = Schema.Struct({ id: UserId, email: Email, displayName: Schema.String });
}
