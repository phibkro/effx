/** @effect-diagnostics unstableApiUsage:off -- the fixture exercises generated native HttpApi and HttpClient over BunHttpServer. */
import { copyUsersFixture } from "../../../tools/testing/projects.ts";
import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Exit, Fiber, FileSystem, Layer, Option, Path, Schema } from "effect";
import { HttpClient, HttpClientError, HttpServerRequest } from "effect/http";
import type { HttpClientResponse } from "effect/http";
import { Extensions, compile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import type {
  ProfileResponse,
  ProfileResponseHeaders,
} from "./fixtures/users/src/client-foldkit-support.ts";

const outDir = new URL("./fixtures/users/.effx/client-foldkit-generated/", import.meta.url)
  .pathname;

type GeneratedHttp = typeof import("./fixtures/users/.effx/client-foldkit-generated/http.ts");

type GeneratedClient = typeof import("./fixtures/users/.effx/client-foldkit-generated/client.ts");

type GeneratedFoldkit = typeof import("./fixtures/users/.effx/client-foldkit-generated/foldkit.ts");

type GeneratedSupport = typeof import("./fixtures/users/src/client-foldkit-support.ts");

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const CompilerServices = Layer.mergeAll(Frontend, BunServices.layer);

type ProfileReply = {
  readonly body: typeof ProfileResponse.Type;
  readonly headers: typeof ProfileResponseHeaders.Type;
};

it.live(
  "serves the generated Profile client, 401 problem and lazy Foldkit Command over Bun HTTP",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const fixtureRoot = yield* copyUsersFixture();
      const tsconfigPath = path.join(fixtureRoot, "tsconfig.json");
      const generatedDir = path.join(fixtureRoot, ".effx", "client-foldkit-generated");
      yield* fs.makeDirectory(generatedDir, { recursive: true });
      const clientUrl = (yield* path.toFileUrl(path.join(generatedDir, "client.ts"))).href;
      const httpUrl = (yield* path.toFileUrl(path.join(generatedDir, "http.ts"))).href;
      const foldkitUrl = (yield* path.toFileUrl(path.join(generatedDir, "foldkit.ts"))).href;

      const supportUrl = (yield* path.toFileUrl(
        path.join(fixtureRoot, "src", "client-foldkit-support.ts"),
      )).href;

      const support: GeneratedSupport = yield* Effect.promise(
        () => import(/* @vite-ignore */ supportUrl),
      );

      const { CredentialMissing, ProfileCredentialSecurity, ProfileUpdated, ProfileUpdateFailed } =
        support;

      const generated = yield* compile(
        { tsconfigPath, entry: ["src/operations.client-foldkit.ts"] },
        Extensions.builtin,
      ).pipe(Effect.provide(CompilerServices));

      assert.deepStrictEqual(
        generated.diagnostics.filter((finding) => finding.severity === "error"),
        [],
      );
      const files = Option.getOrThrow(generated.files.value);
      assert.includeMembers(
        files.map((file) => file.path),
        ["http.ts", "client.ts", "guards.ts", "foldkit.ts"],
      );

      for (const file of files) {
        assert.strictEqual(file.contents, yield* fs.readFileString(outDir + file.path));
        yield* fs.writeFileString(path.join(generatedDir, file.path), file.contents);
      }

      // Runtime imports use this invocation's emitted files; checked-in files are read-only goldens.
      const httpModule: GeneratedHttp = yield* Effect.promise(
        () => import(/* @vite-ignore */ httpUrl),
      );

      const { AppRoutes } = httpModule;

      const clientModule: GeneratedClient = yield* Effect.promise(
        () => import(/* @vite-ignore */ clientUrl),
      );

      const {
        Client,
        ProfileRead,
        ProfileUpdate,
        ProfileUpdateCommandIdentity,
        TransportFailure,
        operationIndex,
      } = clientModule;

      const foldkitModule: GeneratedFoldkit = yield* Effect.promise(
        () => import(/* @vite-ignore */ foldkitUrl),
      );

      const { ProfileCommandsFor } = foldkitModule;

      assert.deepStrictEqual(operationIndex, [
        { group: "profile", operationId: "profile.read", method: "GET", path: "/api/profile" },
        { group: "profile", operationId: "profile.update", method: "PATCH", path: "/api/profile" },
      ]);
      assert.notProperty(clientModule, "InternalClient");

      let cookie: string | undefined = "session=valid";

      const seen: Array<{
        readonly method: string;
        readonly url: string;
        readonly cookie: string | undefined;
        readonly key: string | undefined;
        readonly etag: string | undefined;
        readonly trace: string | undefined;
      }> = [];

      const guard = Effect.fn("profileFixtureGuard")(function* (
        request: HttpServerRequest.HttpServerRequest,
      ) {
        seen.push({
          method: request.method,
          url: request.url,
          cookie: request.headers.cookie,
          key: request.headers["idempotency-key"],
          etag: request.headers["if-match"],
          trace: request.headers["x-trace-id"],
        });

        if (request.headers.cookie !== "session=valid") {
          return yield* new CredentialMissing({ message: "a session is required" });
        }

        return { personId: "fixture-person" };
      });

      const Security = Layer.succeed(
        ProfileCredentialSecurity,
        ProfileCredentialSecurity.of({ sessionCookie: (httpEffect) => httpEffect }),
      );

      const TestServer = Layer.mergeAll(
        AppRoutes({ "effx/profile": { read: guard, update: guard } }),
        Client.layerWith({ credentials: { kind: "cookie", cookie: () => cookie } }),
      ).pipe(Layer.provideMerge(BunHttpServer.layerTest), Layer.provide(Security));

      const request = {
        headers: {
          "idempotency-key": "save-42",
          "if-match": '"v1"',
          "x-trace-id": "trace-save",
        },
        payload: { firstName: "Grace" },
      };

      assert.deepStrictEqual(ProfileUpdateCommandIdentity(request), {
        key: "save-42",
        input: request,
        precondition: '"v1"',
      });
      assert.deepStrictEqual(
        ProfileUpdateCommandIdentity(request),
        ProfileUpdateCommandIdentity(request),
      );

      const adapters = {
        ProfileUpdate: {
          success: ({ requestId, result }: { requestId: number; result: ProfileReply }) =>
            ProfileUpdated.make({ requestId, profile: result.body, etag: result.headers.etag }),
          failure: ({ requestId, failure }: { requestId: number; failure: { _tag: string } }) =>
            ProfileUpdateFailed.make({ requestId, failure }),
        },
      };

      yield* Effect.gen(function* () {
        const read = yield* ProfileRead({
          query: { locale: "fr" },
          headers: { "x-trace-id": "trace-read" },
        });

        assert.deepStrictEqual(read.body, { firstName: "Ada" });
        assert.strictEqual(read.headers.etag, '"v2"');
        assert.strictEqual(seen[0]?.url, "/api/profile?locale=fr");
        assert.strictEqual(seen[0]?.trace, "trace-read");
        const updated = yield* ProfileUpdate(request);
        assert.deepStrictEqual(updated.body, { firstName: "Grace" });
        assert.strictEqual(updated.headers.etag, '"v2"');
        assert.deepStrictEqual(seen[1], {
          method: "PATCH",
          url: "/api/profile",
          cookie: "session=valid",
          key: "save-42",
          etag: '"v1"',
          trace: "trace-save",
        });

        cookie = undefined;
        const denied = yield* Effect.flip(ProfileUpdate(request));

        if (!Schema.is(CredentialMissing)(denied))
          return assert.fail("expected the declared 401 problem");
        assert.strictEqual(denied._tag, "CredentialMissing");
        assert.strictEqual(seen[2]?.cookie, undefined);
        const raw401 = yield* HttpClient.get("/api/profile?locale=en");
        assert.strictEqual(raw401.status, 401);

        cookie = "session=valid";
        const client = yield* Client;
        const commands = ProfileCommandsFor(client, adapters);
        const before = seen.length;
        const discarded = commands.ProfileUpdate({ requestId: 17, request });
        assert.strictEqual(
          seen.length,
          before,
          "constructing and discarding a Command must be inert",
        );
        assert.strictEqual(discarded.name, "ProfileUpdate");
        assert.deepStrictEqual(
          yield* discarded.effect,
          ProfileUpdated.make({
            requestId: 17,
            profile: { firstName: "Grace" },
            etag: '"v2"',
          }),
        );
        assert.strictEqual(seen.length, before + 1, "a Command executes its client call once");

        cookie = undefined;
        const failed = yield* commands.ProfileUpdate({ requestId: 18, request }).effect;

        if (failed._tag !== "ProfileUpdateFailed")
          return assert.fail("expected failed Profile save");
        assert.strictEqual(failed.requestId, 18);
        assert.strictEqual(failed.failure._tag, "CredentialMissing");
        assert.strictEqual(seen.length, before + 2, "an expected failure never retries");
      }).pipe(Effect.provide(TestServer));

      const offline = HttpClient.make((request) =>
        Effect.fail(
          new HttpClientError.HttpClientError({
            reason: new HttpClientError.TransportError({ request, cause: "offline" }),
          }),
        ),
      );

      const OfflineClient = Client.layerWith({ baseUrl: "http://stub.invalid" }).pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, offline)),
      );

      const transport = yield* ProfileUpdate(request).pipe(
        Effect.flip,
        Effect.provide(OfflineClient),
      );

      if (!Schema.is(TransportFailure)(transport)) {
        return assert.fail("expected generated TransportFailure");
      }

      assert.strictEqual(transport._tag, "TransportFailure");
      assert.strictEqual(transport.operationId, "profile.update");

      if (!HttpClientError.isHttpClientError(transport.cause)) {
        return assert.fail("TransportFailure must preserve the original HttpClientError");
      }

      assert.strictEqual(transport.cause.reason._tag, "TransportError");

      if (transport.cause.reason._tag === "TransportError") {
        assert.strictEqual(transport.cause.reason.cause, "offline");
      }

      const started = yield* Deferred.make<void>();
      let signal: AbortSignal | undefined;
      let listenerRegistered = false;

      const pending = HttpClient.make((request, _url, abortSignal) =>
        Effect.gen(function* () {
          signal = abortSignal;
          yield* Deferred.succeed(started, undefined);

          return yield* Effect.callback<
            HttpClientResponse.HttpClientResponse,
            HttpClientError.HttpClientError
          >((resume) => {
            const onAbort = () => {
              abortSignal.removeEventListener("abort", onAbort);
              listenerRegistered = false;
              resume(
                Effect.fail(
                  new HttpClientError.HttpClientError({
                    reason: new HttpClientError.TransportError({ request, cause: "aborted" }),
                  }),
                ),
              );
            };

            if (abortSignal.aborted) onAbort();
            else {
              abortSignal.addEventListener("abort", onAbort, { once: true });
              listenerRegistered = true;
            }

            return Effect.sync(() => {
              if (listenerRegistered) abortSignal.removeEventListener("abort", onAbort);
              listenerRegistered = false;
            });
          });
        }),
      );

      const PendingClient = Client.layerWith({ baseUrl: "http://stub.invalid" }).pipe(
        Layer.provide(Layer.succeed(HttpClient.HttpClient, pending)),
      );

      yield* Effect.gen(function* () {
        const client = yield* Client;
        const commands = ProfileCommandsFor(client, adapters);

        const fiber = yield* Effect.forkChild(
          commands.ProfileUpdate({ requestId: 19, request }).effect,
        );

        yield* Deferred.await(started).pipe(Effect.timeout("2 seconds"));
        yield* Fiber.interrupt(fiber).pipe(Effect.timeout("2 seconds"));
        assert.isTrue(signal?.aborted, "the transport AbortSignal must be canceled");
        assert.isFalse(listenerRegistered, "the transport abort listener must be released");
        assert.isTrue(Exit.hasInterrupts(yield* Fiber.await(fiber)));
      }).pipe(Effect.provide(PendingClient));
    }).pipe(Effect.scoped, Effect.provide(BunServices.layer)),
  20_000,
);
