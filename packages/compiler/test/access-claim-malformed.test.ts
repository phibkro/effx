import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { IRGraph, StableId, make, type Edge, type Node, type OperationNode } from "@effx/ir";
import { Extensions, compileCollected } from "@effx/compiler";
import type { AnnotationArg, Collected, Declaration } from "../src/Collected.ts";

/*
 * A malformed `snapshotDecisionForCommand` (a string, a number, `null`, an object, an array, an explicit
 * `undefined`) is never a claim. It is rejected as data (EFFX1102 while interpreting source, EFFX2500 when
 * a cached IR holds it), never as a `CompilerFault`, and it never waives EFFX2501: the error blocks
 * generation, so a Command that decides in a read snapshot cannot ship on the strength of a bad flag.
 * These tests use only APIs that exist before and after the definition re-expression, so the same file is
 * the old-versus-new parity oracle.
 */

const access = Extensions.accessContractExtension;

const operationId = StableId.make("operation", "Contact.Submit");

const schemaRef = (name: string) => ({
  module: "contact/schemas",
  export: name,
  symbolId: StableId.make("schema", `contact/${name}`),
});

const schema = (name: string): AnnotationArg => ({ _tag: "Schema", ref: schemaRef(name) });

const symbol = (name: string, security = false): AnnotationArg =>
  security
    ? { _tag: "Symbol", ref: { module: "contact/support", export: name }, security }
    : { _tag: "Symbol", ref: { module: "contact/support", export: name } };

/** The mono-web Contact access shape: the one shape a snapshot claim is allowed for. */
const contactAccess = {
  annotator: symbol("contactAccessAnnotations"),
  exposure: "External",
  acceptedCredentials: ["ObjectCapability"],
  principalKinds: ["CapabilityHolder"],
  capabilities: { _tag: "One", capability: "contact.submit" },
  requirements: [],
  canonicalScopeResolver: symbol("ContactDepartmentRecipient"),
  concealment: { _tag: "Reveal" },
  decisionTime: "SnapshotRead",
} satisfies Readonly<Record<string, AnnotationArg>>;

/** Every kind of value the frontend or a hand-edited IR could carry that is not a boolean. */
type MalformedFlag =
  | string
  | number
  | null
  | undefined
  | ReadonlyArray<boolean>
  | { readonly claim: boolean };

const unusable: ReadonlyArray<readonly [string, MalformedFlag]> = [
  ["a string", "true"],
  ["the string yes", "yes"],
  ["a number", 1],
  ["zero", 0],
  ["null", null],
  ["an object", { claim: true }],
  ["an array", [true]],
  ["an explicit undefined", undefined],
];

const withFlag = (flag: MalformedFlag): AnnotationArg => {
  // SAFETY: the lowered form of an invalid value is exactly what the frontend could not produce; the test
  // injects it to prove the compiler rejects it as data. The cast never reaches production code.
  return { ...contactAccess, snapshotDecisionForCommand: flag } as AnnotationArg;
};

const declaration = (arg: AnnotationArg): Declaration => ({
  id: "Contact.Submit",
  kind: "builder",
  module: "contact/operations",
  export: "Submit",
  binding: "external",
  annotations: [
    {
      name: "Command",
      args: [{ name: "Contact.Submit", input: schema("ContactMessage"), success: schema("Sent") }],
    },
    { name: "Http.Post", args: ["/api/contact-messages"] },
    {
      name: "Http.Contract",
      args: [
        {
          group: "contact",
          payload: schema("ContactMessage"),
          success: schema("Sent"),
          middleware: [symbol("ContactSecurity", true)],
          metadata: { operationId: "contact.submit" },
        },
      ],
    },
    { name: "Http.Access", args: [arg] },
  ],
});

const root = { module: "contact/api", export: "ContactApi" };

const group: Declaration = {
  id: "ContactGroup",
  kind: "builder",
  module: "contact/operations",
  export: "ContactGroup",
  annotations: [
    {
      name: "Http.Group",
      args: [
        {
          root: {
            _tag: "Symbol",
            ref: root,
            identifier: "effx",
          },
          group: "contact",
        },
      ],
    },
  ],
};

const collected = (arg: AnnotationArg): Collected => ({
  declarations: [group, declaration(arg)],
  diagnostics: [],
  // The native Contact group is complete even when the access claim is malformed.
  httpApiGroups: [{ root, group: "contact", endpoints: ["submit"] }],
});

const errorCodes = (diagnostics: ReadonlyArray<{ code: string; severity: string }>) =>
  diagnostics.flatMap((d) => (d.severity === "error" ? [d.code] : []));

describe("a non-boolean snapshotDecisionForCommand is rejected as data", () => {
  for (const [label, flag] of unusable) {
    it.effect(`interpreting ${label} yields EFFX1102 only and records nothing`, () =>
      Effect.sync(() => {
        const arg = withFlag(flag);

        const contribution = access.interpreters["Http.Access"]!(
          { name: "Http.Access", args: [arg] },
          declaration(arg),
          { operationId: Option.some(operationId) },
        );

        assert.deepStrictEqual(
          contribution.diagnostics.map((d) => d.code),
          ["EFFX1102"],
        );
        assert.deepStrictEqual(contribution.nodes, []);
        assert.deepStrictEqual(contribution.edges, []);
      }),
    );

    it.effect(`compiling ${label} fails with a diagnostic, not a fault, and ships nothing`, () =>
      Effect.gen(function* () {
        // A CompilerFault would fail this effect; a diagnostic is a value.
        const result = yield* compileCollected(collected(withFlag(flag)), Extensions.builtin);
        const errors = errorCodes(result.diagnostics);

        assert.include(errors, "EFFX1102");
        // The rejected annotation records no AccessContract, so nothing can waive EFFX2501.
        assert.notInclude(errors, "EFFX2506");
        assert.isTrue(Option.isNone(result.files.value));

        const ir = Option.getOrThrow(result.ir.value);

        assert.isFalse(
          ir.nodes.some(
            (node) => node._tag === "Extension" && node.extension === "access-contract",
          ),
        );
      }),
    );
  }

  it.effect("a real claim compiles and a Command/SnapshotRead without one stays EFFX2501", () =>
    Effect.gen(function* () {
      const claimed = yield* compileCollected(
        collected({ ...contactAccess, snapshotDecisionForCommand: true }),
        Extensions.builtin,
      );

      assert.deepStrictEqual(errorCodes(claimed.diagnostics), []);
      assert.isTrue(Option.isSome(claimed.files.value));

      for (const absent of [
        contactAccess,
        { ...contactAccess, snapshotDecisionForCommand: false },
      ]) {
        const result = yield* compileCollected(collected(absent), Extensions.builtin);

        assert.deepStrictEqual(errorCodes(result.diagnostics), ["EFFX2501"]);
        assert.isTrue(Option.isNone(result.files.value));
      }
    }),
  );

  for (const [label, flag] of unusable) {
    if (flag === undefined) continue;

    it.effect(`a cached IR holding ${label} is EFFX2500 and never waives EFFX2501`, () =>
      Effect.sync(() => {
        const extensionId = StableId.make("ext", "access-contract/Contact.Submit");

        // Cached IR can hold any JSON: this is a hand-edited ir.json, built without a cast.
        const contract: Node = {
          _tag: "Extension",
          id: extensionId,
          extension: "access-contract",
          tag: "AccessContract",
          data: {
            annotator: { module: "contact/support", export: "contactAccessAnnotations" },
            exposure: "External",
            acceptedCredentials: ["ObjectCapability"],
            principalKinds: ["CapabilityHolder"],
            capabilities: { _tag: "One", capability: "contact.submit" },
            requirements: [],
            canonicalScopeResolver: {
              module: "contact/support",
              export: "ContactDepartmentRecipient",
            },
            concealment: { _tag: "Reveal" },
            decisionTime: "SnapshotRead",
            snapshotDecisionForCommand: flag,
          },
        };

        const command: OperationNode = {
          _tag: "Operation",
          id: operationId,
          name: "Contact.Submit",
          kind: "Command",
          input: schemaRef("ContactMessage"),
          success: schemaRef("Sent"),
          errors: { values: [], inferred: true },
          requirements: { values: [], inferred: true },
          handler: { module: "contact/operations", export: "Submit" },
        };

        const edges: Array<Edge> = [
          { kind: "ExtensionOf", from: extensionId, to: operationId, qualifier: "AccessContract" },
        ];

        const ir = make([command, contract], edges);
        const index = IRGraph.toGraph(ir);

        const diagnostics = access.analyses.flatMap((analysis) =>
          analysis(ir, index, { strictAccess: false }),
        );

        const errors = errorCodes(diagnostics);

        assert.include(errors, "EFFX2500");
        assert.notInclude(errors, "EFFX2506");
      }),
    );
  }
});
