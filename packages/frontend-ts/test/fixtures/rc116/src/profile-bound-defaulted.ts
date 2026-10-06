import { Effect } from "effect";
import { HttpServerResponse, type HttpServerRequest } from "effect/unstable/http";
import type {
  ProfileEndpoints,
  ProfileRaw,
} from "../project/bound-generic-defaulted/.effx/generated/profile-handlers.js";

/**
 * A handler factory whose only context is an optional Effect whose requirement parameter defaults
 * to `never`. Calling the bound factory with no arguments must keep `R = never`, so the layer has
 * no `unknown` requirement.
 */
export const makeDefaultedProfileRawHandlers = <R = never>(work?: Effect.Effect<void, never, R>) =>
  ({
    readOwnProfile: (_input, authorize) =>
      Effect.gen(function* () {
        yield* authorize();
        if (work !== undefined) yield* work;
        return HttpServerResponse.text("read");
      }),
    updateOwnProfile: (_input, authorize) =>
      Effect.gen(function* () {
        yield* authorize();
        if (work !== undefined) yield* work;
        return HttpServerResponse.text("update");
      }),
  }) satisfies ProfileRaw;

/** One guard per profile endpoint; `guardFor` mode receives each concrete root endpoint. */
export const defaultedProfileGuardFor = (endpoint: ProfileEndpoints) =>
  Effect.fn("defaultedProfileGuard")(function* (_request: HttpServerRequest.HttpServerRequest) {
    return { endpoint: endpoint.identifier };
  });
