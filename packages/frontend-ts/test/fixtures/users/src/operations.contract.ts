import { Effect } from "effect";
import { Http, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";
import {
  ContractParams,
  ContractQuery,
  ContractHeaders,
  RequestMarker,
  UserProblemResponses,
} from "./contract-support.ts";

export class ContractOperations {
  @Query({ name: "User.ContractGet", input: GetUserInput, success: User.Public })
  @Http.Get("/users/:id")
  @Http.Contract({
    group: "users",
    params: ContractParams,
    query: ContractQuery,
    headers: ContractHeaders,
    success: User.Public,
    middleware: [RequestMarker],
    metadata: {
      operationId: "users.contractGet",
      summary: "Read one user",
      description: "Returns one public user projection.",
      tags: ["Users"],
    },
  })
  @Http.Problems({
    registry: UserProblemResponses,
    codes: ["user.not-found"],
    map: { UserNotFound: "user.not-found" },
  })
  static get(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    });
  }
}
