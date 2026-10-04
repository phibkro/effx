import { Effect } from "effect";
import { Http, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { RateLimit } from "./rate-limit.def.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";

export class Twice {
  @Query({ name: "Twice.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/twice/:id")
  @RateLimit({ perMinute: 1 })
  @RateLimit({ perMinute: 2 })
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }
}
