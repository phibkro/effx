import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Option, Result, Schema } from "effect";
import { A, Annotation, type DefinitionData } from "@effx/runtime";
import {
  type ReadArgs,
  Extensions,
  decodeSchemaOf,
  extension,
  implement,
  interpret,
} from "@effx/compiler";
import { decoratorStyle } from "./fixtures/users.ts";

const Options = Schema.Struct({
  name: Schema.String.check(Schema.isMaxLength(3)),
  count: Schema.Natural,
  tags: Schema.UniqueArray(Schema.NonEmptyString),
  kind: Schema.Literals(["a", "b"]),
  extra: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
});

const Def = Annotation.define({
  name: "app.FromSchema",
  target: "operation",
  args: [A.fromSchema(Options)],
});

const decode = Schema.decodeUnknownResult(decodeSchemaOf(Def));

const valid: typeof Options.Type = { name: "abc", count: 2, tags: ["x"], kind: "a" };

describe("A.fromSchema in the compiler", () => {
  it("decodes accepted shapes and returns the Schema's Type", () => {
    const decoded = decode([{ ...valid, extra: { k: [1, "x"] } }]);

    assert.deepStrictEqual(Result.getOrThrow(decoded), [{ ...valid, extra: { k: [1, "x"] } }]);
  });

  it("runs refinement checks the algebra has no name for (isMaxLength, isGreaterThanOrEqualTo)", () => {
    assert.isTrue(Result.isFailure(decode([{ ...valid, name: "abcd" }])), "isMaxLength(3)");
    assert.isTrue(Result.isFailure(decode([{ ...valid, count: -1 }])), "Natural: >= 0");
  });

  it("runs the named checks the plan carries (isInt, isUnique, isNonEmpty)", () => {
    assert.isTrue(Result.isFailure(decode([{ ...valid, count: 1.5 }])), "isInt");
    assert.isTrue(Result.isFailure(decode([{ ...valid, tags: ["x", "x"] }])), "isUnique");
    assert.isTrue(Result.isFailure(decode([{ ...valid, tags: [""] }])), "isNonEmpty on items");
    assert.isTrue(Result.isFailure(decode([{ ...valid, kind: "c" }])), "literal");
    assert.isTrue(Result.isFailure(decode([{ count: 1 }])), "required fields");
  });

  it("types read with the Schema's Type", () => {
    expectTypeOf<ReadArgs<typeof Def>>().toEqualTypeOf<readonly [typeof Options.Type]>();
  });

  it("implement accepts the definition and read receives the typed Type", () => {
    implement(Def, {
      read: ([options]) => {
        expectTypeOf(options.count).toEqualTypeOf<number>();
        expectTypeOf(options.kind).toEqualTypeOf<"a" | "b">();

        return { nodes: [], edges: [], diagnostics: [] };
      },
    });
  });
});

describe("EFFX1301", () => {
  const Bad = Annotation.define({
    name: "app.Bad",
    target: "operation",
    args: { when: A.fromSchema(Schema.Struct({ at: Schema.Date })), ok: A.string },
  });

  const Worse = Annotation.define({
    name: "app.Worse",
    target: "operation",
    args: [A.fromSchema(Schema.FiniteFromString)],
  });

  const report = (...definitions: ReadonlyArray<DefinitionData>) =>
    interpret(decoratorStyle, [
      ...Extensions.builtin,
      extension(
        "app",
        definitions.map((definition) => implement(definition)),
      ),
    ]);

  it("definitionDiagnostics reports each rejected node as an error with its path and kind", () => {
    const result = report(Bad, Worse);

    assert.deepStrictEqual(
      result.diagnostics.filter((d) => d.code === "EFFX1301").map((d) => [d.severity, d.message]),
      [
        [
          "error",
          "annotation app.Bad: args $[0].when.at: Schema node Date cannot be lowered from source (A.fromSchema)",
        ],
        [
          "error",
          "annotation app.Worse: args $[0]: Schema node Transformation cannot be lowered from source (A.fromSchema)",
        ],
      ],
    );
  });

  it("a definition without a rejected node reports nothing, and the IR is still produced", () => {
    const result = report(Def);

    assert.deepStrictEqual(
      result.diagnostics.filter((d) => d.code === "EFFX1301"),
      [],
    );
    assert.isTrue(Option.isSome(result.value));
  });
});
