/** @effect-diagnostics unstableApiUsage:off -- the fixture constructs typed HttpApi response headers. */
import { Effect } from "effect";
import { HttpApiSchema } from "effect/http-api";
import { Command, Http, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { Users } from "./services.ts";
import { User } from "./user.ts";
import {
  ContractParams,
  ContractResponseHeaders,
  RequestMarker,
  UserProblemResponses,
} from "./contract-support.ts";

export class RichContractOperations {
  @Command({ name: "User.ContractPost", input: GetUserInput, success: User.Public })
  @Http.Post("/users/:id/confirm")
  @Http.Contract({
    root: "admin",
    group: "users",
    params: ContractParams,
    payload: GetUserInput,
    success: User.Public,
    status: 201,
    mediaType: "application/vnd.user+json",
    responseHeaders: ContractResponseHeaders,
    middleware: [RequestMarker],
  })
  @Http.Problems({
    registry: UserProblemResponses,
    codes: ["user.not-found"],
    map: { UserNotFound: "user.not-found" },
  })
  static confirm(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return HttpApiSchema.withHeaders({
        body: { id: user.id, displayName: user.displayName },
        headers: { etag: `"${user.id}"` },
      });
    });
  }

  @Query({ name: "User.ConditionalGet", input: GetUserInput, success: User.Public })
  @Http.Get("/users/:id/conditional")
  @Http.Contract({
    group: "users",
    params: ContractParams,
    success: User.Public,
    responseHeaders: ContractResponseHeaders,
    conditional: true,
  })
  @Http.Problems({
    registry: UserProblemResponses,
    codes: ["user.not-found"],
    map: { UserNotFound: "user.not-found" },
  })
  static conditional(input: typeof GetUserInput.Type) {
    return Effect.gen(function* () {
      const users = yield* Users;
      const user = yield* users.find(input.id);

      return HttpApiSchema.withHeaders({
        body: { id: user.id, displayName: user.displayName },
        headers: { etag: `"${user.id}"` },
      });
    });
  }
}
