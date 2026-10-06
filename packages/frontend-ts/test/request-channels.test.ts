import { copyUsersFixture } from "../../../tools/testing/projects.ts";
import { BunServices } from "@effect/platform-bun";
import { assert, describe, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import {
  AnnotationArg as AnnotationArgSchema,
  Extensions,
  SourceFrontend,
  compile,
  type AnnotationArg,
  type CompileResult,
} from "@effx/compiler";
import { TsSourceFrontend } from "@effx/frontend-ts";
import { canonical, semanticHash } from "@effx/ir";

/*
 * Spec 0024 §2 on the TypeScript frontend: `input` records its static field keys, `Http.headers(...)` is
 * detected by the shape of its type, and the dense (derived) and verbose (explicit) spellings of the same
 * declarations compile to the same IR, hash and generated files.
 */

const Frontend = TsSourceFrontend.layer.pipe(Layer.provide(BunServices.layer));

const Services = Layer.mergeAll(Frontend, BunServices.layer);

/** Writes only into this case's scoped users copy. */
const temp = Effect.fnUntraced(function* (fixtureRoot: string, name: string, contents: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(fixtureRoot, "src", name);

  yield* fs.writeFileString(file, contents);
  yield* Effect.addFinalizer(() => fs.remove(file).pipe(Effect.ignore));
});

/** The native root and authored declarations share one endpoint/channel table. */
const support = (): string => `
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Http } from "@effx/runtime";
export const Success = Schema.Struct({ ok: Schema.Boolean });
export const Search = Schema.Struct({ q: Schema.String, page: Schema.optionalKey(Schema.Number) });
export const ById = Schema.Struct({ id: Schema.String });
export const Note = Schema.Struct({ note: Schema.String });
export const Empty = Schema.Struct({});
export class ClassInput extends Schema.Class<ClassInput>("ClassInput")({ b: Schema.String, a: Schema.String }) {}
export const UnionInput = Schema.Union([Schema.String, Schema.Number]);
export const VoidInput = Schema.Void;
export const WideInput: Schema.Struct<Schema.Struct.Fields> = Schema.Struct({ a: Schema.String });
export const Token = Http.headers(
  Schema.Struct({ "x-token": Schema.String, "x-trace": Schema.optionalKey(Schema.String) }),
);
export const ByShape = Object.assign(Schema.Struct({ "x-shape": Schema.String }), {
  "~effx/Http/Headers": true as const,
});
export const Look = Schema.Struct({ "x-token": Schema.String });
export const Opaque = Http.headers(Schema.Union([Schema.String, Schema.Number]));
export const Api = HttpApi.make("derive").add(
  HttpApiGroup.make("derive").add(
${declared
  .map(
    (item) =>
      `    HttpApiEndpoint.${item.verb}("${item.name}", "${item.path}", { ${item.kept} ${item.derived} success: Success }),`,
  )
  .join("\n")}
  ),
);
`;

const lowering = `
import { Effect, Schema } from "effect";
import { Http, Operation, Query } from "@effx/runtime";
import { Api, ByShape, ClassInput, Look, Search, Success, Token, UnionInput, VoidInput, WideInput } from "./_derive-support.ts";

// A header schema declared next to the operations is a Schema value, not a builder chain to collect.
export const InlineToken = Http.headers(Schema.Struct({ "x-inline": Schema.String }));
const hidden = Http.headers(Schema.Struct({ "x-hidden": Schema.String }));
export const Group = Http.group({ root: Api, group: "derive" });
export const byInline = Operation.query({ name: "derive.inline", input: InlineToken, success: Success }).declare();
export const bySearch = Operation.query({ name: "derive.search", input: Search, success: Success }).declare();
export const byClass = Operation.query({ name: "derive.class", input: ClassInput, success: Success }).declare();
export const byUnion = Operation.query({ name: "derive.union", input: UnionInput, success: Success }).declare();
export const byVoid = Operation.query({ name: "derive.void", input: VoidInput, success: Success }).declare();
export const byWide = Operation.query({ name: "derive.wide", input: WideInput, success: Success }).declare();
export const byToken = Operation.query({ name: "derive.token", input: Token, success: Success }).declare();
export const byShape = Operation.query({ name: "derive.shape", input: ByShape, success: Success }).declare();
export const byLook = Operation.query({ name: "derive.look", input: Look, success: Success }).declare();
export class Decorated {
  @Query({ name: "derive.decorated", input: Token, success: Success })
  @Http.Get("/decorated")
  static run() { return Effect.succeed({ ok: true }); }
}
export const keep = hidden;
`;

/** Declarations as `Collected` carries them. */
type Declarations = ReadonlyArray<{
  readonly id: string;
  readonly annotations: ReadonlyArray<{
    readonly name: string;
    readonly args: ReadonlyArray<AnnotationArg>;
  }>;
}>;

const OperationOptions = Schema.Struct({ input: AnnotationArgSchema });

/** The lowered `input` argument of the declaration's `Query`/`Command` annotation. */
const inputOf = (declarations: Declarations, id: string): AnnotationArg | undefined =>
  Option.getOrUndefined(
    Option.map(
      Schema.decodeUnknownOption(OperationOptions)(
        declarations
          .find((declaration) => declaration.id === id)
          ?.annotations.find((annotation) => annotation.name === "Query")?.args[0],
      ),
      (options) => options.input,
    ),
  );

const keysAndMarker = Schema.TaggedStruct("Schema", {
  fields: Schema.optionalKey(Schema.Array(Schema.String)),
  marker: Schema.optionalKey(Schema.Literal("headers")),
});

/** The recorded keys and marker of a lowered Schema argument; its reference is dropped. */
const summary = (arg: AnnotationArg | undefined) =>
  Option.getOrThrow(Schema.decodeUnknownOption(keysAndMarker)(arg));

describe("Http.headers and input field keys on the frontend", () => {
  it.effect("records fields on input, and a marker by type shape", () =>
    Effect.gen(function* () {
      const fixtureRoot = yield* copyUsersFixture();
      const tsconfigPath = fixtureRoot + "/tsconfig.json";
      yield* temp(fixtureRoot, "_derive-support.ts", support());
      yield* temp(fixtureRoot, "_derive-lowering.ts", lowering);

      const collected = yield* SourceFrontend.use((frontend) =>
        frontend.analyze({ tsconfigPath, entry: ["src/_derive-lowering.ts"] }),
      );

      const declarations: Declarations = collected.declarations;

      assert.deepStrictEqual(
        collected.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
        [],
      );

      // Every key of a struct or class, sorted.
      assert.deepStrictEqual(summary(inputOf(declarations, "bySearch")), {
        _tag: "Schema",
        fields: ["page", "q"],
      });
      assert.deepStrictEqual(summary(inputOf(declarations, "byClass")), {
        _tag: "Schema",
        fields: ["a", "b"],
      });

      // A Schema that cannot know its keys still lowers, without `fields` (not rejected, not empty).
      for (const id of ["byUnion", "byVoid", "byWide"])
        assert.deepStrictEqual(summary(inputOf(declarations, id)), { _tag: "Schema" }, id);

      // The brand on the static type marks the schema and makes it record its required keys.
      assert.deepStrictEqual(summary(inputOf(declarations, "byToken")), {
        _tag: "Schema",
        fields: ["x-token"],
        marker: "headers",
      });

      // A header schema declared in the entry file itself: lowered like any other, collected as nothing.
      assert.deepStrictEqual(summary(inputOf(declarations, "byInline")), {
        _tag: "Schema",
        fields: ["x-inline"],
        marker: "headers",
      });
      assert.isUndefined(declarations.find((declaration) => declaration.id === "InlineToken"));
      assert.isUndefined(declarations.find((declaration) => declaration.id === "hidden"));

      // By shape, never by name: a hand-made brand marks, a header-looking key set does not.
      assert.deepStrictEqual(summary(inputOf(declarations, "byShape")), {
        _tag: "Schema",
        fields: ["x-shape"],
        marker: "headers",
      });
      assert.deepStrictEqual(summary(inputOf(declarations, "byLook")), {
        _tag: "Schema",
        fields: ["x-token"],
      });

      // The decorator spelling lowers the very same marked input as the builder.
      const decorated = declarations.find((declaration) => declaration.id === "Decorated.run");

      assert.isDefined(decorated);
      assert.deepStrictEqual(
        inputOf(decorated === undefined ? [] : [{ ...decorated, id: "byToken" }], "byToken"),
        inputOf(declarations, "byToken"),
      );
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );

  it.effect("a header-marked schema without static keys is rejected like a headers schema", () =>
    Effect.gen(function* () {
      const fixtureRoot = yield* copyUsersFixture();
      const tsconfigPath = fixtureRoot + "/tsconfig.json";
      yield* temp(fixtureRoot, "_derive-support.ts", support());
      yield* temp(
        fixtureRoot,
        "_derive-opaque.ts",
        `import { Operation } from "@effx/runtime";
      import { Opaque, Success } from "./_derive-support.ts";
      export const byOpaque = Operation.query({ name: "derive.opaque", input: Opaque, success: Success }).declare();
      `,
      );

      const collected = yield* SourceFrontend.use((frontend) =>
        frontend.analyze({ tsconfigPath, entry: ["src/_derive-opaque.ts"] }),
      );

      const found = collected.diagnostics.filter((diagnostic) => diagnostic.code === "EFFX1102");

      assert.strictEqual(found.length, 1);
    }).pipe(Effect.scoped, Effect.provide(Services)),
  );
});

type Spelling = "grouped" | "bare" | "verbose";

const preamble = `
import { Http, Operation } from "@effx/runtime";
import { Api, ById, Empty, Note, Search, Success, Token } from "./_derive-support.ts";
export const Group = Http.group({ root: Api, group: "derive" });
`;

interface Declared {
  readonly name: string;
  readonly kind: "query" | "command";
  readonly input: string;
  readonly verb: string;
  readonly path: string;
  /** What the dense spellings still write, and what the verbose one writes in addition. */
  readonly kept: string;
  readonly derived: string;
}

const declared: ReadonlyArray<Declared> = [
  {
    name: "readByHeader",
    kind: "query",
    input: "Token",
    verb: "get",
    path: "/header",
    kept: "",
    derived: "headers: Token,",
  },
  {
    name: "search",
    kind: "query",
    input: "Search",
    verb: "get",
    path: "/search",
    kept: "",
    derived: "query: Search,",
  },
  {
    name: "readOne",
    kind: "query",
    input: "ById",
    verb: "get",
    path: "/items/:id",
    kept: "",
    derived: "params: ById,",
  },
  {
    name: "create",
    kind: "command",
    input: "Note",
    verb: "post",
    path: "/items",
    kept: "",
    derived: "payload: Note,",
  },
  {
    name: "revise",
    kind: "command",
    input: "Note",
    verb: "patch",
    path: "/items/:id",
    kept: "params: ById,",
    derived: "payload: Note,",
  },
  {
    name: "cancel",
    kind: "command",
    input: "ById",
    verb: "post",
    path: "/items/:id:cancel",
    kept: "",
    derived: "params: ById,",
  },
  {
    name: "remove",
    kind: "command",
    input: "ById",
    verb: "delete",
    path: "/items/:id",
    kept: "",
    derived: "params: ById,",
  },
  {
    name: "ping",
    kind: "query",
    input: "Empty",
    verb: "get",
    path: "/ping",
    kept: "",
    derived: "",
  },
];

/** What `Http.Contract` still says: the group supplies the identity, the table the derived channels. */
const contractOptions = (spelling: Spelling, item: Declared): string => {
  // `grouped` lets the group supply root, group, success and operation id; `bare` and `verbose` write them out.
  const identity =
    spelling === "grouped"
      ? ""
      : `root: "derive", group: "derive", success: Success, metadata: { operationId: "derive.${item.name}" },`;

  const channels = spelling === "verbose" ? `${item.kept} ${item.derived}` : item.kept;

  return `${identity} ${channels}`;
};

const operation = (spelling: Spelling, item: Declared): string => `
export const ${item.name} = Operation.${item.kind}({ name: "derive.${item.name}", input: ${item.input}, success: Success })
  ${spelling === "grouped" ? ".in(Group)" : ""}
  .http.${item.verb}("${item.path}")
  .http.contract({ ${contractOptions(spelling, item)} })
  .declare();
`;

const source = (spelling: Spelling): string =>
  preamble + declared.map((item) => operation(spelling, item)).join("");

/** The same operations as static methods of a `@Http.Group` class: the decorator spelling. */
const method = (spelling: Spelling, item: Declared): string => `
  @${item.kind === "query" ? "Query" : "Command"}({ name: "derive.${item.name}", input: ${item.input}, success: Success })
  @Http.${item.verb.slice(0, 1).toUpperCase()}${item.verb.slice(1)}("${item.path}")
  @Http.Contract({ ${contractOptions(spelling, item)} })
  static ${item.name}() { return Effect.succeed({ ok: true }); }
`;

const decoratedSource = (spelling: Spelling): string => `
import { Effect } from "effect";
import { Command, Http, Query } from "@effx/runtime";
import { Api, ById, Empty, Note, Search, Success, Token } from "./_derive-support.ts";
@Http.Group({ root: Api, group: "derive" })
export class Decorated {
${declared.map((item) => method(spelling, item)).join("")}}
`;

const build = (tsconfigPath: string, entry: string) =>
  compile({ tsconfigPath, entry: [entry], emit: "contract" }, Extensions.builtin);

/** Both compile without errors to the same canonical IR, semantic hash and generated files. */
const same = Effect.fnUntraced(function* (dense: CompileResult, verbose: CompileResult) {
  for (const result of [dense, verbose])
    assert.deepStrictEqual(
      result.diagnostics.filter((diagnostic) => diagnostic.severity === "error"),
      [],
    );

  const denseIr = Option.getOrThrow(dense.ir.value);
  const ir = Option.getOrThrow(verbose.ir.value);
  const files = Option.getOrThrow(verbose.files.value);

  assert.strictEqual(canonical(denseIr), canonical(ir));
  assert.strictEqual(yield* semanticHash(denseIr), yield* semanticHash(ir));
  assert.deepStrictEqual(Option.getOrThrow(dense.files.value), files);

  // The derived channels really reached the contract (equality of two contracts that both lack them proves nothing).
  const text = files.map((file) => file.contents).join("\n");

  for (const channel of ["headers: Token", "query: Search", "payload: Note", "params: ById"])
    assert.include(text, channel);

  // `ping` has an empty input: no channel at all.
  assert.notInclude(text, "Empty");
});

describe("derived channels from real declarations", () => {
  it.effect(
    "builder: dense and verbose spellings compile to the same IR, hash and generated files",
    () =>
      Effect.gen(function* () {
        const fixtureRoot = yield* copyUsersFixture();
        const tsconfigPath = fixtureRoot + "/tsconfig.json";
        yield* temp(fixtureRoot, "_derive-support.ts", support());
        yield* temp(fixtureRoot, "_derive-grouped.ts", source("grouped"));
        yield* temp(fixtureRoot, "_derive-bare.ts", source("bare"));
        yield* temp(fixtureRoot, "_derive-verbose.ts", source("verbose"));

        const verbose = yield* build(tsconfigPath, "src/_derive-verbose.ts");

        // In a group, and outside one (the mono-web Profile and Directory style).
        for (const entry of ["src/_derive-grouped.ts", "src/_derive-bare.ts"])
          yield* same(yield* build(tsconfigPath, entry), verbose);
      }).pipe(Effect.scoped, Effect.provide(Services)),
    60_000,
  );

  it.effect(
    "decorators: a @Http.Group class derives what its verbose spelling writes",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixtureRoot = yield* copyUsersFixture();
        const tsconfigPath = path.join(fixtureRoot, "tsconfig.json");

        yield* temp(fixtureRoot, "_derive-support.ts", support());

        // One file for both spellings: the IR names the handler's module, so it must not differ.
        const file = path.join(fixtureRoot, "src", "_derive-decorated.ts");

        yield* Effect.addFinalizer(() => fs.remove(file).pipe(Effect.ignore));

        const decorated = Effect.fnUntraced(function* (spelling: Spelling) {
          yield* fs.writeFileString(file, decoratedSource(spelling));

          return yield* build(tsconfigPath, "src/_derive-decorated.ts");
        });

        const dense = yield* decorated("grouped");
        const verbose = yield* decorated("verbose");

        yield* same(dense, verbose);
      }).pipe(Effect.scoped, Effect.provide(Services)),
    60_000,
  );
});
