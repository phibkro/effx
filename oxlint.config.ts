import { correctness, effectNative, recommended } from "@effect/tsgo/oxlint-presets";
import {
  DEFAULT_PLUGIN_NAME,
  effect,
  RULE_NAMES,
  type EffectConfigInput,
  type OxlintConfigFragment,
} from "@phibkro/oxlint-effect-plugin";
import { defineConfig, type OxlintConfig } from "oxlint";

const effectTsgoPresets = [recommended, correctness];

const presetRules = (presets: ReadonlyArray<OxlintConfig>, severity: "error" | "off") =>
  Object.fromEntries(
    presets.flatMap((preset) => Object.keys(preset.rules ?? {})).map((rule) => [rule, severity]),
  );

// Bun implements these Node modules; this option allows imports while still rejecting Node globals.
const bunNodeModules = {
  "no-cross-runtime": {
    extraAllowedModules: [
      "node:assert/strict",
      "node:buffer",
      "node:child_process",
      "node:crypto",
      "node:events",
      "node:fs",
      "node:fs/promises",
      "node:http",
      "node:module",
      "node:net",
      "node:os",
      "node:path",
      "node:process",
      "node:timers/promises",
      "node:url",
    ],
  },
};

// Later matching groups own every Effect rule for their files; tests therefore do not inherit
// library or adapter rules. Keep patterns plain: Oxlint does not support extglob syntax.
export const effectConfig = {
  strictness: "strict",
  groups: [
    {
      files: ["packages/{ir,compiler,runtime,cli}/src/**/*.ts"],
      role: "effect-library",
      platform: "portable",
      strictness: "strict",
    },
    {
      files: ["packages/frontend-ts/src/**/*.ts"],
      role: "runtime-adapter",
      platform: "node",
      boundaries: ["external-data"],
      strictness: "strict",
    },
    {
      files: ["examples/*/src/**/*.ts"],
      role: "effect-library",
      platform: "portable",
      strictness: "strict",
    },
    {
      files: [
        "packages/cli/src/main.ts",
        "examples/*/src/*-main.ts",
        "examples/*/src/**/*-main.ts",
        "scripts/**/*.ts",
      ],
      role: "composition-root",
      platform: "bun",
      strictness: "strict",
      ruleOptions: bunNodeModules,
    },
    {
      files: ["**/*.test.ts"],
      role: "test",
      platform: "bun",
      strictness: "strict",
      // Bun tests use the Bun platform services as their test runtime.
      ruleOptions: {
        "no-cross-runtime": {
          extraAllowedModules: [
            ...bunNodeModules["no-cross-runtime"].extraAllowedModules,
            "@effect/platform-bun",
          ],
        },
      },
    },
    {
      // ai-docs examples are what agents copy: they follow the same rules as application code.
      files: ["ai-docs/src/**/*.ts"],
      role: "effect-library",
      platform: "portable",
      strictness: "strict",
    },
  ],
} satisfies EffectConfigInput;

// Each group gets a total Effect-rule setting: applicable rules are enabled by effect(), and every
// other rule is explicitly off, so broader-group rules cannot leak into the last match.
const totalOverrides = (fragment: OxlintConfigFragment): OxlintConfigFragment => ({
  ...fragment,
  overrides: fragment.overrides.map((override) => ({
    ...override,
    rules: {
      ...Object.fromEntries(RULE_NAMES.map((name) => [DEFAULT_PLUGIN_NAME + "/" + name, "off"])),
      ...override.rules,
    },
  })),
});

const crossPackageSourceImportMessage =
  "Import another workspace package through its export map, not its source path.";

const crossPackageSourceImportPatterns = [
  {
    regex: "^(\\./)?(\\.\\./)+([^./][^/]*/)?[^./][^/]*/src(/|$)",
    message: crossPackageSourceImportMessage,
  },
];

const expandedEffectConfig = totalOverrides(effect(effectConfig));

const effectNativeRules = presetRules([effectNative], "error");

export default defineConfig({
  ...expandedEffectConfig,
  extends: effectTsgoPresets,
  options: { typeAware: true },
  categories: { correctness: "error" },
  jsPlugins: [
    ...expandedEffectConfig.jsPlugins,
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    { name: "anti-slop-effect", specifier: "./tools/oxlint/anti-slop/effect/index.ts" },
  ],
  rules: {
    ...presetRules(effectTsgoPresets, "error"),
    ...presetRules([effectNative], "off"),
    "no-restricted-imports": ["error", { patterns: crossPackageSourceImportPatterns }],
    "anti-slop/no-array-filter-map": "error",
    "anti-slop/no-chained-type-assertions": "error",
    "anti-slop/no-conditional-empty-object-spread": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/no-unknown-returns": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-unsafe-dictionary-type": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
  overrides: [
    ...expandedEffectConfig.overrides,
    { files: ["packages/**", "examples/**", "ai-docs/**"], rules: effectNativeRules },
    {
      files: ["**/operations*.ts", "**/test/fixtures/**"],
      rules: { "typescript/no-extraneous-class": "off" },
    },
  ],
  ignorePatterns: [
    "tools/oxlint/anti-slop/**",
    // rc116 is a separate target project with its own Effect; root type-aware lint must not
    // merge its compiler program with the stable Effect 4.0.0 workspace. Its tsc gate is separate.
    "packages/frontend-ts/test/fixtures/rc116/**",
    // apps/docs is a Next.js + Fumadocs app generated by create-fumadocs-app: a React site, not an
    // Effect program. It has no effect-plugin group (so no Effect rules apply to it by design) and
    // its own TypeScript project; the root type-aware program must not include it. Its gate is
    // `bun run docs:build` (next build type-checks it). The generators that feed it live in
    // `scripts/` and ARE linted as composition roots.
    "apps/docs/**",
    // Spec 0021 Worker programs are parsed, never executed or typechecked, and import the
    // deliberately absent `alchemy` package; their shapes are the fixture, not project source.
    "packages/cli/test/fixtures/surface/**",
    // Git hook entrypoints are extensionless Bun scripts; their behavior is tested in git-hooks.test.ts.
    ".githooks/**",
    "**/build/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/.effx/**",
    "docs/**",
  ],
});
