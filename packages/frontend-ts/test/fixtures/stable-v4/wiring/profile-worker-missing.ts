import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";

export default Cloudflare.Worker(
  "ProfileWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    return { fetch: Effect.succeed("ok") };
  }),
);
