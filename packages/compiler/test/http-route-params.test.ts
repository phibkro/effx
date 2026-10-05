import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { StableId } from "@effx/ir";
import { Extensions, compileCollected } from "@effx/compiler";
import type { Collected, Declaration } from "../src/Collected.ts";

const schema = (name: string, fields?: ReadonlyArray<string>) => {
  const value = {
    _tag: "Schema" as const,
    ref: { module: "./schemas", export: name, symbolId: StableId.make("schema", name) },
  };

  return fields === undefined ? value : { ...value, fields };
};

const operation = (
  name: string,
  path: string,
  fields?: ReadonlyArray<string>,
  method: "Get" | "Post" = "Post",
  inputFields?: ReadonlyArray<string>,
): Declaration => {
  const contractOptions = {
    group: "articles",
    success: schema("Success"),
    metadata: { operationId: `articles.${name}` },
  };

  const options =
    fields === undefined
      ? contractOptions
      : { ...contractOptions, params: schema("ArticleParams", fields) };

  return {
    id: `Article.${name}`,
    kind: "builder",
    module: "./operations",
    export: `Article${name}`,
    binding: "external",
    annotations: [
      {
        name: method === "Get" ? "Query" : "Command",
        args: [
          {
            name: `Article.${name}`,
            input: schema("Input", inputFields),
            success: schema("Success"),
          },
        ],
      },
      { name: `Http.${method}`, args: [path] },
      { name: "Http.Contract", args: [options] },
    ],
  };
};

const root = { module: "./root", export: "ExternalApi" };

const groupDeclaration: Declaration = {
  id: "ArticlesGroup",
  kind: "builder",
  module: "./groups",
  export: "ArticlesGroup",
  annotations: [
    {
      name: "Http.Group",
      args: [
        {
          root: {
            _tag: "Symbol",
            ref: root,
            identifier: "effx",
          },
          group: "articles",
        },
      ],
    },
  ],
};

const collected = (
  declarations: ReadonlyArray<Declaration>,
  emit: "contract" | "handlers" | "all" = "all",
): Collected => ({
  declarations: [groupDeclaration, ...declarations],
  diagnostics: [],
  // Every supplied operation belongs to this complete in-memory native group.
  httpApiGroups: [
    {
      root,
      group: "articles",
      endpoints: declarations.map((declaration) => declaration.id.slice("Article.".length)),
    },
  ],
  project: {
    target: "effect-4.0",
    emit,
    allowImportingTsExtensions: false,
    canonicalImportBase: ".",
    outputDir: ".effx/generated",
  },
});

const errors = (result: {
  readonly diagnostics: ReadonlyArray<{
    readonly severity: string;
    readonly code: string;
    readonly message: string;
  }>;
}) => result.diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("schema-informed HTTP route parameter names", () => {
  it.effect(
    "keeps publish and unpublish action paths and one params schema in both generated outputs",
    () =>
      Effect.gen(function* () {
        const publish = "/api/content/articles/:articleId:publish";
        const unpublish = "/api/content/articles/:articleId:unpublish";

        const declarations = [
          operation("publish", publish, ["articleId"]),
          operation("unpublish", unpublish, ["articleId"]),
        ];

        for (const emit of ["contract", "handlers", "all"] as const) {
          const result = yield* compileCollected(collected(declarations, emit), Extensions.builtin);
          assert.deepStrictEqual(errors(result), []);
          const files = Option.getOrThrow(result.files.value);
          const contract = files.find((file) => file.path === "articles-contract.ts");
          const handlers = files.find((file) => file.path === "articles-handlers.ts");

          if (emit !== "handlers") {
            assert.isDefined(contract);

            for (const [name, path] of [
              ["publish", publish],
              ["unpublish", unpublish],
            ]) {
              assert.include(contract!.contents, `HttpApiEndpoint.post("${name}", "${path}", {`);
            }

            assert.strictEqual(contract!.contents.split("params: ArticleParams,").length - 1, 2);
          }

          if (emit !== "contract") {
            assert.isDefined(handlers);
            assert.include(handlers!.contents, "publish");
            assert.include(handlers!.contents, "unpublish");
          }
        }
      }),
  );

  it.effect.each([
    { path: "/api/:articleId:publish", fields: ["articleId"] },
    { path: "/api/:articleId:publish", fields: ["articleId", "publish"] },
    { path: "/api/:articleId:publish/:revision", fields: ["articleId", "revision"] },
    { path: "/api/:articleId-:revision.json", fields: ["articleId", "revision"] },
    { path: "/api/:articleId.:format", fields: ["articleId", "format"] },
    {
      path: "/api/:articleId((?:[A-Z]+):(?:[0-9]+))-:revision",
      fields: ["articleId", "revision"],
    },
    { path: "/api/:articleId::preview", fields: ["articleId"] },
    { path: "/api/:articleId-archive.json", fields: ["articleId"] },
  ])("accepts FindMyWay param and literal grammar in $path", ({ path, fields }) =>
    Effect.gen(function* () {
      const result = yield* compileCollected(
        collected([operation("read", path, fields, "Get")]),
        Extensions.builtin,
      );

      assert.deepStrictEqual(errors(result), []);
      assert.isTrue(Option.isSome(result.files.value));
    }),
  );

  it.effect.each([
    { path: "/api/:articleId:publish", fields: ["wrong"] },
    { path: "/api/:articleId:publish", fields: ["articleId", "extra"] },
    { path: "/api/:articleId-archive.json", fields: ["articleId", "revision"] },
    { path: "/api/:articleId", fields: ["wrong"] },
  ])("reports mismatched declared keys for $path with $fields", ({ path, fields }) =>
    Effect.gen(function* () {
      const result = yield* compileCollected(
        collected([operation("read", path, fields, "Get")]),
        Extensions.builtin,
      );

      assert.deepStrictEqual(
        errors(result).map((diagnostic) => diagnostic.code),
        ["EFFX2402"],
      );
      assert.include(
        errors(result)[0]!.message,
        "params schema fields must match path parameters exactly",
      );
      assert.isTrue(Option.isNone(result.files.value));
    }),
  );

  it.effect(
    "still requires a schema for a dynamic GET route, and rejects a schema on a static route",
    () =>
      Effect.gen(function* () {
        // The input has known fields that are no route parameter: it derives a query, never a params schema.
        for (const declaration of [
          operation("read", "/api/:articleId", undefined, "Get", ["note"]),
          operation("read", "/api/articles", ["articleId"], "Get", ["note"]),
        ]) {
          const result = yield* compileCollected(collected([declaration]), Extensions.builtin);
          assert.deepStrictEqual(
            errors(result).map((diagnostic) => diagnostic.code),
            ["EFFX2402"],
          );
          assert.include(
            errors(result)[0]!.message,
            "path params require a params schema and vice versa",
          );
        }
      }),
  );
  it.effect("treats escaped colons as static even without a params schema", () =>
    Effect.gen(function* () {
      const result = yield* compileCollected(
        collected([operation("read", "/api/articles/::health", undefined, "Get")]),
        Extensions.builtin,
      );

      assert.deepStrictEqual(errors(result), []);
      assert.isTrue(Option.isSome(result.files.value));
    }),
  );
});
