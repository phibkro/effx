import { assert, describe, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import { StableId } from "@effx/ir";
import { Extensions, compileCollected } from "@effx/compiler";
import type { Collected, Declaration } from "../src/Collected.ts";
import { identifier } from "../src/generate/emit.ts";
import {
  groupApiHandlersName,
  groupApiName,
  groupClassName,
  guardTypeName,
  handlerName,
  rootClassName,
} from "../src/generate/http-contracts.ts";

const root = {
  _tag: "Symbol" as const,
  ref: { module: "./root", export: "ExternalNativeApi" },
  identifier: "external-native-api",
};

const schema = {
  _tag: "Schema" as const,
  ref: {
    module: "./schemas",
    export: "ResultSchema",
    symbolId: StableId.make("schema", "ResultSchema"),
  },
};

const fixtureName = (name: string): string =>
  name.replaceAll("-", "Dash").replaceAll("_", "Underscore").replaceAll(".", "Dot");

const groupDeclaration = (group: string, rootName = "external-native-api"): Declaration => ({
  id: `group:${rootName}/${group}`,
  kind: "builder",
  module: "./groups",
  export: `Group${fixtureName(rootName)}${fixtureName(group)}`,
  annotations: [{ name: "Http.Group", args: [{ root: { ...root, identifier: rootName }, group }] }],
});

const operationDeclaration = (group: string, rootName = "external-native-api"): Declaration => ({
  id: `operation:${rootName}/${group}`,
  kind: "builder",
  module: "./operations",
  export: `Read${fixtureName(rootName)}${fixtureName(group)}`,
  binding: "external",
  annotations: [
    { name: "Query", args: [{ name: `${group}.list`, input: schema, success: schema }] },
    { name: "Http.Get", args: [`/api/${group}`] },
    {
      name: "Http.Contract",
      args: [
        { root: rootName, group, success: schema, metadata: { operationId: `${group}.list` } },
      ],
    },
  ],
});

const source = (
  declarations: ReadonlyArray<Declaration>,
  emit: "all" | "contract" | "handlers" = "all",
): Collected => ({
  declarations,
  diagnostics: [],
  httpApiGroups: [
    ...new Set(
      declarations.flatMap((declaration) =>
        declaration.id.startsWith("group:")
          ? [declaration.id.slice(declaration.id.lastIndexOf("/") + 1)]
          : [],
      ),
    ),
  ].map((group) => ({ root: root.ref, group, endpoints: ["list"] })),
  project: {
    target: "effect-4.0",
    emit,
    allowImportingTsExtensions: false,
    canonicalImportBase: ".",
    outputDir: ".effx/generated",
  },
});

const errors = (
  diagnostics: ReadonlyArray<{
    readonly severity: string;
    readonly code: string;
    readonly message: string;
  }>,
) => diagnostics.filter((diagnostic) => diagnostic.severity === "error");

describe("HTTP group export names", () => {
  it.effect(
    "exports punctuation-aware SocialEvents names without changing its wire group or filename",
    () =>
      Effect.gen(function* () {
        const result = yield* compileCollected(
          source([groupDeclaration("social-events"), operationDeclaration("social-events")]),
          Extensions.builtin,
        );

        assert.deepStrictEqual(errors(result.diagnostics), []);
        const files = Option.getOrThrow(result.files.value);
        assert.deepStrictEqual(
          files.map((file) => file.path),
          ["social-events-contract.ts", "social-events-handlers.ts"],
        );
        assert.include(
          files[0]!.contents,
          'export const SocialEventsApi = HttpApiGroup.make("social-events").add(',
        );
        assert.include(files[1]!.contents, "export type SocialEventsRawHandlers<");
        assert.include(files[1]!.contents, "export const SocialEventsApiHandlers = <");
        assert.include(files[1]!.contents, 'HttpApiBuilder.group(__effxRootApi, "social-events"');
        assert.notInclude(files[0]!.contents, "SocialeventsApi");
        assert.notInclude(files[1]!.contents, "SocialeventsApiHandlers");
      }),
  );

  it.effect.each(["social_events", "social.events"])(
    "preserves the raw %s group filename while exporting SocialEvents",
    (group) =>
      Effect.gen(function* () {
        const result = yield* compileCollected(
          source([groupDeclaration(group), operationDeclaration(group)]),
          Extensions.builtin,
        );

        assert.deepStrictEqual(errors(result.diagnostics), []);
        const files = Option.getOrThrow(result.files.value);
        assert.deepStrictEqual(
          files.map((file) => file.path),
          [`${group}-contract.ts`, `${group}-handlers.ts`],
        );
        assert.include(files[0]!.contents, `HttpApiGroup.make("${group}")`);
        assert.include(files[0]!.contents, "export const SocialEventsApi =");
        assert.include(files[1]!.contents, "export const SocialEventsApiHandlers = <");
      }),
  );

  it.effect(
    "keeps Profile/Directory naming and the external-native-api root spelling unchanged",
    () =>
      Effect.gen(function* () {
        // No word boundary in these groups: every group-derived name is the former classPart output.
        for (const group of ["profile", "directory"]) {
          const previousPart = identifier(group).replace(/^./u, (letter) => letter.toUpperCase());
          assert.strictEqual(groupApiName(group), `${previousPart}Api`);
          assert.strictEqual(groupApiHandlersName(group), `${previousPart}ApiHandlers`);
          assert.strictEqual(
            groupClassName("external-native-api", group),
            `Externalnativeapi${previousPart}Group`,
          );
          assert.strictEqual(
            handlerName("external-native-api", group),
            `Externalnativeapi${previousPart}Handlers`,
          );
          assert.strictEqual(
            guardTypeName("external-native-api", group),
            `Externalnativeapi${previousPart}Guards`,
          );
        }

        assert.strictEqual(rootClassName("external-native-api"), "ExternalnativeapiApi");

        const result = yield* compileCollected(
          source([
            groupDeclaration("profile"),
            operationDeclaration("profile"),
            groupDeclaration("directory"),
            operationDeclaration("directory"),
          ]),
          Extensions.builtin,
        );

        assert.deepStrictEqual(errors(result.diagnostics), []);
        const files = Option.getOrThrow(result.files.value);
        assert.deepStrictEqual(
          files.map((file) => file.path),
          [
            "directory-contract.ts",
            "directory-handlers.ts",
            "profile-contract.ts",
            "profile-handlers.ts",
          ],
        );
        assert.include(
          files[0]!.contents,
          'export const DirectoryApi = HttpApiGroup.make("directory").add(',
        );
        assert.include(files[1]!.contents, "export const DirectoryApiHandlers = <");
        assert.include(
          files[2]!.contents,
          'export const ProfileApi = HttpApiGroup.make("profile").add(',
        );
        assert.include(files[3]!.contents, "export const ProfileApiHandlers = <");
      }),
  );

  it.effect("normalizes hyphen, underscore and dot only in group export parts", () =>
    Effect.sync(() => {
      for (const group of ["social-events", "social_events", "social.events"]) {
        assert.strictEqual(groupApiName(group), "SocialEventsApi");
        assert.strictEqual(groupApiHandlersName(group), "SocialEventsApiHandlers");
        assert.strictEqual(
          groupClassName("external-native-api", group),
          "ExternalnativeapiSocialEventsGroup",
        );
        assert.strictEqual(
          handlerName("external-native-api", group),
          "ExternalnativeapiSocialEventsHandlers",
        );
        assert.strictEqual(
          guardTypeName("external-native-api", group),
          "ExternalnativeapiSocialEventsGuards",
        );
      }

      assert.strictEqual(identifier("social-events"), "socialevents");
    }),
  );

  it.effect("reports both raw identities for colliding source groups and emits no files", () =>
    Effect.gen(function* () {
      for (const mode of ["all", "contract", "handlers"] as const) {
        const result = yield* compileCollected(
          source(
            [
              groupDeclaration("social-events"),
              operationDeclaration("social-events"),
              groupDeclaration("social_events"),
              operationDeclaration("social_events"),
            ],
            mode,
          ),
          Extensions.builtin,
        );

        const findings = errors(result.diagnostics).filter(
          (diagnostic) => diagnostic.code === "EFFX2406",
        );

        assert.strictEqual(findings.length, 1);
        assert.include(findings[0]!.message, "external-native-api/social-events");
        assert.include(findings[0]!.message, "external-native-api/social_events");
        assert.isTrue(Option.isNone(result.files.value));
      }
    }),
  );

  it.effect("checks idle declarations and inferred contract groups within a root", () =>
    Effect.gen(function* () {
      const idle = yield* compileCollected(
        source([groupDeclaration("social-events"), groupDeclaration("social.events")]),
        Extensions.builtin,
      );

      assert.include(
        errors(idle.diagnostics).map((diagnostic) => diagnostic.code),
        "EFFX2406",
      );
      assert.isTrue(Option.isNone(idle.files.value));

      const inferred = yield* compileCollected(
        source([groupDeclaration("social-events"), operationDeclaration("social_events")]),
        Extensions.builtin,
      );

      assert.include(
        errors(inferred.diagnostics).map((diagnostic) => diagnostic.code),
        "EFFX2406",
      );
      assert.isTrue(Option.isNone(inferred.files.value));
    }),
  );

  it.effect("allows the same raw or normalized group export name under separate roots", () =>
    Effect.gen(function* () {
      for (const declarations of [
        [groupDeclaration("profile"), groupDeclaration("profile", "other")],
        [
          groupDeclaration("social-events"),
          groupDeclaration("social_events", "other"),
          operationDeclaration("social_events", "other"),
        ],
      ]) {
        const result = yield* compileCollected(source(declarations), Extensions.builtin);

        assert.deepStrictEqual(errors(result.diagnostics), []);
        assert.isTrue(Option.isSome(result.files.value));
      }
    }),
  );
});
