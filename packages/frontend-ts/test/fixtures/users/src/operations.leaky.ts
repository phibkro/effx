import { Effect } from "effect";
import { Http, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { Leaky } from "./leaky.def.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";

export class Leaking {
  @Query({ name: "Leaking.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/leaking/:id")
  @Leaky({ who: "x" })
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }
}
