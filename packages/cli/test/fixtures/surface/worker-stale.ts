import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import { AppRoutes } from "./src/server.ts";
import { RemovedApiHandlers } from "./.effx/generated/removed-handlers.ts";

export default Cloudflare.Worker(
  "UsersWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    return { fetch: [AppRoutes, RemovedApiHandlers] };
  }),
);
