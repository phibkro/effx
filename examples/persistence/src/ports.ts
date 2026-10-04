import { Persist } from "@effx/persistence/syntax";
import { Operation } from "@effx/runtime";
import {
  ChangeEmailInput,
  EmailTaken,
  GetUserInput,
  UserNotFound,
} from "@effx-examples/users/schemas";
import { User } from "@effx-examples/users/user";
import { SetDisplayNameInput } from "./schemas.ts";

export const FindUser = Operation.query({ name: "Users.find", input: GetUserInput, success: User })
  .errors(UserNotFound)
  .with(Persist.Port({ port: "Users" }))
  .declare();

export const SetEmail = Operation.command({
  name: "Users.setEmail",
  input: ChangeEmailInput,
  success: User,
})
  .errors(UserNotFound, EmailTaken)
  .with(Persist.Port({ port: "Users" }))
  .declare();

export const SetDisplayName = Operation.command({
  name: "Users.setDisplayName",
  input: SetDisplayNameInput,
  success: User,
})
  .errors(UserNotFound)
  .with(Persist.Port({ port: "Users" }))
  .declare();
