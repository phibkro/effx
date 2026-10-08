import { Order } from "effect";
import type { SchemaRef, SymbolRef } from "@effx/ir";
import { nameOfSymbol, type Context } from "./context.ts";
import { symbolRefOf } from "./refs.ts";
import type { AdapterPrerequisite } from "./result.ts";
import type { LiftRule } from "./rules.ts";

/*
 * Adapter prerequisites (spec 0019 §4.2 item 5): the symbols the lifter table names that do not resolve in
 * the analyzed project. A symbol resolves when the model has a record of its module that exports it, so the
 * frontend reports the modules the rules name together with the modules of the declarations. Only symbols of
 * existing exports are checked: a `names` entry for a planned export names an export that must not exist yet.
 */

interface Named {
  readonly rule: string;
  readonly role: string;
  readonly ref: SymbolRef | SchemaRef;
}

const entry = (
  rule: string,
  role: string,
  ref: SymbolRef | SchemaRef | undefined,
): ReadonlyArray<Named> => (ref === undefined ? [] : [{ rule, role, ref }]);

const namedBy = (rule: LiftRule): ReadonlyArray<Named> => {
  switch (rule._tag) {
    case "SuccessWrapper": {
      const label = `SuccessWrapper ${nameOfSymbol(rule.callee)}`;

      return [
        ...entry(label, "callee", rule.callee),
        ...entry(label, "schema", rule.schema),
        ...entry(label, "responseHeaders", rule.responseHeaders),
      ];
    }

    case "NoSchemaSuccess":
      return entry(`NoSchemaSuccess ${nameOfSymbol(rule.callee)}`, "callee", rule.callee);
    case "ProblemRegistry": {
      const label = `ProblemRegistry ${nameOfSymbol(rule.response)}`;

      return [
        ...entry(label, "response", rule.response),
        ...entry(label, "union", rule.union),
        ...entry(label, "registry", rule.registry),
      ];
    }

    case "Metadata": {
      const label = `Metadata ${nameOfSymbol(rule.callee)}`;

      return [...entry(label, "callee", rule.callee), ...entry(label, "annotator", rule.annotator)];
    }

    case "Access": {
      const label = `Access ${nameOfSymbol(rule.callee)}`;

      return [
        ...entry(label, "callee", rule.callee),
        ...entry(label, "apply", rule.apply),
        ...entry(label, "annotator", rule.annotator),
      ];
    }
  }
};

const order: Order.Order<AdapterPrerequisite> = Order.combine(
  Order.mapInput(Order.String, (item: AdapterPrerequisite) => item.rule),
  Order.combine(
    Order.mapInput(Order.String, (item: AdapterPrerequisite) => item.role),
    Order.mapInput(Order.String, (item: AdapterPrerequisite) => item.ref.module),
  ),
);

/**
 * The unresolved symbols of the rules, the resolver names and the configured empty input. A symbol a
 * refactor plans (`planned`) is not a prerequisite: the patch creates it.
 */
export const adapterPrerequisites = (
  ctx: Context,
  planned: ReadonlyArray<SymbolRef>,
): ReadonlyArray<AdapterPrerequisite> => {
  const input = ctx.input;

  const resolvers = Object.entries(input.names).flatMap(([key, ref]) =>
    key.includes("#") ? [] : entry("names", key, ref),
  );

  const named = [
    ...input.rules.flatMap(namedBy),
    ...resolvers,
    ...entry("emptyInput", "schema", input.emptyInput),
  ];

  const unresolved = named.filter(
    (item) =>
      ctx.filesByModule.get(item.ref.module)?.exports.includes(item.ref.export) !== true &&
      !planned.some((ref) => ref.module === item.ref.module && ref.export === item.ref.export),
  );

  return unresolved
    .map((item): AdapterPrerequisite => ({
      rule: item.rule,
      role: item.role,
      ref: symbolRefOf(item.ref),
    }))
    .toSorted(order);
};
