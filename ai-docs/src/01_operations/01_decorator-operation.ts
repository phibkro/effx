/**
 * @title Decorator operation
 *
 * Declare operations as static methods annotated with TC39 decorators from
 * `@effx/runtime`. A decorator is a contribution to the IR, never generated
 * behaviour: the method body stays your ordinary Effect code.
 */
import { Cli, Command, Errors, Http, Query, Requirements, Rpc } from "@effx/runtime";
import { Effect } from "effect";
import {
  ChangeEmailInput,
  EmailTaken,
  GetUserInput,
  UserNotFound,
  UserPublic,
  UserSelf,
  Users,
} from "./fixtures/users.ts";

// Group operations in a class of static methods. Decorators are standard
// (TC39) decorators; do not enable `experimentalDecorators`.
export class UserOperations {
  // `@Query` / `@Command` define the operation: its name, input Schema and
  // success Schema. `@Query` is a semantic claim ("this reads"), not a proof
  // of purity (ADR 0006).
  @Query({ name: "User.Get", input: GetUserInput, success: UserPublic })
  // Exposure decorators say where the operation is reachable. The compiler
  // generates an `HttpApi` route, an `Rpc` and a CLI command from these.
  @Http.Get("/users/:id")
  @Rpc("User.Get")
  @Cli("users get")
  static get(input: typeof GetUserInput.Type) {
    // The body is a normal Effect. The error channel (`UserNotFound`) and the
    // requirement channel (`Users`) are inferred from this return type.
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      // Return the public view: no email leaks through this operation.
      return { id: user.id, displayName: user.displayName };
    });
  }

  @Command({ name: "User.ChangeEmail", input: ChangeEmailInput, success: UserSelf })
  @Http.Patch("/users/:id/email")
  // `@Errors` and `@Requirements` do not add behaviour. They assert what the
  // compiler inferred from the handler; a mismatch is a diagnostic (ADR 0005).
  @Errors(UserNotFound, EmailTaken)
  @Requirements(Users)
  static changeEmail(input: typeof ChangeEmailInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      // Always `return yield*` a failure so TypeScript sees the path end.
      return yield* users.setEmail(input.id, input.email);
    });
  }
}
