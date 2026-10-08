import { Result, Schema } from "effect";
import type { TemplateExpr } from "./rules.ts";

/*
 * Evaluation of the closed template language of a data rule (spec 0019 §5.2). It is total over JSON: every
 * expression yields a JSON value or a message naming what was missing. There is no recursion over
 * application data, no I/O and nothing that could throw.
 */

/** The literal arguments of one builder call, by the argument names its rule declares. */
export type TemplateArgs = ReadonlyMap<string, Schema.Json>;

const isArray = Schema.is(Schema.Array(Schema.Json));

/** Evaluates `expr` over `args`; `item` is the element a surrounding `Map` binds for `Item`. */
export const evaluate = (
  expr: TemplateExpr,
  args: TemplateArgs,
  item?: Schema.Json,
): Result.Result<Schema.Json, string> => {
  switch (expr._tag) {
    case "Const":
      return Result.succeed(expr.value);
    case "Arg": {
      const value = args.get(expr.name);

      return value === undefined
        ? Result.fail(`absent argument ${expr.name}`)
        : Result.succeed(value);
    }

    case "Item":
      return item === undefined ? Result.fail("Item outside Map") : Result.succeed(item);
    case "IfPresent":
      return evaluate(args.has(expr.arg) ? expr.present : expr.absent, args, item);
    case "IfTrue":
      return evaluate(args.get(expr.arg) === true ? expr.whenTrue : expr.whenFalse, args, item);
    case "Object":
      return Result.map(
        Result.all(
          expr.fields.map((field) =>
            Result.map(evaluate(field.value, args, item), (value) => [field.key, value] as const),
          ),
        ),
        (pairs) => Object.fromEntries(pairs),
      );
    case "Array":
      return Result.all(expr.items.map((entry) => evaluate(entry, args, item)));
    case "Concat":
      return Result.flatMap(
        Result.all(expr.parts.map((part) => evaluate(part, args, item))),
        (parts) =>
          parts.every(isArray)
            ? Result.succeed(parts.flatMap((part) => (isArray(part) ? part : [])))
            : Result.fail("Concat of a non-array part"),
      );
    case "Map": {
      const list = args.get(expr.arg);

      return list === undefined || !isArray(list)
        ? Result.fail(`Map over a non-array argument ${expr.arg}`)
        : Result.all(list.map((element) => evaluate(expr.body, args, element)));
    }
  }
};
