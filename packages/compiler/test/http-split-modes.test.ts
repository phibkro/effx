import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import {
  IRGraph,
  StableId,
  make,
  type ApplicationIR,
  type Node,
  type OperationNode,
  type SchemaRef,
} from "@effx/ir";
import type { Annotation, Declaration } from "../src/Collected.ts";
import { httpContractExtension } from "../src/extensions/http-contract.ts";
import type { HttpContractData } from "../src/extensions/http-contract.ts";
import { httpGroupExtension } from "../src/extensions/http-group.ts";
import { problemContract } from "../src/extensions/problem-contract.ts";
import type { ProblemContractData } from "../src/extensions/problem-contract.ts";
import { Imports } from "../src/generate/emit.ts";
import { httpGenerator } from "../src/generate/http.ts";

type HttpContractDraft = { -readonly [K in keyof HttpContractData]: HttpContractData[K] };

type ProblemContractDraft = { -readonly [K in keyof ProblemContractData]: ProblemContractData[K] };

type OperationFixture = Pick<ApplicationIR, "nodes" | "edges">;

const ref = (name: string): SchemaRef => ({
  module: "./schemas",
  export: name,
  symbolId: StableId.make("schema", `profile/${name}`),
});

const operation = (name: string, external = true): OperationNode => ({
  _tag: "Operation",
  id: StableId.make("operation", name),
  name,
  kind: "Query",
  input: ref("ReadInput"),
  success: ref("ReadResponse"),
  errors: { values: [], inferred: !external },
  requirements: { values: [], inferred: !external },
  ...(external
    ? { binding: "external" as const }
    : { handler: { module: "./operations", export: "Profile", member: "read" } }),
});

const httpGroup: Node = {
  _tag: "HttpGroup",
  id: StableId.make("group", "external/profile"),
  root: "external",
  group: "profile",
  rootSymbol: { module: "./profile-root", export: "ExternalNativeApi" },
  title: "Profile",
  description: "Profile operations",
  displayName: "My Profile",
};

const withOperation = (
  name: string,
  endpointId: string | undefined,
  external = true,
  includeContract = true,
  root = "external",
  group = "profile",
): OperationFixture => {
  const op = operation(name, external);
  const exposureId = StableId.make("exposure", `http:${name}`);
  const contractId = StableId.make("ext", `http-contract/${name}`);

  const data: HttpContractDraft = {
    root,
    group,
    success: ref("ReadResponse"),
    conditional: true,
    responseHeaders: ref("ResponseHeaders"),
    middleware: [],
  };

  if (endpointId !== undefined) data.metadata = { operationId: endpointId };

  return {
    nodes: [
      op,
      {
        _tag: "Exposure",
        id: exposureId,
        operation: op.id,
        transport: { _tag: "http", method: "GET", path: "/api/profile" },
      },
      ...(includeContract
        ? [
            {
              _tag: "Extension" as const,
              id: contractId,
              extension: "http-contract",
              tag: "HttpContract",
              data,
            },
          ]
        : []),
    ],
    edges: [
      { kind: "ExposedAs", from: op.id, to: exposureId, qualifier: "http" },
      ...(includeContract
        ? [{ kind: "ExtensionOf" as const, from: contractId, to: op.id, qualifier: "HttpContract" }]
        : []),
    ],
  };
};

const profileIr = (problemIdentifier?: string): ApplicationIR => {
  const item = withOperation("Profile.Read", "profile.readOwnProfile");
  const problemId = StableId.make("ext", "problem-contract/Profile.Read");

  const problemData: ProblemContractDraft = {
    registry: { module: "./problems", export: "ProfileProblems" },
    codes: ["profile.read-failed"],
  };

  if (problemIdentifier !== undefined) problemData.identifier = problemIdentifier;

  return make(
    [
      httpGroup,
      ...item.nodes,
      {
        _tag: "Extension",
        id: problemId,
        extension: "problem-contract",
        tag: "ProblemContract",
        data: problemData,
      },
    ],
    [
      ...item.edges,
      {
        kind: "ExtensionOf",
        from: problemId,
        to: StableId.make("operation", "Profile.Read"),
        qualifier: "ProblemContract",
      },
    ],
  );
};

const target = (emit: "contract" | "handlers" | "all") => ({
  target: "effect-4.0" as const,
  emit,
  allowImportingTsExtensions: false,
});

const httpDiagnostics = (ir: ApplicationIR) =>
  httpContractExtension.analyses.flatMap((analysis) =>
    analysis(ir, IRGraph.toGraph(ir), { strictAccess: false }),
  );

const problemsDiagnostics = (ir: ApplicationIR) =>
  problemContract.analyses.flatMap((analysis) =>
    analysis(ir, IRGraph.toGraph(ir), { strictAccess: false }),
  );

const codes = (ir: ApplicationIR) => httpDiagnostics(ir).map((diagnostic) => diagnostic.code);

describe("standalone Http.Group and endpoint identity", () => {
  it.effect(
    "lowers an exported class independently of any operation and rejects conflicting metadata",
    () =>
      Effect.sync(() => {
        const annotation = {
          name: "Http.Group",
          args: [{ root: "external", group: "profile", title: "Profile" }],
        } satisfies Annotation;

        const declaration: Declaration = {
          id: "ProfileApi",
          kind: "class",
          module: "./profile",
          export: "ProfileApi",
          annotations: [annotation],
        };

        const contribution = httpGroupExtension.interpreters["Http.Group"]!(
          annotation,
          declaration,
          { operationId: Option.none() },
        );

        assert.deepStrictEqual(contribution.diagnostics, []);
        assert.deepStrictEqual(contribution.edges, []);
        assert.deepStrictEqual(contribution.nodes, [
          {
            _tag: "HttpGroup",
            id: httpGroup.id,
            root: "external",
            group: "profile",
            title: "Profile",
          },
        ]);

        const incompatible = make(
          [
            ...contribution.nodes,
            {
              _tag: "HttpGroup",
              id: httpGroup.id,
              root: "external",
              group: "profile",
              title: "Other",
            },
          ],
          [],
        );

        assert.deepStrictEqual(
          httpGroupExtension.analyses
            .flatMap((analysis) =>
              analysis(incompatible, IRGraph.toGraph(incompatible), { strictAccess: false }),
            )
            .map((diagnostic) => diagnostic.code),
          ["EFFX2402"],
        );
        assert.deepStrictEqual(
          httpGroupExtension.interpreters["Http.Group"]!(
            annotation,
            { ...declaration, kind: "staticMethod" },
            { operationId: Option.none() },
          ).diagnostics.map((diagnostic) => diagnostic.code),
          ["EFFX2402"],
        );
      }),
  );
  it.effect(
    "derives a stable root identity from a concrete symbol and rejects external string-only roots",
    () =>
      Effect.sync(() => {
        const annotation: Annotation = {
          name: "Http.Group",
          args: [
            {
              root: {
                _tag: "Symbol",
                ref: { module: "./root", export: "ExternalNativeApi" },
                identifier: "external",
              },
              group: "profile",
            },
          ],
        };

        const declaration: Declaration = {
          id: "ProfileGroup",
          kind: "builder",
          module: "./profile",
          export: "ProfileGroup",
          annotations: [annotation],
        };

        const result = httpGroupExtension.interpreters["Http.Group"]!(annotation, declaration, {
          operationId: Option.none(),
        });

        assert.deepStrictEqual(result.diagnostics, []);
        assert.deepStrictEqual(result.nodes, [
          {
            _tag: "HttpGroup",
            id: StableId.make("group", "external/profile"),
            root: "external",
            rootSymbol: { module: "./root", export: "ExternalNativeApi" },
            group: "profile",
          },
        ]);

        const malformed: Annotation = {
          name: "Http.Group",
          args: [
            {
              root: { _tag: "Symbol", ref: { module: "./root", export: "RootApi" } },
              group: "profile",
            },
          ],
        };

        assert.deepStrictEqual(
          httpGroupExtension.interpreters["Http.Group"]!(malformed, declaration, {
            operationId: Option.none(),
          }).diagnostics.map((d) => d.code),
          ["EFFX1102"],
        );
        const operation = withOperation("Profile.Read", "profile.readOwnProfile");

        const stringGroup: Node = {
          _tag: "HttpGroup",
          id: httpGroup.id,
          root: "external",
          group: "profile",
        };

        assert.deepStrictEqual(codes(make([stringGroup, ...operation.nodes], operation.edges)), [
          "EFFX2402",
        ]);
        assert.deepStrictEqual(codes(make([httpGroup, ...operation.nodes], operation.edges)), []);
        const local = withOperation("Profile.Read", undefined, false);
        assert.deepStrictEqual(codes(make([stringGroup, ...local.nodes], local.edges)), []);
      }),
  );

  it.effect("rejects wrong prefixes, empty keys, duplicates and missing external IDs", () =>
    Effect.sync(() => {
      for (const invalid of ["other.readOwnProfile", "profile.", "profile.not-safe-key"]) {
        const item = withOperation("Profile.Read", invalid);
        assert.deepStrictEqual(codes(make([httpGroup, ...item.nodes], item.edges)), ["EFFX2403"]);
      }

      const missing = withOperation("Profile.Read", undefined);
      assert.deepStrictEqual(codes(make([httpGroup, ...missing.nodes], missing.edges)), [
        "EFFX2403",
      ]);
      const noContract = withOperation("Profile.Read", undefined, true, false);
      assert.deepStrictEqual(codes(make([httpGroup, ...noContract.nodes], noContract.edges)), [
        "EFFX2403",
      ]);

      const first = withOperation("Profile.Read", "profile.readOwnProfile");
      const second = withOperation("Profile.Other", "profile.readOwnProfile");
      assert.deepStrictEqual(
        codes(
          make([httpGroup, ...first.nodes, ...second.nodes], [...first.edges, ...second.edges]),
        ),
        ["EFFX2403"],
      );
    }),
  );

  it.effect("rejects mixed local/external groups but preserves a legacy local name", () =>
    Effect.sync(() => {
      const first = withOperation("Profile.Read", "profile.readOwnProfile");
      const second = withOperation("Profile.Other", "profile.updateOwnProfile", false);

      const mixed = make(
        [httpGroup, ...first.nodes, ...second.nodes],
        [...first.edges, ...second.edges],
      );

      assert.deepStrictEqual(codes(mixed), ["EFFX2403"]);

      const local = withOperation("Profile.Read", undefined, false);
      assert.deepStrictEqual(codes(make([...local.nodes], local.edges)), []);
    }),
  );
});

describe("split HTTP projections", () => {
  it.effect(
    "contract mode emits group-only API metadata, canonical key and explicit Problem identity",
    () =>
      Effect.gen(function* () {
        const ir = profileIr("ProfileReadOwnProfileProblem");
        assert.deepStrictEqual(httpDiagnostics(ir), []);
        assert.deepStrictEqual(problemsDiagnostics(ir), []);
        const files = yield* httpGenerator(ir, IRGraph.toGraph(ir), target("contract"));
        assert.deepStrictEqual(
          files.map((file) => file.path),
          ["profile-contract.ts"],
        );
        const contents = files[0]!.contents;
        assert.include(
          contents,
          'export const readOwnProfile = HttpApiEndpoint.get("readOwnProfile", "/api/profile"',
        );
        assert.include(contents, 'export const ProfileApi = HttpApiGroup.make("profile").add(');
        assert.include(contents, 'title: "Profile"');
        assert.include(contents, 'description: "Profile operations"');
        assert.include(contents, '"x-displayName": "My Profile"');
        assert.include(
          contents,
          'ProfileProblems("ProfileReadOwnProfileProblem", ["profile.read-failed"])',
        );
        assert.include(contents, "HttpApiSchema.status(304)");
        assert.include(contents, 'from "./schemas.js"');
        assert.notInclude(contents, "HttpApi.make(");
        assert.notInclude(contents, "AppRoutes");
        assert.notInclude(contents, "Profile.read(");
      }),
  );

  it.effect("handlers mode binds the concrete root and keeps guards lazy", () =>
    Effect.gen(function* () {
      const ir = profileIr();
      const files = yield* httpGenerator(ir, IRGraph.toGraph(ir), target("handlers"));
      assert.deepStrictEqual(
        files.map((file) => file.path),
        ["profile-handlers.ts"],
      );
      const contents = files[0]!.contents;
      assert.include(contents, "export type ProfileGuards<");
      assert.include(contents, "export type ProfileRawHandlers<");
      assert.include(contents, "HttpApiEndpoint.HandlerRawWithIdentifier<Endpoints");
      assert.include(contents, '"profile.readOwnProfile"');
      assert.include(contents, 'ExternalNativeApi as __effxRootApi } from "./profile-root.js"');
      assert.include(contents, 'HttpApiBuilder.group(__effxRootApi, "profile"');
      assert.include(contents, '.handleRaw("readOwnProfile"');
      assert.include(contents, 'guards["profile.readOwnProfile"](input.request)');
      assert.include(
        contents,
        'type ProfileEndpoints = HttpApiGroup.Endpoints<(typeof __effxRootApi)["groups"]["profile"]>',
      );
      assert.include(contents, "Authorization0 extends Effect.Effect<");
      assert.include(contents, "ProfileGuardBindings<ProfileEndpoints, Authorization0>");
      assert.notInclude(contents, "ApiId extends string");
      assert.notInclude(contents, "AppRoutes");
      assert.notInclude(contents, "handleAll");
      assert.notInclude(contents, "payload");
      assert.notInclude(contents, "./profile-contract");
      assert.notInclude(contents, "HttpApi.make(");
    }),
  );

  it.effect(
    "all emits both external files and no fake local server; default Problem name uses endpoint key",
    () =>
      Effect.gen(function* () {
        const ir = profileIr();
        const files = yield* httpGenerator(ir, IRGraph.toGraph(ir), target("all"));
        assert.deepStrictEqual(
          files.map((file) => file.path),
          ["profile-contract.ts", "profile-handlers.ts"],
        );
        assert.include(
          files[0]!.contents,
          'ProfileProblems("readOwnProfileProblem", ["profile.read-failed"])',
        );
        assert.notInclude(files[1]!.contents, "handler:");
      }),
  );

  it.effect("rejects invalid Problem schema identifiers without evaluating a registry", () =>
    Effect.sync(() => {
      const bad = profileIr("");
      assert.deepStrictEqual(
        problemsDiagnostics(bad).map((diagnostic) => diagnostic.code),
        ["EFFX2402"],
      );
    }),
  );
  it.effect("retains declared requirements in IR while inferring backend-only raw services", () =>
    Effect.gen(function* () {
      const source = profileIr();
      const id = StableId.make("service", "ProfileStore");

      const ir = make(
        [
          ...source.nodes.map((node): Node =>
            node._tag === "Operation"
              ? { ...node, requirements: { values: [id], inferred: false } }
              : node,
          ),
          {
            _tag: "Service",
            id,
            name: "ProfileStore",
            symbol: { module: "./services", export: "ProfileStore" },
          },
        ],
        [
          ...source.edges,
          { kind: "Requires", from: StableId.make("operation", "Profile.Read"), to: id },
        ],
      );

      const declared = ir.nodes.find(
        (node) => node._tag === "Operation" && node.name === "Profile.Read",
      );

      assert.strictEqual(declared?._tag, "Operation");

      if (declared?._tag !== "Operation") return assert.fail("expected Profile.Read operation");
      assert.deepStrictEqual(declared.requirements, { values: [id], inferred: false });
      assert.isTrue(
        ir.edges.some(
          (edge) => edge.kind === "Requires" && edge.from === declared.id && edge.to === id,
        ),
      );

      const files = yield* httpGenerator(ir, IRGraph.toGraph(ir), target("handlers"));
      const contents = files[0]!.contents;
      assert.include(contents, "R0 = unknown> = {");
      assert.include(
        contents,
        'Effect.Services<ReturnType<Guards["profile.readOwnProfile"]>> | R0',
      );
      assert.include(
        contents,
        "ProfileRawHandlers<ProfileEndpoints, ProfileGuardBindings<ProfileEndpoints, Authorization0>, RawR0>",
      );
      assert.notInclude(contents, "Context.Key.Identifier<typeof ProfileStore>");
      assert.notInclude(contents, 'from "./services.js"');
    }),
  );

  it.effect("aliases a root whose export collides with the generated factory", () =>
    Effect.gen(function* () {
      const source = profileIr();

      const ir = make(
        source.nodes.map((node): Node =>
          node._tag === "HttpGroup"
            ? { ...node, rootSymbol: { module: "./colliding-root", export: "ProfileApiHandlers" } }
            : node,
        ),
        source.edges,
      );

      const files = yield* httpGenerator(ir, IRGraph.toGraph(ir), target("handlers"));
      const contents = files[0]!.contents;
      assert.include(
        contents,
        'import { ProfileApiHandlers as __effxRootApi } from "./colliding-root.js";',
      );
      assert.include(contents, "export const ProfileApiHandlers = <");
      assert.include(contents, 'HttpApiBuilder.group(__effxRootApi, "profile"');
      assert.notInclude(contents, 'import { ProfileApiHandlers } from "./colliding-root.js";');
    }),
  );

  it.effect("allocates a distinct root alias when another import uses the preferred local", () =>
    Effect.sync(() => {
      const imports = new Imports();
      imports.add("./other", "__effxRootApi");
      assert.strictEqual(
        imports.addAliased("./root", "ProfileApiHandlers", "__effxRootApi"),
        "__effxRootApi_2",
      );
      assert.include(
        imports.render().join("\n"),
        'import { ProfileApiHandlers as __effxRootApi_2 } from "./root.js";',
      );
    }),
  );

  it.effect("root-prefixes both filenames when two roots share a group name", () =>
    Effect.gen(function* () {
      const first = profileIr();
      const other = withOperation("Second.Read", "profile.readOwnProfile", true, true, "second");

      const ir = make(
        [
          ...first.nodes,
          {
            _tag: "HttpGroup",
            id: StableId.make("group", "second/profile"),
            root: "second",
            group: "profile",
            rootSymbol: { module: "./second-root", export: "SecondApi" },
          },
          ...other.nodes,
        ],
        [...first.edges, ...other.edges],
      );

      const files = yield* httpGenerator(ir, IRGraph.toGraph(ir), target("all"));
      assert.deepStrictEqual(
        files.map((file) => file.path),
        [
          "external-profile-contract.ts",
          "second-profile-contract.ts",
          "external-profile-handlers.ts",
          "second-profile-handlers.ts",
        ],
      );
    }),
  );

  it.effect("keeps legacy wire keys while exporting valid, distinct endpoint constants", () =>
    Effect.gen(function* () {
      const names = [
        "User.Get",
        "UserGet",
        "_UserGet",
        "class",
        "_class",
        "ProfileApi",
        "HttpApiEndpoint",
      ];

      const operations = names.map((name) => withOperation(name, undefined, false));

      const ir = make(
        operations.flatMap((item) => item.nodes),
        operations.flatMap((item) => item.edges),
      );

      const files = yield* httpGenerator(ir, IRGraph.toGraph(ir), target("contract"));
      assert.deepStrictEqual(
        files.map((file) => file.path),
        ["profile-contract.ts"],
      );
      const contents = files[0]!.contents;

      assert.include(contents, 'export const _UserGet_2 = HttpApiEndpoint.get("User.Get"');
      assert.include(contents, 'export const UserGet = HttpApiEndpoint.get("UserGet"');
      assert.include(contents, 'export const _UserGet = HttpApiEndpoint.get("_UserGet"');
      assert.include(contents, 'export const _class_2 = HttpApiEndpoint.get("class"');
      assert.include(contents, 'export const _class = HttpApiEndpoint.get("_class"');
      assert.include(contents, 'export const _ProfileApi = HttpApiEndpoint.get("ProfileApi"');
      assert.include(
        contents,
        'export const _HttpApiEndpoint = HttpApiEndpoint.get("HttpApiEndpoint"',
      );
      assert.include(contents, 'export const ProfileApi = HttpApiGroup.make("profile").add(');

      for (const name of [
        "_UserGet_2",
        "UserGet",
        "_UserGet",
        "_class_2",
        "_class",
        "_ProfileApi",
        "_HttpApiEndpoint",
      ]) {
        assert.include(contents, `  ${name},`);
      }
    }),
  );

  it.effect("never overwrites root-prefixed artifacts with another group's preferred name", () =>
    Effect.gen(function* () {
      const entries = [
        withOperation("A.Read", "profile.readOwnProfile", true, true, "a"),
        withOperation("B.Read", "profile.readOwnProfile", true, true, "b"),
        withOperation("C.Read", "a-profile.readOwnProfile", true, true, "c", "a-profile"),
        withOperation("D.Read", "a-profile-2.readOwnProfile", true, true, "d", "a-profile-2"),
      ];

      const groups: ReadonlyArray<Node> = [
        {
          _tag: "HttpGroup",
          id: StableId.make("group", "a/profile"),
          root: "a",
          group: "profile",
          rootSymbol: { module: "./a-root", export: "ARoot" },
        },
        {
          _tag: "HttpGroup",
          id: StableId.make("group", "b/profile"),
          root: "b",
          group: "profile",
          rootSymbol: { module: "./b-root", export: "BRoot" },
        },
        {
          _tag: "HttpGroup",
          id: StableId.make("group", "c/a-profile"),
          root: "c",
          group: "a-profile",
          rootSymbol: { module: "./c-root", export: "CRoot" },
        },
        {
          _tag: "HttpGroup",
          id: StableId.make("group", "d/a-profile-2"),
          root: "d",
          group: "a-profile-2",
          rootSymbol: { module: "./d-root", export: "DRoot" },
        },
      ];

      const ir = make(
        [...groups, ...entries.flatMap((entry) => entry.nodes)],
        entries.flatMap((entry) => entry.edges),
      );

      const expected = ["a-profile", "b-profile", "a-profile-3", "a-profile-2"];
      const groupNames = ['"profile"', '"profile"', '"a-profile"', '"a-profile-2"'];

      for (const emit of ["contract", "handlers", "all"] as const) {
        const files = yield* httpGenerator(ir, IRGraph.toGraph(ir), target(emit));
        const suffixes = emit === "all" ? ["contract", "handlers"] : [emit];
        assert.deepStrictEqual(
          files.map((file) => file.path),
          suffixes.flatMap((suffix) => expected.map((base) => `${base}-${suffix}.ts`)),
        );
        assert.strictEqual(new Set(files.map((file) => file.path)).size, files.length);

        for (const [index, base] of expected.entries()) {
          const contract = files.find((file) => file.path === `${base}-contract.ts`);

          if (contract !== undefined) {
            assert.include(contract.contents, `HttpApiGroup.make(${groupNames[index]})`);
          }
        }
      }
    }),
  );
});
