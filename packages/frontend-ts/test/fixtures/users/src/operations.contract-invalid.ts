import { Effect } from "effect";
import { Command, Http, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";
import { ContractQuery, UserProblemResponses } from "./contract-support.ts";

export class InvalidContracts {
  @Query({ name: "Invalid.GetPayload", input: GetUserInput, success: User.Public })
  @Http.Get("/invalid")
  @Http.Contract({ group: "invalid", payload: GetUserInput, success: User.Public })
  @Http.Problems({ registry: UserProblemResponses, codes: ["user.not-found"] })
  static getPayload(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }

  @Command({ name: "Invalid.ConditionalPost", input: GetUserInput, success: User.Public })
  @Http.Post("/invalid")
  @Http.Contract({ group: "invalid", success: User.Public, conditional: true })
  @Http.Problems({
    registry: UserProblemResponses,
    codes: ["user.not-found"],
    map: { UserNotFound: "other.code" },
  })
  static conditionalPost(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }
  @Query({ name: "Invalid.ParamsMismatch", input: GetUserInput, success: User.Public })
  @Http.Get("/invalid/:id")
  @Http.Contract({ group: "invalid", params: ContractQuery, success: User.Public })
  static paramsMismatch(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;

      return yield* users.find(input.id);
    });
  }
}
