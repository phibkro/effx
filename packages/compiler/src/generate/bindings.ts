import type { GroupBinding } from "../Collected.ts";
import { Imports } from "./emit.ts";
import {
  endpointKey,
  groupApiHandlersName,
  groupApiName,
  type HttpGroup,
} from "./http-contracts.ts";

/** Add only bound-mode bytes; the unbound projection is left untouched. */
export const boundHandlersLines = (
  imports: Imports,
  group: HttpGroup,
  binding: GroupBinding,
  unbound: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const name = groupApiName(group.group).slice(0, -"Api".length);
  const factory = groupApiHandlersName(group.group);

  const handlersImport = imports.addAliased(
    binding.handlers.module,
    binding.handlers.export,
    "__effxMakeRaw",
  );

  const handlers =
    handlersImport + (binding.handlers.member === undefined ? "" : `.${binding.handlers.member}`);

  // A generic handler factory keeps its full type-parameter clause — name, constraint, default and
  // the imports its constraint needs — so `Parameters<...>` at the bound wrapper's call site does not
  // instantiate the parameters to `unknown` and erase the context, the requirements or the defaults.
  const typeParameters = binding.handlersTypeParameters;

  const clause = typeParameters.map((parameter) => {
    // Every resolved reference is replaced over its whole recorded span, never by word matching, so
    // qualified names and literal defaults keep their other occurrences untouched.
    const print = (text: string, where: "constraint" | "default"): string => {
      let printed = text;

      const spans = parameter.references
        .filter((reference) => reference.where === where)
        .toSorted((left, right) => right.start - left.start);

      for (const span of spans) {
        // A `typeof` reference needs the value binding; a type reference needs a type-only import.
        const local = span.value
          ? imports.addAliased(span.ref.module, span.ref.export, span.ref.export)
          : imports.addTypeAliased(span.ref.module, span.ref.export, span.ref.export);

        const owner = local + (span.ref.member === undefined ? "" : `.${span.ref.member}`);

        printed = printed.slice(0, span.start) + owner + printed.slice(span.end);
      }

      return printed;
    };

    const constraint =
      parameter.constraint === "" ? "" : ` extends ${print(parameter.constraint, "constraint")}`;

    const fallback = parameter.default === "" ? "" : ` = ${print(parameter.default, "default")}`;

    return `${parameter.name}${constraint}${fallback}`;
  });

  const declarations = clause.length === 0 ? "" : `<${clause.join(", ")}>`;
  const names = typeParameters.map((parameter) => parameter.name);
  const typeArguments = names.length === 0 ? "" : `<${names.join(", ")}>`;

  const guardsTypeParameters = binding.guardsTypeParameters;

  // The guard factory takes the handler factory's type arguments by position, truncated to the guard
  // factory's own arity: extra parameters are legal only when they are defaulted, and a required extra
  // parameter leaves the guard uninstantiated so the typed check reports the incompatibility.
  const guardPrefix = Math.min(names.length, guardsTypeParameters.length);

  const guardDefaults = guardsTypeParameters
    .slice(guardPrefix)
    .every((parameter) => parameter.default !== "");

  const guardsTypeArguments =
    names.length > 0 && guardDefaults
      ? guardPrefix === 0
        ? ""
        : `<${names.slice(0, guardPrefix).join(", ")}>`
      : "";

  const context = `Parameters<typeof ${handlers}${typeArguments}>`;

  const root = group.metadata!.rootSymbol!;
  const rootImport = imports.addAliased(root.module, root.export, "__effxRootApi");
  const rootExpr = rootImport + (root.member === undefined ? "" : `.${root.member}`);

  const lines = unbound.map((line) =>
    line.startsWith(`type ${name}Endpoints =`)
      ? `export ${line}`
      : line.replace(`export const ${factory} =`, `export const ${factory}With =`),
  );

  let guardType: string;
  let guardExpression: ReadonlyArray<string>;
  const extra: Array<string> = [];

  if (binding.guards !== undefined) {
    const imported = imports.addAliased(
      binding.guards.module,
      binding.guards.export,
      "__effxMakeGuards",
    );

    const guards =
      imported + (binding.guards.member === undefined ? "" : `.${binding.guards.member}`);

    guardType = `ReturnType<typeof ${guards}>`;

    if (clause.length === 0)
      extra.push(
        `const __effxCheckedGuards: Parameters<typeof ${guards}> extends ${context}`,
        `  ? (...ctx: ${context}) => ReturnType<typeof ${guards}>`,
        `  : never = ${guards};`,
        "",
      );
    else
      // The tuple check mentions the mirrored type parameters, so it must live in a scope that
      // declares them; the `checked` assignment is the check, never a cast.
      extra.push(
        `const __effxCheckedGuards = ${declarations}(...ctx: ${context}) => {`,
        `  const checked: Parameters<typeof ${guards}${guardsTypeArguments}> extends ${context}`,
        `    ? typeof ${guards}${guardsTypeArguments}`,
        `    : never = ${guards};`,
        "  return checked(...ctx);",
        "};",
        "",
      );
    guardExpression = ["    guards: __effxCheckedGuards(...ctx),"];
  } else {
    const ref = binding.guardFor!;
    const imported = imports.addAliased(ref.module, ref.export, "__effxGuardFor");
    const guardFor = imported + (ref.member === undefined ? "" : `.${ref.member}`);
    extra.push(
      "const __effxMakeGuards = () => ({",
      ...group.items.map(
        (item) =>
          `  ${JSON.stringify(`${group.group}.${endpointKey(item)}`)}: ${guardFor}(${rootExpr}.groups[${JSON.stringify(group.group)}].endpoints[${JSON.stringify(endpointKey(item))}]),`,
      ),
      "});",
      "",
    );
    const effect = imports.add("effect", "Effect");
    extra.push(
      `type __effxUnknownPrincipal<Guard> = Guard extends (...args: infer Args) => ${effect}.Effect<infer _A, infer E, infer R>`,
      `  ? (...args: Args) => ${effect}.Effect<unknown, E, R> : never;`,
      "type __effxBoundGuards = {",
      "  readonly [Key in keyof ReturnType<typeof __effxMakeGuards>]: __effxUnknownPrincipal<ReturnType<typeof __effxMakeGuards>[Key]>;",
      "};",
      "",
    );
    guardType = "__effxBoundGuards";
    guardExpression = ["    guards: __effxMakeGuards(),"];
  }

  return [
    ...lines,
    "",
    ...extra,
    `export type ${name}Raw = ${name}RawHandlers<${name}Endpoints, ${guardType}>;`,
    "",
    `export const ${factory} = ${declarations}(...ctx: ${context}) =>`,
    `  ${factory}With({`,
    `    raw: ${handlers}(...ctx),`,
    ...guardExpression,
    "  });",
  ];
};
