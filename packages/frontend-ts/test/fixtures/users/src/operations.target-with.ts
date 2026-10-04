import { Effect } from "effect";
import { Operation } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { ClassOnly } from "./class-only.def.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";

/** `.with(...)` of an applied value whose definition targets a class: EFFX1303. */
export const classOnlyBuilder = Operation.query({
  name: "ClassOnly.Builder",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/class-only/:id")
  .with(ClassOnly("x"))
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    }),
  );
