import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApi, HttpApiBuilder } from "effect/unstable/httpapi";
import { ErrorsStaticApi } from "../project/errors-static/.effx/generated/errors-static-contract.js";
import { UserErrors } from "../project/errors-static/src/errors-support.js";

/**
 * The real consumer of the generated `error:` expression: a hand-written handler fails with the class-static
 * error Schema, and the response is produced through the endpoint's declared error schema. If the generated
 * `error:` names the holding class instead of the member schema, the endpoint's error channel is not the
 * failure the handler produces and neither the typecheck nor the response can be built from it.
 */
export interface ErrorsStaticObservations {
  readonly status: number;
  readonly body: string;
}

const Root = HttpApi.make("errors-static-native-api").add(ErrorsStaticApi);

const Handlers = HttpApiBuilder.group(Root, "errors-static", (handlers) =>
  handlers.handleAll({
    readUser: ({ payload }) =>
      Effect.fail({
        _tag: "UserNotFound",
        id: payload.id,
      } satisfies typeof UserErrors.UserNotFound.Type),
  }),
);

export const observeErrorsStaticBehaviors = (
  signal: AbortSignal,
): Promise<ErrorsStaticObservations> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* Effect.acquireRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              HttpApiBuilder.layer(Root).pipe(
                Layer.provide(Handlers),
                Layer.provide(HttpServer.layerServices),
              ),
              { disableLogger: true },
            ),
          ),
          (value) => Effect.promise(() => value.dispose()),
        );
        const response = yield* Effect.promise(() =>
          host.handler(
            new Request("http://fixture/users/read", {
              method: "POST",
              body: JSON.stringify({ id: "u1" }),
              headers: { "content-type": "application/json" },
              signal,
            }),
          ),
        );
        const body = yield* Effect.promise(() => response.text());

        return { status: response.status, body };
      }),
    ),
  );
