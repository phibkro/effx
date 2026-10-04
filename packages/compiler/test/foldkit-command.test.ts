import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { IRGraph, StableId, make, type Edge, type Node, type OperationNode } from "@effx/ir";
import type { AnnotationArg, Declaration } from "../src/Collected.ts";
import { foldkitExtension } from "../src/extensions/foldkit.ts";
import type { HttpContractData } from "../src/extensions/http-contract.ts";
import { foldkitGenerator } from "../src/generate/foldkit.ts";
import type { GenerationContext } from "../src/Extension.ts";

type HttpContractDraft = { -readonly [K in keyof HttpContractData]: HttpContractData[K] };

const operationId = StableId.make("operation", "Profile.Update");

const exposureId = StableId.make("exposure", "http:Profile.Update");

const contractId = StableId.make("ext", "http-contract/Profile.Update");

const accessId = StableId.make("ext", "access-contract/Profile.Update");

const ref = (name: string) => ({
  module: "profile/schema",
  export: name,
  symbolId: StableId.make("schema", `profile/${name}`),
});

const input = ref("UpdateInput");

const success = ref("ProfileResponse");

const successMessage = ref("ProfileUpdated");

const failureMessage = ref("ProfileUpdateFailed");

const messageOptions: AnnotationArg = {
  success: { _tag: "Schema", ref: successMessage },
  failure: { _tag: "Schema", ref: failureMessage },
};

const annotation = { name: "Foldkit.Command", args: [messageOptions] };

const declaration = (copies = 1): Declaration => ({
  id: "Profile.update",
  kind: "staticMethod",
  module: "profile/operations",
  export: "Profile",
  member: "update",
  annotations: Array.from({ length: copies }, () => annotation),
});

const interpret = (copies = 1) =>
  foldkitExtension.interpreters["Foldkit.Command"]!(annotation, declaration(copies), {
    operationId: Option.some(operationId),
  });

const operation = (external = false): OperationNode => ({
  _tag: "Operation",
  id: operationId,
  name: "Profile.Update",
  kind: "Command",
  input,
  success,
  errors: { values: [], inferred: !external },
  requirements: { values: [], inferred: !external },
  ...(external
    ? { binding: "external" as const }
    : { handler: { module: "profile/operations", export: "Profile", member: "update" } }),
});

interface FixtureOptions {
  readonly annotated?: boolean;
  readonly exposed?: boolean;
  readonly internal?: boolean;
  readonly external?: boolean;
  readonly endpointId?: string;
}

const fixture = ({
  annotated = true,
  exposed = true,
  internal = false,
  external = false,
  endpointId,
}: FixtureOptions = {}) => {
  const contributed = annotated ? interpret() : undefined;
  const nodes: Array<Node> = [operation(external), ...(contributed?.nodes ?? [])];
  const edges: Array<Edge> = [...(contributed?.edges ?? [])];

  if (exposed) {
    nodes.push({
      _tag: "Exposure",
      id: exposureId,
      operation: operationId,
      transport: { _tag: "http", method: "PATCH", path: "/profile/:id" },
    });
    edges.push({ kind: "ExposedAs", from: operationId, to: exposureId, qualifier: "http" });
  }

  const data: HttpContractDraft = {
    root: "effx",
    group: "profile",
    params: ref("ProfileParams"),
    query: ref("ProfileQuery"),
    headers: ref("ProfileHeaders"),
    payload: ref("ProfilePatch"),
    success,
    conditional: false,
    middleware: [],
  };

  if (endpointId !== undefined) data.metadata = { operationId: endpointId };

  nodes.push({
    _tag: "Extension",
    id: contractId,
    extension: "http-contract",
    tag: "HttpContract",
    data,
  });
  edges.push({ kind: "ExtensionOf", from: contractId, to: operationId, qualifier: "HttpContract" });

  if (internal) {
    nodes.push({
      _tag: "Extension",
      id: accessId,
      extension: "access-contract",
      tag: "AccessContract",
      data: {
        annotator: { module: "profile/access", export: "annotate" },
        exposure: "Internal",
        acceptedCredentials: ["None"],
        principalKinds: ["Anonymous"],
        capabilities: { _tag: "None" },
        requirements: [],
        canonicalScopeResolver: { module: "profile/access", export: "scope" },
        concealment: { _tag: "Reveal" },
        decisionTime: "Transaction",
      },
    });
    edges.push({
      kind: "ExtensionOf",
      from: accessId,
      to: operationId,
      qualifier: "AccessContract",
    });
  }

  const ir = make(nodes, edges);

  return { ir, index: IRGraph.toGraph(ir) };
};

const diagnostics = (options: FixtureOptions = {}) => {
  const { ir, index } = fixture(options);

  return foldkitExtension.analyses.flatMap((analysis) =>
    analysis(ir, index, { strictAccess: false }),
  );
};

describe("Foldkit.Command projection", () => {
  it.effect("records exactly two importable SchemaRefs with one owner edge", () =>
    Effect.sync(() => {
      const contribution = interpret();
      assert.deepStrictEqual(contribution.diagnostics, []);
      assert.deepStrictEqual(contribution.nodes, [
        {
          _tag: "Extension",
          id: StableId.make("ext", "foldkit/Profile.Update"),
          extension: "foldkit",
          tag: "UiCommand",
          data: { success: successMessage, failure: failureMessage },
        },
      ]);
      assert.deepStrictEqual(contribution.edges, [
        {
          kind: "ExtensionOf",
          from: StableId.make("ext", "foldkit/Profile.Update"),
          to: operationId,
          qualifier: "UiCommand",
        },
      ]);
    }),
  );

  it.effect("rejects duplicate annotations and missing or internal HTTP exposure", () =>
    Effect.sync(() => {
      assert.include(
        interpret(2).diagnostics.map((item) => item.code),
        "EFFX2601",
      );
      assert.deepStrictEqual(diagnostics(), []);
      assert.include(
        diagnostics({ exposed: false }).map((item) => item.code),
        "EFFX2601",
      );
      assert.include(
        diagnostics({ internal: true }).map((item) => item.code),
        "EFFX2601",
      );
    }),
  );

  it.effect("generates no Foldkit file for an unannotated operation", () =>
    Effect.gen(function* () {
      const { ir, index } = fixture({ annotated: false });
      assert.deepStrictEqual(yield* foldkitGenerator(ir, index), []);
    }),
  );

  it.effect("derives command request channels and app Messages from their refs", () =>
    Effect.gen(function* () {
      const { ir, index } = fixture();
      const files = yield* foldkitGenerator(ir, index);
      assert.deepStrictEqual(
        files.map((file) => file.path),
        ["foldkit.ts"],
      );
      const contents = files[0]!.contents;
      assert.include(contents, 'from "./client.js"');
      assert.include(contents, "export const ProfileCommandsFor = (");
      assert.include(contents, "requestId: Schema.Int,");
      assert.include(contents, "params: ProfileParams,");
      assert.include(contents, "query: ProfileQuery,");
      assert.include(contents, "headers: ProfileHeaders,");
      assert.include(contents, "payload: ProfilePatch,");
      assert.include(contents, "messages: [ProfileUpdated, ProfileUpdateFailed],");
      assert.include(contents, "ProfileUpdate(request).pipe(");
      assert.include(contents, "Effect.provideService(Client, client),");
      assert.notInclude(contents, "runPromise");
    }),
  );

  it.effect("skips unbound commands and modes without local Foldkit projections", () =>
    Effect.gen(function* () {
      const { ir, index } = fixture({ external: true, endpointId: "profile.updateOwnProfile" });

      for (const emit of ["contract", "handlers", "all"] as const) {
        const context: GenerationContext = {
          target: "effect-4.0-rc",
          emit,
          allowImportingTsExtensions: false,
        };

        assert.deepStrictEqual(yield* foldkitGenerator(ir, index, context), []);
      }
    }),
  );

  it.effect("uses the named native endpoint for Foldkit failure types and relative imports", () =>
    Effect.gen(function* () {
      const { ir, index } = fixture({ endpointId: "profile.updateOwnProfile" });

      const context: GenerationContext = {
        target: "effect-4.0-rc",
        emit: "all",
        allowImportingTsExtensions: false,
      };

      const [file] = yield* foldkitGenerator(ir, index, context);
      const contents = file!.contents;
      assert.include(contents, 'from "./client.js"');
      assert.include(contents, 'EffectSdkSuccess<"effx", "profile", "updateOwnProfile">');
      assert.include(contents, 'EffectSdkFailure<"effx", "profile", "updateOwnProfile">');
      assert.include(contents, "ProfileUpdate(request).pipe(");

      const [tsFile] = yield* foldkitGenerator(ir, index, {
        ...context,
        allowImportingTsExtensions: true,
      });

      assert.include(tsFile!.contents, 'from "./client.ts"');
    }),
  );
});
