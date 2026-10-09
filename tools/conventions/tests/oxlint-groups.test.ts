import { correctness, effectNative, recommended } from "@effect/tsgo/oxlint-presets";
import { DEFAULT_PLUGIN_NAME, expandGroupRules, RULE_NAMES } from "@phibkro/oxlint-effect-plugin";
import { describe, expect, it } from "vitest";

import config, { effectConfig } from "../../../oxlint.config.ts";

const root = new URL("../../..", import.meta.url).pathname;

const sourceDirectories = ["packages", "examples", "scripts", "tools", "ai-docs"];

const repositoryFiles = sourceDirectories.flatMap((directory) =>
  [...new Bun.Glob("**/*.ts").scanSync({ cwd: root + "/" + directory, onlyFiles: true })].map(
    (path) => directory + "/" + path,
  ),
);

const overrides = config.overrides ?? [];

const groupOverrides = overrides.slice(0, effectConfig.groups.length);

const matches = (pattern: string, path: string) => new Bun.Glob(pattern).match(path);

const severity = <Setting>(setting: Setting) => (Array.isArray(setting) ? setting[0] : setting);

const effectPrefix = DEFAULT_PLUGIN_NAME + "/";

// Oxlint replaces earlier rule settings in order; later group overrides are total.
const effectRulesFor = (path: string) => {
  const enabled = new Set<string>();

  for (const override of overrides) {
    if (!override.files.some((pattern) => matches(pattern, path))) continue;

    for (const [rule, setting] of Object.entries(override.rules ?? {})) {
      if (!rule.startsWith(effectPrefix)) continue;

      if (severity(setting) === "off") enabled.delete(rule);
      else enabled.add(rule);
    }
  }

  return [...enabled].sort();
};

const settingsFor = (path: string) =>
  new Map(
    [
      config.rules,
      ...overrides
        .filter((override) => override.files.some((pattern) => matches(pattern, path)))
        .map((override) => override.rules),
    ].flatMap((rules) => Object.entries(rules ?? {})),
  );

describe("Oxlint override globs", () => {
  it("use no extglob syntax", () => {
    const extglob = /[!?+*@]\(/;

    const offending = overrides.flatMap((override) =>
      override.files.filter((pattern) => extglob.test(pattern)),
    );

    expect(offending).toEqual([]);
  });

  it("each match at least one repository source or test file", () => {
    const empty = overrides.flatMap((override) =>
      override.files.filter((pattern) => !repositoryFiles.some((path) => matches(pattern, path))),
    );

    expect(empty).toEqual([]);
  });
});

describe("Effect rule groups", () => {
  it("declare the required effx roles, platforms, boundaries, and strictness", () => {
    expect(
      effectConfig.groups.map((group) => [
        group.files,
        group.role,
        group.platform,
        group.boundaries,
        group.strictness,
      ]),
    ).toEqual([
      [
        ["packages/{ir,compiler,runtime,cli}/src/**/*.ts"],
        "effect-library",
        "portable",
        undefined,
        "strict",
      ],
      [
        ["packages/frontend-ts/src/**/*.ts"],
        "runtime-adapter",
        "node",
        ["external-data"],
        "strict",
      ],
      [["examples/*/src/**/*.ts"], "effect-library", "portable", undefined, "strict"],
      [
        [
          "scripts/effx.ts",
          "examples/*/src/*-main.ts",
          "examples/*/src/**/*-main.ts",
          "scripts/**/*.ts",
        ],
        "composition-root",
        "bun",
        undefined,
        "strict",
      ],
      [["scripts/lsp-linux.ts"], "composition-root", "bun", undefined, "strict"],
      [["scripts/test/lsp-linux-extra.peer.ts"], "composition-root", "node", undefined, "strict"],
      [
        ["packages/cli/src/lsp-transport.ts"],
        "runtime-adapter",
        "portable",
        ["external-data"],
        "strict",
      ],
      [
        ["packages/cli/test/packed-watch-peer.ts"],
        "runtime-adapter",
        "bun",
        ["external-data"],
        "strict",
      ],
      [["**/*.test.ts"], "test", "bun", undefined, "strict"],
      [["ai-docs/src/**/*.ts"], "effect-library", "portable", undefined, "strict"],
    ]);
    expect(effectConfig.strictness).toBe("strict");
  });

  it("apply the intended Effect rules to source and test files", () => {
    expect(effectRulesFor("packages/ir/src/index.ts")).toContain("effect/no-ambient-authority");
    expect(effectRulesFor("packages/frontend-ts/src/collect.ts")).toContain(
      "effect/no-raw-json-parse",
    );
    expect(effectRulesFor("scripts/docs-api.ts")).toContain("effect/no-cross-runtime");
    expect(effectRulesFor("examples/users/src/client-main.ts")).toContain(
      "effect/no-cross-runtime",
    );
    expect(effectRulesFor("examples/users/src/server-main.ts")).toContain(
      "effect/no-cross-runtime",
    );
    expect(effectRulesFor("packages/ir/test/laws.test.ts")).not.toContain(
      "effect/no-ambient-authority",
    );
    expect(effectRulesFor("packages/ir/test/laws.test.ts")).toEqual(
      effectRulesFor("tools/conventions/tests/oxlint-groups.test.ts"),
    );
  });

  it("make each group total and keep every applicable plugin rule an error", () => {
    expect(groupOverrides).toHaveLength(effectConfig.groups.length);

    for (const [index, group] of effectConfig.groups.entries()) {
      const override = groupOverrides[index];

      if (override === undefined) throw new Error("Missing Effect override " + index);
      const settings = override.rules ?? {};
      const expected = Object.keys(expandGroupRules(group)).sort();

      const configured = Object.entries(settings)
        .filter(([rule, value]) => rule.startsWith(effectPrefix) && severity(value) !== "off")
        .map(([rule]) => rule)
        .sort();

      expect(
        Object.keys(settings)
          .filter((rule) => rule.startsWith(effectPrefix))
          .sort(),
      ).toEqual(RULE_NAMES.map((name) => effectPrefix + name).sort());
      expect(configured).toEqual(expected);

      for (const rule of configured) expect(severity(settings[rule])).toBe("error");
    }

    const relaxed = overrides
      .slice(effectConfig.groups.length)
      .flatMap((override) =>
        Object.entries(override.rules ?? {}).filter(([rule]) => rule.startsWith(effectPrefix)),
      );

    expect(relaxed).toEqual([]);
  });

  it("passes Bun Node built-ins to Bun groups and the Bun test service layer", () => {
    expect(effectConfig.groups[3]?.files).toContain("examples/*/src/*-main.ts");
    expect(groupOverrides[3]?.rules?.["effect/no-cross-runtime"]).toMatchObject([
      "error",
      expect.objectContaining({
        role: "composition-root",
        platform: "bun",
        extraAllowedModules: expect.arrayContaining(["node:child_process"]),
      }),
    ]);
    expect(
      groupOverrides.find((override) => override.files?.includes("**/*.test.ts"))?.rules?.[
        "effect/no-cross-runtime"
      ],
    ).toMatchObject([
      "error",
      expect.objectContaining({
        role: "test",
        platform: "bun",
        extraAllowedModules: expect.arrayContaining(["@effect/platform-bun"]),
      }),
    ]);
  });
});

describe("Effect language-service rules", () => {
  const presetRules = [
    ...new Set([recommended, correctness].flatMap((preset) => Object.keys(preset.rules ?? {}))),
  ];

  const nativeRules = Object.keys(effectNative.rules ?? {}).sort();

  const notErrorsAt = (path: string, rules: readonly string[]) => {
    const settings = settingsFor(path);

    return rules.filter((rule) => severity(settings.get(rule)) !== "error").sort();
  };

  it("are errors in all source, examples, and tooling", () => {
    expect(notErrorsAt("packages/ir/src/index.ts", presetRules)).toEqual([]);
    expect(notErrorsAt("examples/users/src/users-main.ts", presetRules)).toEqual([]);
    expect(
      notErrorsAt(
        "scripts/docs-api.ts",
        presetRules.filter((rule) => !nativeRules.includes(rule)),
      ),
    ).toEqual([]);
  });

  it("enable effectNative for packages and examples only", () => {
    expect(notErrorsAt("packages/ir/test/laws.test.ts", nativeRules)).toEqual([]);
    expect(notErrorsAt("examples/users/src/users-main.ts", nativeRules)).toEqual([]);
    expect(notErrorsAt("scripts/docs-api.ts", nativeRules)).toEqual(nativeRules);
  });

  it("make the correctness category and type-aware lint explicit", () => {
    expect(config.categories?.correctness).toBe("error");
    expect(config.options?.typeAware).toBe(true);
  });
});
