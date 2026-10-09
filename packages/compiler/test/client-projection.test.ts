import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { expectTypeOf } from "vitest";
import {
  IRGraph,
  StableId,
  make,
  type ApplicationIR,
  type Edge,
  type ExtensionNode,
  type ExposureNode,
  type Node,
  type OperationNode,
  type SchemaRef,
} from "@effx/ir";
import { client } from "../src/extensions/client.ts";
import { httpContractExtension } from "../src/extensions/http-contract.ts";
import type { HttpContractData } from "../src/extensions/http-contract.ts";
import { clientGenerator } from "../src/generate/client.ts";
import type { CompilerFault } from "../src/CompilerFault.ts";
import type { GenerationContext } from "../src/Extension.ts";

type HttpContractDraft = { -readonly [K in keyof HttpContractData]: HttpContractData[K] };

type MetadataDraft = {
  -readonly [K in keyof NonNullable<HttpContractData["metadata"]>]: NonNullable<
    HttpContractData["metadata"]
  >[K];
};

const input: SchemaRef = {
  module: "profile/schemas",
  export: "ProfileInput",
  symbolId: StableId.make("schema", "profile/ProfileInput"),
};

const output: SchemaRef = {
  module: "profile/schemas",
  export: "ProfileOutput",
  symbolId: StableId.make("schema", "profile/ProfileOutput"),
};

const problem: SchemaRef = {
  module: "profile/errors",
  export: "CredentialMissing",
  symbolId: StableId.make("schema", "profile/CredentialMissing"),
};

const declaration = (
  name: string,
  root: string,
  exposure: "Internal" | "External",
  method: "GET" | "PATCH",
  path: string,
  options?: {
    readonly identity?: boolean;
    readonly headers?: ReadonlyArray<string>;
    readonly operationId?: string;
    readonly external?: boolean;
    readonly problemModule?: string;
    readonly group?: string;
  },
) => {
  const operationId = StableId.make("operation", name);

  const operation: OperationNode = {
    _tag: "Operation",
    id: operationId,
    name,
    kind: method === "GET" ? "Query" : "Command",
    input,
    success: output,
    errors: {
      values: [{ ...problem, module: options?.problemModule ?? problem.module }],
      inferred: options?.external !== true,
    },
    requirements: { values: [], inferred: options?.external !== true },
    ...(options?.external === true
      ? { binding: "external" as const }
      : { handler: { module: "profile/operations", export: "Profile", member: "execute" } }),
  };

  const httpId = StableId.make("exposure", `http:${name}`);

  const http: ExposureNode = {
    _tag: "Exposure",
    id: httpId,
    operation: operationId,
    transport: { _tag: "http", method, path },
  };

  const contractId = StableId.make("ext", `http-contract/${name}`);

  const data: HttpContractDraft = {
    root,
    group: options?.group ?? "profile",
    success: output,
    conditional: false,
    middleware: [],
  };

  if (options?.headers !== undefined) {
    data.headers = input;
    data.headersKeys = options.headers;
  }

  if (options?.identity === true || options?.operationId !== undefined) {
    const metadata: MetadataDraft = {};

    if (options.operationId !== undefined) metadata.operationId = options.operationId;

    if (options.identity === true)
      metadata.commandIdentity = { module: "profile/identity", export: "profileCommandIdentity" };

    data.metadata = metadata;
  }

  const contract: ExtensionNode = {
    _tag: "Extension",
    id: contractId,
    extension: "http-contract",
    tag: "HttpContract",
    data,
  };

  const accessId = StableId.make("ext", `access-contract/${name}`);

  const access: ExtensionNode = {
    _tag: "Extension",
    id: accessId,
    extension: "access-contract",
    tag: "AccessContract",
    data: {
      annotator: { module: "profile/access", export: "profileAccessAnnotations" },
      exposure,
      acceptedCredentials: ["Cookie"],
      principalKinds: ["Person"],
      capabilities: { _tag: "None" },
      requirements: [],
      canonicalScopeResolver: { module: "profile/access", export: "CurrentPerson" },
      concealment: { _tag: "Reveal" },
      decisionTime: "SnapshotRead",
    },
  };

  const edges: ReadonlyArray<Edge> = [
    { kind: "ExposedAs", from: operationId, to: httpId, qualifier: "http" },
    { kind: "ExtensionOf", from: contractId, to: operationId, qualifier: "HttpContract" },
    { kind: "ExtensionOf", from: accessId, to: operationId, qualifier: "AccessContract" },
  ];

  return { nodes: [operation, http, contract, access], edges };
};

interface ClientFixturePart {
  readonly nodes: ReadonlyArray<Node>;
  readonly edges: ReadonlyArray<Edge>;
}

const graph = (...parts: ReadonlyArray<ClientFixturePart>): ApplicationIR =>
  make(
    parts.flatMap((part) => part.nodes),
    parts.flatMap((part) => part.edges),
  );

describe("external HTTP client projection", () => {
  it.effect("compiler generator channels and file output require no HTTP client", () =>
    Effect.gen(function* () {
      const ir = graph(declaration("Profile.Read", "effx", "External", "GET", "/profile"));
      const generated = clientGenerator(ir, IRGraph.toGraph(ir));
      expectTypeOf<Effect.Success<typeof generated>>().toEqualTypeOf<
        ReadonlyArray<{ readonly path: string; readonly contents: string }>
      >();
      expectTypeOf<Effect.Error<typeof generated>>().toEqualTypeOf<CompilerFault>();
      expectTypeOf<Effect.Services<typeof generated>>().toEqualTypeOf<never>();

      const files = yield* generated;
      assert.strictEqual(files.length, 1);
      assert.strictEqual(files[0]?.path, "client.ts");
      assert.include(
        Option.getOrThrow(Option.fromUndefinedOr(files[0])).contents,
        '"operationId":"operation:Profile.Read"',
      );
      const contents = Option.getOrThrow(Option.fromUndefinedOr(files[0])).contents;
      assert.include(contents, 'from "effect/http-api"');
      assert.include(contents, 'from "./http.js"');
    }),
  );

  it.effect(
    "omits entire internal roots and indexes external HTTP operations in metadata ID order",
    () =>
      Effect.gen(function* () {
        const external = graph(
          declaration("Profile.Update", "effx", "External", "PATCH", "/profile", {
            identity: true,
            headers: ["idempotency-key", "if-match"],
            operationId: "profile.aUpdate",
          }),
          declaration("Profile.Read", "effx", "External", "GET", "/profile", {
            operationId: "profile.zRead",
          }),
          declaration("Internal.Secrets", "internal", "Internal", "GET", "/secrets"),
        );

        const file = (yield* clientGenerator(external, IRGraph.toGraph(external)))[0];
        const text = Option.getOrThrow(Option.fromUndefinedOr(file)).contents;

        assert.include(
          text,
          [
            "export const operationIndex = [",
            '  {"group":"profile","operationId":"profile.aUpdate","method":"PATCH","path":"/profile"},',
            '  {"group":"profile","operationId":"profile.zRead","method":"GET","path":"/profile"},',
          ].join("\n"),
        );
        assert.notInclude(text, "InternalClient");
        assert.notInclude(text, "InternalSecrets");
        assert.include(text, 'client["profile"]["aUpdate"](');
        assert.include(text, 'readonly "aUpdate": typeof CredentialMissing["Type"]');
        assert.include(text, "export const ProfileUpdateCommandIdentity");
        assert.include(text, 'request.headers["idempotency-key"]');
        assert.include(text, 'request.headers["if-match"]');
        assert.include(text, 'operationId: "profile.aUpdate"');
      }),
  );

  it.effect("qualifies otherwise colliding operation exports by root and group", () =>
    Effect.gen(function* () {
      const ir = graph(
        declaration("Profile.Read", "effx", "External", "GET", "/profile"),
        declaration("ProfileRead", "admin", "External", "GET", "/admin/profile"),
      );

      const file = (yield* clientGenerator(ir, IRGraph.toGraph(ir)))[0];
      const text = Option.getOrThrow(Option.fromUndefinedOr(file)).contents;

      assert.include(text, "export const EffxProfileProfileRead =");
      assert.include(text, "export const AdminProfileProfileRead =");
    }),
  );

  it.effect(
    "uses punctuation-aware HTTP group parts only when SDK exports need qualification",
    () =>
      Effect.gen(function* () {
        const ir = graph(
          declaration("Profile.Read", "effx", "External", "GET", "/social-events", {
            group: "social-events",
          }),
          declaration("ProfileRead", "admin", "External", "GET", "/directory", {
            group: "directory",
          }),
        );

        const file = (yield* clientGenerator(ir, IRGraph.toGraph(ir)))[0];
        const text = Option.getOrThrow(Option.fromUndefinedOr(file)).contents;
        assert.include(text, "export const EffxSocialEventsProfileRead =");
        assert.include(text, "export const AdminDirectoryProfileRead =");
        assert.include(text, 'client["social-events"]');
        assert.notInclude(text, "SocialeventsProfileRead");
      }),
  );

  it.effect("rejects an internal method in the same root as an external service", () =>
    Effect.sync(() => {
      const mixed = graph(
        declaration("Profile.Read", "effx", "External", "GET", "/profile"),
        declaration("Profile.Update", "effx", "Internal", "PATCH", "/profile"),
      );

      assert.deepStrictEqual(
        client.analyses[0]!(mixed, IRGraph.toGraph(mixed), { strictAccess: false }).map(
          (item) => item.code,
        ),
        ["EFFX2505"],
      );
    }),
  );

  it.effect("rejects command identity on Query and without both declared header names", () =>
    Effect.sync(() => {
      const invalid = graph(
        declaration("Profile.Read", "effx", "External", "GET", "/profile", {
          identity: true,
          headers: ["if-match"],
        }),
      );

      assert.deepStrictEqual(
        httpContractExtension.analyses[0]!(invalid, IRGraph.toGraph(invalid), {
          strictAccess: false,
        }).map((item) => item.code),
        ["EFFX2402", "EFFX2402"],
      );
    }),
  );

  it.effect("omits declaration-only HTTP operations and their client services in every mode", () =>
    Effect.gen(function* () {
      const externalOnly = graph(
        declaration("Profile.Read", "app", "External", "GET", "/profile", {
          external: true,
          operationId: "profile.readOwnProfile",
        }),
      );

      const index = IRGraph.toGraph(externalOnly);

      for (const emit of ["contract", "handlers", "all"] as const) {
        const context: GenerationContext = {
          target: "effect-4.0",
          emit,
          allowImportingTsExtensions: false,
        };

        assert.deepStrictEqual(yield* clientGenerator(externalOnly, index, context), []);
      }

      const local = graph(
        declaration("Profile.Read", "app", "External", "GET", "/profile", {
          external: true,
          operationId: "profile.readOwnProfile",
        }),
        declaration("User.Read", "effx", "External", "GET", "/users"),
      );

      const files = yield* clientGenerator(local, IRGraph.toGraph(local));
      assert.strictEqual(files.length, 1);
      assert.notInclude(files[0]!.contents, "profile.readOwnProfile");
      assert.notInclude(files[0]!.contents, "AppClient");
      assert.include(files[0]!.contents, "export class Client");
    }),
  );

  it.effect("maps native imports and rebases source refs for a stable artifact directory", () =>
    Effect.gen(function* () {
      const ir = graph(
        declaration("Profile.Update", "effx", "External", "PATCH", "/profile", {
          operationId: "profile.updateOwnProfile",
          problemModule: "../../src/errors",
        }),
      );

      const context: GenerationContext = {
        target: "effect-4.0",
        emit: "all",
        allowImportingTsExtensions: false,
        canonicalImportBase: "/app/.effx/generated",
        outputDir: "/app/output",
      };

      const [file] = yield* clientGenerator(ir, IRGraph.toGraph(ir), context);
      const contents = Option.getOrThrow(Option.fromUndefinedOr(file)).contents;
      assert.include(contents, 'from "./http.js"');
      assert.include(contents, 'from "../src/errors.js"');
      assert.include(contents, 'client["profile"]["updateOwnProfile"](');
      assert.include(contents, 'ForApi<typeof Api>["profile"]["updateOwnProfile"]');

      const [tsFile] = yield* clientGenerator(ir, IRGraph.toGraph(ir), {
        ...context,
        allowImportingTsExtensions: true,
      });

      const tsContents = Option.getOrThrow(Option.fromUndefinedOr(tsFile)).contents;
      assert.include(tsContents, 'from "./http.ts"');
      assert.include(tsContents, 'from "../src/errors.ts"');
    }),
  );
});
