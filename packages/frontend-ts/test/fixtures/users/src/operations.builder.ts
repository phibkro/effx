import { Effect } from "effect";
import { Operation } from "@effx/runtime";
import { ChangeEmail, Read } from "./capabilities.ts";
import { EmailTaken, UserNotFound } from "./errors.ts";
import { ChangeEmailInput, GetUserInput } from "./schemas.ts";
import { Audit, Users } from "./services.ts";
import { User } from "./user.ts";

export const getUser = Operation.query({
  name: "User.Get",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/users/:id")
  .rpc("User.Get")
  .cli("users get")
  .authorize(Read)
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    }),
  );

export const changeUserEmail = Operation.command({
  name: "User.ChangeEmail",
  input: ChangeEmailInput,
  success: User.Self,
})
  .http.patch("/users/:id/email")
  .rpc("User.ChangeEmail")
  .cli("users change-email")
  .authorize(ChangeEmail)
  .errors(UserNotFound, EmailTaken)
  .requirements(Users, Audit)
  .handler((input: typeof ChangeEmailInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;
      const audit = yield* Audit;
      yield* audit.log(`change email of ${input.id}`);

      return yield* users.setEmail(input.id, input.email);
    }),
  );
