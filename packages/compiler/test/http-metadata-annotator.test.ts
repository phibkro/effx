import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result, Schema } from "effect";
import { IRGraph, StableId, make, type OperationNode } from "@effx/ir";
import type { Annotation, AnnotationArg, Declaration } from "../src/Collected.ts";
import { HttpContractData, httpContractExtension } from "../src/extensions/http-contract.ts";
import { httpGenerator } from "../src/generate/http.ts";

const ref = (name: string) => ({
  module: "./schemas",
  export: name,
  symbolId: StableId.make("schema", `profile/${name}`),
});

const annotator = { module: "./annotations", export: "annotateOperation" };

const operationId = StableId.make("operation", "Profile.Read");

const operation: OperationNode = {
  _tag: "Operation",
  id: operationId,
  name: "Profile.Read",
  kind: "Query",
  input: ref("Input"),
  success: ref("Success"),
  errors: { values: [], inferred: false },
  requirements: { values: [], inferred: false },
  binding: "external",
};

const interpret = (metadata: AnnotationArg) => {
  const annotation: Annotation = {
    name: "Http.Contract",
    args: [
      {
        root: "external",
        group: "profile",
        success: { _tag: "Schema", ref: ref("Success") },
        metadata,
      },
    ],
  };

  const declaration: Declaration = {
    id: "readOwnProfile",
    kind: "builder",
    module: "./profile",
    export: "readOwnProfile",
    binding: "external",
    annotations: [annotation],
  };

  return httpContractExtension.interpreters["Http.Contract"]!(annotation, declaration, {
    operationId: Option.some(operationId),
  });
};

const render = Effect.fnUntraced(function* (metadata: AnnotationArg) {
  const contribution = interpret(metadata);
  assert.deepStrictEqual(contribution.diagnostics, []);

  const ir = make(
    [
      {
        _tag: "HttpGroup",
        id: StableId.make("group", "external/profile"),
        root: "external",
        group: "profile",
        rootSymbol: { module: "./root", export: "ExternalApi" },
      },
      operation,
      {
        _tag: "Exposure",
        id: StableId.make("exposure", "http:Profile.Read"),
        operation: operationId,
        transport: { _tag: "http", method: "GET", path: "/profile" },
      },
      ...contribution.nodes,
    ],
    [
      ...contribution.edges,
      {
        kind: "ExposedAs",
        from: operationId,
        to: StableId.make("exposure", "http:Profile.Read"),
        qualifier: "http",
      },
    ],
  );

  const files = yield* httpGenerator(ir, IRGraph.toGraph(ir), {
    target: "effect-4.0",
    emit: "contract",
    allowImportingTsExtensions: false,
  });

  return files[0]!.contents;
});

describe("HTTP metadata annotator", () => {
  it.effect("keeps the exported symbol in JSON IR without evaluating it", () =>
    Effect.sync(() => {
      const result = interpret({
        annotator: { _tag: "Symbol", ref: annotator },
        operationId: "profile.readOwnProfile",
      });

      assert.deepStrictEqual(result.diagnostics, []);
      const extension = result.nodes[0];
      assert.strictEqual(extension?._tag, "Extension");

      if (extension?._tag !== "Extension") return assert.fail("expected HTTP contract IR");
      const decoded = Schema.decodeUnknownResult(HttpContractData)(extension.data);
      assert.isTrue(Result.isSuccess(decoded));

      if (Result.isFailure(decoded)) return assert.fail("expected decodable HTTP contract IR");
      assert.deepStrictEqual(decoded.success.metadata?.annotator, annotator);
    }),
  );

  it.effect(
    "imports the callable after built-in OpenAPI annotations with all optional fields",
    () =>
      Effect.gen(function* () {
        const full = yield* render({
          annotator: { _tag: "Symbol", ref: annotator },
          operationId: "profile.readOwnProfile",
          summary: "Read profile",
          description: "Current profile",
          tags: ["Profile"],
        });

        assert.include(full, 'annotateOperation } from "./annotations.js"');
        assert.include(
          full,
          '.annotateMerge(annotateOperation({ operationId: "profile.readOwnProfile", summary: "Read profile", description: "Current profile", tags: ["Profile"] }))',
        );
        assert.isBelow(full.indexOf("OpenApi.annotations("), full.indexOf("annotateOperation({"));

        const partial = yield* render({ annotator: { _tag: "Symbol", ref: annotator } });
        assert.include(partial, ".annotateMerge(annotateOperation({}))");
        assert.notInclude(partial, "undefined");
        const unchanged = yield* render({ operationId: "profile.readOwnProfile" });
        assert.notInclude(unchanged, "annotateOperation");
      }),
  );
});
