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
    extra.push(
      `const __effxCheckedGuards: Parameters<typeof ${guards}> extends Parameters<typeof ${handlers}>`,
      `  ? (...ctx: Parameters<typeof ${handlers}>) => ReturnType<typeof ${guards}>`,
      `  : never = ${guards};`,
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
    `export const ${factory} = (...ctx: Parameters<typeof ${handlers}>) =>`,
    `  ${factory}With({`,
    `    raw: ${handlers}(...ctx),`,
    ...guardExpression,
    "  });",
  ];
};
