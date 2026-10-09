import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { EffectModel, LiftFrontend } from "@effx/compiler";
import { LiftTsSourceFrontend } from "@effx/frontend-ts";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { testDirectory } from "../../../tools/testing/projects.ts";

const repo = new URL("../../../", import.meta.url).pathname;

const services = LiftTsSourceFrontend.layer.pipe(Layer.provideMerge(BunServices.layer));

const decodeModel = Schema.decodeUnknownEffect(EffectModel);

const files = {
  "source.ts": `// UTF-16 provenance: 𝄞
import { HttpApi, HttpApiGroup, HttpApiEndpoint } from "effect/http-api";
import { PublicInput as Input } from "./barrel.js";
import type { OnlyType } from "./type-only.js";
import { type OnlyType as InlineType } from "./type-only.js";
import "./side-effect.js";
import { Missing } from "./missing.js";
import Legacy = require("./legacy.js");
import type LegacyType = require("./legacy.js");
export { PublicInput as ReexportedInput } from "./barrel.js";
export type { OnlyType as ReexportedType } from "./type-only.js";
export const Read = HttpApiEndpoint.get("read", "/read", { query: Input, success: Input });
export class Group extends HttpApiGroup.make("imports").add(Read) {}
export class Root extends HttpApi.make("root").add(Group) {}
export const dynamic = () => import("./side-effect.js");
`,
  "barrel.ts": 'export { ActualInput as PublicInput } from "./actual.js";\n',
  "actual.ts":
    'import { Schema } from "effect"; export const ActualInput = Schema.Struct({ id: Schema.String });\n',
  "type-only.ts": "export interface OnlyType { readonly id: string }\n",
  "legacy.ts": "export = { legacy: true };\n",
  "side-effect.ts": 'throw new Error("the analyzer must never execute a side-effect import");\n',
} as const;

describe("source imports belong to the real analyzed closure", () => {
  it.effect(
    "keeps resolved barrel modules distinct from binding origins, type edges, and exact EOF",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const directory = yield* testDirectory("lift-source-imports-");

        for (const [name, source] of Object.entries(files))
          yield* fs.writeFileString(path.join(directory, name), source);

        const tsconfigPath = path.join(directory, "tsconfig.json");
        yield* fs.writeFileString(
          tsconfigPath,
          `{"extends":"${repo}tsconfig.json","files":["source.ts"],"exclude":[],"effx":{"projectRoot":".","outDir":"./custom-output","emit":"contract","strictAccess":true,"naming":{"problemIdentifier":"{Group}{Key}Problem"}}}`,
        );

        const model = Option.getOrThrow(
          (yield* (yield* LiftFrontend).analyze({ tsconfigPath })).value,
        );

        yield* decodeModel(model);

        assert.strictEqual(model.project.target, "effect-4.0");
        assert.strictEqual(model.project.emit, "contract");
        assert.strictEqual(model.project.outputDir, path.join(directory, "custom-output"));
        assert.strictEqual(
          model.project.canonicalImportBase,
          path.join(directory, ".effx/generated"),
        );
        assert.deepStrictEqual(model.project.naming, { problemIdentifier: "{Group}{Key}Problem" });
        const source = model.files.find((file) => file.idPath === "source");
        assert.isDefined(source);

        if (source === undefined) return;
        assert.strictEqual(source.end.offset, files["source.ts"].length);
        assert.strictEqual(source.end.line, files["source.ts"].split("\n").length);
        assert.strictEqual(source.end.col, 1);
        const barrel = source.imports.find((entry) => entry.specifier === "./barrel.js");
        assert.strictEqual(barrel?._tag, "Resolved");

        if (barrel?._tag === "Resolved") {
          assert.strictEqual(barrel.module, "../../barrel");
          assert.strictEqual(barrel.kind, "value");
          assert.deepStrictEqual(barrel.bindings, [
            { local: "Input", ref: { module: "../../actual", export: "ActualInput" } },
          ]);
        }

        assert.deepStrictEqual(
          source.imports
            .filter((entry) => entry.specifier === "./type-only.js")
            .map((entry) => entry.kind),
          ["type", "type", "type"],
        );

        const sideEffect = source.imports.find(
          (entry) => entry.specifier === "./side-effect.js" && entry.kind === "value",
        );

        assert.strictEqual(sideEffect?._tag, "Resolved");
        assert.deepStrictEqual(sideEffect?.bindings, []);
        assert.isTrue(
          source.imports.some(
            (entry) =>
              entry._tag === "Unresolved" &&
              entry.specifier === "./missing.js" &&
              entry.kind === "value",
          ),
        );
        assert.isTrue(
          source.imports.some(
            (entry) =>
              entry._tag === "Unresolved" &&
              entry.specifier === "./side-effect.js" &&
              entry.kind === "dynamic",
          ),
        );
        assert.deepStrictEqual(
          source.imports
            .filter((entry) => entry.specifier === "./legacy.js")
            .map((entry) => [entry._tag, entry.kind]),
          [
            ["Resolved", "value"],
            ["Resolved", "type"],
          ],
        );
        // The insertion point is the end of the last statement that carries an edge, never inside it.
        assert.strictEqual(
          source.importsEnd.offset,
          files["source.ts"].indexOf("\n", files["source.ts"].indexOf("export const dynamic")),
        );
        assert.isTrue(
          source.imports.every((entry) => entry.range.end.offset <= source.importsEnd.offset),
        );
        assert.isTrue(model.files.some((file) => file.idPath === "side-effect"));
      }).pipe(Effect.provide(services)),
  );
});
