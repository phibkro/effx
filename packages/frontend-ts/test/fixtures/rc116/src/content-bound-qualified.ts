import * as EffectLib from "effect";
import { HttpServerResponse } from "effect/unstable/http";
import type { ContentRaw } from "../project/bound-generic-qualified/.effx/generated/content-handlers.js";
import type { SelfConstrained as SelfBound } from "./contexts.js";

/** A local exported type whose written name also appears inside a literal default. */
export type Effect = "Effect";

/** Qualified constraint, F-bound and literal default in one clause. */
export const makeQualifiedRawHandlers = <
  C extends EffectLib.Effect<HttpServerResponse.HttpServerResponse>,
  S extends SelfBound<S> = SelfBound<S>,
  L extends Effect = "Effect",
>(
  work: C,
  self?: S,
  label: L = "Effect",
) =>
  ({
    publishArticle: (_request: unknown, authorize: () => EffectLib.Effect<unknown, never, never>) =>
      EffectLib.gen(function* () {
        yield* authorize();
        yield* EffectLib.asVoid(work);
        void self;
        return HttpServerResponse.text(`publish:${label}`);
      }),
    unpublishArticle: (
      _request: unknown,
      authorize: () => EffectLib.Effect<unknown, never, never>,
    ) =>
      EffectLib.gen(function* () {
        yield* authorize();
        yield* EffectLib.asVoid(work);
        void self;
        return HttpServerResponse.text(`unpublish:${label}`);
      }),
  }) satisfies ContentRaw;
