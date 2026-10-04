import { assert, describe, it } from "@effect/vitest";
import { Annotate, Operation, Query, Reflect } from "@effx/runtime";
import { Predicate, Schema } from "effect";

const details = { reason: "Use the replacement", since: 2, tags: ["public", "old"] };

const query = { name: "Example.Read", input: Schema.String, success: Schema.String };

class Decorated {
  @Query(query)
  @Annotate("example.deprecated", details, true)
  static read() {
    return "unchanged";
  }
}

const decoratedMethod: unknown = Object.getOwnPropertyDescriptor(Decorated, "read")?.value;

if (!Predicate.isFunction(decoratedMethod)) throw new Error("decorated method was not defined");

const built = Operation.query(query)
  .annotate("example.deprecated", details, true)
  .handler(decoratedMethod);

describe("generic method annotations", () => {
  it("records the same ordered metadata without replacing the method or invoking it", () => {
    assert.strictEqual(built.handler, decoratedMethod);
    assert.deepStrictEqual(Reflect.annotationsOf(decoratedMethod), built.annotations);
    assert.deepStrictEqual(built.annotations, [
      { name: "Query", args: [query] },
      { name: "example.deprecated", args: [details, true] },
    ]);
    assert.strictEqual(Decorated.read(), "unchanged");
  });

  it("keeps multiple builder steps and zero-argument annotations in source order", () => {
    const value = Operation.query(query)
      .annotate("example.first")
      .annotate("example.second", { reason: "later" })
      .declare();

    assert.deepStrictEqual(value.annotations.slice(1), [
      { name: "example.first", args: [] },
      { name: "example.second", args: [{ reason: "later" }] },
    ]);
  });
});
