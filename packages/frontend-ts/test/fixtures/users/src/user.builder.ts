import { Model } from "@effx/runtime";
import { User } from "./user.ts";

export const UserModel = Model.persistent(User, { table: "users", focus: { email: ["email"] } });
