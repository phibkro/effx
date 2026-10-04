// Spec 0021 fixture: parsed, never executed or typechecked. Outside tsconfig.target.json on purpose.
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
import { ProfileApiHandlers } from "../project/handlers/.effx/generated/profile-handlers.js";

export default Cloudflare.Worker(
  "ProfileWorker",
  { main: import.meta.url },
  Effect.gen(function* () {
    return { fetch: ProfileApiHandlers };
  }),
);
