import { Schema } from "effect";
import { Builtins } from "@effx/runtime";
import { HttpDiagnostics, SymbolArg, type Diagnostic, type GroupBinding } from "@effx/compiler";
import { lowerExpression } from "./lower.ts";
import { exportedSymbol, type Resolver } from "./resolve.ts";
import { isExported, positionOf, ts } from "./ts.ts";

const isSymbol = Schema.is(SymbolArg);

/**
 * Type-parameter names of an exported factory, in declaration order. The bound projection mirrors
 * them so a generic handler factory's context requirements survive its call site.
 */
const factoryTypeParameters = (declaration: ts.Declaration): ReadonlyArray<string> => {
  const holder = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;

  if (
    holder === undefined ||
    (!ts.isArrowFunction(holder) &&
      !ts.isFunctionExpression(holder) &&
      !ts.isFunctionDeclaration(holder))
  )
    return [];

  return (holder.typeParameters ?? []).map((parameter) => parameter.name.text);
};

/** Read references only. In particular, no initializer or backend function is executed. */
export const collectGroupBinding = (
  resolver: Resolver,
  declaration: ts.VariableDeclaration,
  call: ts.CallExpression,
  bindings: Array<GroupBinding>,
  diagnostics: Array<Diagnostic>,
): void => {
  if (resolver.project.resolution?.emit === "contract" || !isExported(declaration)) return;
  const subject = declaration.name.getText();
  const options = { location: positionOf(call) };
  const [group, fields] = call.arguments;

  if (group === undefined) {
    diagnostics.push(HttpDiagnostics.EFFX2420.emit({ subject }, options));

    return;
  }

  const lowered = lowerExpression(resolver, subject, group, Builtins.HttpIn.plan.items[0]);

  if (!isSymbol(lowered.value)) {
    diagnostics.push(HttpDiagnostics.EFFX2420.emit({ subject }, options));

    return;
  }

  if (
    call.arguments.length !== 2 ||
    fields === undefined ||
    !ts.isObjectLiteralExpression(fields)
  ) {
    diagnostics.push(HttpDiagnostics.EFFX2423.emit({ subject }, options));

    return;
  }

  const entries = new Map<
    string,
    { readonly expression: ts.Expression; readonly symbol: ts.Symbol | undefined }
  >();

  for (const field of fields.properties) {
    if (
      (!ts.isPropertyAssignment(field) && !ts.isShorthandPropertyAssignment(field)) ||
      (!ts.isIdentifier(field.name) && !ts.isStringLiteral(field.name)) ||
      entries.has(field.name.text)
    ) {
      diagnostics.push(HttpDiagnostics.EFFX2423.emit({ subject }, options));

      return;
    }

    const expression = ts.isPropertyAssignment(field) ? field.initializer : field.name;

    const symbol = ts.isShorthandPropertyAssignment(field)
      ? resolver.project.checker.getShorthandAssignmentValueSymbol(field)
      : resolver.project.checker.getSymbolAtLocation(expression);

    entries.set(field.name.text, { expression, symbol });
  }

  if (
    !entries.has("handlers") ||
    entries.has("guards") === entries.has("guardFor") ||
    [...entries.keys()].some((key) => key !== "handlers" && key !== "guards" && key !== "guardFor")
  ) {
    diagnostics.push(HttpDiagnostics.EFFX2423.emit({ subject }, options));

    return;
  }

  const references = new Map<
    string,
    { readonly ref: GroupBinding["handlers"]; readonly typeParameters: ReadonlyArray<string> }
  >();

  for (const [key, value] of entries) {
    const exported =
      value.symbol === undefined ? undefined : exportedSymbol(resolver, value.symbol);

    const callable = resolver.project.checker.getSignaturesOfType(
      resolver.project.checker.getTypeAtLocation(value.expression),
      ts.SignatureKind.Call,
    );

    if (exported === undefined || callable.length === 0) {
      diagnostics.push(HttpDiagnostics.EFFX2421.emit({ subject: subject + "." + key }, options));

      return;
    }

    references.set(key, {
      ref: exported.ref,
      typeParameters: factoryTypeParameters(exported.declaration),
    });
  }

  const ref = lowered.value.ref;

  if (
    bindings.some(
      (binding) =>
        binding.group.module === ref.module &&
        binding.group.export === ref.export &&
        binding.group.member === ref.member,
    )
  ) {
    diagnostics.push(HttpDiagnostics.EFFX2422.emit({ subject }, options));

    return;
  }

  const handlers = references.get("handlers")!;
  const guards = references.get("guards");
  const guardFor = references.get("guardFor");

  bindings.push({
    group: ref,
    handlers: handlers.ref,
    handlersTypeParameters: [...handlers.typeParameters],
    ...(guards === undefined ? { guardFor: guardFor!.ref } : { guards: guards.ref }),
  });
};
