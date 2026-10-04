import { Context, Effect } from "effect";
import { Errors, Query } from "@effx/runtime";
import { UserNotFound } from "./errors.ts";
import { GetUserInput } from "./schemas.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";

/**
 * Function-style `Context.Service<Shape>(key)` with no `Self`: the `Identifier` type parameter
 * defaults to `Shape`, so `R` is the structural object type `{ readonly now: number }` rather
 * than a `Context.Service` class (spec 0002 §E/R inference → EFFX2304).
 */
const Anon = Context.Service<{ readonly now: number }>("Anon");

export class BrokenOperations {
  /** Handler fails with `UserNotFound | EmailTaken`; only `UserNotFound` is declared (EFFX2201). */
  @Query({ name: "Broken.Undeclared", input: GetUserInput, success: User.Public })
  @Errors(UserNotFound)
  static undeclared(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.setEmail(input.id, "taken@example.com");
    });
  }

  /** Handler fails with a plain `Error` (EFFX2203). */
  @Query({ name: "Broken.Opaque", input: GetUserInput, success: User.Public })
  static opaque(_input: typeof GetUserInput.Type) {
    // @effect-diagnostics-next-line globalErrorInEffectFailure:off -- intentionally opaque (spec 0002 EFFX2203 case)
    return Effect.fail(new Error("boom"));
  }

  /** Handler requires a structural, non-class service (EFFX2304). */
  @Query({ name: "Broken.Structural", input: GetUserInput, success: User.Public })
  static structural(_input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const a = yield* Anon;

      return a.now;
    });
  }
}
