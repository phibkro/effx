import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Config, Effect, Layer } from "effect";
import { Client, UserChangeEmail, UserGet } from "../.effx/generated/client.ts";
import { Email, UserId } from "./schemas.ts";

const ClientAtUrl = Layer.unwrap(
  Effect.map(
    Config.String("EFFX_URL").pipe(Config.withDefault("http://localhost:3000")),
    Client.layerAt,
  ),
);

const main = Effect.gen(function* () {
  const id = UserId.make("1");
  yield* Effect.logInfo("User.Get", yield* UserGet({ id }));
  yield* Effect.logInfo(
    "User.ChangeEmail",
    yield* UserChangeEmail({ id, email: Email.make("alice+updated@example.com") }),
  );
}).pipe(Effect.provide(Layer.mergeAll(ClientAtUrl, BunServices.layer)));

BunRuntime.runMain(main);
