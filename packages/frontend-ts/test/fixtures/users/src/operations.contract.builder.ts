import { Effect } from "effect";
import { Operation } from "@effx/runtime";
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

export const contractGet = Operation.query({
  name: "User.ContractGet",
  input: GetUserInput,
  success: User.Public,
})
  .http.get("/users/:id")
  .http.contract({
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
  .http.problems({
    registry: UserProblemResponses,
    codes: ["user.not-found"],
    map: { UserNotFound: "user.not-found" },
  })
  .handler((input: typeof GetUserInput.Type) =>
    Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return { id: user.id, displayName: user.displayName };
    }),
  );
