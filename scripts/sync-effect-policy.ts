#!/usr/bin/env bun
/**
 * Writes the editor half of the Effect diagnostics policy (spec 0033): the `diagnosticSeverity` map
 * of the `@effect/language-service` plugin entry in `tsconfig.effect-stability.json`. The map is
 * derived from the installed `@effect/tsgo` defaults in `tools/conventions/effect-diagnostics.ts`;
 * `tools/conventions/tests/effect-diagnostics.test.ts` fails when the file disagrees with it.
 *
 *   bun run effect:sync    rewrite the map, then format the file with `bun run fmt`
 */
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Schema } from "effect";

import { editorSeverities } from "../tools/conventions/effect-diagnostics.ts";

const policyFile = "tsconfig.effect-stability.json";

const pluginName = "@effect/language-service";

const JsonMap = Schema.Record(Schema.String, Schema.Json);

const Plugin = Schema.StructWithRest(Schema.Struct({ name: Schema.String }), [JsonMap]);

const Options = Schema.StructWithRest(Schema.Struct({ plugins: Schema.Array(Plugin) }), [JsonMap]);

const Config = Schema.StructWithRest(Schema.Struct({ compilerOptions: Options }), [JsonMap]);

const ConfigFile = Schema.fromJsonString(Config);

const decode = Schema.decodeEffect(ConfigFile);

const encode = Schema.encodeEffect(ConfigFile);

const main = Effect.gen(function* syncEffectPolicy() {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* decode(yield* fs.readFileString(policyFile));

  const plugins = config.compilerOptions.plugins.map((plugin) =>
    plugin.name === pluginName ? { ...plugin, diagnosticSeverity: editorSeverities } : plugin,
  );

  const next = { ...config, compilerOptions: { ...config.compilerOptions, plugins } };

  yield* fs.writeFileString(policyFile, `${yield* encode(next)}\n`);
});

BunRuntime.runMain(main.pipe(Effect.provide(BunServices.layer)));
