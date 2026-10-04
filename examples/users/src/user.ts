import { PersistentModel } from "@effx/runtime";
import { Schema } from "effect";
import { Email, UserId, UserPublic, UserSelf } from "./schemas.ts";

@PersistentModel({
  table: "users",
  views: { Public: UserPublic, Self: UserSelf },
  focus: { email: ["email"] },
})
export class User extends Schema.Class<User>("User")({
  id: UserId,
  email: Email,
  displayName: Schema.String,
}) {
  static readonly Public = UserPublic;
  static readonly Self = UserSelf;
}
