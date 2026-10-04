import { Effect } from "effect";
import { Authorize, Cli, Command, Errors, Http, Query, Requirements, Rpc } from "@effx/runtime";
import { ChangeEmail, Read } from "./capabilities.ts";
import { EmailTaken, UserNotFound } from "./errors.ts";
import { ChangeEmailInput, GetUserInput } from "./schemas.ts";
import { Audit, Users } from "./services.ts";
import { User } from "./user.ts";

export class UserOperations {
  @Query({ name: "User.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/users/:id")
  @Rpc("User.Get")
  @Cli("users get")
  @Authorize(Read)
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }

  @Command({ name: "User.ChangeEmail", input: ChangeEmailInput, success: User.Self })
  @Http.Patch("/users/:id/email")
  @Rpc("User.ChangeEmail")
  @Cli("users change-email")
  @Authorize(ChangeEmail)
  @Errors(UserNotFound, EmailTaken)
  @Requirements(Users, Audit)
  static changeEmail(input: typeof ChangeEmailInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;
      const audit = yield* Audit;
      yield* audit.log(`change email of ${input.id}`);

      return yield* users.setEmail(input.id, input.email);
    });
  }
}
