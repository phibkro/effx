import { Effect, type Layer, Schema } from "effect";
import type { HttpRouter } from "effect/unstable/http";
import {
  ProfileApiHandlers,
  ProfileApiHandlersWith,
  type ProfileRaw,
} from "../project/bound-profile/.effx/generated/profile-handlers.js";
import {
  ContentApiHandlers,
  ContentApiHandlersWith,
  type ContentRaw,
} from "../project/bound-content/.effx/generated/content-handlers.js";
import { ExternalContentApi } from "./content-root.js";
import {
  BoundProfileBackend,
  makeProfileGuards,
  makeProfileRawHandlers,
} from "./profile-bound-http.js";
import { contentGuard, makeContentRawHandlers } from "./content-bound-http.js";

const profileContext = { prefix: "bound-person" };
const contentContext = { maxBodyBytes: 8192 };
export const ProfileBound = ProfileApiHandlers(profileContext);
export const ContentBound = ContentApiHandlers(contentContext);

// Existing http.test.ts style: spread the application's guard record and override one entry.
const profileGuards = makeProfileGuards(profileContext);
export const InjectedProfile = ProfileApiHandlersWith({
  raw: makeProfileRawHandlers(profileContext),
  guards: {
    ...profileGuards,
    "profile.readOwnProfile": () => Effect.succeed({ personId: "test-person" }),
  },
});

// Existing http-command-guards.postgres.test.ts style: override one transaction-time command guard.
const contentGuards = {
  "content.publishArticle": contentGuard(
    ExternalContentApi.groups.content.endpoints.publishArticle,
  ),
  "content.unpublishArticle": contentGuard(
    ExternalContentApi.groups.content.endpoints.unpublishArticle,
  ),
};
export const InjectedContent = ContentApiHandlersWith({
  raw: makeContentRawHandlers(contentContext),
  guards: {
    ...contentGuards,
    "content.publishArticle": () => Effect.succeed({ endpoint: "publishArticle" }),
  },
});

type Assert<Condition extends true> = Condition;
type Services = HttpRouter.Request.Only<"Requires", Layer.Services<typeof ProfileBound>>;
export type BackendRetained = Assert<BoundProfileBackend extends Services ? true : false>;
export type NoUnknownRequirements = Assert<unknown extends Services ? false : true>;

// @ts-expect-error a missing endpoint implementation remains an error with pre-applied types.
export const MissingProfile: ProfileRaw = {
  readOwnProfile: makeProfileRawHandlers(profileContext).readOwnProfile,
};
// @ts-expect-error Content also requires every endpoint implementation.
export const MissingContent: ContentRaw = {
  publishArticle: makeContentRawHandlers(contentContext).publishArticle,
};

export class UndeclaredGuardFailure extends Schema.TaggedError<UndeclaredGuardFailure>()(
  "UndeclaredGuardFailure",
  {},
) {}

export const InvalidGuardInjection = ContentApiHandlersWith({
  raw: makeContentRawHandlers(contentContext),
  guards: {
    ...contentGuards,
    // @ts-expect-error guard failures must belong to this endpoint's declared errors.
    "content.publishArticle": () => Effect.fail(new UndeclaredGuardFailure({})),
  },
});

// @ts-expect-error the generated bound entry point preserves the raw factory's context tuple.
export const WrongProfileContext = ProfileApiHandlers(contentContext);
// @ts-expect-error guardFor mode keeps Content's shared backend context too.
export const WrongContentContext = ContentApiHandlers(profileContext);
