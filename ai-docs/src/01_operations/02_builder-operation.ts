/**
 * @title Builder operation
 *
 * The builder is the value-level twin of the decorators. Each step appends the
 * same annotation its decorator would record, so both forms lower to the same IR.
 */
import { Operation } from "@effx/runtime";
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

// Export each operation: the compiler resolves declarations from exported
// symbols. `Operation.query(...)` is `@Query(...)`; `.http.get(...)` is
// `@Http.Get(...)`; `.rpc(...)` is `@Rpc(...)`.
export const getUser = Operation.query({
  name: "User.Get",
  input: GetUserInput,
  success: UserPublic,
})
  .http.get("/users/:id")
  .rpc("User.Get")
  .cli("users get")
  // `.handler(...)` ends the chain and keeps your function untouched. The
  // compiler infers the error and requirement channels from its type.
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    }),
  );

export const changeEmail = Operation.command({
  name: "User.ChangeEmail",
  input: ChangeEmailInput,
  success: UserSelf,
})
  .http.patch("/users/:id/email")
  // Assertions, as with `@Errors` / `@Requirements`: they check the inferred
  // channels and never widen or narrow the handler.
  .errors(UserNotFound, EmailTaken)
  .requirements(Users)
  .handler((input: typeof ChangeEmailInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.setEmail(input.id, input.email);
    }),
  );
