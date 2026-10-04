import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Config, Effect, Layer } from "effect";
import { AppRoutes } from "./server.ts";
import { Users } from "./services.ts";

const Server = Layer.unwrap(
  Effect.map(Config.Number("PORT").pipe(Config.withDefault(3000)), (port) =>
    AppRoutes.pipe(Layer.provide(Users.layer), Layer.provide(BunHttpServer.layer({ port }))),
  ),
);

BunRuntime.runMain(Layer.launch(Server));
