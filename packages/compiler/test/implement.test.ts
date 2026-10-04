import { describe, expectTypeOf, it } from "@effect/vitest";
import { Builtins } from "@effx/runtime";
import type { SchemaRef, SymbolRef } from "@effx/ir";
import { Contribution, implement } from "@effx/compiler";

describe("Annotation.implement typing", () => {
  it("gives read the decoded tuple, with markers resolved to the IR reference types", () => {
    implement(Builtins.HttpGet, {
      read: ([path]) => {
        expectTypeOf(path).toEqualTypeOf<string>();

        return Contribution.empty;
      },
    });

    implement(Builtins.Query, {
      read: ([options]) => {
        expectTypeOf(options.input.ref).toExtend<SchemaRef>();
        expectTypeOf(options.name).toEqualTypeOf<string | undefined>();

        return Contribution.empty;
      },
    });

    implement(Builtins.HttpContract, {
      read: ([options]) => {
        expectTypeOf(options.group).toEqualTypeOf<string>();
        expectTypeOf(options.middleware).toEqualTypeOf<
          | ReadonlyArray<{
              readonly _tag: "Symbol";
              readonly ref: SymbolRef;
              readonly security?: boolean;
            }>
          | undefined
        >();

        return Contribution.empty;
      },
    });

    implement(Builtins.Errors, {
      read: (schemas) => {
        expectTypeOf(schemas[0]?.ref).toExtend<SchemaRef | undefined>();

        return Contribution.empty;
      },
    });
  });
});
