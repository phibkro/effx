import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Option } from "effect";
import { IRGraph, make } from "@effx/ir";
import {
  AccessContractProjection,
  type CedarFiles,
  type Diagnostic,
  cedarOf,
} from "../src/index.ts";
import { AccessContractData } from "../src/extensions/access-contract.ts";
import {
  collidingResolversIr,
  invalidNamesIr,
  profileIr,
  resolverEqualsModelIr,
  stackedIr,
  unprotectedIr,
  usersIr,
  variantsIr,
} from "./fixtures/cedar-ir.ts";

/*
 * Spec 0017 F1/F6: the projection is a pure function of the IR. Goldens carry the placeholder
 * `{{HASH}}` that stands for the semanticHash passed to `cedarOf`, so they do not depend on a hash.
 */

const HASH = "{{HASH}}";

const fixtures = new URL("./fixtures/cedar/", import.meta.url).pathname;

const golden = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return {
      schema: yield* fs.readFileString(`${fixtures}${name}.cedarschema`),
      policies: yield* fs.readFileString(`${fixtures}${name}.cedar`),
    } satisfies CedarFiles;
  }).pipe(Effect.provide(BunServices.layer));

const project = (ir: Parameters<typeof IRGraph.toGraph>[0], namespace?: string) =>
  cedarOf(ir, IRGraph.toGraph(ir), HASH, namespace === undefined ? {} : { namespace });

const filesOf = (ir: Parameters<typeof IRGraph.toGraph>[0], namespace?: string): CedarFiles =>
  Option.getOrThrow(project(ir, namespace).files);

const codes = (diagnostics: ReadonlyArray<Diagnostic>) => diagnostics.map((d) => d.code);

describe("cedarOf (spec 0017 F1)", () => {
  it.effect("projects examples/users (AuthorizedBy only) to the golden pair", () =>
    Effect.gen(function* () {
      const expected = yield* golden("users");
      const result = project(usersIr);

      assert.deepStrictEqual(Option.getOrThrow(result.files), expected);
      assert.deepStrictEqual(
        result.diagnostics.map((d) => [d.code, d.severity]),
        [
          ["EFFX4105", "info"],
          ["EFFX4105", "info"],
        ],
      );
    }),
  );

  it.effect("projects the Profile-like SnapshotRead/Transaction pair to the golden pair", () =>
    Effect.gen(function* () {
      const expected = yield* golden("profile");
      const result = project(profileIr);

      assert.deepStrictEqual(Option.getOrThrow(result.files), expected);
      assert.deepStrictEqual(result.diagnostics, []);
    }),
  );

  it.effect("projects every capability expression, principal and annotation shape", () =>
    Effect.gen(function* () {
      const expected = yield* golden("variants");
      const result = project(variantsIr);

      assert.deepStrictEqual(Option.getOrThrow(result.files), expected);

      assert.deepStrictEqual(
        result.diagnostics.map((d) => [d.code, d.severity]),
        [
          ["EFFX4104", "warning"],
          ["EFFX4103", "warning"],
        ],
      );
    }),
  );

  it("None, Any and All differ only in their group parents (Any is disjunctive, All is unmapped)", () => {
    const { schema, policies } = filesOf(variantsIr);

    assert.include(schema, 'action "operation/Any.Op" in ["capability/cap.a", "capability/cap.b"]');
    assert.include(schema, 'action "operation/All.Op"\n');
    assert.include(schema, 'action "operation/None.Op"\n');
    assert.include(schema, "principal: [Anonymous]");
    assert.include(schema, '@exposure("Internal")');
    assert.include(schema, "principal: [Person, ServicePrincipal]");
    assert.include(schema, "principal: [CapabilityHolder]");
    assert.include(schema, '@snapshotDecisionForCommand("true")');
    assert.include(schema, '@concealment("NotFound:credential,scope")');

    // Only a group that is the parent of some operation is grantable; All members and orphans are not.
    assert.include(policies, 'capability/cap.a"');
    assert.include(policies, 'capability/cap.b"');
    assert.notInclude(policies, "capability/cap.x");
    assert.notInclude(policies, "capability/cap.orphan");
    assert.include(schema, 'action "capability/cap.orphan"');
    assert.include(schema, 'action "capability/cap.x"');
  });

  it("escapes Cedar string literals", () => {
    const { schema, policies } = filesOf(variantsIr);

    assert.include(schema, 'action "capability/cap \\"quoted\\" \\\\ name"');
    assert.include(policies, '@id("effx:grant:cap \\"quoted\\" \\\\ name")');
  });

  it("a Capability focus becomes a @focus annotation and a requirement parameter is id-only", () => {
    const { schema } = filesOf(variantsIr);

    assert.include(schema, '@capability("cap.a") @focus("members")');
    assert.include(schema, '"org.member": Bool, "profile.owner": Bool');
  });

  it("stacked @Authorize cannot be one request: no group parent, EFFX4104", () => {
    const result = project(stackedIr);
    const { schema, policies } = Option.getOrThrow(result.files);

    assert.include(schema, 'action "operation/Stacked.Op"\n');
    assert.notInclude(policies, "effx:grant");
    assert.deepStrictEqual(codes(result.diagnostics), ["EFFX4105", "EFFX4104"]);
  });

  it("the namespace option replaces the default in the schema and in every policy reference", () => {
    const { schema, policies } = filesOf(profileIr, "App::Authz");

    assert.include(schema, "namespace App::Authz {");
    assert.include(policies, 'action in App::Authz::Action::"capability/profile.read-self"');
    assert.include(policies, 'action == App::Authz::Action::"operation/Profile.Read"');
    assert.notInclude(`${schema}${policies}`, "Effx::");
  });

  it("output is deterministic and independent of node and edge order", () => {
    const forward = filesOf(variantsIr);

    const reversed = filesOf(make(variantsIr.nodes.toReversed(), variantsIr.edges.toReversed()));

    assert.deepStrictEqual(reversed, forward);
    assert.deepStrictEqual(filesOf(variantsIr), forward);
  });

  it("every AccessContractData field is classified, and every annotated field has an emitter", () => {
    assert.deepStrictEqual(
      Object.keys(AccessContractProjection).toSorted(),
      Object.keys(AccessContractData.fields).toSorted(),
    );

    const { schema } = filesOf(variantsIr);

    for (const [field, disposition] of Object.entries(AccessContractProjection)) {
      if (disposition === "annotated" || disposition === "both") {
        assert.include(schema, `@${field}(`, `${field} is annotated but never emitted`);
      }
    }
  });
});

describe("cedarOf diagnostics (spec 0017 F6)", () => {
  it("EFFX4101 for an invalid --namespace writes nothing", () => {
    for (const namespace of ["", "1bad", "if", "Effx::", "a-b", "Effx::__cedar", "has::x"]) {
      const result = project(profileIr, namespace);

      assert.isTrue(Option.isNone(result.files), namespace);
      assert.deepStrictEqual(
        result.diagnostics.map((d) => [d.code, d.severity]),
        [["EFFX4101", "error"]],
        namespace,
      );
    }
  });

  it("EFFX4101 for two resolver symbols with one export name", () => {
    const result = project(collidingResolversIr);

    assert.isTrue(Option.isNone(result.files));
    assert.deepStrictEqual(codes(result.diagnostics), ["EFFX4101"]);
    assert.include(result.diagnostics[0]!.message, "entity type Scope");
  });

  it("EFFX4101 for a resolver export equal to a Model name", () => {
    const result = project(resolverEqualsModelIr);

    assert.isTrue(Option.isNone(result.files));
    assert.deepStrictEqual(codes(result.diagnostics), ["EFFX4101"]);
    assert.include(result.diagnostics[0]!.message, "entity type Org");
  });

  it("EFFX4101 for resolver names that are not Cedar entity type names", () => {
    const result = project(invalidNamesIr);

    assert.isTrue(Option.isNone(result.files));
    assert.deepStrictEqual(codes(result.diagnostics), ["EFFX4101", "EFFX4101"]);
  });

  it("EFFX4103/4104/4105 carry the operation name and severities", () => {
    const messages = project(variantsIr).diagnostics.map(
      (d) => `${d.code} ${d.severity} ${d.message}`,
    );

    assert.deepStrictEqual(messages, [
      "EFFX4104 warning All.Op: capabilities All cannot be one Cedar request; the operation action has no capability group parent",
      'EFFX4103 warning Params.Op: requirement "profile.owner" has parameters; projected id-only, the Cedar model does not enforce them',
    ]);
  });

  it("EFFX4107 when nothing has a capability or a contract", () => {
    const result = project(unprotectedIr);

    assert.isTrue(Option.isNone(result.files));
    assert.deepStrictEqual(
      result.diagnostics.map((d) => [d.code, d.severity]),
      [["EFFX4107", "info"]],
    );
  });
});
