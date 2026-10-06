import { Schema } from "effect";
import { Builtins } from "@effx/runtime";
import { HttpDiagnostics, SymbolArg, type Diagnostic, type GroupBinding } from "@effx/compiler";
import { lowerExpression } from "./lower.ts";
import { exportedSymbol, type Resolver } from "./resolve.ts";
import { isExported, positionOf, ts } from "./ts.ts";

const isSymbol = Schema.is(SymbolArg);

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

  const entries = new Map<string, ts.Expression>();

  for (const field of fields.properties) {
    if (
      (!ts.isPropertyAssignment(field) && !ts.isShorthandPropertyAssignment(field)) ||
      (!ts.isIdentifier(field.name) && !ts.isStringLiteral(field.name)) ||
      entries.has(field.name.text)
    ) {
      diagnostics.push(HttpDiagnostics.EFFX2423.emit({ subject }, options));

      return;
    }

    entries.set(field.name.text, ts.isPropertyAssignment(field) ? field.initializer : field.name);
  }

  if (
    !entries.has("handlers") ||
    entries.has("guards") === entries.has("guardFor") ||
    [...entries.keys()].some((key) => key !== "handlers" && key !== "guards" && key !== "guardFor")
  ) {
    diagnostics.push(HttpDiagnostics.EFFX2423.emit({ subject }, options));

    return;
  }

  const references = new Map<string, GroupBinding["handlers"]>();

  for (const [key, expression] of entries) {
    const symbol = resolver.project.checker.getSymbolAtLocation(expression);
    const exported = symbol === undefined ? undefined : exportedSymbol(resolver, symbol);

    const callable = resolver.project.checker.getSignaturesOfType(
      resolver.project.checker.getTypeAtLocation(expression),
      ts.SignatureKind.Call,
    );

    if (exported === undefined || callable.length === 0) {
      diagnostics.push(HttpDiagnostics.EFFX2421.emit({ subject: `${subject}.${key}` }, options));

      return;
    }

    references.set(key, exported.ref);
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

  bindings.push({
    group: ref,
    handlers: references.get("handlers")!,
    ...(references.has("guards")
      ? { guards: references.get("guards")! }
      : { guardFor: references.get("guardFor")! }),
  });
};
