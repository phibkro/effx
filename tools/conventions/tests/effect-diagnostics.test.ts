import { describe, expect, it } from "vitest";

import config from "../../../oxlint.config.ts";
import schema from "../../../node_modules/@effect/tsgo/schema.json" with { type: "json" };
import policy from "../../../tsconfig.effect-stability.json" with { type: "json" };
import { defaultOnDiagnostics, editorSeverities, lintSeverities } from "../effect-diagnostics.ts";

/**
 * Spec 0033: every `@effect/tsgo` diagnostic whose installed default is not `off` is an error, in
 * the editor (`tsconfig.effect-stability.json`) and in Oxlint (`oxlint.config.ts`). The rule list
 * is read from the installed package, so a rule that an upgrade turns on fails these tests until
 * `bun run effect:sync` writes it (the editor half) or the lint config already carries it.
 */
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

const severityOf = <Setting>(setting: Setting) => (Array.isArray(setting) ? setting[0] : setting);

describe("Effect diagnostics policy", () => {
  it("derives its rule list from the installed package", () => {
    expect([...defaultOnDiagnostics].sort()).toEqual(installedDefaultOn);
    expect(installedDefaultOn.length).toBeGreaterThan(0);
    expect(installedDefaultOff.length).toBeGreaterThan(0);
  });

  it("sets every default-on diagnostic to error in the editor config, and nothing else", () => {
    expect(plugin?.diagnosticSeverity).toEqual(editorSeverities);
  });

  it("keeps the language service on, with no override that lowers a rule", () => {
    expect(plugin?.diagnostics).not.toBe(false);

    for (const override of plugin?.overrides ?? []) {
      const options: { readonly diagnostics?: boolean; readonly diagnosticSeverity?: unknown } =
        override.options;

      expect(options.diagnostics, override.include.join(",")).not.toBe(false);
      expect(options.diagnosticSeverity, override.include.join(",")).toBeUndefined();
    }
  });

  it("sets every default-on diagnostic to error in Oxlint, in every override too", () => {
    const rules = Object.keys(lintSeverities);

    expect(rules.length).toBe(installedDefaultOn.length);

    for (const rule of rules) {
      expect(severityOf(config.rules?.[rule]), rule).toBe("error");

      for (const override of config.overrides ?? []) {
        const setting = override.rules?.[rule];

        if (setting !== undefined)
          expect(severityOf(setting), `${rule} in ${override.files.join(",")}`).toBe("error");
      }
    }
  });
});
