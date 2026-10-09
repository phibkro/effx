import { assert, describe, it } from "@effect/vitest";
import {
  Terms,
  lift,
  liftRegistryOf,
  type BindingRecord,
  type HandlerRegistration,
  type LiftInput,
} from "@effx/compiler";
import { lowered, range } from "./lift-support.ts";
import { sourceInput, sourceUniverse, supportFiles } from "./lift-fixtures.ts";
import { modelOf, type SourceFile } from "./lift-source.ts";

/*
 * Group-level and channel-level outcomes of the pure core (spec 0019 §3.4, §4.1, §7), over small real sources:
 * what blocks a whole group, what an endpoint with no request channel needs, and the static binding report.
 */

const imports = [
  'import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api";',
  'import { Schema } from "effect";',
  'import { UserProfileResponse } from "./v2-schemas.js";',
];

const sourceOf = (group: string, lines: ReadonlyArray<string>): SourceFile => ({
  path: `src/${group}.ts`,
  contents: `${[...imports, "", ...lines].join("\n")}\n`,
});

const liftOf = (group: string, lines: ReadonlyArray<string>, input?: LiftInput) =>
  lift(
    modelOf([...supportFiles, sourceOf(group, lines)], {
      ...sourceUniverse,
      root: { symbol: { module: `./src/${group}`, export: "Root" }, id: `${group}-root` },
    }),
    input ?? sourceInput(group),
    liftRegistryOf([]),
  );

const read = (key: string, path = "/g/read") => [
  `export const Read = HttpApiEndpoint.get("${key}", "${path}", {`,
  "  success: UserProfileResponse,",
  "  error: Schema.Never,",
  "});",
];

describe("a group the core cannot represent is blocked as a whole", () => {
  it("diagnoses a group prefix once and suggests nothing for any endpoint", () => {
    const result = liftOf("blocked", [
      ...read("read"),
      "",
      'export const Api = HttpApiGroup.make("blocked").add(Read).prefix("/v1");',
      'export const Root = HttpApi.make("blocked-root").add(Api);',
    ]);

    assert.deepStrictEqual(result.collected.declarations, []);
    assert.strictEqual(result.unsupported.length, 1);
    assert.strictEqual(result.unsupported[0]?.subject, "blocked");
    assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3001");
    assert.include(result.unsupported[0]?.primary.message ?? "", ".prefix(...) on a group");
  });

  it("diagnoses a group option and an unknown OpenApi annotation together", () => {
    const result = liftOf("options", [
      ...read("read"),
      "",
      'export const Api = HttpApiGroup.make("options", { topLevel: true })',
      "  .add(Read)",
      '  .annotateMerge(OpenApi.annotations({ title: "t", override: { "x-other": "y" } }));',
      'export const Root = HttpApi.make("options-root").add(Api);',
    ]);

    const [site] = result.unsupported;

    assert.strictEqual(site?.primary.code, "EFFX3001");
    assert.deepStrictEqual(
      (site?.primary.related ?? []).map((related) => related.code),
      ["EFFX3001"],
    );
    assert.include(site?.primary.message ?? "", "topLevel");
  });

  it("preserves a literal x-displayName override", () => {
    const result = liftOf("display", [
      ...read("read"),
      'export const Api = HttpApiGroup.make("display").add(Read)',
      '  .annotateMerge(OpenApi.annotations({ override: { "x-displayName": "Display name" } }));',
      'export const Root = HttpApi.make("display-root").add(Api);',
    ]);

    const group = result.collected.declarations[0]?.annotations.find(
      (annotation) => annotation.name === "Http.Group",
    );

    assert.deepStrictEqual(result.unsupported, []);
    assert.isDefined(group);
    assert.deepStrictEqual(group?.args[0], {
      root: {
        _tag: "Symbol",
        ref: { module: "./src/display", export: "Root" },
        identifier: "display-root",
      },
      group: "display",
      displayName: "Display name",
    });
  });

  it.each(["false", "null", "0", "{}", "[]"])(
    "rejects non-string x-displayName overrides: %s",
    (value) => {
      const result = liftOf("bad-display", [
        ...read("read"),
        'export const Api = HttpApiGroup.make("bad-display").add(Read)',
        `  .annotateMerge(OpenApi.annotations({ override: { "x-displayName": ${value} } }));`,
        'export const Root = HttpApi.make("bad-display-root").add(Api);',
      ]);

      assert.deepStrictEqual(result.collected.declarations, []);
      assert.strictEqual(result.unsupported.length, 1);
      assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3001");
    },
  );

  it("preserves outer root composition without treating it as group behavior", () => {
    const result = liftOf("rooted", [
      ...read("read"),
      "",
      'export const Api = HttpApiGroup.make("rooted").add(Read);',
      'export const Root = HttpApi.make("rooted-root").add(Api)',
      '  .middleware(Api).prefix("/outer").addError(UserProfileResponse)',
      '  .annotateMerge(OpenApi.annotations({ version: "outer-version" }));',
    ]);

    assert.deepStrictEqual(result.unsupported, []);
    assert.strictEqual(result.collected.declarations.length, 2);
  });

  it("retains outer source steps and the actual original root", () => {
    const file = sourceOf("outer", [
      ...read("read"),
      'export const Api = HttpApiGroup.make("outer").add(Read);',
      'export const Root = HttpApi.make("outer-root").add(Api)',
      "  .middleware(Api).annotateMerge(OpenApi.annotations({ version: privateVersion }));",
    ]);

    const model = modelOf([...supportFiles, file], {
      ...sourceUniverse,
      root: { symbol: { module: "./src/outer", export: "Root" }, id: "outer-root" },
    });

    const result = lift(model, sourceInput("outer"), liftRegistryOf([]));
    const [root] = model.roots;

    assert.deepStrictEqual(result.unsupported, []);
    assert.deepStrictEqual(
      root?.steps.map((step) => (step._tag === "Method" ? step.name : step._tag)),
      ["add", "middleware", "annotateMerge"],
    );
    assert.strictEqual(
      root?.steps[2]?._tag === "Method" ? root.steps[2].args[0]?._tag : "",
      "Unlowered",
    );
    assert.deepStrictEqual(root?.symbol, { module: "./src/outer", export: "Root" });
  });
});

describe("an endpoint with no request channel needs a configured empty input", () => {
  const lines = [
    ...read("read"),
    "",
    'export const Api = HttpApiGroup.make("channels").add(Read);',
    'export const Root = HttpApi.make("channels-root").add(Api);',
  ];

  it("reports EFFX3009 when none is configured", () => {
    const { emptyInput: _omitted, ...withoutEmpty } = sourceInput("channels");
    const result = liftOf("channels", lines, withoutEmpty);

    assert.deepStrictEqual(result.collected.declarations, []);
    assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3009");
  });

  it("uses the configured export as the input and lists it as a decision to review", () => {
    const result = liftOf("channels", lines);
    const input = result.decisions.find((decision) => decision._tag === "OperationInput");

    assert.strictEqual(input?._tag === "OperationInput" ? input.channel : "", "emptyInput");
    assert.strictEqual(input?._tag === "OperationInput" ? input.schema.export : "", "EmptyInput");
    assert.deepStrictEqual(result.unsupported, []);
  });

  it("reports a POST without a channel, which effx would give a payload it never had", () => {
    const result = liftOf("channels", [
      'export const Read = HttpApiEndpoint.post("read", "/g/read", { success: UserProfileResponse, error: Schema.Never });',
      "",
      'export const Api = HttpApiGroup.make("channels").add(Read);',
      'export const Root = HttpApi.make("channels-root").add(Api);',
    ]);

    assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3001");
    assert.include(
      result.unsupported[0]?.primary.message ?? "",
      "a POST endpoint without a request channel",
    );
  });
});

describe("what an endpoint says about itself must match what effx derives", () => {
  it("rejects two endpoints that share a key, both of them", () => {
    const result = liftOf("keys", [
      'export const First = HttpApiEndpoint.get("same", "/k/1", { success: UserProfileResponse, error: Schema.Never });',
      'export const Second = HttpApiEndpoint.get("same", "/k/2", { success: UserProfileResponse, error: Schema.Never });',
      "",
      'export const Api = HttpApiGroup.make("keys").add(First, Second);',
      'export const Root = HttpApi.make("keys-root").add(Api);',
    ]);

    assert.deepStrictEqual(result.collected.declarations, []);
    assert.deepStrictEqual(
      result.unsupported.map((site) => site.primary.code),
      ["EFFX3001", "EFFX3001"],
    );
  });

  it("rejects a key that is not an identifier, because an operation id is `<group>.<key>`", () => {
    const result = liftOf("names", [
      'export const Odd = HttpApiEndpoint.get("not-an-identifier", "/n", { success: UserProfileResponse, error: Schema.Never });',
      "",
      'export const Api = HttpApiGroup.make("names").add(Odd);',
      'export const Root = HttpApi.make("names-root").add(Api);',
    ]);

    assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3001");
    assert.include(result.unsupported[0]?.primary.message ?? "", "is not an identifier");
  });

  it("rejects an OpenAPI identifier that is not the operation id effx derives", () => {
    const result = liftOf("ids", [
      'export const Read = HttpApiEndpoint.get("read", "/i", { success: UserProfileResponse, error: Schema.Never })',
      '  .annotateMerge(OpenApi.annotations({ identifier: "custom.read" }));',
      "",
      'export const Api = HttpApiGroup.make("ids").add(Read);',
      'export const Root = HttpApi.make("ids-root").add(Api);',
    ]);

    assert.strictEqual(result.unsupported[0]?.primary.code, "EFFX3001");
    assert.include(result.unsupported[0]?.primary.message ?? "", 'identifier "custom.read"');
  });

  it("accepts an OpenAPI identifier that equals it and omits the operation's own defaults", () => {
    const result = liftOf("same", [
      'export const Read = HttpApiEndpoint.get("read", "/i", { success: UserProfileResponse, error: Schema.Never })',
      '  .annotateMerge(OpenApi.annotations({ identifier: "same.read", summary: "Read" }));',
      "",
      'export const Api = HttpApiGroup.make("same").add(Read);',
      'export const Root = HttpApi.make("same-root").add(Api);',
    ]);

    assert.deepStrictEqual(result.unsupported, []);
    assert.strictEqual(result.collected.declarations.length, 2);
  });
});

describe("the binding report is a static key comparison and is never verified", () => {
  const model = modelOf(
    [
      ...supportFiles,
      sourceOf("bound", [
        'export const Read = HttpApiEndpoint.get("read", "/b/r", { success: UserProfileResponse, error: Schema.Never });',
        'export const Write = HttpApiEndpoint.get("write", "/b/w", { success: UserProfileResponse, error: Schema.Never });',
        "",
        'export const Api = HttpApiGroup.make("bound").add(Read, Write);',
        'export const Root = HttpApi.make("bound-root").add(Api);',
      ]),
    ],
    {
      ...sourceUniverse,
      root: { symbol: { module: "./src/bound", export: "Root" }, id: "bound-root" },
    },
  );

  const rootSymbol = { module: "./src/bound", export: "Root" };

  const registered = (key: string, kind: "raw" | "normal" = "raw"): HandlerRegistration => ({
    _tag: "Registered",
    kind,
    key: lowered(Terms.lit(key), 10, 20),
    handler: { _tag: "Exported", ref: { module: "./src/handlers", export: key } },
    range: range(10, 40, "src/bind.ts"),
  });

  const binding = (
    registrations: ReadonlyArray<HandlerRegistration>,
    group = "bound",
  ): BindingRecord => ({
    range: range(0, 100, "src/bind.ts"),
    root: lowered(Terms.ref(rootSymbol), 1, 5),
    group: lowered(Terms.lit(group), 6, 9),
    registrations,
    authorizeCalls: [],
  });

  const bound = (...records: ReadonlyArray<BindingRecord>) =>
    lift({ ...model, bindings: records }, sourceInput("bound"), liftRegistryOf([]));

  it("is equal and silent when the keys are exactly the group's endpoint keys", () => {
    const result = bound(binding([registered("read"), registered("write")]));

    assert.deepStrictEqual(result.bindings[0]?.missing, []);
    assert.deepStrictEqual(result.bindings[0]?.extra, []);
    assert.deepStrictEqual(result.bindings[0]?.declared, ["read", "write"]);
    assert.strictEqual(result.bindings[0]?.verification, "UNVERIFIED");
    assert.deepStrictEqual(
      result.diagnostics.filter((diagnostic) => diagnostic.code.startsWith("EFFX32")),
      [],
    );
  });

  it("names the missing and the extra keys in EFFX3201 at the binding", () => {
    const result = bound(binding([registered("read"), registered("extra")]));
    const [mismatch] = result.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX3201");

    assert.deepStrictEqual(result.bindings[0]?.missing, ["write"]);
    assert.deepStrictEqual(result.bindings[0]?.extra, ["extra"]);
    assert.include(mismatch?.message ?? "", "missing: write");
    assert.include(mismatch?.message ?? "", "extra: extra");
    assert.deepStrictEqual(mismatch?.location, { file: "src/bind.ts", line: 1, col: 1 });
  });

  it("reports a `.handle` registration as a site that needs hand adaptation", () => {
    const result = bound(binding([registered("read", "normal"), registered("write")]));
    const sites = result.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX3202");

    assert.strictEqual(sites.length, 1);
    assert.include(sites[0]?.message ?? "", "bound.read: handle site");
  });

  it("lists each call of the authorization function the frontend located", () => {
    const result = lift(
      {
        ...model,
        bindings: [
          {
            ...binding([registered("read"), registered("write")]),
            authorizeCalls: [range(50, 60, "src/bind.ts"), range(70, 80, "src/bind.ts")],
          },
        ],
      },
      sourceInput("bound"),
      liftRegistryOf([]),
    );

    const sites = result.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX3202");

    assert.strictEqual(sites.length, 2);
    assert.isTrue(sites.every((site) => site.message.includes("authorize site")));
    assert.deepStrictEqual(
      sites.map((site) => site.location?.col),
      [51, 71],
    );
  });

  it("ignores a binding of another group and keeps the handlers the frontend resolved", () => {
    const result = bound(
      binding([registered("read"), registered("write")]),
      binding([registered("nothing")], "other"),
    );

    assert.strictEqual(result.bindings.length, 1);
    assert.deepStrictEqual(result.bindings[0]?.registrations[0]?.handler, {
      _tag: "Exported",
      ref: { module: "./src/handlers", export: "read" },
    });
  });
});
