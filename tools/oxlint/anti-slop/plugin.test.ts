import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RuleTester } from "oxlint/plugins-dev";

import effectPlugin from "./effect/index.ts";
import antiSlopPlugin from "./index.ts";
import { noUnknownParametersRule } from "./rules/no-unknown-parameters.ts";

RuleTester.describe = describe;
RuleTester.it = it;

it("loads all retained anti-slop rules", () => {
  assert.deepStrictEqual(Object.keys(antiSlopPlugin.rules).sort(), [
    "no-array-filter-map",
    "no-chained-type-assertions",
    "no-conditional-empty-object-spread",
    "no-known-value-widening",
    "no-module-mocking",
    "no-object-parameters",
    "no-reduce-accumulator-copy",
    "no-reflect-apply",
    "no-reflect-get",
    "no-runtime-typeof",
    "no-shape-in-symbol-names",
    "no-unknown-parameters",
    "no-unknown-returns",
    "no-unknown-type-aliases",
    "no-unsafe-dictionary-type",
    "no-widen-then-assert",
    "require-readable-spacing",
    "require-safety-comment-for-type-assertion",
  ]);
  assert.deepStrictEqual(Object.keys(effectPlugin.rules).sort(), [
    "no-manual-effect-error-tag",
    "no-manual-tag-comparison",
    "no-manual-tagged-construction",
    "no-service-constructor-imports",
    "prefer-effect-match",
  ]);
});

new RuleTester().run("no-unknown-parameters", noUnknownParametersRule, {
  valid: [
    {
      code: "function isText(value: unknown): value is string { return typeof value === 'string'; }",
      filename: "fixture.ts",
    },
  ],
  invalid: [
    {
      code: "function decode(value: unknown): string { return String(value); }",
      filename: "fixture.ts",
      errors: [{ messageId: "unknownParameter" }],
    },
  ],
});
