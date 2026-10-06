import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { StableId } from "@effx/ir";
import { compileCollected, interpret } from "../src/pipeline.ts";
import { builtin } from "../src/extensions/index.ts";
import type { Collected, Declaration, GroupBinding } from "../src/Collected.ts";
import { resolveBindings } from "../src/bindings.ts";
import { bundledDiagnosticEntries, HttpDiagnostics } from "../src/diagnostics/index.ts";

const binding: GroupBinding = {
  group: { module: "./contract", export: "ProfileGroup" },
  handlers: { module: "./backend", export: "makeRaw" },
  guards: { module: "./backend", export: "makeGuards" },
};

const declarations: ReadonlyArray<Declaration> = [
  {
    id: "ProfileGroup",
    kind: "builder",
    module: "./contract",
    export: "ProfileGroup",
    annotations: [
      {
        name: "Http.Group",
        args: [
          {
            root: {
              _tag: "Symbol",
              ref: { module: "./root", export: "Api" },
              identifier: "application",
            },
            group: "profile",
          },
        ],
      },
    ],
  },
  {
    id: "read",
    kind: "builder",
    module: "./contract",
    export: "read",
    binding: "external",
    annotations: [
      {
        name: "Query",
        args: [
          {
            name: "profile.read",
            input: {
              _tag: "Schema",
              ref: {
                module: "./schemas",
                export: "Input",
                symbolId: StableId.make("schema", "Input"),
              },
            },
            success: {
              _tag: "Schema",
              ref: {
                module: "./schemas",
                export: "Success",
                symbolId: StableId.make("schema", "Success"),
              },
            },
          },
        ],
      },
      { name: "Http.In", args: [{ _tag: "Symbol", ref: binding.group }] },
      { name: "Http.Get", args: ["/profile"] },
      {
        name: "Http.Contract",
        args: [
          {
            root: "application",
            group: "profile",
            success: {
              _tag: "Schema",
              ref: {
                module: "./schemas",
                export: "Success",
                symbolId: StableId.make("schema", "Success"),
              },
            },
            metadata: { operationId: "profile.read" },
          },
        ],
      },
    ],
  },
];

const collected: Collected = { declarations, diagnostics: [], bindings: [binding] };

// These laws use the real interpreters/pre-pass, not manually invented HTTP nodes.
describe("binding generation admission", () => {
  it("resolves canonical group references without contributing a node or edge", () => {
    const plain = interpret({ ...collected, bindings: [] }, builtin);
    const bound = interpret(collected, builtin);
    assert.deepStrictEqual(bound, plain);
    const resolved = resolveBindings(collected, Option.getOrThrow(bound.value));
    assert.deepStrictEqual(resolved, {
      bindings: [{ binding, root: "application", group: "profile" }],
      diagnostics: [],
    });
  });

  it.effect("ignores even an invalid binding in contract mode and runs no inventory resolver", () =>
    Effect.gen(function* () {
      const result = yield* compileCollected(
        {
          ...collected,
          bindings: [{ ...binding, group: { module: "./none", export: "Missing" } }],
          project: {
            target: "effect-4.0",
            emit: "contract",
            allowImportingTsExtensions: false,
            canonicalImportBase: "/source/.effx/generated",
            outputDir: "/artifacts/contract",
          },
          resolveHttpApiInventory: () => Effect.die("contract mode cannot need endpoint inventory"),
        },
        builtin,
      );

      assert.deepStrictEqual(
        result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        [],
      );
      assert.isTrue(Option.isSome(result.files.value));
    }),
  );

  it("rejects duplicate references before generation even across frontend entry sinks", () => {
    const ir = Option.getOrThrow(interpret(collected, builtin).value);
    const result = resolveBindings({ ...collected, bindings: [binding, binding] }, ir);
    assert.deepStrictEqual(
      result.diagnostics.map((diagnostic) => diagnostic.code),
      ["EFFX2422"],
    );
  });

  it("rejects source-owned operations and groups with no external operation", () => {
    const ir = Option.getOrThrow(interpret(collected, builtin).value);

    const local = {
      ...ir,
      nodes: ir.nodes.map((node) =>
        node._tag === "Operation"
          ? { ...node, handler: { module: "./local", export: "read" } }
          : node,
      ),
    };

    assert.deepStrictEqual(
      resolveBindings(collected, local).diagnostics.map((diagnostic) => diagnostic.code),
      ["EFFX2424"],
    );
    assert.deepStrictEqual(
      resolveBindings(collected, {
        ...ir,
        nodes: ir.nodes.filter((node) => node._tag !== "Operation"),
      }).diagnostics.map((diagnostic) => diagnostic.code),
      ["EFFX2424"],
    );
  });

  it("registers each binding failure as one fixed-severity Schema factory", () => {
    for (const code of ["EFFX2420", "EFFX2421", "EFFX2422", "EFFX2423", "EFFX2424"] as const) {
      const factory = HttpDiagnostics[code];
      assert.strictEqual(bundledDiagnosticEntries.filter((entry) => entry.code === code).length, 1);
      assert.strictEqual(factory.emit({ subject: "ProfileBinding" }).severity, "error");
      assert.deepStrictEqual(factory.entry.severityPolicy, { kind: "fixed" });
    }
  });
});
