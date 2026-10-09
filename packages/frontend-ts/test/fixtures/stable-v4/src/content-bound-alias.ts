import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import type {
  ContentEndpoints,
  ContentGuards,
  ContentRaw,
} from "../project/bound-generic-alias/.effx/generated/content-handlers.js";
import type { Options as Ctx, RetryPolicy as Retries } from "./contexts.js";
import { ExternalContentApi } from "./content-root.js";
import { contentGuard } from "./content-bound-http.js";

const endpoints = ExternalContentApi.groups.content.endpoints;

/** Constraint and default reference types that arrive through aliased imports. */
export const makeAliasedRawHandlers = <C extends Ctx, D extends Retries = Retries>(
  context: C,
  delay: D = 1 as D,
) =>
  ({
    publishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`publish:${context.maxBodyBytes}:${delay}`);
      }),
    unpublishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`unpublish:${context.maxBodyBytes}:${delay}`);
      }),
  }) satisfies ContentRaw;

/** The same context tuple as the raw factory, with alpha-renamed type parameters. */
export const makeAlphaGuards = <T extends Ctx, U extends Retries = Retries>(
  _context: T,
  _delay: U = 1 as U,
) =>
  ({
    "content.publishArticle": contentGuard(endpoints.publishArticle),
    "content.unpublishArticle": contentGuard(endpoints.unpublishArticle),
  }) satisfies ContentGuards<ContentEndpoints>;
