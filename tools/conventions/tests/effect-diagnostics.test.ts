import { dirname, resolve } from "node:path";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import schema from "../../../node_modules/@effect/tsgo/schema.json" with { type: "json" };
import config from "../../../oxlint.config.ts";
import policy from "../../../tsconfig.effect-stability.json" with { type: "json" };
import {
  defaultOnDiagnostics,
  derivePolicy,
  editorSeverities,
  lintSeverities,
  nativeEditorSeverities,
} from "../effect-diagnostics.ts";

/**
 * Spec 0033: every `@effect/tsgo` diagnostic whose installed default is not `off`, and every rule
 * the Oxlint presets enable, is an error in the editor (`tsconfig.effect-stability.json`) and in
 * Oxlint (`oxlint.config.ts`). The rule list is read from the installed package, so a rule that an
 * upgrade turns on fails these tests until `bun run effect:sync` writes it (the editor half) or
 * the lint config already carries it.
 */
const root = resolve(import.meta.dirname, "../../..");

const installedDefaults = Object.entries(
  schema.definitions.effectLanguageServicePluginDiagnosticSeverityDefinition.properties,
);

const installedDefaultOn = installedDefaults
  .filter(([, definition]) => definition.default !== "off")
  .map(([name]) => name)
  .sort();

const installedDefaultOff = installedDefaults
  .filter(([, definition]) => definition.default === "off")
  .map(([name]) => name);

const plugin = policy.compilerOptions.plugins.find(
  (entry) => entry.name === "@effect/language-service",
);

const nativeOverride = plugin?.overrides.find((override) =>
  override.include.includes("packages/**/*.ts"),
);

const severityOf = <Setting>(setting: Setting) => (Array.isArray(setting) ? setting[0] : setting);

describe("Effect diagnostics policy", () => {
  it("derives its rule list from the installed package", () => {
    expect([...defaultOnDiagnostics].sort()).toEqual(installedDefaultOn);
    expect(installedDefaultOn.length).toBeGreaterThan(0);
    expect(installedDefaultOff.length).toBeGreaterThan(0);
  });

  it("holds every default-on diagnostic in the editor map, at error", () => {
    for (const name of installedDefaultOn) expect(editorSeverities[name], name).toBe("error");
  });

  it("writes the derived maps into the editor config, and nothing else", () => {
    expect(plugin?.diagnosticSeverity).toEqual(editorSeverities);
    expect(nativeOverride?.options.diagnosticSeverity).toEqual(nativeEditorSeverities);
  });

  it("keeps the language service on, with no override that lowers a rule", () => {
    expect(plugin?.diagnostics).not.toBe(false);

    for (const override of plugin?.overrides ?? []) {
      const options: { readonly diagnostics?: boolean; readonly diagnosticSeverity?: unknown } =
        override.options;

      expect(options.diagnostics, override.include.join(",")).not.toBe(false);

      if (override !== nativeOverride) {
        expect(options.diagnosticSeverity, override.include.join(",")).toBeUndefined();
      }
    }
  });

  it("sets every default-on diagnostic to error in Oxlint, in every override too", () => {
    const rules = Object.keys(lintSeverities);

    expect(rules.length).toBe(installedDefaultOn.length);

    for (const rule of rules) {
      expect(severityOf(config.rules?.[rule]), rule).toBe("error");

      for (const override of config.overrides ?? []) {
        const setting = override.rules?.[rule];

        if (setting !== undefined) {
          expect(severityOf(setting), `${rule} in ${override.files.join(",")}`).toBe("error");
        }
      }
    }
  });

  it("fails to derive when a default-on diagnostic has no Oxlint rule, or a rule no diagnostic", () => {
    const schemas = {
      defaults: { fooBarBaz: { default: "warning" }, quiet: { default: "off" } },
      lintRules: ["effecttsgo/foo-bar-baz", "effecttsgo/quiet", "other/rule"],
    };

    const presets = { global: [], native: [] };

    expect(derivePolicy(schemas, presets).lint).toEqual({ "effecttsgo/foo-bar-baz": "error" });

    expect(() => derivePolicy({ ...schemas, lintRules: ["effecttsgo/quiet"] }, presets)).toThrow(
      "no Oxlint rule for the diagnostic fooBarBaz",
    );

    // A default-off diagnostic without a rule is not part of the policy.
    expect(() =>
      derivePolicy({ ...schemas, lintRules: ["effecttsgo/foo-bar-baz"] }, presets),
    ).not.toThrow();

    expect(() =>
      derivePolicy(schemas, { global: ["effecttsgo/unknown-rule"], native: [] }),
    ).toThrow("no diagnostic for the Oxlint rule effecttsgo/unknown-rule");
  });

  it("puts preset rules in the editor map, and the effectNative rules in the scoped map", () => {
    const schemas = {
      defaults: { onByDefault: { default: "error" }, byPreset: { default: "off" } },
      lintRules: ["effecttsgo/on-by-default", "effecttsgo/by-preset", "effecttsgo/native-only"],
    };

    const derived = derivePolicy(
      { ...schemas, defaults: { ...schemas.defaults, nativeOnly: { default: "off" } } },
      {
        global: ["effecttsgo/by-preset"],
        native: ["effecttsgo/by-preset", "effecttsgo/native-only"],
      },
    );

    expect(derived.editor).toEqual({ onByDefault: "error", byPreset: "error" });
    expect(derived.nativeEditor).toEqual({ nativeOnly: "error" });
  });
});

const TsConfig = Schema.fromJsonString(
  Schema.Struct({
    extends: Schema.optional(Schema.String),
    compilerOptions: Schema.optional(Schema.Struct({ plugins: Schema.optional(Schema.Unknown) })),
  }),
);

const decodeTsConfig = Schema.decodeUnknownSync(TsConfig);

const policyFile = resolve(root, "tsconfig.effect-stability.json");

const readConfig = async (file: string) => decodeTsConfig(await Bun.file(file).text());

/** The tsconfig files from `file` up its `extends` chain, nearest first. */
const chainOf = async (file: string): Promise<ReadonlyArray<string>> => {
  const { extends: parent } = await readConfig(file);

  return parent === undefined ? [file] : [file, ...(await chainOf(resolve(dirname(file), parent)))];
};

describe("Effect diagnostics projects", () => {
  // `plugins` arrays do not merge across `extends`: a project with its own entry replaces the
  // policy, so no tsconfig except the policy file may declare one.
  it("declare no language-service plugin of their own", async () => {
    const files = [
      ...new Bun.Glob("**/tsconfig*.json").scanSync({ cwd: root, onlyFiles: true }),
    ].filter(
      (file) =>
        !/(^|\/)(node_modules|fixtures|\.effx|\.next|out|dist)\//.test(file) &&
        !file.startsWith("apps/docs/"),
    );

    expect(files.length).toBeGreaterThan(5);

    const own = [];

    for (const file of files) {
      const { compilerOptions } = await readConfig(resolve(root, file));

      if (compilerOptions?.plugins !== undefined && resolve(root, file) !== policyFile) {
        own.push(file);
      }
    }

    expect(own).toEqual([]);
  });

  it("listed for effect:diagnostics all reach the policy file", async () => {
    const projects = (
      await Bun.file(resolve(root, "scripts/effect-diagnostic-projects.txt")).text()
    )
      .split("\n")
      .filter((line) => line.length > 0);

    expect(projects).toContain(".");

    for (const project of projects) {
      const chain = await chainOf(resolve(root, project, "tsconfig.json"));

      expect(chain, project).toContain(policyFile);
    }
  });
});
