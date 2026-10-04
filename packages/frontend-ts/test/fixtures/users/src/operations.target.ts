import { Effect } from "effect";
import { Http, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { RateLimit } from "./rate-limit.def.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";

/** An operation-target user annotation on a class: EFFX1303, not the generic EFFX1104. */
// @ts-expect-error a method decorator cannot decorate a class
@RateLimit({ perMinute: 1 })
export class RateLimitedClass {
  @Query({ name: "RateLimitedClass.Get", input: GetUserInput, success: User.Public })
  @Http.Get("/rate-limited-class/:id")
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }
}

/** A built-in operation annotation on a class keeps the generic EFFX1104. */
// @ts-expect-error a method decorator cannot decorate a class
@Http.Get("/builtin-class")
export class BuiltinOnClass {}
