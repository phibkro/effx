/** @effect-diagnostics unstableApiUsage:off -- the fixture declares a typed HttpApi middleware marker. */
import { Schema } from "effect";
import { HttpApiMiddleware } from "effect/http-api";
import { UserNotFound } from "./errors.ts";
import { UserId } from "./schemas.ts";

export const ContractParams = Schema.Struct({ id: UserId });

export const ContractQuery = Schema.Struct({ include: Schema.optionalKey(Schema.String) });

export const ContractHeaders = Schema.Struct({ "x-request-id": Schema.optionalKey(Schema.String) });

export const ContractResponseHeaders = Schema.Struct({ etag: Schema.String });

/** Contract marker, not an authorization decision. */
export class RequestMarker extends HttpApiMiddleware.Service<RequestMarker>()(
  "users/RequestMarker",
) {}

/** Only the declared fixture code is accepted, with its real tagged error schema. */
export const UserProblemResponses = (_identifier: string, codes: ReadonlyArray<string>) => {
  if (codes.length !== 1 || codes[0] !== "user.not-found") {
    throw new TypeError("UserProblemResponses accepts only user.not-found");
  }

  return [UserNotFound.pipe(Schema.annotate({ httpApiStatus: 404 }))];
};
