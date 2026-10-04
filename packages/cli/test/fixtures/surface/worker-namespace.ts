import * as Cloudflare from "alchemy/Cloudflare";
import * as Generated from "./.effx/generated/http.ts";

declare const name: "AppRoutes" | "Api";

export default Cloudflare.Worker("UsersWorker", { main: import.meta.url }, Generated[name]);
