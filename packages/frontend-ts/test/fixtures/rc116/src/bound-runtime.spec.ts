import { expect, test } from "bun:test";
import { Context, Deferred, Effect, Exit, Fiber, Layer } from "effect";
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

// The security marker delegates authority to the application-owned guards.
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

// Bun is the Promise host; run only at this test entry point, never in backend domain code.
test("bound Profile preserves backend substitution and releases request-owned work on success", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        let released = 0;
        const host = yield* profileHost;
        const read = Effect.acquireUseRelease(
          Effect.void,
          () => Effect.succeed("substitute"),
          () =>
            Effect.sync(() => {
              released++;
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
        expect(response.status).toBe(200);
        expect(yield* Effect.promise(() => response.text())).toBe(
          '{"firstName":"bound:substitute","lastName":"bound"}',
        );
        expect(released).toBe(1);
      }),
    ),
  ));

test("bound Content guardFor reflects concrete endpoint keys and retains raw response bytes", () =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const host = yield* contentHost;
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
          expect(response.status).toBe(200);
          expect(yield* Effect.promise(() => response.text())).toBe(`article-1:${action}ed:8192`);
        }
      }),
    ),
  ));

test("cancelling the native request interrupts the backend and finalizes exactly once", () =>
  Effect.runPromise(
    Effect.scoped(
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
        expect(Exit.hasInterrupts(yield* Fiber.await(request))).toBe(true);
        expect(releases).toBe(1);
      }),
    ),
  ));

test("explicit With guard injection reaches the HTTP error contract before backend work", () =>
  Effect.runPromise(
    Effect.scoped(
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
        expect(response.status).toBe(401);
        expect(reads).toBe(0);
      }),
    ),
  ));

test("backend defects retain native failure handling and release request-owned work", () =>
  Effect.runPromise(
    Effect.scoped(
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
        expect(response.status).toBe(500);
        expect(releases).toBe(1);
      }),
    ),
  ));
