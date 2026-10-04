import type { Extension } from "../Extension.ts";
import { accessContractExtension } from "./access-contract.ts";
import { cli } from "./cli.ts";
import { client } from "./client.ts";
import { core } from "./core.ts";
import { foldkitExtension } from "./foldkit.ts";
import { http } from "./http.ts";
import { httpContractExtension } from "./http-contract.ts";
import { httpGroupExtension } from "./http-group.ts";
import { problemContract } from "./problem-contract.ts";
import { rpc } from "./rpc.ts";

export {
  accessContractExtension,
  cli,
  client,
  core,
  foldkitExtension,
  http,
  httpContractExtension,
  httpGroupExtension,
  problemContract,
  rpc,
};

export { operationIdOf } from "./core.ts";

/** Built-ins interpret both transport exposures and their graph-owned contract metadata. */
export const builtin: ReadonlyArray<Extension> = [
  core,
  http,
  foldkitExtension,
  httpContractExtension,
  httpGroupExtension,
  accessContractExtension,
  problemContract,
  rpc,
  cli,
  client,
];
