/**
 * @title Declaring a persistence port
 *
 * Persistence methods are declaration-only operations with no transport exposure.
 * The compiler generates a leaf Context.Service and a typed conformance suite
 * from the same input, success and error Schema references (spec 0022).
 */
import { Persist } from "@effx/persistence/syntax";
import { Operation } from "@effx/runtime";
import {
  ChangeEmailInput,
  EmailTaken,
  GetUserInput,
  UserNotFound,
  UserSelf,
} from "../01_operations/fixtures/users.ts";

export const FindUser = Operation.query({
  name: "Users.find",
  input: GetUserInput,
  success: UserSelf,
})
  .errors(UserNotFound)
  .with(Persist.Port({ port: "Users" }))
  .declare();

export const SetEmail = Operation.command({
  name: "Users.setEmail",
  input: ChangeEmailInput,
  success: UserSelf,
})
  .errors(UserNotFound, EmailTaken)
  .with(Persist.Port({ port: "Users" }))
  .declare();
