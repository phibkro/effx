import { BunHttpServer, BunRuntime } from "@effect/platform-bun";
import { Config, Effect, Layer } from "effect";
import { routes } from "./server.ts";

const Server = Layer.unwrap(
  Effect.gen(function* () {
    const adapter = yield* Config.Literals(["sql", "drizzle"], "ADAPTER").pipe(
      Config.withDefault("sql"),
    );

    const port = yield* Config.Number("PORT").pipe(Config.withDefault(3000));

    return routes(adapter).pipe(Layer.provide(BunHttpServer.layer({ port })));
  }),
);

BunRuntime.runMain(Layer.launch(Server));
