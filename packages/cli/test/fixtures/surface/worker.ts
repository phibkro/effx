// Spec 0021 fixture: parsed, never executed or typechecked. `alchemy` need not be installed.
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { AppRoutes } from "./src/server.ts";
import { Users } from "./src/services.ts";

export default class UsersWorker extends Cloudflare.Worker<UsersWorker>()(
  "UsersWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    return { fetch: HttpRouter.toHttpEffect(AppRoutes.pipe(Layer.provide(Users.layer))) };
  }),
) {}
