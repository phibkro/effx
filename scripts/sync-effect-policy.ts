#!/usr/bin/env bun
/**
 * Writes the editor half of the Effect diagnostics policy (spec 0033) into
 * `tsconfig.effect-stability.json`: the `diagnosticSeverity` map of the `@effect/language-service`
 * plugin entry, and the one of its override for `packages`, `examples` and `ai-docs` (the
 * `effectNative` rules). Both are derived from the installed `@effect/tsgo` in
 * `tools/conventions/effect-diagnostics.ts`; `tools/conventions/tests/effect-diagnostics.test.ts`
 * fails when the file disagrees with it.
 *
 *   bun run effect:sync    rewrite the maps (the script then formats the file)
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Schema } from "effect";

import {
  editorSeverities,
  nativeEditorSeverities,
} from "../tools/conventions/effect-diagnostics.ts";

const policyFile = "tsconfig.effect-stability.json";

const pluginName = "@effect/language-service";

/** The override that scopes the `effectNative` rules, found by the pattern it is scoped with. */
const nativeScope = "packages/**/*.ts";

const JsonMap = Schema.Record(Schema.String, Schema.Json);

const Override = Schema.StructWithRest(
  Schema.Struct({ include: Schema.Array(Schema.String), options: JsonMap }),
  [JsonMap],
);

const Plugin = Schema.StructWithRest(
  Schema.Struct({ name: Schema.String, overrides: Schema.optional(Schema.Array(Override)) }),
  [JsonMap],
);

const Options = Schema.StructWithRest(Schema.Struct({ plugins: Schema.Array(Plugin) }), [JsonMap]);

const Config = Schema.StructWithRest(Schema.Struct({ compilerOptions: Options }), [JsonMap]);

const ConfigFile = Schema.fromJsonString(Config);

const decode = Schema.decodeEffect(ConfigFile);

const decodeConfig = Schema.decodeUnknownEffect(Config);

const encode = Schema.encodeEffect(ConfigFile);

const main = Effect.gen(function* syncEffectPolicy() {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* decode(yield* fs.readFileString(policyFile));

  const withNativeMap = (override: typeof Override.Type) =>
    override.include.includes(nativeScope)
      ? {
          ...override,
          options: { ...override.options, diagnosticSeverity: nativeEditorSeverities },
        }
      : override;

  const plugins = config.compilerOptions.plugins.map((plugin) =>
    plugin.name === pluginName
      ? {
          ...plugin,
          diagnosticSeverity: editorSeverities,
          overrides: plugin.overrides?.map(withNativeMap),
        }
      : plugin,
  );

  const next = { ...config, compilerOptions: { ...config.compilerOptions, plugins } };

  const result = yield* decodeConfig(next);

  yield* fs.writeFileString(policyFile, `${yield* encode(result)}\n`);
});

BunRuntime.runMain(main.pipe(Effect.provide(BunServices.layer)));
