import { Capability, Focus } from "@effx/runtime";
import { User } from "./user.ts";

export const Read = Capability.make("User.Read", { resource: User });

export const ChangeEmail = Capability.make("User.ChangeEmail", {
  resource: User,
  focus: Focus.key(User, "email"),
});
