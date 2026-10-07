import { Array as Arr, Option, Predicate, Result, Schema } from "effect";
import { SymbolRef } from "@effx/ir";
import type { CoreDiagnostics } from "./diagnostics/core.ts";
import { type ObjEntry, type Term, arr, lit, obj } from "./generate/term.ts";
import { refTerm } from "./generate/emit.ts";

/**
 * Printing decoded annotation arguments as TypeScript source (spec 0020 §6): the value half of the default
 * writer's `.annotate(<key>, <value>)`. Pure; validation and printing are split so the generated file is
 * only touched once a value is known to be printable (a term carries the references, the generator registers
 * them). The input is the JSON an `Extension` node stores: decoded arguments, where a lowered
 * `Schema`/`Symbol` argument is the object `{ _tag, ref }`.
 */

/** A value the writer cannot spell as source; `path` locates it from the printed root (`$`, `$[0].tags`). */
export interface Unprintable {
  readonly path: string;
  readonly kind: Extract<
    Parameters<(typeof CoreDiagnostics)["EFFX1102"]["emit"]>[0],
    { readonly _tag: "EffectArgument" }
  >["kind"];
}

/**
 * A lowered `Schema`/`Symbol` argument: the exported symbol the generated file imports. Decoding reads the
 * `SymbolRef` contract (module, export and optional member); a `SchemaRef`'s static-member `symbolId` path is
 * not part of this contract and never reaches the generated `.annotate(...)` value.
 */
const referenceOf = Schema.decodeUnknownOption(
  Schema.Struct({ _tag: Schema.Literals(["Schema", "Symbol"]), ref: SymbolRef }),
);

const bareKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

const isJsonArray = (value: Schema.Json): value is Schema.JsonArray => Arr.isArray(value);

const unprintable = (path: string, kind: Unprintable["kind"]): Result.Result<Term, Unprintable> =>
  Result.fail({ path, kind });

/**
 * Validates `value` and returns the term that prints it: `null`, strings, finite numbers and booleans via
 * `JSON.stringify`; arrays and objects by structure; a lowered `{ _tag: "Schema" | "Symbol", ref }` as a
 * reference to the exported symbol (a `member` is read off it, `User.Public`). A lowered `Lambda` and a
 * non-finite number are `Unprintable`: they are reported, never dropped.
 */
export const printable = (value: Schema.Json, path = "$"): Result.Result<Term, Unprintable> => {
  if (value === null || Predicate.isString(value) || Predicate.isBoolean(value))
    return Result.succeed(lit(value));

  if (Predicate.isNumber(value)) {
    return Number.isFinite(value)
      ? Result.succeed(lit(value))
      : unprintable(path, "non-finite number");
  }

  if (isJsonArray(value)) {
    return Result.map(
      Result.all(value.map((item, index) => printable(item, `${path}[${index}]`))),
      (items) => arr(items),
    );
  }

  const reference = referenceOf(value);

  if (Option.isSome(reference)) return Result.succeed(refTerm(reference.value.ref));

  if (value._tag === "Lambda") return unprintable(path, "Lambda");

  const fields = Object.entries(value).map(([key, item]) =>
    Result.map(
      printable(item, bareKey.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`),
      (term): ObjEntry => ({ key: bareKey.test(key) ? key : JSON.stringify(key), value: term }),
    ),
  );

  return Result.map(Result.all(fields), (entries) => obj(entries));
};
