import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem } from "effect";
import * as cedar from "@cedar-policy/cedar-wasm/nodejs";
import { CedarValidator, CedarWasm } from "../src/cedar-validate.ts";

/*
 * Spec 0017 F2 over the real Cedar 4.13.0 validator (wasm). Every rejection asserted here is
 * Cedar's own message, never an effx re-check.
 */

const fixtures = new URL("../../compiler/test/fixtures/cedar/", import.meta.url).pathname;

const pair = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return {
      schema: yield* fs.readFileString(`${fixtures}${name}.cedarschema`),
      policies: yield* fs.readFileString(`${fixtures}${name}.cedar`),
    };
  }).pipe(Effect.provide(BunServices.layer));

const validate = (schema: string, policies: string) =>
  Effect.gen(function* () {
    const validator = yield* CedarValidator;

    return yield* validator.validate(schema, policies);
  }).pipe(Effect.provide(CedarWasm));

const messages = (issues: ReadonlyArray<{ readonly message: string }>) =>
  issues.map((issue) => issue.message);

describe("CedarValidator over the real wasm validator (spec 0017 F2)", () => {
  it.effect("accepts every emitted golden pair with no errors and no warnings", () =>
    Effect.gen(function* () {
      for (const name of ["users", "profile", "variants"]) {
        const { schema, policies } = yield* pair(name);
        const verdict = yield* validate(schema, policies);

        assert.deepStrictEqual(verdict, { errors: [], warnings: [] }, name);
      }
    }),
  );

  it.effect("rejects a misspelled action id with Cedar's own message and help", () =>
    Effect.gen(function* () {
      const { schema, policies } = yield* pair("profile");

      const mutated = policies.replace(
        "capability/profile.read-self",
        "capability/profile.read-selff",
      );

      const verdict = yield* validate(schema, mutated);

      assert.deepStrictEqual(messages(verdict.errors), [
        'for policy `effx:grant:profile.read-self`, unrecognized action `Effx::Action::"capability/profile.read-selff"`',
      ]);
      assert.strictEqual(verdict.errors[0]?.policyId, "effx:grant:profile.read-self");
      assert.strictEqual(
        verdict.errors[0]?.help,
        'did you mean `Effx::Action::"capability/profile.read-self"`?',
      );
    }),
  );

  it.effect("rejects a context attribute the schema does not declare", () =>
    Effect.gen(function* () {
      const { schema, policies } = yield* pair("profile");
      const mutated = policies.replaceAll('context["profile.owner"]', 'context["profile.ownr"]');
      const verdict = yield* validate(schema, mutated);

      assert.deepStrictEqual(messages(verdict.errors), [
        'for policy `effx:require:Profile.Read:profile.owner`, attribute `["profile.ownr"]` in context for Effx::Action::"operation/Profile.Read" not found',
        'for policy `effx:require:Profile.Update:profile.owner`, attribute `["profile.ownr"]` in context for Effx::Action::"operation/Profile.Update" not found',
      ]);
      assert.deepStrictEqual(
        verdict.errors.map((issue) => issue.help),
        ["did you mean `profile.owner`?", "did you mean `profile.owner`?"],
      );
    }),
  );

  it.effect("fails on non-empty validationErrors even though the wasm answers type success", () =>
    Effect.gen(function* () {
      const { schema, policies } = yield* pair("profile");
      const mutated = policies.replace("capability/profile.read-self", "capability/nope");

      // The trap: the raw wasm answer says success while carrying validation errors.
      const parts = cedar.policySetTextToParts(mutated);

      assert.strictEqual(parts.type, "success");

      if (parts.type !== "success") return;

      const raw = cedar.validate({
        schema,
        policies: {
          staticPolicies: Object.fromEntries(parts.policies.map((text, at) => [`p${at}`, text])),
          templates: Object.fromEntries(parts.policy_templates.map((text, at) => [`t${at}`, text])),
          templateLinks: [],
        },
      });

      assert.strictEqual(raw.type, "success");

      if (raw.type !== "success") return;
      assert.isAbove(raw.validationErrors.length, 0);

      const verdict = yield* validate(schema, mutated);

      assert.isAbove(verdict.errors.length, 0);
    }),
  );

  it.effect("reports a policy that does not parse as an error", () =>
    Effect.gen(function* () {
      const { schema } = yield* pair("profile");
      const verdict = yield* validate(schema, "permit (");

      assert.deepStrictEqual(messages(verdict.errors), ["unexpected end of input"]);
    }),
  );

  it.effect("reports a schema that does not parse as an error", () =>
    Effect.gen(function* () {
      const { policies } = yield* pair("profile");
      const verdict = yield* validate("namespace X { entity ;", policies);

      assert.isAbove(verdict.errors.length, 0);
      assert.include(verdict.errors[0]!.message, "failed to parse schema");
    }),
  );

  it.effect("reports Cedar's warning for a grant that no action can match", () =>
    Effect.gen(function* () {
      const schema = `namespace Effx {
  entity Person;
  entity Scope;
  action "capability/orphan";
  action "operation/o" appliesTo { principal: [Person], resource: [Scope], context: {} };
}
`;

      const verdict = yield* validate(
        schema,
        'permit (principal == ?principal, action in Effx::Action::"capability/orphan", resource == ?resource);',
      );

      assert.deepStrictEqual(verdict.errors, []);
      assert.isAbove(verdict.warnings.length, 0);
      assert.isTrue(
        verdict.warnings.some((warning) =>
          warning.message.includes("unable to find an applicable action"),
        ),
      );
    }),
  );

  it.effect("keeps two policies that share one @id distinct", () =>
    Effect.gen(function* () {
      const { schema } = yield* pair("profile");

      const policies = [
        '@id("dup")',
        'forbid (principal, action == Effx::Action::"operation/Profile.Read", resource) unless { context["nope1"] };',
        '@id("dup")',
        'forbid (principal, action == Effx::Action::"operation/Profile.Read", resource) unless { context["nope2"] };',
      ].join("\n");

      const verdict = yield* validate(schema, policies);

      assert.strictEqual(verdict.errors.length, 2);
      assert.deepStrictEqual(
        verdict.errors.map((issue) => issue.policyId),
        ["dup", "dup#1"],
      );
    }),
  );
});
