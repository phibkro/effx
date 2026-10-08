import { assert, describe, it } from "@effect/vitest";
import { Effect, Option, Result } from "effect";
import { IRArbitrary, canonical } from "@effx/ir";
import { dense, lift, printSuggestion, type Collected } from "@effx/compiler";
import { expandGroupDefaults } from "../src/group-defaults.ts";
import { profileFullModel, profileInput } from "./lift-profile.ts";
import { compiled, roundtrip } from "./lift-pipeline.ts";
import { GroupSpec } from "./lift-universe.ts";

/*
 * The suggestion printer and the dense rewrite (spec 0019 §4.2, laws L4 and the printer half of L5): what
 * a person reads, and the proof that the dense form is the same program (`expandGroupDefaults(dense(c))`
 * rebuilds `c`, and both compile to one canonical IR).
 */

const lifted = lift(profileFullModel, profileInput);

const options = {
  module: profileInput.output.module,
  codeReferences: lifted.codeReferences,
};

const printed = (collected: Collected): string =>
  Result.getOrElse(printSuggestion(collected, options), (message) => `ERROR ${message}`);

const denseOf = (collected: Collected): Collected =>
  Option.getOrThrowWith(dense(collected), () => new Error("no dense form"));

const head = [
  "// Suggested by `effx lift`. Review the decisions before accepting it.",
  'import { ExternalNativeApi } from "./api.js";',
  'import { PersonSecurity, nativeOperationAnnotations } from "./common.js";',
  'import { ProfileReadOwnProfileCodes, nativeProblems } from "./endpoint-problems.js";',
  'import { ConditionalReadHeaders, ProfileReadResponseHeaders } from "./http-semantics.js";',
  'import { ProfileCurrentPerson, profileAccessAnnotations } from "./profile-effx-adapters.js";',
  'import { UserProfileResponse } from "./v2-schemas.js";',
  'import { Capability, Concealment, Http, Operation } from "@effx/runtime";',
  "",
];

describe("the verbose suggestion is what a person writes", () => {
  it("prints the group and the operation in builder form with every field explicit", () => {
    assert.strictEqual(
      printed(lifted.collected),
      [
        ...head,
        "export const ProfileGroup = Http.group({",
        "  root: ExternalNativeApi,",
        '  group: "profile",',
        '  title: "Profile",',
        '  description: "Authenticated self-service profile API.",',
        "});",
        "",
        "export const ReadOwnProfile = Operation.query({",
        '  name: "profile.readOwnProfile",',
        "  input: ConditionalReadHeaders,",
        "  success: UserProfileResponse,",
        "})",
        '  .http.get("/api/profile")',
        "  .http.contract({",
        '    root: "external-native-api",',
        '    group: "profile",',
        "    headers: ConditionalReadHeaders,",
        "    success: UserProfileResponse,",
        "    responseHeaders: ProfileReadResponseHeaders,",
        "    conditional: true,",
        "    middleware: [PersonSecurity],",
        "    metadata: {",
        "      annotator: nativeOperationAnnotations,",
        '      operationId: "profile.readOwnProfile",',
        '      summary: "Read own profile",',
        '      description: "Returns the profile selected by the current session.",',
        "    },",
        "  })",
        "  .http.problems({",
        "    registry: nativeProblems,",
        "    codes: ProfileReadOwnProfileCodes,",
        '    identifier: "ProfileReadOwnProfileProblem",',
        "  })",
        "  .http.access({",
        "    annotator: profileAccessAnnotations,",
        '    exposure: "External",',
        '    acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],',
        '    principalKinds: ["Person"],',
        '    capabilities: Capability.one("profile.read-self"),',
        '    requirements: [{ id: "profile.owner" }],',
        "    canonicalScopeResolver: ProfileCurrentPerson,",
        "    concealment: Concealment.reveal,",
        '    decisionTime: "SnapshotRead",',
        "  })",
        "  .declare();",
        "",
      ].join("\n"),
    );
  });

  it("copies the codes when no exported tuple is known for them", () => {
    const text = Result.getOrElse(
      printSuggestion(lifted.collected, { module: profileInput.output.module }),
      (message) => message,
    );

    assert.include(text, 'codes: ["request.malformed", "precondition.failed", "internal.error"],');
    assert.notInclude(text, "ProfileReadOwnProfileCodes");
  });

  it("is deterministic", () => {
    assert.strictEqual(printed(lifted.collected), printed(lifted.collected));
  });
});

describe("imports are written from the suggestion's own module", () => {
  const elsewhere = (module: string): string =>
    Result.getOrElse(
      printSuggestion(lifted.collected, { module, codeReferences: lifted.codeReferences }),
      (message) => message,
    );

  it("climbs out of a nested suggestion directory", () => {
    assert.include(elsewhere("./generated/lift/profile.effx"), 'from "../../src/api.js";');
  });

  it("uses a `.ts` suffix when the project imports with extensions", () => {
    const collected: Collected = {
      ...lifted.collected,
      project: {
        target: "effect-4.0-rc",
        emit: "contract",
        allowImportingTsExtensions: true,
        canonicalImportBase: "/app/src",
        outputDir: "/app/.effx/generated",
      },
    };

    const text = Result.getOrElse(
      printSuggestion(collected, { module: profileInput.output.module }),
      (message) => message,
    );

    assert.include(text, 'from "./api.ts";');
  });

  it("does not import what the suggestion itself declares", () => {
    const text = printed(denseOf(lifted.collected));

    assert.notInclude(text, 'from "./profile.effx');
    assert.include(text, ".in(ProfileGroup)");
  });
});

describe("what has no source form is an error, never a placeholder", () => {
  it("names an annotation the builder cannot spell", () => {
    const [group, operation] = lifted.collected.declarations;

    if (group === undefined || operation === undefined) return assert.fail("a lifted operation");

    const result = printSuggestion(
      {
        ...lifted.collected,
        declarations: [
          group,
          { ...operation, annotations: [...operation.annotations, { name: "Rpc", args: ["x"] }] },
        ],
      },
      options,
    );

    assert.isTrue(Result.isFailure(result));
    assert.include(
      Result.isFailure(result) ? result.failure : "",
      "annotation Rpc has no builder form",
    );
  });

  it("names a module key that cannot be written from the suggestion's directory", () => {
    const result = printSuggestion(lifted.collected, { module: "../../out/profile.effx" });

    assert.isTrue(Result.isFailure(result));
  });
});

describe("the dense form is the same program (L4)", () => {
  const compact = denseOf(lifted.collected);

  it("hoists what the group's operations share into the group's defaults", () => {
    const [group] = compact.declarations;
    const args = group?.annotations[0]?.args[0];

    assert.deepStrictEqual(args, {
      root: {
        _tag: "Symbol",
        ref: { module: "./src/api", export: "ExternalNativeApi" },
        identifier: "external-native-api",
      },
      group: "profile",
      title: "Profile",
      description: "Authenticated self-service profile API.",
      defaults: {
        middleware: [
          {
            _tag: "Symbol",
            ref: { module: "./src/common", export: "PersonSecurity" },
            security: true,
          },
        ],
        metadata: {
          annotator: {
            _tag: "Symbol",
            ref: { module: "./src/common", export: "nativeOperationAnnotations" },
          },
        },
        problems: {
          registry: {
            _tag: "Symbol",
            ref: { module: "./src/endpoint-problems", export: "nativeProblems" },
          },
        },
        access: {
          annotator: {
            _tag: "Symbol",
            ref: { module: "./src/profile-effx-adapters", export: "profileAccessAnnotations" },
          },
          exposure: "External",
          acceptedCredentials: ["BetterAuthCookie", "OAuthUserBearer"],
          principalKinds: ["Person"],
          concealment: { _tag: "Reveal" },
        },
      },
    });
  });

  it("associates the operation with `.in(Group)` and omits everything the pre-pass derives", () => {
    const operation = compact.declarations[1];
    const names = operation?.annotations.map((annotation) => annotation.name);

    assert.deepStrictEqual(names, [
      "Query",
      "Http.In",
      "Http.Get",
      "Http.Contract",
      "Http.Problems",
      "Http.Access",
    ]);

    const contract = operation?.annotations.find(
      (annotation) => annotation.name === "Http.Contract",
    );

    const access = operation?.annotations.find((annotation) => annotation.name === "Http.Access");

    assert.deepStrictEqual(Object.keys(contract?.args[0] ?? {}), [
      "headers",
      "responseHeaders",
      "conditional",
      "metadata",
    ]);

    assert.deepStrictEqual(Object.keys(access?.args[0] ?? {}), [
      "capabilities",
      "requirements",
      "canonicalScopeResolver",
    ]);
  });

  it("prints the dense text a person writes with `.in`", () => {
    const text = printed(compact);

    assert.include(text, "  .in(ProfileGroup)\n");
    assert.include(text, "  defaults: {\n    middleware: [PersonSecurity],");
    assert.notInclude(text, 'root: "external-native-api"');
    assert.notInclude(text, "decisionTime");
  });

  it("is rebuilt exactly by the group-defaults pre-pass", () => {
    const rebuilt = expandGroupDefaults(compact);

    assert.deepStrictEqual(rebuilt.diagnostics, []);
    assert.strictEqual(
      rebuilt.declarations[1]?.annotations.find((annotation) => annotation.name === "Http.In"),
      undefined,
    );
  });

  it("is not offered without a group declaration", () => {
    assert.isTrue(Option.isNone(dense({ declarations: [], diagnostics: [] })));
  });

  it.effect("compiles to the canonical IR of the verbose form, for every lifted group", () =>
    Effect.gen(function* () {
      const canonicalOf = Effect.fnUntraced(function* (collected: Collected) {
        const result = yield* compiled(collected);

        return Option.map(result.ir.value, canonical);
      });

      const failure = yield* IRArbitrary.falsification(
        IRArbitrary.arbitraryOf(GroupSpec),
        (spec) =>
          Effect.gen(function* () {
            const { lifted } = yield* roundtrip(spec);
            const compact = dense(lifted.collected);

            if (Option.isNone(compact)) return false;

            const verbose = yield* canonicalOf(lifted.collected);
            const rebuilt = expandGroupDefaults(compact.value);

            return (
              rebuilt.diagnostics.length === 0 &&
              Option.isSome(verbose) &&
              Option.getOrUndefined(verbose) ===
                Option.getOrUndefined(yield* canonicalOf(compact.value))
            );
          }),
        { runs: 150, seed: 24 },
      );

      assert.isUndefined(failure, failure);
    }),
  );
});
