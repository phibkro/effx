import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Schema } from "effect";
import { IRArbitrary } from "@effx/ir";
import {
  Collected,
  Extensions,
  LiftDiagnostics,
  compileCollected,
  lift,
  type EffectModel,
  type LiftInput,
  type LiftResult,
} from "@effx/compiler";
import { profileFullModel, profileInput, profileRules } from "./lift-profile.ts";
import { schemaOf } from "./lift-support.ts";

/*
 * The pure core on the mono-web Profile group (spec 0019 §3.3, §3.4): what a supported endpoint lifts to,
 * what an unsupported one keeps (every cause, no suggestion), the refactors with their real references, the
 * decisions that are never "verified", and the totality and order laws of §10.
 */

const lifted = lift(profileFullModel, profileInput);

const declaration = (result: LiftResult, id: string) =>
  result.collected.declarations.find((candidate) => candidate.id === id);

const annotationsOf = (result: LiftResult, id: string) =>
  Object.fromEntries(
    (declaration(result, id)?.annotations ?? []).map((annotation) => [
      annotation.name,
      annotation.args,
    ]),
  );

const schema = (module: string, name: string, fields?: ReadonlyArray<string>) => {
  const ref = { module, export: name, symbolId: `schema:${module.replace(/^\.\//u, "")}/${name}` };

  return fields === undefined ? { _tag: "Schema", ref } : { _tag: "Schema", ref, fields };
};

const symbol = (module: string, name: string, security?: true) => {
  const ref = { module, export: name };

  return security === undefined ? { _tag: "Symbol", ref } : { _tag: "Symbol", ref, security };
};

describe("a supported endpoint lifts to the declaration a human writes", () => {
  it("makes the group and one operation per recognized endpoint, group first", () => {
    assert.deepStrictEqual(
      lifted.collected.declarations.map((candidate) => candidate.id),
      ["ProfileGroup", "ReadOwnProfile"],
    );
  });

  it("names the operation `<group>.<key>` and takes the headers schema as its input", () => {
    const annotations = annotationsOf(lifted, "ReadOwnProfile");

    assert.deepStrictEqual(annotations.Query, [
      {
        name: "profile.readOwnProfile",
        input: schema("./src/http-semantics", "ConditionalReadHeaders", ["if-none-match"]),
        success: schema("./src/v2-schemas", "UserProfileResponse"),
      },
    ]);

    assert.deepStrictEqual(annotations["Http.Get"], ["/api/profile"]);
  });

  it("reads the registered wrapper, middleware and metadata into one contract", () => {
    assert.deepStrictEqual(annotationsOf(lifted, "ReadOwnProfile")["Http.Contract"], [
      {
        root: "external-native-api",
        group: "profile",
        headers: schema("./src/http-semantics", "ConditionalReadHeaders", ["if-none-match"]),
        success: schema("./src/v2-schemas", "UserProfileResponse"),
        responseHeaders: schema("./src/http-semantics", "ProfileReadResponseHeaders"),
        conditional: true,
        middleware: [symbol("./src/common", "PersonSecurity", true)],
        metadata: {
          annotator: symbol("./src/common", "nativeOperationAnnotations"),
          operationId: "profile.readOwnProfile",
          summary: "Read own profile",
          description: "Returns the profile selected by the current session.",
        },
      },
    ]);
  });

  it("evaluates the access rule to the data the IR validates, with the pinned resolver", () => {
    assert.deepStrictEqual(annotationsOf(lifted, "ReadOwnProfile")["Http.Access"], [
      {
        annotator: symbol("./src/profile-effx-adapters", "profileAccessAnnotations"),
        exposure: "External",
        acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
        principalKinds: ["Person"],
        capabilities: { _tag: "One", capability: "profile.read-self" },
        requirements: [{ id: "profile.owner" }],
        canonicalScopeResolver: symbol("./src/profile-effx-adapters", "ProfileCurrentPerson"),
        concealment: { _tag: "Reveal" },
        decisionTime: "SnapshotRead",
      },
    ]);
  });

  it("references the planned code tuple instead of copying the codes", () => {
    assert.deepStrictEqual(annotationsOf(lifted, "ReadOwnProfile")["Http.Problems"], [
      {
        registry: symbol("./src/endpoint-problems", "nativeProblems"),
        codes: ["request.malformed", "precondition.failed", "internal.error"],
        identifier: "ProfileReadOwnProfileProblem",
      },
    ]);

    assert.deepStrictEqual(lifted.codeReferences, [
      {
        identifier: "ProfileReadOwnProfileProblem",
        codes: ["request.malformed", "precondition.failed", "internal.error"],
        ref: { module: "./src/endpoint-problems", export: "ProfileReadOwnProfileCodes" },
      },
    ]);
  });

  it.effect("compiles with the existing pipeline to errors-free IR", () =>
    Effect.gen(function* () {
      const compiled = yield* compileCollected(lifted.collected, Extensions.builtin);

      assert.deepStrictEqual(compiled.diagnostics, []);
      assert.isTrue(Option.isSome(compiled.ir.value));
    }),
  );
});

describe("an unsupported endpoint keeps every cause and no suggestion", () => {
  it("omits the endpoint and reports one primary diagnostic at the spread", () => {
    assert.isUndefined(declaration(lifted, "UpdateOwnProfile"));

    const [site] = lifted.unsupported;

    assert.strictEqual(lifted.unsupported.length, 1);
    assert.strictEqual(site?.subject, "profile.updateOwnProfile");
    assert.strictEqual(site?.primary.code, "EFFX3001");
    assert.deepStrictEqual(site?.primary.location, { file: "src/profile.ts", line: 11, col: 1 });
    assert.strictEqual(site?.primary.related, undefined);
  });

  it("never lets one unsupported endpoint change what another one lifts to", () => {
    const without: EffectModel = {
      ...profileFullModel,
      endpoints: profileFullModel.endpoints.filter(
        (endpoint) => endpoint.symbol.export !== "UpdateOwnProfileEndpoint",
      ),
    };

    const alone = lift(without, profileInput);

    assert.deepStrictEqual(alone.collected, lifted.collected);
    assert.deepStrictEqual(alone.refactors, lifted.refactors);
  });
});

describe("refactors are typed edits with real references", () => {
  const [refactor] = lifted.refactors;

  it("plans one EFFX3004 in the file that holds the union, never applying it", () => {
    assert.strictEqual(lifted.refactors.length, 1);
    assert.strictEqual(refactor?.code, "EFFX3004");
    assert.strictEqual(refactor?.file, "src/endpoint-problems.ts");
    assert.strictEqual(refactor?.sourceSha256, "1".repeat(64));
    assert.strictEqual(refactor?.cause.code, "EFFX3004");
  });

  it("inserts the exported tuple before the union and replaces the inline list by it", () => {
    assert.deepStrictEqual(
      refactor?.edits.map((edit) => edit._tag),
      ["InsertExport", "Replace"],
    );

    const [insert, replace] = refactor?.edits ?? [];

    assert.strictEqual(
      insert?._tag === "InsertExport" ? insert.name : "",
      "ProfileReadOwnProfileCodes",
    );
    assert.strictEqual(insert?._tag === "InsertExport" ? insert.asConst : false, true);
    assert.strictEqual(insert?._tag === "InsertExport" ? insert.at.offset : -1, 100);
    assert.strictEqual(replace?._tag === "Replace" ? replace.range.start.offset : -1, 190);
    assert.strictEqual(replace?._tag === "Replace" ? replace.range.end.offset : -1, 256);
    assert.deepStrictEqual(replace?._tag === "Replace" ? replace.replacement : undefined, {
      _tag: "Ref",
      ref: { module: "./src/endpoint-problems", export: "ProfileReadOwnProfileCodes" },
    });
  });

  it("tells a derived name from a pinned one by `source` alone", () => {
    assert.deepStrictEqual(refactor?.planned, [
      {
        key: "./src/endpoint-problems#ProfileReadOwnProfileProblem#codes",
        role: "codes",
        name: "ProfileReadOwnProfileCodes",
        source: "derived",
        ref: { module: "./src/endpoint-problems", export: "ProfileReadOwnProfileCodes" },
      },
    ]);

    const pinned = lift(profileFullModel, {
      ...profileInput,
      names: {
        ...profileInput.names,
        "./src/endpoint-problems#ProfileReadOwnProfileProblem#codes": {
          module: "./src/endpoint-problems",
          export: "ProfileReadCodes",
        },
      },
    });

    assert.deepStrictEqual(
      pinned.refactors.flatMap((planned) =>
        planned.planned.map((entry) => [entry.name, entry.source]),
      ),
      [["ProfileReadCodes", "names"]],
    );
  });

  it("diagnoses a pin that names an export which already exists instead of overwriting it", () => {
    const taken = lift(profileFullModel, {
      ...profileInput,
      names: {
        ...profileInput.names,
        "./src/endpoint-problems#ProfileReadOwnProfileProblem#codes": {
          module: "./src/endpoint-problems",
          export: "ProfileReadOwnProfileProblem",
        },
      },
    });

    assert.strictEqual(taken.refactors.length, 0);
    assert.strictEqual(taken.unsupported[0]?.primary.code, "EFFX3001");
    assert.include(taken.unsupported[0]?.primary.message ?? "", "already declared");
    assert.strictEqual(declaration(taken, "ReadOwnProfile"), undefined);
  });
});

describe("decisions are reviewable and never verified", () => {
  it("lists the kind, the input and every export name with an EFFX3010 warning each", () => {
    assert.deepStrictEqual(
      lifted.decisions.map((decision) => [decision._tag, "role" in decision ? decision.role : ""]),
      [
        ["ExportName", "group"],
        ["OperationKind", ""],
        ["OperationInput", ""],
        ["ExportName", "operation"],
        ["ExportName", "codes"],
      ],
    );

    const warnings = lifted.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX3010");

    assert.strictEqual(warnings.length, lifted.decisions.length);
    assert.isTrue(warnings.every((diagnostic) => diagnostic.severity === "warning"));
  });

  it("states that a GET is a Query read from the headers schema, and what else was available", () => {
    const input = lifted.decisions.find((decision) => decision._tag === "OperationInput");

    assert.deepStrictEqual(input, {
      _tag: "OperationInput",
      subject: "profile.readOwnProfile",
      channel: "headers",
      schema: schemaOf("./src/http-semantics", "ConditionalReadHeaders"),
      others: [],
    });
  });
});

describe("the group is found or diagnosed", () => {
  it("reports EFFX3008 for a group no declaration has", () => {
    const missing = lift(profileFullModel, { ...profileInput, group: "nobody" });

    assert.deepStrictEqual(
      missing.diagnostics.map((diagnostic) => diagnostic.code),
      [LiftDiagnostics.EFFX3008.entry.code],
    );
    assert.deepStrictEqual(missing.collected.declarations, []);
    assert.deepStrictEqual(missing.refactors, []);
  });

  it("reports EFFX3008 for a group two roots add", () => {
    const [root] = profileFullModel.roots;

    if (root === undefined) return assert.fail("the Profile model has a root");

    const twice = lift(
      {
        ...profileFullModel,
        roots: [root, { ...root, symbol: { module: "./src/api", export: "InternalNativeApi" } }],
      },
      profileInput,
    );

    assert.strictEqual(twice.diagnostics[0]?.code, "EFFX3008");
    assert.include(twice.diagnostics[0]?.message ?? "", "ExternalNativeApi");
    assert.include(twice.diagnostics[0]?.message ?? "", "InternalNativeApi");
    assert.deepStrictEqual(twice.collected.declarations, []);
  });
});

describe("adapter prerequisites name only symbols that do not resolve", () => {
  it("is empty when every rule symbol is exported by a module of the model", () => {
    assert.deepStrictEqual(lifted.adapterPrerequisites, [
      {
        rule: "ProblemRegistry endpointProblemResponses",
        role: "registry",
        ref: { module: "./src/endpoint-problems", export: "nativeProblems" },
      },
    ]);
  });

  it("lists a rule symbol whose module is not analyzed", () => {
    const extra: LiftInput = {
      ...profileInput,
      rules: [
        ...profileRules,
        {
          _tag: "NoSchemaSuccess",
          callee: { module: "./src/not-analyzed", export: "documentMutationResponse" },
        },
      ],
    };

    assert.isTrue(
      lift(profileFullModel, extra).adapterPrerequisites.some(
        (entry) => entry.ref.export === "documentMutationResponse",
      ),
    );
  });
});

describe("lifting is total and order independent", () => {
  const permuted = (model: EffectModel): EffectModel => ({
    ...model,
    files: model.files.toReversed(),
    natives: model.natives.toReversed(),
    schemas: model.schemas.toReversed(),
    markers: model.markers.toReversed(),
    values: model.values.toReversed(),
  });

  it("does not depend on the order of the inventories of the model", () => {
    assert.deepStrictEqual(lift(permuted(profileFullModel), profileInput), lifted);
  });

  it("does not depend on the order of the rules", () => {
    assert.deepStrictEqual(
      lift(profileFullModel, { ...profileInput, rules: profileRules.toReversed() }),
      lifted,
    );
  });

  it("returns a result the Collected schema accepts", () => {
    assert.isTrue(Schema.is(Collected)(lifted.collected));
  });

  it.effect("never throws on a model broken in any combination of its parts", () =>
    Effect.gen(function* () {
      const Break = Schema.Struct({
        claims: Schema.Boolean,
        files: Schema.Boolean,
        schemas: Schema.Boolean,
        markers: Schema.Boolean,
        values: Schema.Boolean,
        rules: Schema.Array(Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 3 }))),
      });

      const failure = yield* IRArbitrary.falsification(
        IRArbitrary.arbitraryOf(Break),
        (broken) => {
          const model: EffectModel = {
            ...profileFullModel,
            natives: broken.claims ? [] : profileFullModel.natives,
            files: broken.files ? [] : profileFullModel.files,
            schemas: broken.schemas ? [] : profileFullModel.schemas,
            markers: broken.markers ? [] : profileFullModel.markers,
            values: broken.values ? [] : profileFullModel.values,
          };

          const input: LiftInput = {
            ...profileInput,
            rules: profileRules.filter((_, index) => !broken.rules.includes(index)),
          };

          const result = lift(model, input);
          const operations = Math.max(result.collected.declarations.length - 1, 0);

          // A blocked or missing group suggests nothing and says why; otherwise every endpoint of the
          // group is exactly one of a lifted operation and an unsupported site.
          const endpointSites = result.unsupported.filter((site) => site.subject !== input.group);

          const accounted =
            result.collected.declarations.length === 0
              ? result.diagnostics.length > 0
              : operations + endpointSites.length === profileFullModel.endpoints.length;

          return accounted && Schema.is(Collected)(result.collected);
        },
        { runs: 120, seed: 7 },
      );

      assert.isUndefined(failure, failure);
    }),
  );
});
