import { Context, Effect } from "effect";
import { HttpServerResponse, type HttpServerRequest } from "effect/unstable/http";
import type {
  ProfileEndpoints,
  ProfileGuards,
  ProfileRaw,
} from "../project/bound-profile/.effx/generated/profile-handlers.js";
import { AccessDenied, type ProfilePrincipal } from "./profile-support.js";

export interface ProfileContext {
  readonly prefix: string;
}

export class BoundProfileBackend extends Context.Service<
  BoundProfileBackend,
  {
    readonly read: Effect.Effect<string>;
  }
>()("fixture/rc116/BoundProfileBackend") {}

export const makeProfileGuards = (context: ProfileContext) => {
  const guard = Effect.fn("boundProfileGuard")(function* (
    request: HttpServerRequest.HttpServerRequest,
  ) {
    if (request.headers.cookie === undefined)
      return yield* new AccessDenied({ message: "bound session required" });
    return { personId: context.prefix } satisfies ProfilePrincipal;
  });
  return {
    "profile.readOwnProfile": guard,
    "profile.updateOwnProfile": guard,
  } satisfies ProfileGuards<ProfileEndpoints>;
};

/** The cycle imports generated types only; the inferred return keeps backend requirements. */
export const makeProfileRawHandlers = (context: ProfileContext) =>
  ({
    readOwnProfile: (_input, authorize) =>
      Effect.gen(function* () {
        const principal = yield* authorize();
        const firstName = yield* (yield* BoundProfileBackend).read;
        return yield* HttpServerResponse.json({
          firstName: `${context.prefix}:${firstName}`,
          lastName: principal.personId,
        }).pipe(Effect.orDie);
      }),
    updateOwnProfile: ({ headers }, authorize) =>
      Effect.gen(function* () {
        const principal = yield* authorize();
        return HttpServerResponse.text(
          `${principal.personId}:${headers["if-match"]}:${context.prefix}`,
        );
      }),
  }) satisfies ProfileRaw;
