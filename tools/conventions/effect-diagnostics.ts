/**
 * The Effect diagnostics policy (spec 0033): every `@effect/tsgo` diagnostic whose installed
 * default is not `off`, and every rule the Oxlint presets already enable, is an error in the
 * editor and in Oxlint. The sets are read from the installed package's own schemas and presets, so
 * a rule that an upgrade turns on needs no edit here.
 *
 * - `editorSeverities` is the `diagnosticSeverity` map of the `@effect/language-service` plugin
 *   entry in `tsconfig.effect-stability.json`, `nativeEditorSeverities` the extra map of its
 *   `packages`/`examples`/`ai-docs` override (the `effectNative` rules, as in `oxlint.config.ts`).
 *   `bun run effect:sync` writes both and `tools/conventions/tests/effect-diagnostics.test.ts`
 *   fails when the file differs.
 * - `lintSeverities` is the default-on set under its Oxlint names (`effecttsgo/<kebab-name>`),
 *   spread into `oxlint.config.ts`.
 */
import { correctness, effectNative, recommended } from "@effect/tsgo/oxlint-presets";

import oxlintSchema from "../../node_modules/@effect/tsgo/oxlint-schema.json" with { type: "json" };
import schema from "../../node_modules/@effect/tsgo/schema.json" with { type: "json" };

const lintPrefix = "effecttsgo/";

/** The two installed schema files, reduced to what the derivation reads. */
export interface PolicySchemas {
  /** Diagnostic name (camelCase) to its default severity. */
  readonly defaults: Readonly<Record<string, { readonly default: string }>>;
  /** Names of every Oxlint rule the package defines (any plugin prefix). */
  readonly lintRules: ReadonlyArray<string>;
}

export interface Policy {
  /** Every diagnostic whose installed default is not `off`, by its plugin name. */
  readonly defaultOn: ReadonlyArray<string>;
  /** The default-on set as Oxlint rule settings. */
  readonly lint: Readonly<Record<string, "error">>;
  /** `diagnosticSeverity` of the plugin entry: default-on plus the `recommended`/`correctness` presets. */
  readonly editor: Readonly<Record<string, "error">>;
  /** The `effectNative` rules the editor map does not already hold, for the scoped override. */
  readonly nativeEditor: Readonly<Record<string, "error">>;
}

// The package spells a diagnostic in camelCase and its Oxlint rule in kebab-case; matching with
// the dashes removed avoids a second casing algorithm that would have to agree with the package's.
const squash = (name: string): string => name.replaceAll("-", "").toLowerCase();

/** Derives the policy from schemas and the preset rule lists; throws when a rule has no partner. */
export const derivePolicy = (
  schemas: PolicySchemas,
  presets: {
    readonly global: ReadonlyArray<string>;
    readonly native: ReadonlyArray<string>;
  },
): Policy => {
  const lintRules = schemas.lintRules.filter((rule) => rule.startsWith(lintPrefix));
  const diagnostics = Object.keys(schemas.defaults);

  const lintRuleOf = (diagnostic: string): string => {
    const rule = lintRules.find(
      (candidate) => squash(candidate.slice(lintPrefix.length)) === squash(diagnostic),
    );

    if (rule === undefined) {
      throw new Error(`@effect/tsgo has no Oxlint rule for the diagnostic ${diagnostic}`);
    }

    return rule;
  };

  const diagnosticOf = (rule: string): string => {
    const diagnostic = diagnostics.find(
      (candidate) => squash(candidate) === squash(rule.slice(lintPrefix.length)),
    );

    if (diagnostic === undefined) {
      throw new Error(`@effect/tsgo has no diagnostic for the Oxlint rule ${rule}`);
    }

    return diagnostic;
  };

  const errors = (names: Iterable<string>): Record<string, "error"> =>
    Object.fromEntries([...names].map((name) => [name, "error" as const]));

  const defaultOn = Object.entries(schemas.defaults)
    .filter(([, definition]) => definition.default !== "off")
    .map(([name]) => name);

  const editorNames = new Set([...defaultOn, ...presets.global.map(diagnosticOf)]);

  return {
    defaultOn,
    lint: Object.fromEntries(defaultOn.map((name) => [lintRuleOf(name), "error" as const])),
    editor: errors(editorNames),
    nativeEditor: errors(presets.native.map(diagnosticOf).filter((name) => !editorNames.has(name))),
  };
};

const ruleNames = (...presets: ReadonlyArray<{ readonly rules?: object | undefined }>) => [
  ...new Set(presets.flatMap((preset) => Object.keys(preset.rules ?? {}))),
];

/**
 * `effectNative` rules that effx does not adopt (spec 0034 §3). `@effect/tsgo` 0.63.0 added the three
 * `prefer-effect-*` rules to the preset: they ask for `effect/Array`, `effect/String` and `effect/Record`
 * in place of native array, string and `Object` members, each with a documented semantic caveat, and
 * reported 3,338 sites in this repository. A rule leaves this list when the repository adopts it or the
 * preset drops it; the conventions test fails if a name here is no longer in the preset.
 */
export const declinedNativeRules: ReadonlyArray<string> = [
  "effecttsgo/prefer-effect-array",
  "effecttsgo/prefer-effect-record",
  "effecttsgo/prefer-effect-string",
];

/** Every rule the `effectNative` preset lists. */
export const installedNativeRules: ReadonlyArray<string> = ruleNames(effectNative);

/** The `effectNative` rules effx adopts, in their Oxlint names. */
export const adoptedNativeRules: ReadonlyArray<string> = installedNativeRules.filter(
  (rule) => !declinedNativeRules.includes(rule),
);

const policy = derivePolicy(
  {
    defaults: schema.definitions.effectLanguageServicePluginDiagnosticSeverityDefinition.properties,
    lintRules: Object.keys(oxlintSchema.definitions.DummyRuleMap.properties),
  },
  { global: ruleNames(recommended, correctness), native: adoptedNativeRules },
);

export const defaultOnDiagnostics: ReadonlyArray<string> = policy.defaultOn;

export const editorSeverities: Readonly<Record<string, "error">> = policy.editor;

export const nativeEditorSeverities: Readonly<Record<string, "error">> = policy.nativeEditor;

export const lintSeverities: Readonly<Record<string, "error">> = policy.lint;
