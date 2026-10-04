import { Effect } from "effect";
import { Http, Operation, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { RateLimit } from "./rate-limit.def.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";

export class Limited {
  @Query({ name: "Limited.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/limited/:id")
  @RateLimit({ perMinute: 60, burst: 5 })
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }
}

export const limitedBuilder = Operation.query({
  name: "Limited.Builder",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/limited-builder/:id")
  .with(RateLimit({ perMinute: 60, burst: 5 }))
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    }),
  );
