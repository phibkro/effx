import { Effect } from "effect";
import { Http, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { Mismatch } from "./rate-limit-mismatch.def.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";

export class Mismatched {
  @Query({ name: "Mismatched.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/mismatched/:id")
  @Mismatch({ perMinute: 60 })
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }
}
