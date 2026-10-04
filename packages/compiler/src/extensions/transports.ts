import { Option, Result, Schema } from "effect";
import { type HttpMethod, StableId, type Transport } from "@effx/ir";
import { Contribution, type Interpreter } from "../Extension.ts";
import { decodeArgs } from "../args.ts";
import { notAnOperation } from "./core.ts";

const StringArg = Schema.Tuple([Schema.String]);

/** One `Exposure` node plus its `ExposedAs` edge; transport-specific parsing is injected. */
const exposure =
  (tag: Transport["_tag"], transport: (arg: string) => Transport): Interpreter =>
  (annotation, declaration, ctx) => {
    if (Option.isNone(ctx.operationId))
      return Contribution.diagnostics(notAnOperation(annotation, declaration));
    const operationId = ctx.operationId.value;

    return Result.match(decodeArgs(StringArg, annotation, declaration), {
      onFailure: (diagnostic) => Contribution.diagnostics(diagnostic),
      onSuccess: ([arg]) => {
        const id = StableId.make("exposure", `${tag}:${StableId.nameOf(operationId)}`);

        return Contribution.make(
          [{ _tag: "Exposure", id, operation: operationId, transport: transport(arg) }],
          [{ kind: "ExposedAs", from: operationId, to: id, qualifier: tag }],
        );
      },
    });
  };

const http = (method: HttpMethod): Interpreter =>
  exposure("http", (path) => ({ _tag: "http", method, path }));

export const httpInterpreters = {
  "Http.Get": http("GET"),
  "Http.Post": http("POST"),
  "Http.Put": http("PUT"),
  "Http.Patch": http("PATCH"),
  "Http.Delete": http("DELETE"),
} satisfies Readonly<Record<string, Interpreter>>;

export const rpcInterpreters = {
  Rpc: exposure("rpc", (name) => ({ _tag: "rpc", name })),
} satisfies Readonly<Record<string, Interpreter>>;

export const cliInterpreters = {
  Cli: exposure("cli", (command) => ({
    _tag: "cli",
    command: command.split(/\s+/).filter((w) => w.length > 0),
  })),
} satisfies Readonly<Record<string, Interpreter>>;
