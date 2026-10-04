import { assert, describe, it } from "@effect/vitest";
import { Option, Struct } from "effect";
import {
  type Collected,
  type Expand,
  type Extension,
  Extensions,
  error,
  interpret,
  warning,
} from "@effx/compiler";
import { canonical } from "@effx/ir";
import { decoratorStyle } from "./fixtures/users.ts";

const plain = (name: string): Extension => ({
  name,
  interpreters: {},
  analyses: [],
  generators: [],
});

const expanding = (name: string, expand: Expand): Extension => ({ ...plain(name), expand });

describe("Extension.expand (spec 0020 §3, the 0013 pre-pass seam)", () => {
  it("http-group is the one built-in extension that provides the group-defaults pre-pass", () => {
    assert.deepStrictEqual(
      Extensions.builtin
        .filter((extension) => extension.expand !== undefined)
        .map((extension) => extension.name),
      ["http-group"],
    );
  });

  it("a pre-pass replaces the declarations the interpreters see and contributes its diagnostics", () => {
    const dropAll = expanding("drop", () => ({
      declarations: [],
      diagnostics: [error("EFFX9101", "dropped")],
    }));

    const result = interpret(decoratorStyle, [...Extensions.builtin, dropAll]);

    assert.deepStrictEqual(Option.getOrThrow(result.value).nodes, []);
    assert.deepStrictEqual(
      result.diagnostics.map((d) => d.code),
      ["EFFX9101"],
    );
  });

  it("composes in list order: each sees the previous declarations; diagnostics keep list order", () => {
    const seen: Array<number> = [];

    const first = expanding("first", (collected: Collected) => {
      seen.push(collected.declarations.length);

      return {
        declarations: collected.declarations.slice(1),
        diagnostics: [warning("EFFX9102", "first")],
      };
    });

    const second = expanding("second", (collected: Collected) => {
      seen.push(collected.declarations.length);

      return { declarations: collected.declarations, diagnostics: [warning("EFFX9103", "second")] };
    });

    const total = decoratorStyle.declarations.length;

    const forward = interpret(decoratorStyle, [first, second]);

    assert.deepStrictEqual(seen, [total, total - 1]);
    assert.deepStrictEqual(
      forward.diagnostics.slice(0, 2).map((d) => d.code),
      ["EFFX9102", "EFFX9103"],
    );

    seen.length = 0;

    const reversed = interpret(decoratorStyle, [second, first]);

    assert.deepStrictEqual(seen, [total, total]);
    assert.deepStrictEqual(
      reversed.diagnostics.slice(0, 2).map((d) => d.code),
      ["EFFX9103", "EFFX9102"],
    );
  });

  it("the built-in pre-pass leaves a collection without group sugar byte-identical", () => {
    const withExpand = interpret(decoratorStyle, Extensions.builtin);

    const without = interpret(
      decoratorStyle,
      Extensions.builtin.map((extension): Extension => Struct.omit(extension, ["expand"])),
    );

    assert.strictEqual(
      canonical(Option.getOrThrow(withExpand.value)),
      canonical(Option.getOrThrow(without.value)),
    );
    assert.deepStrictEqual(withExpand.diagnostics, without.diagnostics);
  });

  it("a throwing pre-pass is a defect the pipeline does not swallow", () => {
    const boom = expanding("boom", () => {
      throw new Error("expand failed");
    });

    assert.throws(() => interpret(decoratorStyle, [boom]), "expand failed");
  });
});
