import { Option } from "effect";
import { Builtins } from "@effx/runtime";
import { type HttpMethod, StableId, type Transport } from "@effx/ir";
import { Contribution } from "../Extension.ts";
import { type Implementation, implement } from "../annotation.ts";
import { notAnOperation } from "./core.ts";

/** The seven annotations whose single argument is one string (a path, a name, a command line). */
type StringExposure =
  | typeof Builtins.HttpGet
  | typeof Builtins.HttpPost
  | typeof Builtins.HttpPut
  | typeof Builtins.HttpPatch
  | typeof Builtins.HttpDelete
  | typeof Builtins.Rpc
  | typeof Builtins.Cli;

/** One `Exposure` node plus its `ExposedAs` edge; transport-specific parsing is injected. */
const exposure = (
  definition: StringExposure,
  tag: Transport["_tag"],
  transport: (arg: string) => Transport,
): Implementation =>
  implement(definition, {
    notOperation: notAnOperation,
    read: ([arg], { ctx }) => {
      const operationId = Option.getOrThrow(ctx.operationId);
      const id = StableId.make("exposure", `${tag}:${StableId.nameOf(operationId)}`);

      return Contribution.make(
        [{ _tag: "Exposure", id, operation: operationId, transport: transport(arg) }],
        [{ kind: "ExposedAs", from: operationId, to: id, qualifier: tag }],
      );
    },
  });

const http = (definition: StringExposure, method: HttpMethod): Implementation =>
  exposure(definition, "http", (path) => ({ _tag: "http", method, path }));

export const httpImplementations: ReadonlyArray<Implementation> = [
  http(Builtins.HttpGet, "GET"),
  http(Builtins.HttpPost, "POST"),
  http(Builtins.HttpPut, "PUT"),
  http(Builtins.HttpPatch, "PATCH"),
  http(Builtins.HttpDelete, "DELETE"),
];

export const rpcImplementations: ReadonlyArray<Implementation> = [
  exposure(Builtins.Rpc, "rpc", (name) => ({ _tag: "rpc", name })),
];

export const cliImplementations: ReadonlyArray<Implementation> = [
  exposure(Builtins.Cli, "cli", (command) => ({
    _tag: "cli",
    command: command.split(/\s+/).filter((w) => w.length > 0),
  })),
];
