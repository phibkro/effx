import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import {
  A,
  Annotation,
  Builtins,
  Cli,
  Command,
  Errors,
  Foldkit,
  Http,
  Operation,
  PersistentModel,
  Query,
  Reflect,
  Requirements,
  Rpc,
  type Applied,
  type MethodDecorator,
} from "@effx/runtime";

const Input = Schema.Struct({ id: Schema.String });

const Tag = Annotation.define({ name: "app.Tag", target: "operation", args: [A.string] });

class Decorated {
  @Query({ input: Input, success: Input })
  @Tag("a")
  @Http.Get("/x")
  static op() {}
}

const decoratedOp = Object.getOwnPropertyDescriptor(Decorated, "op")?.value;

describe("decorators are the built-in definitions", () => {
  it("each public decorator is its definition", () => {
    assert.strictEqual(Query, Builtins.Query);
    assert.strictEqual(Command, Builtins.Command);
    assert.strictEqual(Errors, Builtins.Errors);
    assert.strictEqual(Requirements, Builtins.Requirements);
    assert.strictEqual(Rpc, Builtins.Rpc);
    assert.strictEqual(Cli, Builtins.Cli);
    assert.strictEqual(Http.Group, Builtins.HttpGroup);
    assert.strictEqual(Http.Access, Builtins.HttpAccess);
    assert.strictEqual(Http.Contract, Builtins.HttpContract);
    assert.strictEqual(Http.Get, Builtins.HttpGet);
    assert.strictEqual(Http.Post, Builtins.HttpPost);
    assert.strictEqual(Http.Put, Builtins.HttpPut);
    assert.strictEqual(Http.Patch, Builtins.HttpPatch);
    assert.strictEqual(Http.Delete, Builtins.HttpDelete);
    assert.strictEqual(Foldkit.Command, Builtins.FoldkitCommand);
    assert.strictEqual(PersistentModel, Builtins.PersistentModel);
  });

  it("applied values are assignable to the public decorator types", () => {
    expectTypeOf(Query({ input: Input, success: Input })).toExtend<MethodDecorator>();
    expectTypeOf(Http.Problems({ codes: ["a"] })).toExtend<MethodDecorator>();
    expectTypeOf(Http.Problems({ codes: ["a"] })).toEqualTypeOf<
      Applied<"Http.Problems", "operation">
    >();
  });
});

describe("OperationBuilder.with", () => {
  it("appends exactly applied.annotation, in order, without mutating the receiver", () => {
    const base = Operation.query({ input: Input, success: Input });
    const next = base.with(Tag("a")).http.get("/x");

    assert.strictEqual(base.annotations.length, 1);
    assert.deepStrictEqual(next.annotations, [
      { name: "Query", args: [{ input: Input, success: Input }] },
      { name: "app.Tag", args: ["a"] },
      { name: "Http.Get", args: ["/x"] },
    ]);
    assert.deepStrictEqual(next.annotations, Reflect.annotationsOf(decoratedOp));
  });

  it("accepts every operation-target applied value and rejects other targets", () => {
    const builder = Operation.query({ input: Input, success: Input });

    expectTypeOf(builder.with(Http.Get("/x"))).toEqualTypeOf<typeof builder>();
    expectTypeOf(builder.with(Tag("a"))).toEqualTypeOf<typeof builder>();
    // @ts-expect-error a group annotation is not an operation annotation
    builder.with(Http.Group({ root: "Api", group: "g" }));
  });
});
