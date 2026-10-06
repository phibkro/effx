import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Predicate, Result, Schema } from "effect";
import { IRGraph, StableId, make, type Edge, type Node, type OperationNode } from "@effx/ir";
import { accessContractExtension, AccessContractData } from "../src/extensions/access-contract.ts";
import type { AnnotationArg, Declaration } from "../src/Collected.ts";
import type { Diagnostic } from "../src/Diagnostic.ts";

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

const contactResolver = { module: "contact/access", export: "ContactDepartmentRecipient" };

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

/** The mono-web Contact declaration: an ObjectCapability CapabilityHolder, no requirements. */
const contact = {
  annotator: { _tag: "Symbol", ref: annotator },
  exposure: "External",
  acceptedCredentials: ["ObjectCapability"],
  principalKinds: ["CapabilityHolder"],
  capabilities: { _tag: "One", capability: "contact.submit" },
  requirements: [],
  canonicalScopeResolver: { _tag: "Symbol", ref: contactResolver },
  concealment: { _tag: "Reveal" },
  decisionTime: "SnapshotRead",
} satisfies AnnotationArg;

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

/** Cached IR can hold a claim the interpreter never writes: `false`, or a bare `true`. */
const cachedClaim = (node: Node, claim: boolean | undefined): Node => {
  if (claim === undefined || node._tag !== "Extension") return node;
  const decoded = Schema.decodeUnknownResult(AccessContractData)(node.data);

  return Result.isSuccess(decoded)
    ? { ...node, data: { ...decoded.success, snapshotDecisionForCommand: claim } }
    : node;
};

const analyze = ({
  access = true,
  arg,
  claim,
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
  arg?: AnnotationArg;
  claim?: boolean;
  credentials?: ReadonlyArray<string>;
  decisionTime?: "SnapshotRead" | "Transaction";
  kind?: "Query" | "Command";
  http?: boolean;
  marker?: boolean;
  middleware?: boolean;
  unrelatedMarker?: boolean;
  strictAccess?: boolean;
} = {}) => {
  const contribution = access ? interpret(arg ?? options(credentials, decisionTime)) : undefined;
  const contributed = contribution?.nodes.map((node) => cachedClaim(node, claim)) ?? [];
  const nodes: Array<Node> = [operation(kind), ...contributed];
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

/** The raw IR data of the one AccessContract an interpretation contributes. */
const contractData = (arg: AnnotationArg) => {
  const node = interpret(arg).nodes[0];

  if (node?._tag !== "Extension" || !Predicate.isObject(node.data))
    return assert.fail("expected one AccessContract extension node with object data");

  return node.data;
};

/** The nine IR keys an AccessContract had before `snapshotDecisionForCommand` existed. */
const existingKeys = [
  "acceptedCredentials",
  "annotator",
  "canonicalScopeResolver",
  "capabilities",
  "concealment",
  "decisionTime",
  "exposure",
  "principalKinds",
  "requirements",
];

const codes = (diagnostics: ReadonlyArray<Diagnostic>) => diagnostics.map((d) => d.code);

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
        { snapshotDecisionForCommand: "true" },
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
      assert.deepStrictEqual(
        codes(interpret({ ...contact, snapshotDecisionForCommand: "yes" }).diagnostics),
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

describe("Http.Access snapshotDecisionForCommand", () => {
  it.effect("accepts the claim on exactly the Contact shape", () =>
    Effect.sync(() => {
      const claimed = { ...contact, snapshotDecisionForCommand: true };

      assert.deepStrictEqual(analyze({ kind: "Command", arg: claimed }), []);
      assert.deepStrictEqual(analyze({ kind: "Command", arg: claimed, strictAccess: true }), []);
    }),
  );

  it.effect("keeps EFFX2501 on the same Command when the claim is absent or false", () =>
    Effect.sync(() => {
      const explicitFalse = { ...contact, snapshotDecisionForCommand: false };

      for (const arg of [contact, explicitFalse]) {
        assert.deepStrictEqual(codes(analyze({ kind: "Command", arg })), ["EFFX2501"]);
      }
    }),
  );

  it.effect("reports EFFX2506 and keeps EFFX2501 when a claimed Command has requirements", () =>
    Effect.sync(() => {
      const arg = {
        ...contact,
        snapshotDecisionForCommand: true,
        requirements: [{ id: "contact.owner" }],
      };

      const diagnostics = analyze({ kind: "Command", arg });

      assert.deepStrictEqual(codes(diagnostics), ["EFFX2501", "EFFX2506"]);
      assert.isTrue(diagnostics.every((d) => d.severity === "error"));
    }),
  );

  it.effect("rejects the claim on a Query or a Transaction decision", () =>
    Effect.sync(() => {
      const claimed = { ...contact, snapshotDecisionForCommand: true };
      const transaction = { ...claimed, decisionTime: "Transaction" };

      const queryRead = analyze({ kind: "Query", arg: claimed });
      const commandTransaction = analyze({ kind: "Command", arg: transaction });
      const queryTransaction = analyze({ kind: "Query", arg: transaction });

      assert.deepStrictEqual(codes(queryRead), ["EFFX2506"]);
      assert.deepStrictEqual(codes(commandTransaction), ["EFFX2506"]);
      assert.deepStrictEqual(codes(queryTransaction), ["EFFX2502", "EFFX2506"]);
    }),
  );

  it.effect("rejects a wrong or mixed credential set", () =>
    Effect.sync(() => {
      const claimed = { ...contact, snapshotDecisionForCommand: true };

      const credentials = [
        ["BetterAuthCookie"],
        ["None"],
        ["ObjectCapability", "BetterAuthCookie"],
        ["ObjectCapability", "None"],
      ];

      for (const acceptedCredentials of credentials) {
        const arg = { ...claimed, acceptedCredentials };
        const diagnostics = analyze({ kind: "Command", arg });

        assert.deepStrictEqual(
          codes(diagnostics),
          ["EFFX2501", "EFFX2506"],
          acceptedCredentials.join(" + "),
        );
      }
    }),
  );

  it.effect("rejects a wrong or mixed principal set", () =>
    Effect.sync(() => {
      const claimed = { ...contact, snapshotDecisionForCommand: true };
      const principals = [["Person"], ["Anonymous"], ["CapabilityHolder", "Person"]];

      for (const principalKinds of principals) {
        const arg = { ...claimed, principalKinds };
        const diagnostics = analyze({ kind: "Command", arg });

        assert.deepStrictEqual(
          codes(diagnostics),
          ["EFFX2501", "EFFX2506"],
          principalKinds.join(" + "),
        );
      }
    }),
  );

  it.effect("records the claim in the IR only when it is true", () =>
    Effect.sync(() => {
      const claimed = contractData({ ...contact, snapshotDecisionForCommand: true });
      const explicitFalse = { ...contact, snapshotDecisionForCommand: false };
      const expected = [...existingKeys, "snapshotDecisionForCommand"];

      for (const arg of [options(), contact, explicitFalse]) {
        assert.deepStrictEqual(Object.keys(contractData(arg)).toSorted(), existingKeys);
      }

      assert.deepStrictEqual(Object.keys(claimed).toSorted(), expected);
      assert.strictEqual(claimed.snapshotDecisionForCommand, true);
    }),
  );

  it.effect("reads the claim from cached IR, where only true is a claim", () =>
    Effect.sync(() => {
      const cachedFalse = analyze({ kind: "Command", arg: contact, claim: false });
      const cachedTrue = analyze({ kind: "Command", arg: contact, claim: true });

      const cachedFalseSafe = analyze({
        kind: "Command",
        decisionTime: "Transaction",
        claim: false,
      });

      assert.deepStrictEqual(codes(cachedFalse), ["EFFX2501"]);
      assert.deepStrictEqual(cachedTrue, []);
      assert.deepStrictEqual(cachedFalseSafe, []);
    }),
  );
});
