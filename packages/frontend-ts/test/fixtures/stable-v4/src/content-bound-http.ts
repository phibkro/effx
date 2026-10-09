import { Effect } from "effect";
import { HttpServerResponse, type HttpServerRequest } from "effect/http";
import type {
  ContentEndpoints,
  ContentRaw,
} from "../project/bound-content/.effx/generated/content-handlers.js";

export interface ContentContext {
  readonly maxBodyBytes: number;
}

/** Accept the concrete native endpoint; do not import one endpoint constant per guard. */
export const contentGuard = (endpoint: ContentEndpoints) =>
  Effect.fn("contentGuard")(function* (_request: HttpServerRequest.HttpServerRequest) {
    return { endpoint: endpoint.identifier };
  });

export const makeContentRawHandlers = (context: ContentContext) =>
  ({
    publishArticle: ({ params }, authorize) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`${params.articleId}:published:${context.maxBodyBytes}`);
      }),
    unpublishArticle: ({ params }, authorize) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`${params.articleId}:unpublished:${context.maxBodyBytes}`);
      }),
  }) satisfies ContentRaw;
