import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Result, Schema } from "effect";
import { StableId, canonical } from "@effx/ir";
import { TsSourceFrontend } from "@effx/frontend-ts";
import {
  Extensions,
  SourceFrontend,
  compileCollected,
  dense,
  hasErrors,
  lift,
  liftRegistryOf,
  printSuggestion,
  renderPatch,
  type ProjectConfig,
} from "@effx/compiler";
import { modelOf, type SourceFile } from "./lift-source.ts";
import { applyPatch } from "./lift-apply.ts";

const encodeConfig = Schema.encodeEffect(
  Schema.fromJsonString(
    Schema.Struct({
      compilerOptions: Schema.Struct({
        target: Schema.String,
        module: Schema.String,
        moduleResolution: Schema.String,
        strict: Schema.Boolean,
        skipLibCheck: Schema.Boolean,
        noEmit: Schema.Boolean,
        allowImportingTsExtensions: Schema.Boolean,
        paths: Schema.Record(Schema.String, Schema.Array(Schema.String)),
      }),
      include: Schema.Array(Schema.String),
    }),
  ),
);

// This is a pure, owned native Effect program, not an application import or the placeholder support of lift-fixtures.
const types: SourceFile = {
  path: "src/types.ts",
  contents: [
    'import { Schema } from "effect";',
    'import { HttpApiSchema } from "effect/http-api";',
    "export const EmptyInput = Schema.Struct({});",
    'export const RequestHeaders = Schema.Struct({ "x-read": Schema.String });',
    "export const ResponseHeaders = Schema.Struct({ etag: Schema.String });",
    "export const Response = Schema.Struct({ id: Schema.String });",
    "export const Body = Schema.Struct({ value: Schema.String });",
    "export const CreatedResponse = Response.pipe(HttpApiSchema.status(201));",
    "export const NoContent = HttpApiSchema.NoContent;",
    "export class Responses { static created(schema: Schema.Top) { return HttpApiSchema.WithHeaders(schema, ResponseHeaders).pipe(HttpApiSchema.status(201)); } }",
    "export class Schemas { static Response = Response; static Body = Body; }",
    "",
  ].join("\n"),
};

const problems: SourceFile = {
  path: "src/problems.ts",
  contents: [
    'import { Schema } from "effect";',
    "export class Problems {",
    "  static union(identifier: string, codes: ReadonlyArray<string>) { return Schema.Struct({ code: Schema.Literals(codes) }).annotate({ description: identifier }); }",
    "  static responses(schema: Schema.Top) { return [schema]; }",
    "  static registry(identifier: string, codes: ReadonlyArray<string>) { return [Problems.union(identifier, codes)]; }",
    "}",
    "export const registry = Problems.registry;",
    'export const ReadProblem = Problems.union("SharedProblem", ["read.missing", "read.denied"]);',
    'export const CreateProblem = Problems.union("SharedProblem", ["create.invalid", "create.conflict"]);',
    "",
  ].join("\n"),
};

const original: SourceFile = {
  path: "src/original.ts",
  contents: [
    'import { Schema } from "effect";',
    'import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";',
    'import { annotations as apiAnnotations } from "effect/http-api/OpenApi";',
    'import { Schemas, ResponseHeaders, RequestHeaders, CreatedResponse, NoContent, Responses } from "./types.ts";',
    'import { Problems, ReadProblem, CreateProblem } from "./problems.ts";',
    'export const Read = HttpApiEndpoint.get("read", "/wire", {',
    "  headers: RequestHeaders,",
    "  error: Problems.responses(ReadProblem),",
    "  success: [HttpApiSchema.WithHeaders(Schemas.Response, ResponseHeaders), HttpApiSchema.WithHeaders(HttpApiSchema.NoContent.pipe(HttpApiSchema.status(304)), ResponseHeaders)],",
    '}).annotateMerge(apiAnnotations({ summary: "Read", override: { tags: ["Wire"] } }));',
    'export const Create = HttpApiEndpoint.post("create", "/wire", {',
    '  payload: Schemas.Body.pipe(HttpApiSchema.asJson({ contentType: "application/example+json" })),',
    "  error: Problems.responses(CreateProblem),",
    "  success: Schema.Array(Schemas.Response).pipe(HttpApiSchema.status(201)),",
    "});",
    'export const Repeat = HttpApiEndpoint.get("repeat", "/wire/repeat", { headers: RequestHeaders, success: Schemas.Response, error: Problems.responses(ReadProblem) });',
    'export const Plain200 = HttpApiEndpoint.get("plain200", "/wire/plain200", { headers: RequestHeaders, success: CreatedResponse.pipe(HttpApiSchema.status(200)), error: Problems.responses(ReadProblem) });',
    'export const Headers200 = HttpApiEndpoint.get("headers200", "/wire/headers200", { headers: RequestHeaders, success: HttpApiSchema.WithHeaders(CreatedResponse, ResponseHeaders).pipe(HttpApiSchema.status(200)), error: Problems.responses(ReadProblem) });',
    'export const Empty200 = HttpApiEndpoint.get("empty200", "/wire/empty200", { headers: RequestHeaders, success: NoContent.pipe(HttpApiSchema.status(200)), error: Problems.responses(ReadProblem) });',
    'export const EmptyHeaders200 = HttpApiEndpoint.get("emptyHeaders200", "/wire/emptyHeaders200", { headers: RequestHeaders, success: HttpApiSchema.WithHeaders(NoContent, ResponseHeaders).pipe(HttpApiSchema.status(200)), error: Problems.responses(ReadProblem) });',
    'export const Wrapped200 = HttpApiEndpoint.get("wrapped200", "/wire/wrapped200", { headers: RequestHeaders, success: Responses.created(Schemas.Response).pipe(HttpApiSchema.status(200)), error: Problems.responses(ReadProblem) });',
    'export const Inner200 = HttpApiEndpoint.get("inner200", "/wire/inner200", { headers: RequestHeaders, success: Responses.created(Schemas.Response.pipe(HttpApiSchema.status(200))), error: Problems.responses(ReadProblem) });',
    'export const Omitted = HttpApiEndpoint.get("omitted", "/wire/omitted", { headers: RequestHeaders, success: CreatedResponse, error: Problems.responses(ReadProblem) });',
    'export const Api = HttpApiGroup.make("wire").add(Read, Create, Repeat, Plain200, Headers200, Empty200, EmptyHeaders200, Wrapped200, Inner200, Omitted);',
    'export const Root = HttpApi.make("wire-root").add(Api);',
    "",
  ].join("\n"),
};

const schema = (name: string) => ({
  module: "./src/types",
  export: name,
  symbolId: StableId.make("schema", `src/types/${name}`),
});

const staticSchema = (member: string) => ({
  module: "./src/types",
  export: "Schemas",
  symbolId: StableId.make("schema", `src/types/Schemas.${member}`),
});

const sourceFiles = [types, problems, original];

const model = modelOf(sourceFiles, {
  target: "effect-4.0",
  schemas: [
    ...[
      "EmptyInput",
      "RequestHeaders",
      "ResponseHeaders",
      "Response",
      "Body",
      "CreatedResponse",
      "NoContent",
    ].map(schema),
    staticSchema("Response"),
    staticSchema("Body"),
  ],
  facts: [{ ref: schema("RequestHeaders"), allKeys: ["x-read"], requiredKeys: ["x-read"] }],
  markers: [],
  root: { symbol: { module: "./src/original", export: "Root" }, id: "wire-root" },
});

const result = lift(
  model,
  {
    group: "wire",
    rules: [
      {
        _tag: "ProblemRegistry",
        response: { module: "./src/problems", export: "Problems", member: "responses" },
        union: { module: "./src/problems", export: "Problems", member: "union" },
        registry: { module: "./src/problems", export: "registry" },
      },
      {
        _tag: "SuccessWrapper",
        callee: { module: "./src/types", export: "Responses", member: "created" },
        responseHeaders: schema("ResponseHeaders"),
        status: 201,
      },
    ],
    names: {},
    emptyInput: schema("EmptyInput"),
    output: { module: "./src/suggestion.effx" },
    project: {
      target: "effect-4.0",
      emit: "contract",
      allowImportingTsExtensions: true,
      canonicalImportBase: "/wire",
      outputDir: "/wire/.effx/generated",
    },
  },
  liftRegistryOf([]),
);

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

const repository = new URL("../../../", import.meta.url).pathname.replace(/\/$/u, "");

const workspace = `${repository}/.effx/acceptance/core/repair-r1/wire`;

// The independently authored declarations describe the intended wire; they are not derived from lift's output.
const authoritative = [
  'import { Operation, Http } from "@effx/runtime";',
  'import { Root, WireCreateResponse, WireInner200Response } from "./original.ts";',
  'import { RequestHeaders, Schemas, ResponseHeaders, CreatedResponse, NoContent } from "./types.ts";',
  'import { registry, ReadCodes, CreateCodes } from "./problems.ts";',
  'export const WireGroup = Http.group({ root: Root, group: "wire" });',
  'export const Read = Operation.query({ name: "wire.read", input: RequestHeaders, success: Schemas.Response })',
  '  .http.get("/wire")',
  '  .http.contract({ root: "wire-root", group: "wire", headers: RequestHeaders, success: Schemas.Response, responseHeaders: ResponseHeaders, conditional: true, metadata: { operationId: "wire.read", summary: "Read", tags: ["Wire"] } })',
  '  .http.problems({ registry, identifier: "SharedProblem", codes: ReadCodes }).declare();',
  'export const Create = Operation.command({ name: "wire.create", input: Schemas.Body, success: WireCreateResponse })',
  '  .http.post("/wire")',
  '  .http.contract({ root: "wire-root", group: "wire", payload: Schemas.Body, success: WireCreateResponse, status: 201, mediaType: "application/example+json", metadata: { operationId: "wire.create" } })',
  '  .http.problems({ registry, identifier: "SharedProblem", codes: CreateCodes }).declare();',
  'export const Repeat = Operation.query({ name: "wire.repeat", input: RequestHeaders, success: Schemas.Response }).http.get("/wire/repeat")',
  '  .http.contract({ root: "wire-root", group: "wire", headers: RequestHeaders, success: Schemas.Response, metadata: { operationId: "wire.repeat" } })',
  '  .http.problems({ registry, identifier: "SharedProblem", codes: ReadCodes }).declare();',
  'export const Plain200 = Operation.query({ name: "wire.plain200", input: RequestHeaders, success: CreatedResponse }).http.get("/wire/plain200")',
  '  .http.contract({ root: "wire-root", group: "wire", headers: RequestHeaders, success: CreatedResponse, status: 200, metadata: { operationId: "wire.plain200" } }).http.problems({ registry, identifier: "SharedProblem", codes: ReadCodes }).declare();',
  'export const Headers200 = Operation.query({ name: "wire.headers200", input: RequestHeaders, success: CreatedResponse }).http.get("/wire/headers200")',
  '  .http.contract({ root: "wire-root", group: "wire", headers: RequestHeaders, success: CreatedResponse, responseHeaders: ResponseHeaders, status: 200, metadata: { operationId: "wire.headers200" } }).http.problems({ registry, identifier: "SharedProblem", codes: ReadCodes }).declare();',
  'export const Empty200 = Operation.query({ name: "wire.empty200", input: RequestHeaders, success: NoContent }).http.get("/wire/empty200")',
  '  .http.contract({ root: "wire-root", group: "wire", headers: RequestHeaders, success: NoContent, status: 200, metadata: { operationId: "wire.empty200" } }).http.problems({ registry, identifier: "SharedProblem", codes: ReadCodes }).declare();',
  'export const EmptyHeaders200 = Operation.query({ name: "wire.emptyHeaders200", input: RequestHeaders, success: NoContent }).http.get("/wire/emptyHeaders200")',
  '  .http.contract({ root: "wire-root", group: "wire", headers: RequestHeaders, success: NoContent, responseHeaders: ResponseHeaders, status: 200, metadata: { operationId: "wire.emptyHeaders200" } }).http.problems({ registry, identifier: "SharedProblem", codes: ReadCodes }).declare();',
  'export const Wrapped200 = Operation.query({ name: "wire.wrapped200", input: RequestHeaders, success: Schemas.Response }).http.get("/wire/wrapped200")',
  '  .http.contract({ root: "wire-root", group: "wire", headers: RequestHeaders, success: Schemas.Response, responseHeaders: ResponseHeaders, status: 200, metadata: { operationId: "wire.wrapped200" } }).http.problems({ registry, identifier: "SharedProblem", codes: ReadCodes }).declare();',
  'export const Inner200 = Operation.query({ name: "wire.inner200", input: RequestHeaders, success: WireInner200Response }).http.get("/wire/inner200")',
  '  .http.contract({ root: "wire-root", group: "wire", headers: RequestHeaders, success: WireInner200Response, responseHeaders: ResponseHeaders, status: 201, metadata: { operationId: "wire.inner200" } }).http.problems({ registry, identifier: "SharedProblem", codes: ReadCodes }).declare();',
  'export const Omitted = Operation.query({ name: "wire.omitted", input: RequestHeaders, success: CreatedResponse }).http.get("/wire/omitted")',
  '  .http.contract({ root: "wire-root", group: "wire", headers: RequestHeaders, success: CreatedResponse, metadata: { operationId: "wire.omitted" } }).http.problems({ registry, identifier: "SharedProblem", codes: ReadCodes }).declare();',
  "",
].join("\n");

describe("owned printed suggestion collector proof (not the future lift frontend L5)", () => {
  it.effect(
    "collects actual verbose/dense text and matches independently authored declaration IR",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const frontend = yield* SourceFrontend;
        assert.deepStrictEqual(result.unsupported, []);
        const compact = dense(result.collected);
        assert.isTrue(Option.isSome(compact));

        const verbose = printSuggestion(result.collected, {
          module: "./src/suggestion.effx",
          codeReferences: result.codeReferences,
        });

        const denseText = Option.isSome(compact)
          ? printSuggestion(compact.value, {
              module: "./src/suggestion.effx",
              codeReferences: result.codeReferences,
            })
          : Result.fail("dense unavailable");

        assert.isTrue(Result.isSuccess(verbose));
        assert.isTrue(Result.isSuccess(denseText));

        if (Result.isFailure(verbose) || Result.isFailure(denseText)) return;

        const patch = yield* renderPatch({
          refactors: result.refactors,
          files: model.files,
          texts: new Map(sourceFiles.map((file) => [file.path, file.contents])),
          allowImportingTsExtensions: true,
        });

        const patched = applyPatch(sourceFiles, patch);
        yield* fs.makeDirectory(path.join(workspace, "src"), { recursive: true });

        for (const file of patched)
          yield* fs.writeFileString(path.join(workspace, file.path), file.contents);
        yield* fs.writeFileString(
          path.join(workspace, "src", "suggestion.effx.ts"),
          verbose.success,
        );
        yield* fs.writeFileString(path.join(workspace, "src", "dense.effx.ts"), denseText.success);
        yield* fs.writeFileString(
          path.join(workspace, "src", "authoritative.effx.ts"),
          authoritative,
        );

        for (const file of sourceFiles) {
          const destination = path.join(workspace, "untouched", file.path);
          yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
          yield* fs.writeFileString(destination, file.contents);
        }

        yield* fs.writeFileString(
          path.join(workspace, "tsconfig.json"),
          yield* encodeConfig({
            compilerOptions: {
              target: "ES2023",
              module: "ESNext",
              moduleResolution: "bundler",
              strict: true,
              skipLibCheck: true,
              noEmit: true,
              allowImportingTsExtensions: true,
              paths: {
                "@effx/runtime": [`${repository}/packages/runtime/src/index.ts`],
                "@effx/diagnostics": [`${repository}/packages/diagnostics/src/index.ts`],
                "@effx/ir": [`${repository}/packages/ir/src/index.ts`],
              },
            },
            include: ["src/*.ts", "untouched/src/*.ts", ".effx/**/*.ts", "reflect.ts"],
          }),
        );

        const compileText = Effect.fnUntraced(function* (entry: string, output: string) {
          const config: ProjectConfig = {
            tsconfigPath: path.join(workspace, "tsconfig.json"),
            entry: [`src/${entry}.effx.ts`],
            projectRoot: workspace,
            outDir: path.join(workspace, ".effx", output),
            target: "effect-4.0",
            emit: "contract",
            strictAccess: false,
          };

          const collected = yield* frontend.analyze(config);
          const compiled = yield* compileCollected(collected, Extensions.builtin);
          assert.isFalse(
            hasErrors(compiled.diagnostics),
            compiled.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
          );
          assert.isTrue(Option.isSome(compiled.ir.value));
          const files = Option.getOrUndefined(compiled.files.value) ?? [];

          for (const file of files) {
            const destination = path.join(workspace, ".effx", output, file.path);
            yield* fs.makeDirectory(path.dirname(destination), { recursive: true });
            yield* fs.writeFileString(destination, file.contents);
          }

          return Option.map(compiled.ir.value, canonical);
        });

        const reference = yield* compileText("authoritative", "authoritative");
        assert.strictEqual(
          Option.getOrUndefined(yield* compileText("suggestion", "verbose")),
          Option.getOrUndefined(reference),
        );
        assert.strictEqual(
          Option.getOrUndefined(yield* compileText("dense", "dense")),
          Option.getOrUndefined(reference),
        );
        yield* fs.writeFileString(
          path.join(workspace, "reflect.ts"),
          [
            'import { Context, Schema } from "effect";',
            'import { HttpApi, HttpApiGroup, OpenApi } from "effect/http-api";',
            'import { canonicalJson } from "@effx/ir";',
            'import { Api as Original } from "./untouched/src/original.ts";',
            'import { Api as Patched } from "./src/original.ts";',
            'import { WireApi as Verbose } from "./.effx/verbose/wire-contract.ts";',
            'import { WireApi as Dense } from "./.effx/dense/wire-contract.ts";',
            "const observe = <Group extends HttpApiGroup.Constraint>(selected: Group) => {",
            '  const api = HttpApi.make("wire-root").add(selected);',
            "  const endpoints: Array<{ id: string; method: string; path: string; success: number[]; errors: number[]; annotations: string[]; middleware: string[] }> = [];",
            "  const groups: Array<string> = [];",
            "  HttpApi.reflect(api, { onGroup: ({ group }) => groups.push(group.identifier), onEndpoint: ({ group, endpoint, successes, errors, mergedAnnotations, middleware }) => {",
            "    const identifier = Context.getOrUndefined(mergedAnnotations, OpenApi.Identifier);",
            "    const annotations = [...mergedAnnotations.mapUnsafe.keys()].filter((key) => !(key === OpenApi.Identifier.key && identifier === `${group.identifier}.${endpoint.identifier}`)).sort();",
            "    endpoints.push({ id: endpoint.identifier, method: endpoint.method, path: endpoint.path, success: [...successes.keys()], errors: [...errors.keys()], annotations, middleware: [...middleware].map((service) => service.key).sort() });",
            "  } });",
            "  return Schema.decodeUnknownSync(Schema.Json)({ openapi: OpenApi.fromApi(api), groups, endpoints: endpoints.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0) });",
            "};",
            "const result = { original: observe(Original), patched: observe(Patched), verbose: observe(Verbose), dense: observe(Dense) };",
            'for (const candidate of [result.patched, result.verbose, result.dense]) if (canonicalJson(candidate) !== canonicalJson(result.original)) throw new Error("native OpenAPI/reflection mismatch");',
            'console.log(JSON.stringify({ status: "PASS", deltas: ["explicit-default-identifier", "endpoint-order"], ...result }));',
            "",
          ].join("\n"),
        );
      }).pipe(Effect.provide(Services)),
  );
});
