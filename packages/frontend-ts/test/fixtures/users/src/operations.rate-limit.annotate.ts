import { Effect } from "effect";
import { Annotate, Http, Operation, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { RateLimit } from "./rate-limit.def.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";

/**
 * One definition (spec 0020), four spellings: the generic `Annotate` / `.annotate` of spec 0015 and the
 * typed decorator / `.with(...)`. Each records the same `{ name, args }`.
 */
export class Spellings {
  @Query({ name: "Spellings.GenericDecorator", input: GetUserInput, success: User.Public })
  @Http.Get("/spellings/generic-decorator/:id")
  @Annotate("app.RateLimit", { perMinute: 60, burst: 5 })
  static genericDecorator(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }

  @Query({ name: "Spellings.TypedDecorator", input: GetUserInput, success: User.Public })
  @Http.Get("/spellings/typed-decorator/:id")
  @RateLimit({ perMinute: 60, burst: 5 })
  static typedDecorator(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }
}

export const genericBuilder = Operation.query({
  name: "Spellings.GenericBuilder",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/spellings/generic-builder/:id")
  .annotate("app.RateLimit", { perMinute: 60, burst: 5 })
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    }),
  );

export const typedBuilder = Operation.query({
  name: "Spellings.TypedBuilder",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/spellings/typed-builder/:id")
  .with(RateLimit({ perMinute: 60, burst: 5 }))
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    }),
  );
