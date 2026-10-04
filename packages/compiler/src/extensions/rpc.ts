import { extension } from "../annotation.ts";
import type { Extension } from "../Extension.ts";
import { rpcGenerator } from "../generate/rpc.ts";
import { rpcImplementations } from "./transports.ts";

/** `@Rpc` → `Exposure{rpc}`; generates `rpc.ts` (`Rpc`/`RpcGroup`). */
export const rpc: Extension = extension("rpc", rpcImplementations, { generators: [rpcGenerator] });
