import { Context, Deferred, Effect, Exit, Fiber, Layer } from "effect";
import effectPackage from "effect/package.json";
import { HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  ProfileApiHandlers,
  ProfileApiHandlersWith,
} from "../project/bound-profile/.effx/generated/profile-handlers.js";
import { ContentApiHandlers } from "../project/bound-content/.effx/generated/content-handlers.js";
import { ExternalNativeApi } from "./profile-root.js";
import { ExternalContentApi } from "./content-root.js";
import {
  BoundProfileBackend,
  makeProfileGuards,
  makeProfileRawHandlers,
} from "./profile-bound-http.js";
import { AccessDenied, PersonSecurity } from "./profile-support.js";

export interface BoundBehaviorObservations {
  readonly packageVersion: string;
  readonly moduleOrigin: string;
  readonly runtimeIdentityMatches: boolean;
  readonly profile: { readonly status: number; readonly body: string; readonly releases: number };
  readonly content: ReadonlyArray<{
    readonly action: "publish" | "unpublish";
    readonly status: number;
    readonly body: string;
  }>;
  readonly cancellation: { readonly interrupted: boolean; readonly releases: number };
  readonly guardFailure: { readonly status: number; readonly reads: number };
  readonly defect: { readonly status: number; readonly releases: number };
}

const Security = Layer.succeed(PersonSecurity, { sessionCookie: (effect) => effect });

const profileHost = Effect.acquireRelease(
  Effect.sync(() =>
    HttpRouter.toWebHandler(
      HttpApiBuilder.layer(ExternalNativeApi).pipe(
        Layer.provide(ProfileApiHandlers({ prefix: "bound" })),
        Layer.provide(Security),
        Layer.provide(HttpServer.layerServices),
      ),
      { disableLogger: true },
    ),
  ),
  (host) => Effect.promise(() => host.dispose()),
);

const contentHost = Effect.acquireRelease(
  Effect.sync(() =>
    HttpRouter.toWebHandler(
      HttpApiBuilder.layer(ExternalContentApi).pipe(
        Layer.provide(ContentApiHandlers({ maxBodyBytes: 8192 })),
        Layer.provide(Security),
        Layer.provide(HttpServer.layerServices),
      ),
      { disableLogger: true },
    ),
  ),
  (host) => Effect.promise(() => host.dispose()),
);

const observations = Effect.gen(function* () {
  const profile = yield* Effect.scoped(
    Effect.gen(function* () {
      let releases = 0;
      const host = yield* profileHost;
      const read = Effect.acquireUseRelease(
        Effect.void,
        () => Effect.succeed("substitute"),
        () =>
          Effect.sync(() => {
            releases++;
          }),
      );
      const response = yield* Effect.promise((signal) =>
        host.handler(
          new Request("http://fixture/api/profile", {
            headers: { cookie: "session=fixture" },
            signal,
          }),
          Context.make(BoundProfileBackend, { read }),
        ),
      );
      const body = yield* Effect.promise(() => response.text());
      return { status: response.status, body, releases };
    }),
  );

  const content = yield* Effect.scoped(
    Effect.gen(function* () {
      const host = yield* contentHost;
      const responses: Array<BoundBehaviorObservations["content"][number]> = [];
      for (const action of ["publish", "unpublish"] as const) {
        const response = yield* Effect.promise((signal) =>
          host.handler(
            new Request(`http://fixture/api/content/articles/article-1:${action}`, {
              method: "POST",
              body: "{}",
              signal,
              headers: {
                cookie: "session=fixture",
                "content-type": "application/json",
                "idempotency-key": "fixture-key",
                "if-match": '"v1"',
              },
            }),
          ),
        );
        const body = yield* Effect.promise(() => response.text());
        responses.push({ action, status: response.status, body });
      }
      return responses;
    }),
  );

  const cancellation = yield* Effect.scoped(
    Effect.gen(function* () {
      const acquired = yield* Deferred.make<void>();
      const released = yield* Deferred.make<void>();
      let releases = 0;
      const host = yield* profileHost;
      const read = Effect.acquireUseRelease(
        Deferred.succeed(acquired, undefined),
        () => Effect.never,
        () =>
          Effect.gen(function* () {
            releases++;
            yield* Deferred.succeed(released, undefined);
          }),
      );
      const request = yield* Effect.forkChild(
        Effect.promise((signal) =>
          host.handler(
            new Request("http://fixture/api/profile", {
              headers: { cookie: "session=fixture" },
              signal,
            }),
            Context.make(BoundProfileBackend, { read }),
          ),
        ),
      );
      yield* Deferred.await(acquired);
      yield* Fiber.interrupt(request);
      yield* Deferred.await(released);
      const exit = yield* Fiber.await(request);
      return { interrupted: Exit.hasInterrupts(exit), releases };
    }),
  );

  const guardFailure = yield* Effect.scoped(
    Effect.gen(function* () {
      const context = { prefix: "fixture" };
      let reads = 0;
      const guards = makeProfileGuards(context);
      const injected = ProfileApiHandlersWith({
        raw: makeProfileRawHandlers(context),
        guards: {
          ...guards,
          "profile.readOwnProfile": () =>
            Effect.fail(new AccessDenied({ message: "injected denial" })),
        },
      });
      const host = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            HttpApiBuilder.layer(ExternalNativeApi).pipe(
              Layer.provide(injected),
              Layer.provide(Security),
              Layer.provide(HttpServer.layerServices),
            ),
            { disableLogger: true },
          ),
        ),
        (host) => Effect.promise(() => host.dispose()),
      );
      const response = yield* Effect.promise((signal) =>
        host.handler(
          new Request("http://fixture/api/profile", {
            headers: { cookie: "session=fixture" },
            signal,
          }),
          Context.make(BoundProfileBackend, {
            read: Effect.sync(() => {
              reads++;
              return "unexpected";
            }),
          }),
        ),
      );
      return { status: response.status, reads };
    }),
  );

  const defect = yield* Effect.scoped(
    Effect.gen(function* () {
      let releases = 0;
      const host = yield* profileHost;
      const read = Effect.acquireUseRelease(
        Effect.void,
        () => Effect.die("backend invariant"),
        () =>
          Effect.sync(() => {
            releases++;
          }),
      );
      const response = yield* Effect.promise((signal) =>
        host.handler(
          new Request("http://fixture/api/profile", {
            headers: { cookie: "session=fixture" },
            signal,
          }),
          Context.make(BoundProfileBackend, { read }),
        ),
      );
      return { status: response.status, releases };
    }),
  );

  const nativeModule = yield* Effect.promise(() => import(import.meta.resolve("effect")));

  return {
    packageVersion: effectPackage.version,
    moduleOrigin: import.meta.resolve("effect"),
    runtimeIdentityMatches: nativeModule.Effect === Effect,
    profile,
    content,
    cancellation,
    guardFailure,
    defect,
  } satisfies BoundBehaviorObservations;
});

/**
 * Foreign test entry point for hosts using a different installed Effect version.
 * Both Bun and Vitest call this native rc.116 program. The caller's AbortSignal
 * interrupts its root Scope, including real HTTP work and every host disposer.
 */
export const observeBoundBehaviors = (signal?: AbortSignal): Promise<BoundBehaviorObservations> =>
  Effect.runPromise(Effect.scoped(observations), { signal });
