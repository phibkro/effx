import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result, Schema } from "effect";
import { IRGraph, StableId, make, type Edge, type Node, type OperationNode } from "@effx/ir";
import { accessContractExtension, AccessContractData } from "../src/extensions/access-contract.ts";
import type { AnnotationArg, Declaration } from "../src/Collected.ts";

const operationId = StableId.make("operation", "Profile.Read");

const input = {
  module: "profile/schemas",
  export: "ReadInput",
  symbolId: StableId.make("schema", "profile/ReadInput"),
};

const success = {
  module: "profile/schemas",
  export: "ProfileResponse",
  symbolId: StableId.make("schema", "profile/ProfileResponse"),
};

const annotator = { module: "profile/access", export: "profileAccessAnnotations" };

const resolver = { module: "profile/access", export: "ProfileCurrentPerson" };

const security = { module: "profile/security", export: "PersonSecurity" };

const ordinary = { module: "profile/logging", export: "RequestLogger" };

const _annotatorType: AccessContractData["annotator"] = annotator;

void _annotatorType;

const operation = (kind: "Query" | "Command" = "Query"): OperationNode => ({
  _tag: "Operation",
  id: operationId,
  name: "Profile.Read",
  kind,
  input,
  success,
  errors: { values: [], inferred: true },
  requirements: { values: [], inferred: true },
  handler: { module: "profile/operations", export: "Profile", member: "read" },
});

const options = (
  credentials: ReadonlyArray<string> = ["BetterAuthCookie", "OAuthUserBearer"],
  decisionTime: "SnapshotRead" | "Transaction" = "SnapshotRead",
): AnnotationArg => ({
  annotator: { _tag: "Symbol", ref: annotator },
  exposure: "External",
  acceptedCredentials: credentials,
  principalKinds: ["Person"],
  capabilities: { _tag: "One", capability: "profile.read-self" },
  requirements: [{ id: "profile.owner", parameters: { scope: "self" } }],
  canonicalScopeResolver: { _tag: "Symbol", ref: resolver },
  concealment: { _tag: "Reveal" },
  decisionTime,
});

const declaration = (arg: AnnotationArg, copies = 1): Declaration => ({
  id: "Profile.read",
  kind: "staticMethod",
  module: "profile/operations",
  export: "Profile",
  member: "read",
  annotations: Array.from({ length: copies }, () => ({ name: "Http.Access", args: [arg] })),
});

const interpret = (arg: AnnotationArg, copies = 1) =>
  accessContractExtension.interpreters["Http.Access"]!(
    { name: "Http.Access", args: [arg] },
    declaration(arg, copies),
    { operationId: Option.some(operationId) },
  );

const httpId = StableId.make("ext", "http-contract/Profile.Read");

const exposureId = StableId.make("exposure", "http:Profile.Read");

const analyze = ({
  access = true,
  credentials = ["BetterAuthCookie"],
  decisionTime = "SnapshotRead",
  kind = "Query",
  http = true,
  marker = true,
  middleware = true,
  unrelatedMarker = false,
  strictAccess = false,
}: {
  access?: boolean;
  credentials?: ReadonlyArray<string>;
  decisionTime?: "SnapshotRead" | "Transaction";
  kind?: "Query" | "Command";
  http?: boolean;
  marker?: boolean;
  middleware?: boolean;
  unrelatedMarker?: boolean;
  strictAccess?: boolean;
} = {}) => {
  const contribution = access ? interpret(options(credentials, decisionTime)) : undefined;
  const nodes: Array<Node> = [operation(kind), ...(contribution?.nodes ?? [])];
  const edges: Array<Edge> = [...(contribution?.edges ?? [])];

  if (http) {
    nodes.push({
      _tag: "Exposure",
      id: exposureId,
      operation: operationId,
      transport: { _tag: "http", method: "GET", path: "/api/profile" },
    });
    edges.push({ kind: "ExposedAs", from: operationId, to: exposureId, qualifier: "http" });
  }

  if (middleware) {
    nodes.push({
      _tag: "Extension",
      id: httpId,
      extension: "http-contract",
      tag: "HttpContract",
      data: {
        root: "effx",
        group: "profile",
        success,
        conditional: false,
        middleware: [unrelatedMarker ? ordinary : security],
        securityMiddleware: marker ? [security] : [],
      },
    });
    edges.push({ kind: "ExtensionOf", from: httpId, to: operationId, qualifier: "HttpContract" });
  }

  const ir = make(nodes, edges);

  return accessContractExtension.analyses.flatMap((analysis) =>
    analysis(ir, IRGraph.toGraph(ir), { strictAccess }),
  );
};

describe("Http.Access semantic contract", () => {
  it.effect("construction only contributes one JSON AccessContract and its owner edge", () =>
    Effect.sync(() => {
      const contributed = interpret(options());
      assert.deepStrictEqual(contributed.diagnostics, []);
      assert.deepStrictEqual(contributed.edges, [
        {
          kind: "ExtensionOf",
          from: StableId.make("ext", "access-contract/Profile.Read"),
          to: operationId,
          qualifier: "AccessContract",
        },
      ]);
      assert.strictEqual(contributed.nodes.length, 1);
      const node = contributed.nodes[0];
      assert.strictEqual(node?._tag, "Extension");

      if (node?._tag !== "Extension") return;
      assert.strictEqual(node.extension, "access-contract");
      assert.strictEqual(node.tag, "AccessContract");
      const decoded = Schema.decodeUnknownResult(AccessContractData)(node.data);
      assert.isTrue(Result.isSuccess(decoded));

      if (Result.isFailure(decoded)) return;
      assert.deepStrictEqual(decoded.success.annotator, annotator);
      assert.deepStrictEqual(decoded.success.canonicalScopeResolver, resolver);
      assert.deepStrictEqual(decoded.success.requirements, [
        { id: "profile.owner", parameters: { scope: "self" } },
      ]);
      assert.deepStrictEqual(analyze(), []);
    }),
  );

  it.effect("validates nonempty unique sets, tagged branches, and JSON parameters", () =>
    Effect.sync(() => {
      const valid = Schema.decodeResult(AccessContractData)({
        annotator,
        exposure: "Internal",
        acceptedCredentials: ["None"],
        principalKinds: ["Anonymous", "ServicePrincipal"],
        capabilities: { _tag: "All", capabilities: ["profile.read", "profile.audit"] },
        requirements: [{ id: "profile.owner", parameters: { nested: [1, true, null] } }],
        canonicalScopeResolver: resolver,
        concealment: { _tag: "NotFound", stages: ["resource"] },
        decisionTime: "SnapshotRead",
      });

      assert.isTrue(Result.isSuccess(valid));

      for (const invalid of [
        { acceptedCredentials: [] },
        { acceptedCredentials: ["None", "None"] },
        { principalKinds: [] },
        { principalKinds: ["Bot"] },
        { capabilities: { _tag: "Any", capabilities: [] } },
        { concealment: { _tag: "NotFound", stages: [] } },
        { requirements: [{ id: "profile.owner", parameters: { invalid: undefined } }] },
      ]) {
        const base = Result.isSuccess(valid) ? valid.success : undefined;
        assert.isTrue(
          Result.isFailure(Schema.decodeUnknownResult(AccessContractData)({ ...base, ...invalid })),
        );
      }
    }),
  );

  it.effect("rejects duplicate annotations, missing owners and malformed arguments", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        interpret(options(), 2).diagnostics.map((d) => d.code),
        ["EFFX2500"],
      );
      assert.deepStrictEqual(
        interpret(options([])).diagnostics.map((d) => d.code),
        ["EFFX1102"],
      );

      const unattached = accessContractExtension.interpreters["Http.Access"]!(
        { name: "Http.Access", args: [options()] },
        declaration(options()),
        { operationId: Option.none() },
      );

      assert.deepStrictEqual(
        unattached.diagnostics.map((d) => d.code),
        ["EFFX1103"],
      );
    }),
  );

  it.effect("detects duplicate and malformed cached-IR contracts", () =>
    Effect.sync(() => {
      const contribution = interpret(options(["None"]));
      const first = contribution.nodes[0];
      assert.strictEqual(first?._tag, "Extension");

      if (first?._tag !== "Extension") return;
      const decoded = Schema.decodeUnknownResult(AccessContractData)(first.data);
      assert.isTrue(Result.isSuccess(decoded));

      if (Result.isFailure(decoded)) return;

      const duplicate = {
        ...first,
        data: { ...decoded.success, decisionTime: "Transaction" },
      };

      const duplicated = make([operation(), first, duplicate], contribution.edges);
      assert.isTrue(
        accessContractExtension.analyses
          .flatMap((analysis) =>
            analysis(duplicated, IRGraph.toGraph(duplicated), { strictAccess: false }),
          )
          .some((diagnostic) => diagnostic.code === "EFFX2500"),
      );

      const malformed = make(
        [operation(), { ...first, data: { acceptedCredentials: [] } }],
        contribution.edges,
      );

      assert.deepStrictEqual(
        accessContractExtension.analyses
          .flatMap((analysis) =>
            analysis(malformed, IRGraph.toGraph(malformed), { strictAccess: false }),
          )
          .map((diagnostic) => diagnostic.code),
        ["EFFX2500"],
      );
    }),
  );

  it.effect("rejects Command SnapshotRead and warns on Query Transaction", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        analyze({ kind: "Command" }).map((d) => [d.code, d.severity]),
        [["EFFX2501", "error"]],
      );
      assert.deepStrictEqual(
        analyze({ decisionTime: "Transaction" }).map((d) => [d.code, d.severity]),
        [["EFFX2502", "warning"]],
      );
      assert.deepStrictEqual(analyze({ kind: "Command", decisionTime: "Transaction" }), []);
    }),
  );

  it.effect("requires the security marker, not merely ordinary HTTP middleware", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        analyze({ marker: false }).map((d) => d.code),
        ["EFFX2503"],
      );
      assert.deepStrictEqual(
        analyze({ middleware: false }).map((d) => d.code),
        ["EFFX2503"],
      );
      assert.deepStrictEqual(
        analyze({ unrelatedMarker: true }).map((d) => d.code),
        ["EFFX2503"],
      );
      assert.deepStrictEqual(analyze({ credentials: ["None"] }), []);
      assert.deepStrictEqual(
        analyze({ credentials: ["None", "OAuthServiceBearer"], marker: false }).map((d) => d.code),
        ["EFFX2503"],
      );
    }),
  );

  it.effect("only strictAccess escalates missing access on HTTP operations", () =>
    Effect.sync(() => {
      assert.deepStrictEqual(
        analyze({ access: false }).map((d) => [d.code, d.severity]),
        [["EFFX2504", "warning"]],
      );
      assert.deepStrictEqual(
        analyze({ access: false, strictAccess: true }).map((d) => [d.code, d.severity]),
        [["EFFX2504", "error"]],
      );
      assert.deepStrictEqual(analyze({ access: false, http: false }), []);
      assert.deepStrictEqual(
        analyze({ marker: false, strictAccess: true }).map((d) => [d.code, d.severity]),
        [["EFFX2503", "error"]],
      );
    }),
  );
});
