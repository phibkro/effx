import { assert, describe, it } from "@effect/vitest";
import { BunCrypto } from "@effect/platform-bun";
import { Effect, Option } from "effect";
import { expectTypeOf } from "vitest";
import { StableId, canonical, semanticHash } from "@effx/ir";
import {
  Extensions,
  compileCollected,
  interpret,
  type CompileResult,
  type CompilerFault,
} from "@effx/compiler";
import type { AnnotationArg, Collected, Declaration } from "../src/Collected.ts";

const schema = (name: string): AnnotationArg => ({
  _tag: "Schema",
  ref: {
    module: "directory/schema",
    export: name,
    symbolId: StableId.make("schema", `directory/${name}`),
  },
});

const symbol = (name: string, security = false): AnnotationArg =>
  security
    ? { _tag: "Symbol", ref: { module: "directory/support", export: name }, security }
    : { _tag: "Symbol", ref: { module: "directory/support", export: name } };

const root = { _tag: "Symbol", ref: { module: "directory/api", export: "Api" }, identifier: "Api" };

const defaults = {
  middleware: [symbol("Security", true)],
  metadata: { annotator: symbol("Annotate") },
  problems: { registry: symbol("Problem") },
  access: {
    annotator: symbol("Access"),
    exposure: "External",
    acceptedCredentials: ["None"],
    principalKinds: ["Anonymous"],
    concealment: { _tag: "Reveal" },
  },
} satisfies Readonly<Record<string, AnnotationArg>>;

const group = (dense: boolean, kind: "builder" | "class" = "builder"): Declaration => ({
  id: "DirectoryGroup",
  kind,
  module: "directory/operations",
  export: "DirectoryGroup",
  annotations: [
    {
      name: "Http.Group",
      args: [
        dense
          ? { root, group: "directory", title: "Directory", defaults }
          : { root, group: "directory", title: "Directory" },
      ],
    },
  ],
});

const access = (override: boolean) => {
  const base = {
    capabilities: { _tag: "None" },
    requirements: [],
    canonicalScopeResolver: symbol("Resolve"),
    decisionTime: "Transaction",
  } satisfies AnnotationArg;

  return override
    ? ({
        ...base,
        annotator: symbol("SpecialAccess"),
        exposure: "External",
        acceptedCredentials: ["None"],
        principalKinds: ["Person"],
        concealment: { _tag: "NotFound", stages: ["Read"] },
      } satisfies AnnotationArg)
    : base;
};

const operation = (
  dense: boolean,
  key: string,
  method: "Get" | "Post" | "Patch",
  kind: "Query" | "Command",
  override = false,
  association: "in" | "class" = "in",
  withQuery = true,
  withHeaders = false,
): Declaration => {
  const name = `directory.${key}`;
  const input = schema(`${key}Input`);
  const success = schema(`${key}Response`);

  const verboseContract: Record<string, AnnotationArg> & {
    root: AnnotationArg;
    group: AnnotationArg;
    success: AnnotationArg;
    middleware: AnnotationArg;
    metadata: AnnotationArg;
  } = {
    root: "Api",
    group: "directory",
    success,
    middleware: override ? [] : [symbol("Security", true)],
    metadata: {
      operationId: name,
      annotator: override ? symbol("SpecialAnnotate") : symbol("Annotate"),
      summary: "A summary",
    },
  };

  // The dense twin writes `query: true` or leaves the query to the derivation (spec 0024 §2): both mean `input`.
  if (method === "Get") verboseContract.query = input;

  if (method !== "Get") verboseContract.payload = input;

  const denseContract: Record<string, AnnotationArg> = override
    ? {
        root: "Api",
        group: "directory",
        success,
        middleware: [],
        metadata: { operationId: name, annotator: symbol("SpecialAnnotate"), summary: "A summary" },
      }
    : { metadata: { summary: "A summary" } };

  if (method === "Get" && !override && withQuery) denseContract.query = true;

  if (method === "Get" && override) denseContract.query = input;

  if (method !== "Get" && override) denseContract.payload = input;

  if (withHeaders) {
    const headers = schema(`${key}Headers`);
    verboseContract.headers = headers;
    denseContract.headers = headers;

    if (dense && method === "Patch") delete denseContract.payload;
  }

  return {
    id: `DirectoryGroup.${key}`,
    kind: association === "class" ? "staticMethod" : "builder",
    module: "directory/operations",
    export: "DirectoryGroup",
    member: key,
    annotations: [
      { name: kind, args: [{ name, input, success }] },
      { name: `Http.${method}`, args: [`/directory/${key}`] },
      ...(dense && association === "in"
        ? [
            {
              name: "Http.In",
              args: [
                {
                  _tag: "Symbol",
                  ref: { module: "directory/operations", export: "DirectoryGroup" },
                },
              ],
            },
          ]
        : []),
      { name: "Http.Contract", args: [dense ? denseContract : verboseContract] },
      {
        name: "Http.Problems",
        args: [
          dense && !override
            ? { codes: ["Unexpected"] }
            : {
                registry: override ? symbol("SpecialProblem") : symbol("Problem"),
                codes: ["Unexpected"],
              },
        ],
      },
      {
        name: "Http.Access",
        args: [
          dense || override
            ? access(override)
            : {
                ...access(false),
                annotator: symbol("Access"),
                exposure: "External",
                acceptedCredentials: ["None"],
                principalKinds: ["Anonymous"],
                concealment: { _tag: "Reveal" },
              },
        ],
      },
    ],
    handlerSignature: {
      success: {
        _tag: "Schema",
        ref: {
          module: "directory/schema",
          export: `${key}Response`,
          symbolId: StableId.make("schema", `directory/${key}Response`),
        },
      },
      errors: [],
      requirements: [],
    },
  };
};

const source = (
  dense: boolean,
  association: "in" | "class" = "in",
  mixedHeaders = false,
): Collected => ({
  declarations: [
    group(dense, association === "class" ? "class" : "builder"),
    operation(dense, "lookup", "Get", "Query", false, association, true, mixedHeaders),
    operation(dense, "list", "Get", "Query", false, association, false),
    operation(dense, "create", "Post", "Command", false, association, true, mixedHeaders),
    operation(dense, "edit", "Patch", "Command", true, association, true, mixedHeaders),
    operation(dense, "direct", "Get", "Query", true, association),
  ],
  diagnostics: [],
});

const errors = (result: {
  readonly diagnostics: ReadonlyArray<{ readonly severity: string; readonly code: string }>;
}) => result.diagnostics.filter((d) => d.severity === "error").map((d) => d.code);

const identical = Effect.fnUntraced(function* (dense: Collected, verbose: Collected) {
  const aEffect = compileCollected(dense, Extensions.builtin);
  expectTypeOf<Effect.Success<typeof aEffect>>().toEqualTypeOf<CompileResult>();
  expectTypeOf<Effect.Error<typeof aEffect>>().toEqualTypeOf<CompilerFault>();
  expectTypeOf<Effect.Services<typeof aEffect>>().toEqualTypeOf<never>();
  const a = yield* aEffect;
  const b = yield* compileCollected(verbose, Extensions.builtin);
  assert.deepStrictEqual(errors(a), []);
  assert.deepStrictEqual(errors(b), []);
  const first = Option.getOrThrow(a.ir.value);
  const second = Option.getOrThrow(b.ir.value);
  assert.strictEqual(canonical(first), canonical(second));
  assert.strictEqual(yield* semanticHash(first), yield* semanticHash(second));
  assert.deepStrictEqual(Option.getOrThrow(a.files.value), Option.getOrThrow(b.files.value));
  assert.isTrue(first.nodes.some((node) => node._tag === "HttpGroup"));
  assert.isFalse(canonical(first).includes('"defaults"'));
});

describe("group defaults expansion", () => {
  it.effect(
    "builder and class source syntax lower to verbose canonical IR, hash and emitted files",
    () =>
      Effect.gen(function* () {
        yield* identical(source(true), source(false));
        yield* identical(source(true, "class"), source(false, "class"));
        const builder = yield* compileCollected(source(true), Extensions.builtin);
        const decorated = yield* compileCollected(source(true, "class"), Extensions.builtin);
        assert.strictEqual(
          canonical(Option.getOrThrow(builder.ir.value)),
          canonical(Option.getOrThrow(decorated.ir.value)),
        );
        assert.deepStrictEqual(
          Option.getOrThrow(builder.files.value),
          Option.getOrThrow(decorated.files.value),
        );

        const withoutProblems = (s: Collected): Collected => ({
          ...s,
          declarations: s.declarations.map((d) =>
            d.member === "list"
              ? {
                  ...d,
                  annotations: d.annotations.filter(
                    (a) => a.name !== "Http.Problems" && a.name !== "Http.Access",
                  ),
                }
              : d,
          ),
        });

        yield* identical(withoutProblems(source(true)), withoutProblems(source(false)));
      }).pipe(Effect.provide(BunCrypto.layer)),
  );

  it.effect("distinct headers coexist with GET query and POST/PATCH inferred payload", () =>
    Effect.gen(function* () {
      yield* identical(source(true, "in", true), source(false, "in", true));
      yield* identical(source(true, "class", true), source(false, "class", true));
    }).pipe(Effect.provide(BunCrypto.layer)),
  );

  it.effect("no association leaves the existing verbose meaning and output intact", () =>
    Effect.gen(function* () {
      const verbose = source(false);

      const withoutAssociation: Collected = {
        ...verbose,
        declarations: [verbose.declarations[1]!],
      };

      const result = yield* compileCollected(withoutAssociation, Extensions.builtin);
      assert.deepStrictEqual(errors(result), []);
      assert.isTrue(Option.isSome(result.files.value));
    }),
  );

  it.effect.each([
    [
      "associated operation without a contract",
      "EFFX2405",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: s.declarations[1]!.annotations.filter((a) => a.name !== "Http.Contract"),
          },
        ],
      }),
    ],
    [
      "tagged contract options",
      "EFFX1102",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: s.declarations[1]!.annotations.map((a) =>
              a.name === "Http.Contract" ? { ...a, args: [schema("lookupInput")] } : a,
            ),
          },
        ],
      }),
    ],
    [
      "malformed explicit metadata",
      "EFFX1102",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: s.declarations[1]!.annotations.map((a) =>
              a.name === "Http.Contract" ? { ...a, args: [{ metadata: "invalid" }] } : a,
            ),
          },
        ],
      }),
    ],
    [
      "unresolved symbol",
      "EFFX2404",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: s.declarations[1]!.annotations.map((a) =>
              a.name === "Http.In"
                ? { ...a, args: [{ _tag: "Symbol", ref: { module: "missing", export: "Group" } }] }
                : a,
            ),
          },
        ],
      }),
    ],
    [
      "repeated exported group",
      "EFFX2404",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          { ...s.declarations[0]!, id: "AnotherGroup" },
          s.declarations[1]!,
        ],
      }),
    ],
    [
      "duplicate .in",
      "EFFX2404",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: [
              ...s.declarations[1]!.annotations,
              s.declarations[1]!.annotations.find((a) => a.name === "Http.In")!,
            ],
          },
        ],
      }),
    ],
    [
      "class and .in",
      "EFFX2404",
      (s: Collected): Collected => {
        const cls = source(true, "class");

        return {
          ...cls,
          declarations: [
            cls.declarations[0]!,
            {
              ...cls.declarations[1]!,
              annotations: [
                ...cls.declarations[1]!.annotations,
                s.declarations[1]!.annotations.find((a) => a.name === "Http.In")!,
              ],
            },
          ],
        };
      },
    ],
    [
      "different root",
      "EFFX2405",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: s.declarations[1]!.annotations.map((a) =>
              a.name === "Http.Contract" ? { ...a, args: [{ root: "Wrong", query: true }] } : a,
            ),
          },
        ],
      }),
    ],
    [
      "different group",
      "EFFX2405",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: s.declarations[1]!.annotations.map((a) =>
              a.name === "Http.Contract" ? { ...a, args: [{ group: "wrong", query: true }] } : a,
            ),
          },
        ],
      }),
    ],
    [
      "GET mapped twice",
      "EFFX2405",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: s.declarations[1]!.annotations.map((a) =>
              a.name === "Http.Contract"
                ? { ...a, args: [{ query: true, headers: schema("lookupInput") }] }
                : a,
            ),
          },
        ],
      }),
    ],
    [
      "invalid GET marker on POST",
      "EFFX2405",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[3]!,
            annotations: s.declarations[3]!.annotations.map((a) =>
              a.name === "Http.Contract" ? { ...a, args: [{ query: true }] } : a,
            ),
          },
        ],
      }),
    ],
    [
      "malformed group reference",
      "EFFX2404",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: s.declarations[1]!.annotations.map((a) =>
              a.name === "Http.In" ? { ...a, args: ["not a symbol"] } : a,
            ),
          },
        ],
      }),
    ],
    [
      "non-group reference",
      "EFFX2404",
      (s: Collected): Collected => ({
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[1]!,
            annotations: s.declarations[1]!.annotations.map((a) =>
              a.name === "Http.In"
                ? {
                    ...a,
                    args: [
                      { _tag: "Symbol", ref: { module: "directory/operations", export: "Other" } },
                    ],
                  }
                : a,
            ),
          },
          { ...s.declarations[0]!, id: "Other", export: "Other", annotations: [] },
        ],
      }),
    ],
  ] as const)("%s diagnoses %s and suppresses output", ([, expected, change]) =>
    Effect.gen(function* () {
      const result = yield* compileCollected(change(source(true)), Extensions.builtin);
      assert.include(errors(result), expected);
      assert.isTrue(Option.isNone(result.files.value));
    }),
  );

  it.effect("unsupported verbs do not infer GET query mappings", () =>
    Effect.gen(function* () {
      const s = source(true);
      const declaration = s.declarations[1]!;

      const invalid: Collected = {
        diagnostics: [],
        declarations: [
          s.declarations[0]!,
          {
            ...declaration,
            annotations: declaration.annotations.map((a) =>
              a.name === "Http.Get" ? { name: "Http.Put", args: a.args } : a,
            ),
          },
        ],
      };

      const result = yield* compileCollected(invalid, Extensions.builtin);
      assert.include(errors(result), "EFFX2405");
      assert.isTrue(Option.isNone(result.files.value));
    }),
  );

  it.effect("malformed group defaults are diagnostics rather than interpreted or emitted", () =>
    Effect.gen(function* () {
      const s = source(true);

      const malformed: Collected = {
        ...s,
        declarations: [
          {
            ...s.declarations[0]!,
            annotations: [
              {
                name: "Http.Group",
                args: [{ root, group: "directory", defaults: { middleware: ["not a symbol"] } }],
              },
            ],
          },
          s.declarations[1]!,
        ],
      };

      const result = yield* compileCollected(malformed, Extensions.builtin);
      assert.include(errors(result), "EFFX1102");
      assert.isTrue(Option.isNone(result.files.value));
    }),
  );

  // T1 (spec 0020 §0.1): group defaults use the same strict access value sets as `Http.Access`.
  for (const [label, access] of [
    ["empty acceptedCredentials", { acceptedCredentials: [] }],
    ["duplicate acceptedCredentials", { acceptedCredentials: ["None", "None"] }],
    ["empty principalKinds", { principalKinds: [] }],
    ["unknown principal kind", { principalKinds: ["Robot"] }],
    ["duplicate principal kinds", { principalKinds: ["Person", "Person"] }],
    ["empty NotFound stages", { concealment: { _tag: "NotFound", stages: [] } }],
  ] as const) {
    it.effect(`group defaults reject ${label}`, () =>
      Effect.gen(function* () {
        const s = source(true);

        const strict: Collected = {
          ...s,
          declarations: [
            {
              ...s.declarations[0]!,
              annotations: [
                {
                  name: "Http.Group",
                  args: [
                    {
                      root,
                      group: "directory",
                      defaults: { access: { ...defaults.access, ...access } },
                    },
                  ],
                },
              ],
            },
            s.declarations[1]!,
          ],
        };

        const result = yield* compileCollected(strict, Extensions.builtin);
        assert.include(errors(result), "EFFX1102");
        assert.isTrue(Option.isNone(result.files.value));
      }),
    );
  }

  // Spec 0024 §2.1 extends the 0013 payload default to PUT; ADR 0010 keeps a Query over POST explicit.
  it.effect("PUT Commands derive their payload; POST Queries keep an explicit payload", () =>
    Effect.sync(() => {
      const s = source(true);

      const put: Declaration = {
        ...s.declarations[3]!,
        annotations: s.declarations[3]!.annotations.map((a) =>
          a.name === "Http.Post" ? { name: "Http.Put", args: a.args } : a,
        ),
      };

      const postQuery: Declaration = {
        ...s.declarations[3]!,
        annotations: s.declarations[3]!.annotations.map((a) =>
          a.name === "Command" ? { name: "Query", args: a.args } : a,
        ),
      };

      const irPut = Option.getOrThrow(
        interpret({ diagnostics: [], declarations: [s.declarations[0]!, put] }, Extensions.builtin)
          .value,
      );

      const irPost = Option.getOrThrow(
        interpret(
          { diagnostics: [], declarations: [s.declarations[0]!, postQuery] },
          Extensions.builtin,
        ).value,
      );

      assert.isTrue(canonical(irPut).includes('"payload":'));
      assert.isFalse(canonical(irPost).includes('"payload":'));
    }),
  );

  // Spec 0024 §2.1 step 0 replaces the 0013 EFFX2405 "Command input assigned elsewhere": an input that is
  // already an explicit channel derives nothing, so the explicit twin of a derived channel stays valid.
  it.effect("a Command input that is already its headers schema needs no payload", () =>
    Effect.gen(function* () {
      const s = source(true);

      const headersOnly: Collected = {
        ...s,
        declarations: [
          s.declarations[0]!,
          {
            ...s.declarations[3]!,
            annotations: s.declarations[3]!.annotations.map((a) =>
              a.name === "Http.Contract" ? { ...a, args: [{ headers: schema("createInput") }] } : a,
            ),
          },
        ],
      };

      const result = yield* compileCollected(headersOnly, Extensions.builtin);
      assert.deepStrictEqual(errors(result), []);
      assert.isFalse(canonical(Option.getOrThrow(result.ir.value)).includes('"payload":'));
    }),
  );
});
