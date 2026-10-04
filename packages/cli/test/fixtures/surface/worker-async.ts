import * as Cloudflare from "alchemy/Cloudflare";

// Async Worker form: the runtime implementation is the `main` file, followed by literal path.
export const Worker = Cloudflare.Worker("UsersWorker", { main: "./impl.ts" });
