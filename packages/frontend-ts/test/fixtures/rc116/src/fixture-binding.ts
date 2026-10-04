import { Context, Effect } from "effect";
import { HttpServerResponse, type HttpServerRequest } from "effect/unstable/http";
import type { HttpApiGroup } from "effect/unstable/httpapi";
import { ProfileApi } from "../project/contract/.effx/generated/profile-contract.js";
import {
  ProfileApiHandlers,
  type ProfileGuards,
  type ProfileRawHandlers,
} from "../project/handlers/.effx/generated/profile-handlers.js";
import { AccessDenied, type ProfilePrincipal } from "./profile-support.js";

/** Fixture-local backend dependencies intentionally absent from the shared Profile contract. */
export class FixtureReadBackend extends Context.Service<
  FixtureReadBackend,
  {
    readonly read: Effect.Effect<string>;
  }
>()("fixture/rc116/FixtureReadBackend") {}

export class FixtureWriteBackend extends Context.Service<
  FixtureWriteBackend,
  {
    readonly write: Effect.Effect<string>;
  }
>()("fixture/rc116/FixtureWriteBackend") {}

const fixtureGuard = Effect.fn("fixtureGuard")(function* (
  request: HttpServerRequest.HttpServerRequest,
) {
  if (request.headers.cookie === undefined) {
    return yield* new AccessDenied({ message: "fixture session required" });
  }
  return { personId: "fixture-person" } satisfies ProfilePrincipal;
});

export const guards = {
  "profile.readOwnProfile": fixtureGuard,
  "profile.updateOwnProfile": fixtureGuard,
} satisfies ProfileGuards<HttpApiGroup.Endpoints<typeof ProfileApi>>;

/** Raw callbacks retain ownership of the response and call authorization only when needed. */
export const raw = {
  readOwnProfile: ({ headers }, authorize) =>
    Effect.gen(function* () {
      const principal = yield* authorize();
      const firstName = yield* (yield* FixtureReadBackend).read;
      const responseHeaders = {
        etag: `"${principal.personId}"`,
        "cache-control": "private, no-store",
        vary: "Origin",
      };
      if (headers["if-none-match"] === responseHeaders.etag) {
        return HttpServerResponse.empty({ status: 304, headers: responseHeaders });
      }
      // The fixed fixture payload is serializable; a body-encoding failure is a defect.
      return yield* HttpServerResponse.json(
        { firstName, lastName: "Person" },
        { headers: responseHeaders },
      ).pipe(Effect.orDie);
    }),
  updateOwnProfile: ({ headers, request }, authorize) =>
    Effect.gen(function* () {
      const principal = yield* authorize();
      const lastName = yield* (yield* FixtureWriteBackend).write;
      const etag = headers["if-match"];
      const commandKey = headers["idempotency-key"];
      // Raw mode keeps the original request (and therefore its unread merge-patch body).
      // This test adapter deliberately does not consume or decode that body.
      const responseHeaders = {
        etag: `"${principal.personId}:${etag}:${commandKey}:${request.method}"`,
        "cache-control": "no-store",
        vary: "Origin",
      };
      return yield* HttpServerResponse.json(
        { firstName: "Fixture", lastName },
        { headers: responseHeaders },
      ).pipe(Effect.orDie);
    }),
} satisfies ProfileRawHandlers<HttpApiGroup.Endpoints<typeof ProfileApi>, typeof guards>;

export const ProfileBindings = ProfileApiHandlers({ raw, guards });
