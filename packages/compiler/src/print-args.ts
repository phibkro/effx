import { Array as Arr, Predicate, Result, Schema } from "effect";
import { SymbolRef } from "@effx/ir";
import type { FragmentImports } from "./Extension.ts";
import type { CoreDiagnostics } from "./diagnostics/core.ts";

/**
 * Printing decoded annotation arguments as TypeScript source (spec 0020 §6): the value half of the default
 * writer's `.annotate(<key>, <value>)`. Pure; validation and printing are split so the generated file is
 * only touched once a value is known to be printable (a `Render` registers imports, nothing else does).
 * The input is the JSON an `Extension` node stores: decoded arguments, where a lowered `Schema`/`Symbol`
 * argument is the object `{ _tag, ref }`.
 */

/** A value the writer cannot spell as source; `path` locates it from the printed root (`$`, `$[0].tags`). */
export interface Unprintable {
  readonly path: string;
  readonly kind: Extract<
    Parameters<(typeof CoreDiagnostics)["EFFX1102"]["emit"]>[0],
    { readonly _tag: "EffectArgument" }
  >["kind"];
}

/** Prints a validated value, registering the imports it needs. */
export type Render = (imports: FragmentImports) => string;

/** A lowered `Schema`/`Symbol` argument: an application export the generated file imports. */
const isReference = Schema.is(
  Schema.Struct({ _tag: Schema.Literals(["Schema", "Symbol"]), ref: SymbolRef }),
);

const bareKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray => Arr.isArray(value);

const unprintable = (path: string, kind: Unprintable["kind"]): Result.Result<Render, Unprintable> =>
  Result.fail({ path, kind });

const literal = (value: string | number | boolean | null): Result.Result<Render, Unprintable> => {
  const text = JSON.stringify(value);

  return Result.succeed(() => text);
};

/**
 * Validates `value` and returns how to print it: `null`, strings, finite numbers and booleans via
 * `JSON.stringify`; arrays and objects by structure; a lowered `{ _tag: "Schema" | "Symbol", ref }` as an
 * import of the referenced export (a `member` is read off it, `User.Public`). A lowered `Lambda` and a
 * non-finite number are `Unprintable`: they are reported, never dropped.
 */
export const printable = (value: Schema.Json, path = "$"): Result.Result<Render, Unprintable> => {
  if (value === null || Predicate.isString(value) || Predicate.isBoolean(value))
    return literal(value);

  if (Predicate.isNumber(value)) {
    return Number.isFinite(value) ? literal(value) : unprintable(path, "non-finite number");
  }

  if (isJsonArray(value)) {
    return Result.map(
      Result.all(value.map((item, index) => printable(item, `${path}[${index}]`))),
      (items): Render =>
        (imports) =>
          `[${items.map((item) => item(imports)).join(", ")}]`,
    );
  }

  if (isReference(value)) {
    const { ref } = value;

    return Result.succeed((imports) => {
      const name = imports.add(ref.module, ref.export);

      return ref.member === undefined ? name : `${name}.${ref.member}`;
    });
  }

  if (value._tag === "Lambda") return unprintable(path, "Lambda");

  const fields = Object.entries(value).map(([key, item]) =>
    Result.map(
      printable(item, bareKey.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`),
      (render): Render =>
        (imports) =>
          `${bareKey.test(key) ? key : JSON.stringify(key)}: ${render(imports)}`,
    ),
  );

  return Result.map(
    Result.all(fields),
    (items): Render =>
      (imports) =>
        items.length === 0 ? "{}" : `{ ${items.map((item) => item(imports)).join(", ")} }`,
  );
};
