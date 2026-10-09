import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import type { ContentRaw } from "../project/bound-generic-nested/.effx/generated/content-handlers.js";
import type { Contexts } from "./contexts-namespace.js";

/**
 * The only reference this clause makes is to a type nested two namespaces deep, with no sibling
 * reference to the same namespace: the generated import must therefore name the outer exported
 * namespace plus the full member path.
 */
export const makeNestedOnlyRawHandlers = <D extends Contexts.Nested.Deep = Contexts.Nested.Deep>(
  deep?: D,
) =>
  ({
    publishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`publish:${deep?.value ?? 0}`);
      }),
    unpublishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`unpublish:${deep?.value ?? 0}`);
      }),
  }) satisfies ContentRaw;
