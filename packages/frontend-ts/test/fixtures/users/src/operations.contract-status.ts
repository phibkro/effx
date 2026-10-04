import { Effect, Schema } from "effect";
import { Http, Query } from "@effx/runtime";
import { GetUserInput } from "./schemas.ts";
import { User } from "./user.ts";
import { ContractParams } from "./contract-support.ts";

export class StatusConflict extends Schema.TaggedError<StatusConflict>()(
  "StatusConflict",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

export const StatusProblemResponses = (_identifier: string, codes: ReadonlyArray<string>) => {
  if (codes.length !== 1 || codes[0] !== "status.conflict") {
    throw new TypeError("StatusProblemResponses accepts only status.conflict");
  }

  return [StatusConflict];
};

export class StatusContractOperations {
  @Query({ name: "User.Status", input: GetUserInput, success: User.Public })
  @Http.Get("/users/:id/status")
  @Http.Contract({ group: "users", params: ContractParams, success: User.Public })
  @Http.Problems({ registry: StatusProblemResponses, codes: ["status.conflict"] })
  static get(_input: typeof GetUserInput.Type) {
    return Effect.fail(new StatusConflict({ message: "not current" }));
  }
}
