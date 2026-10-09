/**
 * The approved stable-Effect source migration of the historical lift corpus.
 *
 * Operator decision (2026-10-09): effx supports stable Effect >= 4.0.0 only. The historical corpus bytes
 * stay immutable provenance. A stable snapshot is these rules applied to those bytes, nothing else.
 *
 * Every rule is a change the application's own stable migration (vektorprogrammet/mono-web) made to the
 * same declarations because installed Effect 4.0.0 requires it: the module entry points that left the
 * unstable namespace, the `Encoding` namespace that became the `effect/encoding` module, and the literal
 * brand name `Schema.brand` demands. The application's lint-only edits (diagnostic headers, exception
 * comments, synchronous decoders turned into `Result`) and its feature changes are not part of it.
 */
export const migrationId = "effect-4.0.0-v1";

export interface MigrationRule {
  /** The exact historical text. */
  readonly from: string;
  /** The text stable Effect 4.0.0 requires there. */
  readonly to: string;
  /** The application commit that made the same change to the same declaration. */
  readonly applied: string;
}

const encodingModule = 'import { Base64 } from "effect/encoding";';

const positiveSafeIntFrom = `const positiveSafeInt = (brandName: string) =>
  Schema.Int.pipe(
    Schema.check(
      Schema.makeFilter(Number.isSafeInteger, { message: "a safe integer" }),
      Schema.isGreaterThan(0),
    ),
    Schema.brand(brandName),
  );`;

const positiveSafeIntTo = `const positiveSafeInt = Schema.Int.pipe(
  Schema.check(
    Schema.makeFilter(Number.isSafeInteger, { message: "a safe integer" }),
    Schema.isGreaterThan(0),
  ),
);`;

/**
 * Ordered exact replacements. The closing quote keeps `http` from matching `httpapi`, and the first rule
 * runs before the second so the OpenAPI provenance string moves with its module.
 */
export const migrationRules: ReadonlyArray<MigrationRule> = [
  {
    from: '"effect/unstable/httpapi/OpenApi.fromApi"',
    to: '"effect/http-api/OpenApi.fromApi"',
    applied: "c9d19722",
  },
  { from: '"effect/unstable/httpapi"', to: '"effect/http-api"', applied: "c9d19722" },
  { from: '"effect/unstable/http"', to: '"effect/http"', applied: "c9d19722" },
  { from: '"effect/unstable/schema"', to: '"effect/schema"', applied: "a39aca10" },
  {
    from: 'import { Effect, Encoding, Order, Result, Schema } from "effect";',
    to: `import { Effect, Order, Result, Schema } from "effect";\n${encodingModule}`,
    applied: "a39aca10",
  },
  {
    from: 'import { Result, Schema, Encoding, Effect } from "effect";',
    to: `import { Result, Schema, Effect } from "effect";\n${encodingModule}`,
    applied: "a39aca10",
  },
  {
    from: 'import { Effect, Encoding, Result, Schema } from "effect";',
    to: `import { Effect, Result, Schema } from "effect";\n${encodingModule}`,
    applied: "a39aca10",
  },
  { from: "Encoding.encodeBase64(", to: "Base64.encode(", applied: "a39aca10" },
  { from: "Encoding.decodeBase64String(", to: "Base64.decodeString(", applied: "a39aca10" },
  { from: positiveSafeIntFrom, to: positiveSafeIntTo, applied: "43149389" },
  {
    from: 'export const ArticleId = positiveSafeInt("ArticleId");',
    to: 'export const ArticleId = positiveSafeInt.pipe(Schema.brand("ArticleId"));',
    applied: "43149389",
  },
  {
    from: 'export const ArticleVersionNumber = positiveSafeInt("ArticleVersionNumber");',
    to: 'export const ArticleVersionNumber = positiveSafeInt.pipe(Schema.brand("ArticleVersionNumber"));',
    applied: "43149389",
  },
];

/** Pure and total: applying it to migrated text changes nothing. */
export const migrateStableEffect = (text: string): string =>
  migrationRules.reduce((current, rule) => current.replaceAll(rule.from, rule.to), text);

/** What no stable snapshot may contain: an unstable entry point or a spelling stable Effect removed. */
export const staleText: ReadonlyArray<string> = [
  "effect/unstable/",
  "Encoding.encodeBase64",
  "Encoding.decodeBase64String",
  "positiveSafeInt(",
];

/** The canonical text a snapshot digest covers: sorted logical paths and the hash of each exact blob. */
export const manifestText = (
  files: ReadonlyArray<{ readonly path: string; readonly sha256: string }>,
): string =>
  files
    .toSorted((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    .map((file) => `${file.path}\t${file.sha256}\n`)
    .join("");
