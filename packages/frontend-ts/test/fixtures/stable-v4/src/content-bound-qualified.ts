import { Effect as EffectNS } from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import type { ContentRaw } from "../project/bound-generic-qualified/.effx/generated/content-handlers.js";
import type * as Contexts from "./contexts.js";

/** A local exported type whose written name also appears inside a literal default. */
export type Effect = "Effect";

/**
 * A qualified type-only constraint, an F-bound constraint that refers to its own parameter, and a
 * literal default whose spelling also occurs as a type name.
 */
export const makeQualifiedRawHandlers = <
  C extends Contexts.Options,
  S extends Contexts.SelfConstrained<S>,
  L extends Effect = "Effect",
>(
  context: C,
  self?: S,
  label?: L,
) =>
  ({
    publishArticle: (_request: unknown, authorize: () => EffectNS.Effect<unknown, never, never>) =>
      EffectNS.gen(function* () {
        yield* authorize();
        void self;
        return HttpServerResponse.text(`publish:${context.maxBodyBytes}:${label ?? "Effect"}`);
      }),
    unpublishArticle: (
      _request: unknown,
      authorize: () => EffectNS.Effect<unknown, never, never>,
    ) =>
      EffectNS.gen(function* () {
        yield* authorize();
        void self;
        return HttpServerResponse.text(`unpublish:${context.maxBodyBytes}:${label ?? "Effect"}`);
      }),
  }) satisfies ContentRaw;
