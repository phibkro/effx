import { Effect } from "effect";
import { Annotate, Http, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";

/**
 * `tsc` cannot check the arguments of the untyped `Annotate`, so a wrong value reaches the compiler. A name
 * with a registered definition is decoded against that definition (EFFX1102); `@RateLimit({ perMinute: "60" })`
 * would have been a `tsc` error instead.
 */
export class Wrong {
  @Query({ name: "Wrong.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/wrong/:id")
  @Annotate("app.RateLimit", { perMinute: "60" })
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }
}
