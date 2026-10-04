/**
 * @title Using a declared annotation
 *
 * The value `RateLimit(...)` is both a standard decorator and a builder argument. Both
 * spellings record the same `{ name, args }` annotation, so the compiler sees one meaning
 * (spec 0020 section 2.1). The generic `@Annotate(name, ...args)` of spec 0015 reaches the same
 * definition by its name.
 */
import { Annotate, Http, Operation, Query } from "@effx/runtime";
import { Effect } from "effect";
import { GetUserInput, UserPublic, Users } from "./fixtures/users.ts";
import { RateLimit } from "./03_define-annotation.ts";

export class LimitedUsers {
  @Query({ name: "Limited.Get", input: GetUserInput, success: UserPublic })
  @Http.Get("/limited/:id")
  // A literal object: the frontend lowers it statically. A variable here would be EFFX1102.
  @RateLimit({ perMinute: 60, burst: 5 })
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    });
  }

  // The untyped floor: the name is a string literal, so `tsc` no longer checks the arguments, but
  // the frontend lowers them by the definition's plan and records the same `{ name, args }`.
  @Query({ name: "Limited.Generic", input: GetUserInput, success: UserPublic })
  @Http.Get("/limited-generic/:id")
  @Annotate("app.RateLimit", { perMinute: 60, burst: 5 })
  static generic(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    });
  }
}

// The builder spelling: `.with(...)` takes the applied annotation.
export const limitedBuilder = Operation.query({
  name: "Limited.Builder",
  input: GetUserInput,
  success: UserPublic,
})
  .http.get("/limited-builder/:id")
  .with(RateLimit({ perMinute: 60, burst: 5 }))
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    }),
  );
