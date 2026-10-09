import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import { StableId, canonical } from "@effx/ir";
import {
  Extensions,
  Terms,
  compileCollected,
  dense,
  lift,
  liftRegistryOf,
  printSuggestion,
  renderPatch,
  type EffectModel,
  type LiftInput,
  type Term,
} from "@effx/compiler";
import { expandGroupDefaults } from "../src/group-defaults.ts";
import { refIdentity, symbolRefOf } from "../src/lift/refs.ts";
import { entriesOf, isObjectArg } from "../src/lift/arg.ts";
import { sourceInput, sourceUniverse, supportFiles } from "./lift-fixtures.ts";
import { modelOf, type SourceFile } from "./lift-source.ts";
import { applyPatch } from "./lift-apply.ts";

const source = (body: ReadonlyArray<string>): SourceFile => ({
  path: "src/repair.ts",
  contents: [
    'import { Schema, SchemaAST } from "effect";',
    'import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api";',
    'import { EmptyInput, UserProfileResponse, ProfileMergePatch } from "./v2-schemas.js";',
    'import { ConditionalReadHeaders, EntityMutationResponseHeaders, endpointProblemResponses, entityMutationResponse } from "./http-semantics.js";',
    'import { ProfileReadOwnProfileProblem, ProfileUpdateOwnProfileProblem } from "./endpoint-problems.js";',
    'import { mysteryAnnotations } from "./mystery.js";',
    "export const Body = Schema.String;",
    ...body,
    'export const Api = HttpApiGroup.make("repair").add(Read);',
    'export const Root = HttpApi.make("repair-root").add(Api);',
    "",
  ].join("\n"),
});

const input = (): LiftInput => sourceInput("repair");

const filesOf = (file: SourceFile): ReadonlyArray<SourceFile> => [...supportFiles, file];

const model = (file: SourceFile): EffectModel =>
  modelOf(filesOf(file), {
    ...sourceUniverse,
    schemas: [
      {
        module: "./src/repair",
        export: "Body",
        symbolId: StableId.make("schema", "src/repair/Body"),
      },
    ],
    root: { symbol: { module: "./src/repair", export: "Root" }, id: "repair-root" },
  });

const outcome = (body: ReadonlyArray<string>, options: LiftInput = input()) =>
  lift(model(source(body)), options, liftRegistryOf([]));

const unsupported = (body: ReadonlyArray<string>) => {
  const result = outcome(body);
  assert.strictEqual(result.collected.declarations.length, 0);
  assert.strictEqual(result.unsupported.length, 1);
  assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3001");
};

const patchOf = Effect.fnUntraced(function* (file: SourceFile, result: ReturnType<typeof lift>) {
  return yield* renderPatch({
    refactors: result.refactors,
    files: model(file).files,
    texts: new Map(filesOf(file).map((entry) => [entry.path, entry.contents])),
    allowImportingTsExtensions: false,
  });
});

// Each case is a falsifier from the frozen-head independent review, not a pin of the buggy output.
describe("lift repair: unsupported wire-loss shapes", () => {
  it("rejects every unrepresentable endpoint OpenAPI override field", () => {
    const result = outcome([
      'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: Schema.Never })',
      '  .annotateMerge(OpenApi.annotations({ override: { "x-audit": true, security: [] } }));',
    ]);

    assert.deepStrictEqual(result.collected.declarations, []);
    const [site] = result.unsupported;
    assert.strictEqual(site?.primary.code, "EFFX3001");
    const causes = site === undefined ? [] : [site.primary, ...(site.primary.related ?? [])];
    assert.strictEqual(causes.length, 2);
    assert.include(causes.map((cause) => cause.message).join(" "), "x-audit");
    assert.isBelow(causes[0]?.location?.col ?? 0, causes[1]?.location?.col ?? 0);
    assert.include(causes.map((cause) => cause.message).join(" "), "security");
  });

  it.each([
    'Body.pipe(HttpApiSchema.asJson({ contentType: "application/example+json" }), HttpApiSchema.asText({ contentType: "text/plain" }))',
    'Body.pipe(HttpApiSchema.asJson({ contentType: "application/example+json" }, "extra"))',
  ])("rejects extra payload transformations and asJson arguments: %s", (payload) => {
    unsupported([
      `export const Read = HttpApiEndpoint.post("read", "/read", { payload: ${payload}, success: UserProfileResponse, error: Schema.Never });`,
    ]);
  });

  it("retains missing-input and unknown-metadata causes together", () => {
    const { emptyInput: _, ...withoutEmpty } = input();

    const result = outcome(
      [
        'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: Schema.Never })',
        '  .annotateMerge(mysteryAnnotations("Read"));',
      ],
      withoutEmpty,
    );

    const site = result.unsupported[0];
    assert.deepStrictEqual(
      site === undefined
        ? []
        : [site.primary.code, ...(site.primary.related ?? []).map((cause) => cause.code)],
      ["EFFX3009", "EFFX3006"],
    );
  });

  it.each([
    "HttpApiSchema.WithHeaders(UserProfileResponse.pipe(HttpApiSchema.status(201)), EntityMutationResponseHeaders)",
    "HttpApiSchema.WithHeaders(HttpApiSchema.NoContent.pipe(HttpApiSchema.status(201)), EntityMutationResponseHeaders)",
    'HttpApiSchema.WithHeaders(HttpApiSchema.NoContent.pipe(HttpApiSchema.status(304)), EntityMutationResponseHeaders, "extra")',
  ])("rejects a conditional pair with the wrong second response: %s", (second) => {
    unsupported([
      `export const Read = HttpApiEndpoint.get("read", "/read", { success: [HttpApiSchema.WithHeaders(UserProfileResponse, EntityMutationResponseHeaders), ${second}], error: Schema.Never });`,
    ]);
  });

  it("preserves an outer 200 over the wrapper's 201", () => {
    const configured: LiftInput = {
      ...input(),
      rules: input().rules.map((rule) =>
        rule._tag === "SuccessWrapper" && rule.callee.export === "entityMutationResponse"
          ? { ...rule, status: 201 }
          : rule,
      ),
    };

    const result = outcome(
      [
        'export const Read = HttpApiEndpoint.get("read", "/read", { success: entityMutationResponse(UserProfileResponse).pipe(HttpApiSchema.status(200)), error: Schema.Never });',
      ],
      configured,
    );

    assert.deepStrictEqual(result.unsupported, []);

    const contract = result.collected.declarations
      .find((declaration) => declaration.export === "Read")
      ?.annotations.find((annotation) => annotation.name === "Http.Contract")?.args[0];

    assert.isDefined(contract);

    if (contract !== undefined && isObjectArg(contract))
      assert.strictEqual(entriesOf(contract).find(([name]) => name === "status")?.[1], 200);
    else assert.fail("the explicit 200 contract must remain an object");
  });

  it.each([
    "(SchemaAST.resolve(ProfileMergePatch.ast)?.httpApiStatus ?? 200) === 200 ? UserProfileResponse : HttpApiSchema.status(200)(UserProfileResponse)",
    "(SchemaAST.resolve(UserProfileResponse.ast)?.httpApiStatus ?? 201) === 200 ? UserProfileResponse : HttpApiSchema.status(200)(UserProfileResponse)",
    "(SchemaAST.resolve(UserProfileResponse.ast)?.httpApiStatus ?? 200) === 200 ? UserProfileResponse : HttpApiSchema.status(200)(ProfileMergePatch)",
  ])("rejects a conditional that is not the complete S5 expression: %s", (success) => {
    unsupported([
      `export const Read = HttpApiEndpoint.get("read", "/read", { success: ${success}, error: Schema.Never });`,
    ]);
  });
});

describe("lift repair: shared references and source ownership", () => {
  it.effect.each([false, true])("reuses one shared-union extraction with a name pin=%s", (pinned) =>
    Effect.gen(function* () {
      const file = source([
        'export const Other = HttpApiEndpoint.get("other", "/other", { success: UserProfileResponse, error: endpointProblemResponses(ProfileReadOwnProfileProblem) });',
        'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: endpointProblemResponses(ProfileReadOwnProfileProblem) });',
      ]);

      const both = { ...file, contents: file.contents.replace(".add(Read)", ".add(Read, Other)") };

      const result = lift(
        model(both),
        {
          ...input(),
          names: pinned
            ? {
                "./src/endpoint-problems#ProfileReadOwnProfileProblem#codes": {
                  module: "./src/endpoint-problems",
                  export: "ReadCodes",
                },
              }
            : {},
        },
        liftRegistryOf([]),
      );

      assert.deepStrictEqual(result.unsupported, []);
      assert.strictEqual(
        result.refactors.filter((refactor) => refactor.code === "EFFX3004").length,
        1,
      );
      const patch = yield* patchOf(both, result);
      const after = applyPatch(filesOf(both), patch);
      assert.strictEqual(
        lift(
          modelOf(after, {
            ...sourceUniverse,
            root: { symbol: { module: "./src/repair", export: "Root" }, id: "repair-root" },
          }),
          input(),
          liftRegistryOf([]),
        ).refactors.length,
        0,
      );
    }).pipe(Effect.provide(BunServices.layer)),
  );

  it("preserves distinct static-schema members and their import holding export", () => {
    const response = {
      module: "./src/types",
      export: "Schemas",
      symbolId: StableId.make("schema", "src/types/Schemas.Response"),
    };

    const other = { ...response, symbolId: StableId.make("schema", "src/types/Schemas.Other") };
    assert.notStrictEqual(refIdentity(response), refIdentity(other));
    assert.deepStrictEqual(symbolRefOf(response), {
      module: "./src/types",
      export: "Schemas",
      member: "Response",
    });

    const result = outcome([
      'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: Schema.Never });',
    ]);

    const declarations = result.collected.declarations.map((declaration) => ({
      ...declaration,
      annotations: declaration.annotations.map((annotation) => ({
        ...annotation,
        args: annotation.args.map((arg) =>
          annotation.name === "Query"
            ? {
                name: "repair.read",
                input: { _tag: "Schema" as const, ref: response },
                success: { _tag: "Schema" as const, ref: other },
              }
            : arg,
        ),
      })),
    }));

    const printed = printSuggestion(
      { ...result.collected, declarations },
      { module: input().output.module },
    );

    assert.isTrue(Result.isSuccess(printed));

    if (Result.isSuccess(printed)) {
      assert.include(printed.success, "input: Schemas.Response");
      assert.include(printed.success, "success: Schemas.Other");
    }
  });

  it("accepts validated direct native OpenAPI annotations exports", () => {
    const file = source([
      'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: Schema.Never }).annotateMerge(OpenApi.annotations({ summary: "Read" }));',
    ]);

    const original = model(file);
    const direct = { module: "effect/http-api/OpenApi", export: "annotations" };

    const replaced: EffectModel = {
      ...original,
      natives: [...original.natives, { kind: "OpenApi", ref: direct, target: "effect-4.0" }],
      endpoints: original.endpoints.map((endpoint) => ({
        ...endpoint,
        steps: endpoint.steps.map((step) =>
          step._tag === "Method" && step.name === "annotateMerge"
            ? {
                ...step,
                args: step.args.map((arg) =>
                  arg._tag === "Lowered" && arg.term._tag === "Call"
                    ? { ...arg, term: Terms.call(Terms.ref(direct), arg.term.args) }
                    : arg,
                ),
              }
            : step,
        ),
      })),
    };

    const result = lift(replaced, input(), liftRegistryOf([]));
    assert.deepStrictEqual(result.unsupported, []);
    const printed = printSuggestion(result.collected, { module: input().output.module });
    assert.isTrue(Result.isSuccess(printed));

    if (Result.isSuccess(printed)) assert.include(printed.success, 'summary: "Read"');
  });

  it("keeps each code tuple associated with its exact contract despite shared identifiers", () => {
    const file = source([
      'export const Other = HttpApiEndpoint.get("other", "/other", { success: UserProfileResponse, error: endpointProblemResponses(ProfileUpdateOwnProfileProblem) });',
      'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: endpointProblemResponses(ProfileReadOwnProfileProblem) });',
    ]);

    const both = {
      ...file,
      contents: file.contents.replace(".add(Read)", ".add(Read, Other)"),
    };

    const files = filesOf(both).map((entry) =>
      entry.path === "src/endpoint-problems.ts"
        ? {
            ...entry,
            contents: entry.contents
              .replace('"ProfileReadOwnProfileProblem"', '"SharedProblem"')
              .replace('"ProfileUpdateOwnProfileProblem"', '"SharedProblem"'),
          }
        : entry,
    );

    const result = lift(
      modelOf(files, {
        ...sourceUniverse,
        root: { symbol: { module: "./src/repair", export: "Root" }, id: "repair-root" },
      }),
      input(),
      liftRegistryOf([]),
    );

    const printed = printSuggestion(result.collected, {
      module: input().output.module,
      codeReferences: result.codeReferences,
    });

    assert.isTrue(Result.isSuccess(printed));

    if (Result.isSuccess(printed)) {
      assert.include(printed.success, "codes: ProfileReadOwnProfileCodes");
      assert.include(printed.success, "codes: ProfileUpdateOwnProfileCodes");
    }
  });

  it.effect(
    "Call and Chain refactors replace only the inline schema, preserving status suffixes",
    () =>
      Effect.gen(function* () {
        const file = source([
          'export const Read = HttpApiEndpoint.get("read", "/read", { success: Schema.Array(UserProfileResponse).pipe(HttpApiSchema.status(201)), error: Schema.Never });',
        ]);

        const original = model(file);
        const endpoint = original.endpoints[0];
        assert.isDefined(endpoint);

        const transform = (term: Term): Term =>
          term._tag === "Call" && term.callee._tag === "Member" && term.callee.member === "pipe"
            ? Terms.chain(term.callee.term, [{ name: "pipe", args: term.args }])
            : term;

        const chained: EffectModel = {
          ...original,
          endpoints: original.endpoints.map((entry) => ({
            ...entry,
            options:
              entry.options._tag === "Entries"
                ? {
                    ...entry.options,
                    entries: entry.options.entries.map((property) =>
                      property._tag === "Property" &&
                      property.name === "success" &&
                      property.value._tag === "Lowered"
                        ? {
                            ...property,
                            value: {
                              ...property.value,
                              term: transform(property.value.term),
                              spans: property.value.spans.map((span) => ({
                                ...span,
                                path:
                                  span.path[0] === "callee" && span.path[1] === "term"
                                    ? ["head", ...span.path.slice(2)]
                                    : span.path,
                              })),
                            },
                          }
                        : property,
                    ),
                  }
                : entry.options,
          })),
        };

        const called = lift(original, input(), liftRegistryOf([]));
        const chainResult = lift(chained, input(), liftRegistryOf([]));

        const replacedText = (result: ReturnType<typeof lift>) =>
          result.refactors
            .flatMap((refactor) => refactor.edits)
            .filter((edit) => edit._tag === "Replace")
            .map((edit) => file.contents.slice(edit.range.start.offset, edit.range.end.offset));

        assert.deepStrictEqual(replacedText(chainResult), ["Schema.Array(UserProfileResponse)"]);
        assert.deepStrictEqual(replacedText(chainResult), replacedText(called));
        const patched = applyPatch(filesOf(file), yield* patchOf(file, chainResult));
        assert.include(
          patched.find((entry) => entry.path === file.path)?.contents ?? "",
          "RepairReadResponse.pipe(HttpApiSchema.status(201))",
        );
      }).pipe(Effect.provide(BunServices.layer)),
  );

  it.effect(
    "keeps CRLF and a missing final newline exact when applying a schema export patch",
    () =>
      Effect.gen(function* () {
        const base = source([
          'export const Read = HttpApiEndpoint.get("read", "/read", { query: { q: Schema.String }, success: UserProfileResponse, error: Schema.Never });',
        ]);

        const file = {
          ...base,
          contents: base.contents.replace(/\n/gu, "\r\n").replace(/\r\n$/u, ""),
        };

        const result = lift(model(file), input(), liftRegistryOf([]));

        const patched = applyPatch(filesOf(file), yield* patchOf(file, result)).find(
          (entry) => entry.path === file.path,
        );

        const expected = file.contents
          .replace(
            "export const Read =",
            "export const RepairReadQuery = Schema.Struct({ q: Schema.String });\r\n\r\nexport const Read =",
          )
          .replace("query: { q: Schema.String }", "query: RepairReadQuery");

        assert.strictEqual(patched?.contents, expected);
      }).pipe(Effect.provide(BunServices.layer)),
  );

  it("distinguishes definitely absent errors from unreadable error slots and retains input causes", () => {
    const { emptyInput: _, ...withoutEmpty } = input();

    const absent = outcome(
      [
        'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse }).annotateMerge(mysteryAnnotations("x"));',
      ],
      withoutEmpty,
    );

    const unreadable = outcome(
      [
        "const localError = UserProfileResponse;",
        'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: localError }).annotateMerge(mysteryAnnotations("x"));',
      ],
      withoutEmpty,
    );

    const causes = (result: ReturnType<typeof lift>) => {
      const site = result.unsupported[0];

      return site === undefined ? [] : [site.primary, ...(site.primary.related ?? [])];
    };

    assert.deepStrictEqual(
      causes(absent).map((cause) => cause.code),
      ["EFFX3001", "EFFX3009", "EFFX3006"],
    );
    assert.deepStrictEqual(
      causes(unreadable).map((cause) => cause.code),
      ["EFFX3009", "EFFX3001", "EFFX3006"],
    );
  });
});

it.effect("densifies configured pattern identifiers before dropping operationId", () =>
  Effect.gen(function* () {
    const file = source([
      'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: endpointProblemResponses(ProfileReadOwnProfileProblem) });',
    ]);

    const files = filesOf(file).map((entry) =>
      entry.path === "src/endpoint-problems.ts"
        ? {
            ...entry,
            contents: entry.contents.replace(
              '"ProfileReadOwnProfileProblem"',
              '"RepairReadProblem"',
            ),
          }
        : entry,
    );

    const model = modelOf(files, {
      ...sourceUniverse,
      root: { symbol: { module: "./src/repair", export: "Root" }, id: "repair-root" },
    });

    const result = lift(
      {
        ...model,
        project: {
          ...model.project,
          naming: { problemIdentifier: "{Group}{Key}Problem" },
        },
      },
      input(),
      liftRegistryOf([]),
    );

    const compact = dense(result.collected);
    assert.isTrue(Option.isSome(compact));

    if (Option.isSome(compact)) {
      const operation = compact.value.declarations.find(
        (declaration) => declaration.export === "Read",
      );

      const problems = operation?.annotations.find(
        (annotation) => annotation.name === "Http.Problems",
      )?.args[0];

      assert.isDefined(problems);

      if (problems !== undefined && isObjectArg(problems)) assert.isFalse("identifier" in problems);
      else assert.fail("the dense problem contract must remain an object");
      const rebuilt = expandGroupDefaults(compact.value);

      assert.deepStrictEqual(rebuilt.diagnostics, []);
      const verboseIR = yield* compileCollected(result.collected, Extensions.builtin);
      const denseIR = yield* compileCollected(compact.value, Extensions.builtin);
      assert.isTrue(Option.isSome(verboseIR.ir.value));
      assert.isTrue(Option.isSome(denseIR.ir.value));

      if (Option.isSome(verboseIR.ir.value) && Option.isSome(denseIR.ir.value))
        assert.strictEqual(canonical(verboseIR.ir.value.value), canonical(denseIR.ir.value.value));
    }
  }),
);

describe("private const problem-union source facts", () => {
  const privateSource = (
    use = "endpointProblemResponses(PrivateProblem)",
    init = 'problemUnion("PrivateProblem", ["missing", "denied"])',
  ) => {
    const file = source([
      `const PrivateProblem = ${init};`,
      `export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: ${use} });`,
    ]);

    return {
      ...file,
      contents: file.contents.replace(
        "endpointProblemResponses, entityMutationResponse",
        "endpointProblemResponses, entityMutationResponse, problemUnion",
      ),
    };
  };

  it.effect(
    "extracts one real public tuple without inventing an export for the private union",
    () =>
      Effect.gen(function* () {
        const file = privateSource();
        const inputModel = model(file);
        const result = lift(inputModel, input(), liftRegistryOf([]));

        assert.deepStrictEqual(result.unsupported, []);
        assert.strictEqual(
          inputModel.localValues.find((record) => record.id.name === "PrivateProblem")?.kind,
          "const",
        );
        assert.isFalse(inputModel.values.some((value) => value.symbol.export === "PrivateProblem"));
        assert.strictEqual(result.refactors.length, 1);
        assert.deepStrictEqual(result.codeReferences[0], {
          identifier: "PrivateProblem",
          codes: ["missing", "denied"],
          ref: { module: "./src/repair", export: "PrivateCodes" },
        });
        assert.strictEqual(
          result.refactors[0]?.sourceSha256,
          inputModel.files.find((record) => record.file === file.path)?.sha256,
        );

        const patch = yield* patchOf(file, result);
        const patched = applyPatch([file], patch)[0];

        assert.isDefined(patched);

        if (patched === undefined) return assert.fail("the patch must preserve the source file");

        const recovered = lift(model(patched), input(), liftRegistryOf([]));

        assert.deepStrictEqual(recovered.unsupported, []);
        assert.deepStrictEqual(recovered.refactors, []);
        assert.deepStrictEqual(recovered.collected, result.collected);
      }).pipe(Effect.provide(BunServices.layer)),
  );

  it.each([
    [
      "endpointProblemResponses(PrivateProblem, PrivateProblem)",
      'problemUnion("PrivateProblem", ["missing"])',
    ],
    ["entityMutationResponse(PrivateProblem)", 'problemUnion("PrivateProblem", ["missing"])'],
    [
      "endpointProblemResponses(PrivateProblem)",
      'mysteryAnnotations("PrivateProblem", ["missing"])',
    ],
    ["endpointProblemResponses(PrivateProblem)", 'problemUnion("PrivateProblem", [Body])'],
    ["endpointProblemResponses(PrivateProblem)", "ProfileReadOwnProfileProblem"],
  ])("keeps non-contract local forms unsupported: %s / %s", (use, init) => {
    const result = lift(model(privateSource(use, init)), input(), liftRegistryOf([]));

    assert.deepStrictEqual(result.collected.declarations, []);
    assert.strictEqual(result.unsupported.length, 1);
    assert.deepStrictEqual(result.refactors, []);
  });

  it("rejects a use fact whose local declaration identity does not join its source identifier", () => {
    const original = model(privateSource());

    const result = lift(
      {
        ...original,
        localCalls: original.localCalls.map((call) => ({
          ...call,
          argument: { ...call.argument, name: "AnotherPrivateProblem" },
        })),
      },
      input(),
      liftRegistryOf([]),
    );

    assert.deepStrictEqual(result.collected.declarations, []);
    assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3001");
  });
});

describe("schema-valued source identity and annotations", () => {
  it("reads an exported problem union through its truthful SchemaRef", () => {
    const file = source([
      'export const Read = HttpApiEndpoint.get("read", "/read", { success: UserProfileResponse, error: endpointProblemResponses(ProfileReadOwnProfileProblem) });',
    ]);

    const original = model(file);

    const union = {
      module: "./src/endpoint-problems",
      export: "ProfileReadOwnProfileProblem",
      symbolId: StableId.make("schema", "src/endpoint-problems/ProfileReadOwnProfileProblem"),
    };

    const response = input().rules.find((rule) => rule._tag === "ProblemRegistry");

    assert.isDefined(response);

    if (response?._tag !== "ProblemRegistry")
      return assert.fail("the registered response rule is required");

    const result = lift(
      {
        ...original,
        endpoints: original.endpoints.map((endpoint) => ({
          ...endpoint,
          options:
            endpoint.options._tag === "Entries"
              ? {
                  ...endpoint.options,
                  entries: endpoint.options.entries.map((entry) =>
                    entry._tag === "Property" &&
                    entry.name === "error" &&
                    entry.value._tag === "Lowered"
                      ? {
                          ...entry,
                          value: {
                            ...entry.value,
                            term: Terms.call(Terms.ref(response.response), [Terms.ref(union)]),
                          },
                        }
                      : entry,
                  ),
                }
              : endpoint.options,
        })),
      },
      input(),
      liftRegistryOf([]),
    );

    assert.deepStrictEqual(result.unsupported, []);
    assert.deepStrictEqual(result.codeReferences[0]?.codes, [
      "request.malformed",
      "precondition.failed",
    ]);
  });

  it.each([
    "UserProfileResponse.annotate()",
    "UserProfileResponse.annotate({}, {})",
    "UserProfileResponse.unknown({})",
    "ProfileReadOwnProfileProblem.annotate({})",
  ])("does not broaden annotation extraction to unsupported shapes: %s", (success) => {
    const result = outcome([
      `export const Read = HttpApiEndpoint.get("read", "/read", { success: ${success}, error: Schema.Never });`,
    ]);

    assert.deepStrictEqual(result.collected.declarations, []);
    assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3001");
    assert.deepStrictEqual(result.refactors, []);
  });
});

describe("lift repair: planned schema identities", () => {
  const inlineParams = [
    'export const Read = HttpApiEndpoint.get("read", "/read/:id", { params: { id: Schema.String }, success: UserProfileResponse, error: Schema.Never });',
  ];

  const withIdentity = (idPath: string): EffectModel => {
    const base = model(source(inlineParams));

    return {
      ...base,
      files: base.files.map((file) =>
        file.module === "./src/repair" ? { ...file, idPath } : file,
      ),
    };
  };

  it("plans the real schema identity of an inline params export", () => {
    const result = lift(withIdentity("src/repair"), input(), liftRegistryOf([]));

    assert.deepStrictEqual(result.unsupported, []);

    const planned = result.refactors.flatMap((refactor) => refactor.planned);

    assert.deepStrictEqual(
      planned.map((entry) => entry.name),
      ["RepairReadParams"],
    );
    assert.deepStrictEqual(
      planned.map((entry) => ("symbolId" in entry.ref ? entry.ref.symbolId : undefined)),
      [StableId.make("schema", "src/repair/RepairReadParams")],
    );
  });

  it.each([
    ".effx/generated/repair-contract",
    "packages/@scope/repair",
    "src/with space/repair",
    "-leading/repair",
  ])("diagnoses an inline export in a file whose identity %s cannot be a StableId", (idPath) => {
    const result = lift(withIdentity(idPath), input(), liftRegistryOf([]));
    const [site] = result.unsupported;

    assert.strictEqual(result.unsupported.length, 1);
    assert.strictEqual(site?.primary.code, "EFFX3001");
    assert.include(site?.primary.message ?? "", "StableId");
    assert.deepStrictEqual(result.refactors, []);
    assert.deepStrictEqual(result.collected.declarations, []);
  });

  it.each(["Bad Name", "Ünï"])(
    "diagnoses a pinned export %s that cannot form a StableId",
    (name) => {
      const result = lift(
        withIdentity("src/repair"),
        {
          ...input(),
          names: {
            ...input().names,
            "repair.read#params": { module: "./src/repair", export: name },
          },
        },
        liftRegistryOf([]),
      );

      assert.strictEqual(result.unsupported.length, 1);
      assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3001");
      assert.deepStrictEqual(result.refactors, []);
    },
  );

  it("keeps the names a file already binds when a pin claims a name in it first", () => {
    const file = source([
      "export const RepairReadParams = Schema.Struct({ id: Schema.String });",
      'export const Other = HttpApiEndpoint.get("other", "/other", { query: { page: Schema.String }, success: UserProfileResponse, error: Schema.Never });',
      ...inlineParams,
    ]);

    const both = { ...file, contents: file.contents.replace(".add(Read)", ".add(Other, Read)") };

    const result = lift(
      model(both),
      {
        ...input(),
        names: { "repair.other#query": { module: "./src/repair", export: "OtherPage" } },
      },
      liftRegistryOf([]),
    );

    assert.deepStrictEqual(result.unsupported, []);
    assert.deepStrictEqual(
      result.refactors.flatMap((refactor) => refactor.planned.map((entry) => entry.name)),
      ["OtherPage", "RepairReadParams2"],
    );
  });
});
