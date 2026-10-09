import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";
import type { ContentRaw } from "../project/bound-generic-type-only/.effx/generated/content-handlers.js";
import type { defaults } from "./type-only-context.js";

/**
 * The context module is imported **type-only** and named through `typeof`, which is legal: the value
 * binding is available for a type query without a runtime import. The generated wrapper must therefore
 * import it type-only too, or it would execute a module the original factory never loads.
 */
export const makeTypeOnlyRawHandlers = <C extends typeof defaults = typeof defaults>(context?: C) =>
  ({
    publishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`publish:${context?.maxBodyBytes ?? 0}`);
      }),
    unpublishArticle: (_request: unknown, authorize: () => Effect.Effect<unknown, never, never>) =>
      Effect.gen(function* () {
        yield* authorize();
        return HttpServerResponse.text(`unpublish:${context?.maxBodyBytes ?? 0}`);
      }),
  }) satisfies ContentRaw;
