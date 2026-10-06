import { Effect } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import type { ContentRaw } from "../project/bound-generic-expr/.effx/generated/content-handlers.js";
import { defaults } from "./contexts-namespace.js";
import { defaults as importedDefaults } from "./contexts-namespace.js";
import type { Contexts } from "./contexts-namespace.js";

/** `typeof` on a local and on an aliased imported value, plus namespace-owned types. */
export const makeExpressionRawHandlers = <
  A extends typeof defaults = typeof defaults,
  B extends typeof importedDefaults = typeof importedDefaults,
  C extends Contexts.Options = Contexts.Options,
  D extends Contexts.Nested.Deep = Contexts.Nested.Deep,
>(
  options?: A,
  imported?: B,
  context?: C,
  deep?: D,
) =>
  ({
    publishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        void imported;
        void deep;
        return HttpServerResponse.text(
          `publish:${options?.maxBodyBytes ?? 0}:${context?.maxBodyBytes ?? 0}`,
        );
      }),
    unpublishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        void imported;
        void deep;
        return HttpServerResponse.text(
          `unpublish:${options?.maxBodyBytes ?? 0}:${context?.maxBodyBytes ?? 0}`,
        );
      }),
  }) satisfies ContentRaw;
