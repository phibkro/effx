import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import { HttpServerResponse } from "effect/http";

export default Cloudflare.Worker(
  "UsersWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    return { fetch: Effect.succeed(HttpServerResponse.text("ok")) };
  }),
);
