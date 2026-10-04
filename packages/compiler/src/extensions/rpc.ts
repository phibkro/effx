import type { Extension } from "../Extension.ts";
import { rpcGenerator } from "../generate/rpc.ts";
import { rpcInterpreters } from "./transports.ts";

/** `@Rpc` → `Exposure{rpc}`; generates `rpc.ts` (`Rpc`/`RpcGroup`). */
export const rpc: Extension = {
  name: "rpc",
  interpreters: rpcInterpreters,
  analyses: [],
  generators: [rpcGenerator],
};
