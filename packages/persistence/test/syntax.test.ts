import { assert, describe, expectTypeOf, it } from "@effect/vitest";
import { Schema } from "effect";
import { Operation, Query, Reflect, type ExternalOperationValue } from "@effx/runtime";
import { Persist, Port } from "@effx/persistence/syntax";

const Input = Schema.Struct({ id: Schema.String });

const Success = Schema.Struct({ id: Schema.String, email: Schema.String });

let calls = 0;

class DeclarationSyntax {
  @Query({ name: "Users.find", input: Input, success: Success })
  @Persist.Port({ port: "Users" })
  static find() {
    calls++;
  }
}

const method = Object.getOwnPropertyDescriptor(DeclarationSyntax, "find")?.value;

const Find = Operation.query({ name: "Users.find", input: Input, success: Success })
  .with(Persist.Port({ port: "Users" }))
  .declare();

describe("persistence source syntax", () => {
  it("derives the frozen plan, target and cardinality from Annotation.define", () => {
    assert.strictEqual(Persist.Port, Port);
    assert.strictEqual(Port.name, "persistence.Port");
    assert.strictEqual(Port.target, "operation");
    assert.strictEqual(Port.cardinality, "one");
    assert.deepStrictEqual(Port.plan, {
      items: [{ _tag: "Struct", fields: { port: { _tag: "String" } }, optional: [] }],
    });
    expectTypeOf(Port).parameters.toEqualTypeOf<[options: { readonly port: string }]>();
  });

  it("decorators and builder application record identical data without invoking a handler", () => {
    assert.deepStrictEqual(Reflect.annotationsOf(method), Find.annotations);
    assert.strictEqual(calls, 0);
    assert.isFalse("handler" in Find);
    expectTypeOf(Find).toEqualTypeOf<ExternalOperationValue>();
  });

  it("rejects missing or non-string port names at compile time", () => {
    // @ts-expect-error port is required by the one shared definition
    Port({});
    // @ts-expect-error the port name is a string, never an adapter implementation
    Port({ port: 1 });
  });
});
