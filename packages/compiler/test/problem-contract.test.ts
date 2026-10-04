import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { IRGraph, StableId, make, type OperationNode, type SchemaRef } from "@effx/ir";
import { problemContract, ProblemContractData } from "../src/extensions/problem-contract.ts";
import type { AnnotationArg, Declaration } from "../src/Collected.ts";

const operationId = StableId.make("operation", "User.Get");

const errorRef: SchemaRef = {
  module: "users/errors",
  export: "UserNotFound",
  symbolId: StableId.make("schema", "users/UserNotFound"),
};

const operation: OperationNode = {
  _tag: "Operation",
  id: operationId,
  name: "User.Get",
  kind: "Query",
  input: {
    module: "users/schemas",
    export: "Input",
    symbolId: StableId.make("schema", "users/Input"),
  },
  success: {
    module: "users/schemas",
    export: "Output",
    symbolId: StableId.make("schema", "users/Output"),
  },
  errors: { values: [errorRef], inferred: true },
  requirements: { values: [], inferred: true },
  handler: { module: "users/operations", export: "User", member: "get" },
};

const registry = { module: "users/problems", export: "UserProblemResponses" };

type SchemaErrorTypeRef = {
  _tag: "Schema";
  ref: SchemaRef;
  httpStatus?: number;
  errorTag?: string;
};

type ProblemOptions = {
  registry: { _tag: "Symbol"; ref: typeof registry };
  codes: string[];
  map?: Record<string, string>;
};

const declaration = (httpStatus?: number, errorTag?: string): Declaration => {
  const schemaError: SchemaErrorTypeRef = {
    _tag: "Schema",
    ref: errorRef,
  };

  if (httpStatus !== undefined) schemaError.httpStatus = httpStatus;

  if (errorTag !== undefined) schemaError.errorTag = errorTag;

  return {
    id: "User.get",
    kind: "staticMethod",
    module: "users/operations",
    export: "User",
    member: "get",
    annotations: [],
    handlerSignature: {
      success: { _tag: "Schema", ref: operation.success },
      errors: [schemaError],
      requirements: [],
    },
  };
};

const annotate = (options: AnnotationArg, httpStatus?: number, errorTag?: string) =>
  problemContract.interpreters["Http.Problems"]!(
    { name: "Http.Problems", args: [options] },
    declaration(httpStatus, errorTag),
    { operationId: Option.some(operationId) },
  );

const diagnostics = (
  options: AnnotationArg,
  httpStatus?: number,
  expose = true,
  errorTag?: string,
) => {
  const contribution = annotate(options, httpStatus, errorTag);
  const exposureId = StableId.make("exposure", "http:User.Get");

  const ir = make(
    [
      operation,
      ...contribution.nodes,
      ...(expose
        ? [
            {
              _tag: "Exposure" as const,
              id: exposureId,
              operation: operationId,
              transport: { _tag: "http" as const, method: "GET" as const, path: "/users/:id" },
            },
          ]
        : []),
    ],
    [
      ...contribution.edges,
      ...(expose
        ? [{ kind: "ExposedAs" as const, from: operationId, to: exposureId, qualifier: "http" }]
        : []),
    ],
  );

  return problemContract.analyses.flatMap((analysis) =>
    analysis(ir, IRGraph.toGraph(ir), { strictAccess: false }),
  );
};

const options = (map?: Record<string, string>): AnnotationArg => {
  const args: ProblemOptions = {
    registry: { _tag: "Symbol", ref: registry },
    codes: ["user.not-found"],
  };

  if (map !== undefined) args.map = map;

  return args;
};

// Type-level contract: the decoder retains the exact JSON payload shape.
type DecodedData = ProblemContractData;

const _registryType: DecodedData["registry"] = registry;

void _registryType;

describe("Http.Problems extension", () => {
  it.effect("construction is lazy, and contributes only JSON IR and ExtensionOf", () =>
    Effect.sync(() => {
      const contribution = annotate(options({ UserNotFound: "user.not-found" }));
      assert.deepStrictEqual(contribution.diagnostics, []);
      assert.strictEqual(contribution.nodes[0]?._tag, "Extension");
      assert.deepStrictEqual(contribution.edges, [
        {
          kind: "ExtensionOf",
          from: StableId.make("ext", "problem-contract/User.Get"),
          to: operationId,
          qualifier: "ProblemContract",
        },
      ]);
      assert.isTrue(
        Schema.decodeUnknownResult(ProblemContractData)(
          contribution.nodes[0] && contribution.nodes[0]._tag === "Extension"
            ? contribution.nodes[0].data
            : undefined,
        )._tag === "Success",
      );
    }),
  );

  it.effect("unmapped domain error is EFFX2205; mapped one is accepted", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        diagnostics(options()).map((d) => d.code),
        ["EFFX2205"],
      );
      assert.deepStrictEqual(diagnostics(options({ UserNotFound: "user.not-found" })), []);
    }),
  );

  it.effect("only sourced status metadata exempts an unmapped error", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(diagnostics(options(), 404), []);
      const data = annotate(options(), 404).nodes[0];
      assert.deepStrictEqual(
        data?._tag === "Extension"
          ? Schema.decodeUnknownResult(ProblemContractData)(data.data)._tag
          : undefined,
        "Success",
      );
      assert.deepStrictEqual(
        diagnostics(options()).map((d) => d.code),
        ["EFFX2205"],
      );
    }),
  );

  it.effect("maps literal ErrorTag rather than the exported symbol name", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        diagnostics(
          options({ "user.notFound": "user.not-found" }),
          undefined,
          true,
          "user.notFound",
        ),
        [],
      );
      assert.deepStrictEqual(diagnostics(options(), 404, true, "user.notFound"), []);
      assert.deepStrictEqual(
        diagnostics(
          options({ UserNotFound: "user.not-found" }),
          undefined,
          true,
          "user.notFound",
        ).map((d) => d.code),
        ["EFFX2205", "EFFX2205"],
      );
    }),
  );

  it.effect("invalid mapping and absent HTTP exposure are diagnostics", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        diagnostics(options({ UserNotFound: "user.other" })).map((d) => d.code),
        ["EFFX2206"],
      );
      assert.deepStrictEqual(
        diagnostics(options({ UserNotFound: "user.not-found" }), undefined, false).map(
          (d) => d.code,
        ),
        ["EFFX2402"],
      );
    }),
  );

  it.effect(
    "rejects malformed args and duplicate codes without constructing an invalid contract",
    () =>
      Effect.sync(() => {
        assert.deepStrictEqual(
          annotate({ registry: { _tag: "Symbol", ref: registry }, codes: [] }).diagnostics.map(
            (d) => d.code,
          ),
          ["EFFX1102"],
        );
        assert.deepStrictEqual(
          diagnostics({ registry: { _tag: "Symbol", ref: registry }, codes: ["same", "same"] }).map(
            (d) => d.code,
          ),
          ["EFFX2402", "EFFX2205"],
        );
      }),
  );
});
