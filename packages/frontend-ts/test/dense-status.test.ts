import { copyRc116Fixture } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Extensions, compile } from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash, type Node } from "@effx/ir";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { requireRc116FixtureDependencies } from "./rc116-fixture-dependencies.ts";

const fixtureRoot = new URL("./fixtures/rc116/", import.meta.url).pathname;

requireRc116FixtureDependencies(fixtureRoot);

const Services = Layer.mergeAll(
  BunServices.layer,
  TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer)),
);

const dataObject = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Json));

const successRef = Schema.decodeUnknownEffect(Schema.Struct({ export: Schema.String }));

const omittedSuccesses = [
  "UserProfileResponse",
  "PeopleDirectoryResponse",
  "SchoolDirectoryResponse",
  "SchoolCommandResult",
  "ArticleActionResponse",
];

// These are the exact five envelope expressions whose redundant override may disappear.
const omittedExpressions = [
  "HttpApiSchema.WithHeaders(UserProfileResponse, ProfileReadResponseHeaders)",
  "HttpApiSchema.WithHeaders(UserProfileResponse, ProfileWriteResponseHeaders)",
  "HttpApiSchema.WithHeaders(PeopleDirectoryResponse, PrivateReadResponseHeaders)",
  "HttpApiSchema.WithHeaders(SchoolDirectoryResponse, PrivateReadResponseHeaders)",
  "HttpApiSchema.WithHeaders(SchoolCommandResult, EntityMutationResponseHeaders)",
];

const ReflectionProjection = Schema.Struct({
  openapi: Schema.Json,
  operations: Schema.Array(
    Schema.Struct({
      group: Schema.String,
      key: Schema.String,
      method: Schema.String,
      path: Schema.String,
      successes: Schema.Array(Schema.Int),
      errors: Schema.Array(Schema.Int),
    }),
  ),
});

const ReflectionComparison = Schema.Struct({
  effect: Schema.Struct({ version: Schema.String, moduleOrigin: Schema.String }),
  explicit: ReflectionProjection,
  consumer: ReflectionProjection,
});

describe("0024 item 2 dense consumer status spelling", () => {
  it.effect(
    "changes only status IR and status expressions while preserving the real rc116 OpenAPI/SDK",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const copied = yield* copyRc116Fixture();

        const explicit = yield* compile(
          {
            tsconfigPath: path.join(copied, "project/status-explicit/tsconfig.effx.json"),
            entry: [
              "../../src/profile.effx.ts",
              "../../src/directory-dense.effx.ts",
              "../../src/content-actions.effx.ts",
            ],
            emit: "contract",
            strictAccess: true,
          },
          Extensions.builtin,
        );

        const consumer = yield* compile(
          {
            tsconfigPath: path.join(copied, "project/status-consumer/tsconfig.effx.json"),
            entry: [
              "../../src/profile-consumer.effx.ts",
              "../../src/directory-consumer.effx.ts",
              "../../src/content-consumer.effx.ts",
            ],
            emit: "contract",
            strictAccess: true,
          },
          Extensions.builtin,
        );

        for (const result of [explicit, consumer])
          assert.deepStrictEqual(
            result.diagnostics.filter((d) => d.severity === "error"),
            [],
          );

        const explicitIr = Option.getOrThrow(explicit.ir.value);
        const consumerIr = Option.getOrThrow(consumer.ir.value);
        const nodes: Array<Node> = [];
        let removed = 0;

        for (const node of explicitIr.nodes) {
          if (node._tag !== "Extension" || node.tag !== "HttpContract") {
            nodes.push(node);
            continue;
          }

          const data = yield* dataObject(node.data);
          const success = yield* successRef(data.success);

          if (!omittedSuccesses.includes(success.export)) {
            nodes.push(node);
            continue;
          }

          assert.strictEqual(data.status, 200);
          const { status: _status, ...rest } = data;
          removed++;
          nodes.push({ ...node, data: rest });
        }

        const normalized = { ...explicitIr, nodes };
        assert.strictEqual(
          removed,
          7,
          "must exercise Profile, Directory and Content redundant statuses",
        );
        // Fails if a twin changes a channel, symbol reference, edge, access policy or any other field.
        assert.strictEqual(canonical(normalized), canonical(consumerIr));
        assert.notStrictEqual(canonical(explicitIr), canonical(consumerIr));
        assert.notStrictEqual(yield* semanticHash(explicitIr), yield* semanticHash(consumerIr));

        const explicitFiles = Option.getOrThrow(explicit.files.value);
        const consumerFiles = Option.getOrThrow(consumer.files.value);
        assert.deepStrictEqual(
          explicitFiles.map((file) => file.path),
          consumerFiles.map((file) => file.path),
        );
        assert.deepStrictEqual(explicitFiles.map((file) => file.path).toSorted(), [
          "content-contract.ts",
          "directory-contract.ts",
          "profile-contract.ts",
        ]);
        let expressionChanges = 0;

        for (const [index, file] of explicitFiles.entries()) {
          let normalizedText = file.contents;

          for (const expression of omittedExpressions) {
            const explicitExpression = expression + ".pipe(HttpApiSchema.status(200))";

            if (!normalizedText.includes(explicitExpression)) continue;
            assert.strictEqual(normalizedText.split(explicitExpression).length - 1, 1);
            normalizedText = normalizedText.replace(explicitExpression, expression);
            expressionChanges++;
          }

          if (file.path === "content-contract.ts") {
            const conditional =
              "((SchemaAST.resolve(ArticleActionResponse.ast)?.httpApiStatus ?? 200) === 200 ? ArticleActionResponse : HttpApiSchema.status(200)(ArticleActionResponse))";

            assert.strictEqual(normalizedText.split(conditional).length - 1, 2);
            assert.include(normalizedText, 'import { Schema, SchemaAST } from "effect";');
            normalizedText = normalizedText
              .replaceAll(conditional, "ArticleActionResponse")
              .replace(
                'import { Schema, SchemaAST } from "effect";',
                'import { Schema } from "effect";',
              )
              .replace("HttpApiGroup, HttpApiSchema, OpenApi", "HttpApiGroup, OpenApi");
            expressionChanges += 2;
          }

          assert.strictEqual(normalizedText, consumerFiles[index]!.contents);
        }

        assert.strictEqual(expressionChanges, 7);

        // Emit into this scope's fresh projects, never into a tracked golden or shared fixture.
        for (const [flavor, files] of [
          ["explicit", explicitFiles],
          ["consumer", consumerFiles],
        ] as const) {
          const out = path.join(copied, "project", "status-" + flavor, ".effx/generated");
          yield* fs.makeDirectory(out, { recursive: true });

          for (const file of files)
            yield* fs.writeFileString(path.join(out, file.path), file.contents);
        }

        const comparison: { readonly compareDenseStatus: () => typeof ReflectionComparison.Type } =
          yield* Effect.promise(
            () => import(/* @vite-ignore */ path.join(copied, "src/dense-status-reflection.ts")),
          );

        const rawReflection = yield* Effect.sync(() => comparison.compareDenseStatus());
        const reflected = yield* Schema.decodeEffect(ReflectionComparison)(rawReflection);
        assert.strictEqual(reflected.effect.version, "4.0.0-rc.116");
        const modulePath = yield* path.fromFileUrl(new URL(reflected.effect.moduleOrigin));
        const actualModule = yield* fs.realPath(modulePath);

        const expectedModule = yield* fs.realPath(
          path.join(copied, "node_modules/effect/dist/unstable/httpapi/index.js"),
        );

        assert.strictEqual(actualModule, expectedModule);
        // Compare raw native outputs too: the schema boundary must not normalize OpenAPI/index data.
        assert.deepStrictEqual(rawReflection.consumer, rawReflection.explicit);

        assert.deepStrictEqual(reflected.consumer, reflected.explicit);
        assert.lengthOf(reflected.explicit.operations, 8);
      }).pipe(Effect.scoped, Effect.provide(Services)),
    120_000,
  );
});
