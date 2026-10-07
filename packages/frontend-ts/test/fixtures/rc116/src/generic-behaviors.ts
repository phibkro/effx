import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  ContentApiHandlers,
  ContentApiHandlersWith,
} from "../project/bound-generic/.effx/generated/content-handlers.js";
import { ContentApiHandlers as DefaultedGuardHandlers } from "../project/bound-generic-defaulted-guard/.effx/generated/content-handlers.js";
import { ContentApiHandlers as TypeOnlyHandlers } from "../project/bound-generic-type-only/.effx/generated/content-handlers.js";
import { ContentApiHandlers as NamespaceValueHandlers } from "../project/bound-generic-namespace-value/.effx/generated/content-handlers.js";
import { ExternalContentApi } from "./content-root.js";
import { makeGenericGuards, makeGenericRawHandlers } from "./content-bound-generic.js";
import { PersonSecurity } from "./profile-support.js";

export interface GenericBehaviorObservations {
  readonly success: { readonly status: number; readonly body: string };
  readonly denial: { readonly status: number; readonly body: string };
  /** The same raw factory paired with a guards factory that adds an extra defaulted type parameter. */
  readonly defaultedGuard: { readonly status: number; readonly body: string };
  /**
   * A raw factory whose mirrored constraint names a `typeof` of a type-only imported value: the
   * context module throws while loading, so this observation also proves it is never executed.
   */
  readonly typeOnlyContext: { readonly status: number; readonly body: string };
  /** A raw factory whose mirrored constraint names a namespace-owned value through `typeof`. */
  readonly namespaceValue: { readonly status: number; readonly body: string };
}

const Security = Layer.succeed(PersonSecurity, { sessionCookie: (effect) => effect });
const genericContext = { maxBodyBytes: 4096 };

const publishRequest = () =>
  new Request("http://fixture/api/content/articles/article-1:publish", {
    method: "POST",
    body: "{}",
    headers: {
      cookie: "session=fixture",
      "content-type": "application/json",
      "idempotency-key": "fixture-key",
      "if-match": '"v1"',
    },
  });

/**
 * Runs the real generated generic bound factory on the unchanged rc.116 content root: a constrained
 * generic raw factory with a guards factory that shares its context tuple. The success case proves the
 * generic context reaches the handler Effect; the denial case proves the guard runs before the raw
 * handler, whose Effect must never be evaluated.
 */
export const observeGenericBoundBehaviors = (): Promise<GenericBehaviorObservations> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const successHost = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              HttpApiBuilder.layer(ExternalContentApi).pipe(
                Layer.provide(ContentApiHandlers(genericContext)),
                Layer.provide(Security),
                Layer.provide(HttpServer.layerServices),
              ),
              { disableLogger: true },
            ),
          ),
          (host) => Effect.promise(() => host.dispose()),
        );

        const successResponse = yield* Effect.promise(() => successHost.handler(publishRequest()));
        const successBody = yield* Effect.promise(() => successResponse.text());

        const denialHost = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              HttpApiBuilder.layer(ExternalContentApi).pipe(
                Layer.provide(
                  ContentApiHandlersWith({
                    raw: {
                      ...makeGenericRawHandlers(genericContext),
                      publishArticle: (input, authorize) =>
                        makeGenericRawHandlers(genericContext).publishArticle(input, authorize),
                    },
                    guards: {
                      ...makeGenericGuards(genericContext),
                      "content.publishArticle": () => Effect.die("denied"),
                    },
                  }),
                ),
                Layer.provide(Security),
                Layer.provide(HttpServer.layerServices),
              ),
              { disableLogger: true },
            ),
          ),
          (host) => Effect.promise(() => host.dispose()),
        );

        const denialResponse = yield* Effect.promise(() => denialHost.handler(publishRequest()));
        const denialBody = yield* Effect.promise(() => denialResponse.text());

        const defaultedGuardHost = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              HttpApiBuilder.layer(ExternalContentApi).pipe(
                Layer.provide(DefaultedGuardHandlers({ maxBodyBytes: 256 })),
                Layer.provide(Security),
                Layer.provide(HttpServer.layerServices),
              ),
              { disableLogger: true },
            ),
          ),
          (host) => Effect.promise(() => host.dispose()),
        );

        const defaultedGuardResponse = yield* Effect.promise(() =>
          defaultedGuardHost.handler(publishRequest()),
        );
        const defaultedGuardBody = yield* Effect.promise(() => defaultedGuardResponse.text());

        const typeOnlyHost = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              HttpApiBuilder.layer(ExternalContentApi).pipe(
                Layer.provide(TypeOnlyHandlers({ maxBodyBytes: 128 })),
                Layer.provide(Security),
                Layer.provide(HttpServer.layerServices),
              ),
              { disableLogger: true },
            ),
          ),
          (host) => Effect.promise(() => host.dispose()),
        );

        const typeOnlyResponse = yield* Effect.promise(() =>
          typeOnlyHost.handler(publishRequest()),
        );
        const typeOnlyBody = yield* Effect.promise(() => typeOnlyResponse.text());

        const namespaceValueHost = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              HttpApiBuilder.layer(ExternalContentApi).pipe(
                Layer.provide(NamespaceValueHandlers({ maxBodyBytes: 4096 })),
                Layer.provide(Security),
                Layer.provide(HttpServer.layerServices),
              ),
              { disableLogger: true },
            ),
          ),
          (host) => Effect.promise(() => host.dispose()),
        );

        const namespaceValueResponse = yield* Effect.promise(() =>
          namespaceValueHost.handler(publishRequest()),
        );
        const namespaceValueBody = yield* Effect.promise(() => namespaceValueResponse.text());

        return {
          success: { status: successResponse.status, body: successBody },
          denial: { status: denialResponse.status, body: denialBody },
          defaultedGuard: {
            status: defaultedGuardResponse.status,
            body: defaultedGuardBody,
          },
          typeOnlyContext: { status: typeOnlyResponse.status, body: typeOnlyBody },
          namespaceValue: { status: namespaceValueResponse.status, body: namespaceValueBody },
        };
      }),
    ),
  );
