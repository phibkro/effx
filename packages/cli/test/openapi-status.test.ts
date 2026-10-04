/**
 * @effect-diagnostics unstableApiUsage:off
 * EX-OPENAPI-STATUS (FX012): native generated-contract verification boundary.
 * Scope/owner: packages/cli/test/openapi-status.test.ts, generatedDocument.
 * HttpApi/OpenApi have no stable equivalent; source-text assertions do not prove generated OpenAPI.
 * Verification: this suite and bun run effect:diagnostics.
 * Examined: effect 4.0.0, @effect/tsgo 0.48.0; retire when HttpApi/OpenApi stabilize.
 */
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Extensions, compile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { HttpApi, OpenApi } from "effect/http-api";
import type { HttpApiGroup } from "effect/http-api";

const repoRoot = new URL("../../../", import.meta.url).pathname;

const runtime = new URL("../../runtime/src/index.ts", import.meta.url).pathname;

const Services = Layer.mergeAll(
  BunServices.layer,
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
);

interface GeneratedContract {
  readonly SharedApi: HttpApiGroup.Top;
}

const generatedDocument = Effect.fnUntraced(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const root = yield* fs.makeTempDirectoryScoped({
    directory: repoRoot,
    prefix: ".openapi-status-",
  });

  const project = path.join(root, "tsconfig.json");
  yield* fs.writeFileString(
    project,
    yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
      compilerOptions: {
        target: "ES2023",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        paths: { "@effx/runtime": [runtime] },
      },
      include: ["*.ts"],
    }),
  );
  yield* fs.writeFileString(
    path.join(root, "support.ts"),
    `
import { Schema } from "effect";
import { HttpApi } from "effect/http-api";
export const Root = HttpApi.make("StatusTestRoot");
export const Input = Schema.Struct({});
export const Body = Schema.Struct({ id: Schema.String, label: Schema.String }).annotate({ identifier: "SharedBody" });
export const AlreadyCreated = Body.annotate({ identifier: "AlreadyCreated", httpApiStatus: 201 });
export const BareBody = Body.annotate({ identifier: "BareBody", httpApiStatus: 202 });
export const ResponseHeaders = Schema.Struct({ "x-revision": Schema.String });
`,
  );
  yield* fs.writeFileString(
    path.join(root, "operation.ts"),
    `
import { Http, Operation } from "@effx/runtime";
import { Root, Input, Body, AlreadyCreated, BareBody, ResponseHeaders } from "./support.ts";
export const Group = Http.group("shared", { root: Root });
export const Read = Operation.query({ name: "shared.read", input: Input, success: Body })
  .in(Group).http.get("/read").http.contract({ status: 200, responseHeaders: ResponseHeaders, conditional: true }).declare();
export const Create = Operation.command({ name: "shared.create", input: Input, success: Body })
  .in(Group).http.post("/create").http.contract({ status: 201, responseHeaders: ResponseHeaders }).declare();
export const Override = Operation.query({ name: "shared.override", input: Input, success: AlreadyCreated })
  .in(Group).http.get("/override").http.contract({ status: 200, responseHeaders: ResponseHeaders }).declare();
export const Inherit = Operation.query({ name: "shared.inherit", input: Input, success: AlreadyCreated })
  .in(Group).http.get("/inherit").http.contract({ responseHeaders: ResponseHeaders }).declare();
export const BareInherited = Operation.query({ name: "shared.bareInherited", input: Input, success: BareBody })
  .in(Group).http.get("/bare-inherited").http.contract({}).declare();
export const BareCreated = Operation.command({ name: "shared.bareCreated", input: Input, success: BareBody })
  .in(Group).http.post("/bare-created").http.contract({ status: 201 }).declare();
export const BareOverride = Operation.query({ name: "shared.bareOverride", input: Input, success: BareBody })
  .in(Group).http.get("/bare-override").http.contract({ status: 200 }).declare();
`,
  );

  const result = yield* compile(
    { tsconfigPath: project, entry: ["operation.ts"], emit: "contract" },
    Extensions.builtin,
  );

  assert.deepStrictEqual(
    result.diagnostics.filter((d) => d.severity === "error"),
    [],
  );
  const out = path.join(root, ".effx", "generated");

  for (const file of Option.getOrThrow(result.files.value)) {
    const target = path.join(out, file.path);
    yield* fs.makeDirectory(path.dirname(target), { recursive: true });
    yield* fs.writeFileString(target, file.contents);
  }

  const module: GeneratedContract = yield* Effect.promise(
    () => import(/* @vite-ignore */ path.join(out, "shared-contract.ts")),
  );

  return OpenApi.fromApi(HttpApi.make("StatusTest").add(module.SharedApi));
});

const expectedBody = {
  type: "object",
  properties: { id: { type: "string" }, label: { type: "string" } },
  required: ["id", "label"],
  additionalProperties: false,
};

const expectedHeaders = {
  "x-revision": { required: true, schema: { type: "string" } },
};

describe("generated response status envelopes", () => {
  it.effect("shares one component across header-bearing 200 and 201 responses", () =>
    Effect.gen(function* () {
      const doc = yield* generatedDocument();
      assert.deepStrictEqual(
        Object.keys(doc.components.schemas).filter((key) => key.startsWith("SharedBody")),
        ["SharedBody"],
      );
      const shared = { $ref: "#/components/schemas/SharedBody" };
      assert.deepStrictEqual(
        doc.paths["/read"]!.get!.responses[200]!.content!["application/json"]!.schema,
        shared,
      );
      assert.deepStrictEqual(
        doc.paths["/create"]!.post!.responses[201]!.content!["application/json"]!.schema,
        shared,
      );
      assert.deepStrictEqual(doc.components.schemas.SharedBody, expectedBody);
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("preserves statuses, response headers, conditional responses and body JSON", () =>
    Effect.gen(function* () {
      const doc = yield* generatedDocument();

      for (const [route, method, statuses] of [
        ["/read", "get", ["200", "304"]],
        ["/create", "post", ["201"]],
        ["/override", "get", ["200"]],
        ["/inherit", "get", ["201"]],
      ] as const) {
        const responses = doc.paths[route]![method]!.responses;
        assert.deepStrictEqual(Object.keys(responses), statuses);

        for (const status of statuses)
          assert.deepStrictEqual(responses[status]!.headers, expectedHeaders);
      }

      assert.isUndefined(doc.paths["/read"]!.get!.responses[304]!.content);
      assert.deepStrictEqual(doc.components.schemas.AlreadyCreated, expectedBody);
      assert.deepStrictEqual(doc.components.schemas.SharedBody, expectedBody);
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("keeps inherited, explicit 201 and overriding 200 statuses on bare responses", () =>
    Effect.gen(function* () {
      const doc = yield* generatedDocument();

      for (const [route, method, status] of [
        ["/bare-inherited", "get", "202"],
        ["/bare-created", "post", "201"],
        ["/bare-override", "get", "200"],
      ] as const) {
        const responses = doc.paths[route]![method]!.responses;
        assert.deepStrictEqual(Object.keys(responses), [status]);
        const response = responses[status]!;
        assert.isUndefined(response.headers);
        const ref = response.content!["application/json"]!.schema.$ref!;
        assert.deepStrictEqual(
          doc.components.schemas[ref.slice("#/components/schemas/".length)],
          expectedBody,
        );
      }
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});
