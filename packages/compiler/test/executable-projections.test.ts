import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { expectTypeOf } from "vitest";
import {
  IRGraph,
  StableId,
  make,
  type Edge,
  type Node,
  type OperationNode,
  type SchemaRef,
} from "@effx/ir";
import type { CompilerFault } from "../src/CompilerFault.ts";
import type { GenerationContext } from "../src/Extension.ts";
import { cliGenerator } from "../src/generate/cli.ts";
import { rpcGenerator } from "../src/generate/rpc.ts";

const input: SchemaRef = {
  module: "../../src/schemas",
  export: "Input",
  symbolId: StableId.make("schema", "app/Input"),
};

const success: SchemaRef = {
  module: "../../src/schemas",
  export: "Success",
  symbolId: StableId.make("schema", "app/Success"),
};

const problem: SchemaRef = {
  module: "../../src/schemas",
  export: "Problem",
  symbolId: StableId.make("schema", "app/Problem"),
};

const operation = (name: string, external: boolean): OperationNode => ({
  _tag: "Operation",
  id: StableId.make("operation", name),
  name,
  kind: "Command",
  input,
  success,
  errors: { values: [problem], inferred: !external },
  requirements: { values: [], inferred: !external },
  ...(external
    ? { binding: "external" as const }
    : { handler: { module: "../../src/operations", export: "execute" } }),
});

const fixture = (includeLocal: boolean) => {
  const operations = [
    operation("App.External", true),
    ...(includeLocal ? [operation("App.Local", false)] : []),
  ];

  const nodes: Array<Node> = [...operations];
  const edges: Array<Edge> = [];

  for (const op of operations) {
    const rpcId = StableId.make("exposure", `rpc:${op.name}`);
    const cliId = StableId.make("exposure", `cli:${op.name}`);
    nodes.push(
      {
        _tag: "Exposure",
        id: rpcId,
        operation: op.id,
        transport: { _tag: "rpc", name: op.name },
      },
      {
        _tag: "Exposure",
        id: cliId,
        operation: op.id,
        transport: { _tag: "cli", command: [op.name] },
      },
    );
    edges.push(
      { kind: "ExposedAs", from: op.id, to: rpcId, qualifier: "rpc" },
      { kind: "ExposedAs", from: op.id, to: cliId, qualifier: "cli" },
    );
  }

  const ir = make(nodes, edges);

  return { ir, index: IRGraph.toGraph(ir) };
};

const rc: GenerationContext = {
  target: "effect-4.0-rc",
  emit: "all",
  allowImportingTsExtensions: false,
  canonicalImportBase: "/app/.effx/generated",
  outputDir: "/app/output",
};

describe("executable RPC and CLI projections", () => {
  it.effect("keeps file, fault, and dependency channels explicit", () =>
    Effect.sync(() => {
      const { ir, index } = fixture(true);

      for (const generator of [rpcGenerator, cliGenerator]) {
        const generated = generator(ir, index, rc);
        expectTypeOf<Effect.Success<typeof generated>>().toEqualTypeOf<
          ReadonlyArray<{ readonly path: string; readonly contents: string }>
        >();
        expectTypeOf<Effect.Error<typeof generated>>().toEqualTypeOf<CompilerFault>();
        expectTypeOf<Effect.Services<typeof generated>>().toEqualTypeOf<never>();
      }
    }),
  );

  it.effect("does not emit placeholder files or fake calls for external-only operations", () =>
    Effect.gen(function* () {
      const { ir, index } = fixture(false);

      for (const emit of ["contract", "handlers", "all"] as const) {
        const context: GenerationContext = { ...rc, emit };
        assert.deepStrictEqual(yield* rpcGenerator(ir, index, context), []);
        assert.deepStrictEqual(yield* cliGenerator(ir, index, context), []);
      }
    }),
  );

  it.effect("limits all-mode handlers to locally bound operations and maps rc imports", () =>
    Effect.gen(function* () {
      const { ir, index } = fixture(true);
      const [rpc] = yield* rpcGenerator(ir, index, rc);
      const [cli] = yield* cliGenerator(ir, index, rc);
      const rpcText = Option.getOrThrow(Option.fromUndefinedOr(rpc)).contents;
      const cliText = Option.getOrThrow(Option.fromUndefinedOr(cli)).contents;

      assert.include(rpcText, 'Rpc.make("App.Local"');
      assert.include(rpcText, 'from "effect/unstable/rpc"');
      assert.include(rpcText, 'from "effect/unstable/http"');
      assert.include(rpcText, 'from "effect/unstable/net"');
      assert.include(rpcText, 'from "../src/schemas.js"');
      assert.include(rpcText, 'from "../src/operations.js"');
      assert.notInclude(rpcText, 'Rpc.make("App.External"');
      assert.notInclude(rpcText, '"App.External": (payload)');

      assert.include(cliText, 'from "effect/unstable/cli"');
      assert.include(cliText, 'from "../src/schemas.js"');
      assert.include(cliText, 'from "../src/operations.js"');
      assert.include(cliText, 'Command.make("App.Local"');
      assert.notInclude(cliText, 'Command.make("App.External"');

      const ts = { ...rc, allowImportingTsExtensions: true };
      const [tsRpc] = yield* rpcGenerator(ir, index, ts);
      const [tsCli] = yield* cliGenerator(ir, index, ts);
      assert.include(tsRpc!.contents, 'from "../src/schemas.ts"');
      assert.include(tsCli!.contents, 'from "../src/operations.ts"');
    }),
  );
});
