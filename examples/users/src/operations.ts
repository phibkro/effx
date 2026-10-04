import { Authorize, Cli, Command, Errors, Http, Query, Requirements, Rpc } from "@effx/runtime";
import { Effect } from "effect";
import { ChangeEmail, Read } from "./capabilities.ts";
import { ChangeEmailInput, EmailTaken, GetUserInput, UserNotFound } from "./schemas.ts";
import { Users } from "./services.ts";
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
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    });
  }

  @Command({ name: "User.ChangeEmail", input: ChangeEmailInput, success: User.Self })
  @Http.Patch("/users/:id/email")
  @Rpc("User.ChangeEmail")
  @Cli("users change-email")
  @Authorize(ChangeEmail)
  @Errors(UserNotFound, EmailTaken)
  @Requirements(Users)
  static changeEmail(input: typeof ChangeEmailInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.setEmail(input.id, input.email);
    });
  }
}
