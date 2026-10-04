import * as Cloudflare from "alchemy/Cloudflare";
import * as Generated from "./.effx/generated/http.ts";

export default Cloudflare.Worker("UsersWorker", { main: import.meta.url }, Generated.AppRoutes);
