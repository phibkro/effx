import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import type { ContentRaw as ValueRaw } from "../project/bound-generic-namespace-value/.effx/generated/content-handlers.js";
import type { ContentRaw as StaticRaw } from "../project/bound-generic-namespace-static/.effx/generated/content-handlers.js";
import type { Contexts } from "./contexts-namespace.js";

/**
 * Each factory names exactly one namespace-owned value through `typeof`, so a dropped reference cannot
 * be masked by a sibling reference to the same namespace.
 */
export const makeNamespaceValueRawHandlers = <
  C extends typeof Contexts.defaults = typeof Contexts.defaults,
>(
  defaults?: C,
) =>
  ({
    publishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`publish:${defaults?.maxBodyBytes ?? 0}`);
      }),
    unpublishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`unpublish:${defaults?.maxBodyBytes ?? 0}`);
      }),
  }) satisfies ValueRaw;

export const makeNamespaceStaticRawHandlers = <
  C extends typeof Contexts.Defaults.value = typeof Contexts.Defaults.value,
>(
  value?: C,
) =>
  ({
    publishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`publish:${value?.maxBodyBytes ?? 0}`);
      }),
    unpublishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`unpublish:${value?.maxBodyBytes ?? 0}`);
      }),
  }) satisfies StaticRaw;
