import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import type {
  ContentEndpoints,
  ContentGuards,
  ContentRaw,
} from "../project/bound-generic/.effx/generated/content-handlers.js";
import { ExternalContentApi } from "./content-root.js";
import { contentGuard } from "./content-bound-http.js";

export interface GenericContentContext {
  readonly maxBodyBytes: number;
}

const endpoints = ExternalContentApi.groups.content.endpoints;

/**
 * A constrained generic raw factory: the bound wrapper must re-declare `C extends
 * GenericContentContext`, so a concrete context keeps its own shape and a value outside the
 * constraint is rejected.
 */
export const makeGenericRawHandlers = <C extends GenericContentContext>(context: C) =>
  ({
    publishArticle: (_request, authorize) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`publish:${context.maxBodyBytes}`);
      }),
    unpublishArticle: (_request, authorize) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`unpublish:${context.maxBodyBytes}`);
      }),
  }) satisfies ContentRaw;

/**
 * The same parameter tuple as the generic raw factory, so the generated tuple compatibility check
 * must run inside the scope that declares `C`.
 */
export const makeGenericGuards = <C extends GenericContentContext>(_context: C) =>
  ({
    "content.publishArticle": contentGuard(endpoints.publishArticle),
    "content.unpublishArticle": contentGuard(endpoints.unpublishArticle),
  }) satisfies ContentGuards<ContentEndpoints>;

/** The same value tuple as the raw factory, with an extra legal defaulted type parameter. */
export const makeDefaultedGuards = <T extends GenericContentContext, U = never>(_context: T) =>
  ({
    "content.publishArticle": contentGuard(endpoints.publishArticle),
    "content.unpublishArticle": contentGuard(endpoints.unpublishArticle),
  }) satisfies ContentGuards<ContentEndpoints>;
