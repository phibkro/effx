/**
 * The Effect diagnostics policy (spec 0033): every `@effect/tsgo` diagnostic whose installed
 * default is not `off` is an error, in the editor and in Oxlint. The set is read from the installed
 * package's own schemas, so a rule that an upgrade turns on needs no edit here.
 *
 * - `editorSeverities` is the `diagnosticSeverity` map of the `@effect/language-service` plugin
 *   entry in `tsconfig.effect-stability.json`. `bun run effect:sync` writes it there and
 *   `tools/conventions/tests/effect-diagnostics.test.ts` fails when the file differs.
 * - `lintSeverities` is the same set under its Oxlint names (`effecttsgo/<kebab-name>`), spread
 *   into `oxlint.config.ts`.
 */
import oxlintSchema from "../../node_modules/@effect/tsgo/oxlint-schema.json" with { type: "json" };
import schema from "../../node_modules/@effect/tsgo/schema.json" with { type: "json" };

const lintPrefix = "effecttsgo/";

const diagnosticDefaults = Object.entries(
  schema.definitions.effectLanguageServicePluginDiagnosticSeverityDefinition.properties,
);

const lintRuleNames = Object.keys(oxlintSchema.definitions.DummyRuleMap.properties).filter((rule) =>
  rule.startsWith(lintPrefix),
);

// The package spells a diagnostic in camelCase and its Oxlint rule in kebab-case; matching with
// the dashes removed avoids a second casing algorithm that would have to agree with the package's.
const squash = (name: string): string => name.replaceAll("-", "").toLowerCase();

const lintRuleOf = (diagnostic: string): string => {
  const rule = lintRuleNames.find(
    (candidate) => squash(candidate.slice(lintPrefix.length)) === squash(diagnostic),
  );

  if (rule === undefined) {
    throw new Error(`@effect/tsgo has no Oxlint rule for the diagnostic ${diagnostic}`);
  }

  return rule;
};

/** Every diagnostic whose installed default severity is not `off`, by its plugin name. */
export const defaultOnDiagnostics: ReadonlyArray<string> = diagnosticDefaults
  .filter(([, definition]) => definition.default !== "off")
  .map(([name]) => name);

/** The `diagnosticSeverity` map of the language-service plugin entry. */
export const editorSeverities: Readonly<Record<string, "error">> = Object.fromEntries(
  defaultOnDiagnostics.map((name) => [name, "error"]),
);

/** The same set as Oxlint rule settings. */
export const lintSeverities: Readonly<Record<string, "error">> = Object.fromEntries(
  defaultOnDiagnostics.map((name) => [lintRuleOf(name), "error"]),
);
