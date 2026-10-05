import type { CoreDiagnostics, SpreadSource } from "@effx/compiler";
import { type Resolver, origin } from "./resolve.ts";
import { positionOf, ts } from "./ts.ts";

interface ResolvedTuple {
  readonly codes: ReadonlyArray<string>;
  readonly spreads: ReadonlyArray<SpreadSource>;
}

type TupleReason = Extract<
  Parameters<typeof CoreDiagnostics.EFFX1102.emit>[0],
  { readonly _tag: "Lowering" }
>["reason"];

interface UnresolvedTuple {
  readonly spread: ts.SpreadElement;
  readonly reason: TupleReason;
}

type TupleResult = ResolvedTuple | UnresolvedTuple;

/** Walk runtime initializers; tuple types only cross-check the walked values, never supply them. */
export const resolveStringSpread = (
  resolver: Resolver,
  declarationId: string,
  spread: ts.SpreadElement,
  active = new Set<ts.Symbol>(),
): TupleResult => {
  const checker = resolver.project.checker;
  const operand = spread.expression;
  const unresolved = (reason: TupleReason): UnresolvedTuple => ({ spread, reason });

  const walk = (input: ts.Expression): TupleResult => {
    let node = input;

    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isTypeAssertionExpression(node)
    )
      node = node.expression;

    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const symbol = checker.getSymbolAtLocation(node);
      const found = symbol === undefined ? undefined : origin(resolver, symbol);

      if (found === undefined) return unresolved({ _tag: "TupleUnresolved" });

      if (active.has(found.symbol)) return unresolved({ _tag: "TupleCycle" });
      const declaration = found.declaration;

      if (
        !ts.isVariableDeclaration(declaration) ||
        (declaration.parent.flags & ts.NodeFlags.Const) === 0 ||
        declaration.initializer === undefined
      )
        return unresolved({ _tag: "TupleConst" });

      active.add(found.symbol);
      const result = walk(declaration.initializer);
      active.delete(found.symbol);

      if ("reason" in result) return result;

      // Check the referenced value before any surrounding assertion can hide a mutable alias hop.
      return crossCheck(node, result);
    }

    if (!ts.isArrayLiteralExpression(node)) return unresolved({ _tag: "TupleLiteral" });

    const codes: Array<string> = [];
    const spreads: Array<SpreadSource> = [];

    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) {
        const nested = resolveStringSpread(resolver, declarationId, element, active);

        if ("reason" in nested) return nested;
        codes.push(...nested.codes);
        spreads.push(...nested.spreads);
      } else if (ts.isStringLiteral(element) || ts.isNoSubstitutionTemplateLiteral(element)) {
        codes.push(element.text);
      } else {
        return unresolved({ _tag: "TupleElement", source: element.getText() });
      }
    }

    return crossCheck(node, { codes, spreads });
  };

  const crossCheck = (expression: ts.Expression, result: ResolvedTuple): TupleResult => {
    const type = checker.getTypeAtLocation(expression);

    if (!checker.isTupleType(type)) return unresolved({ _tag: "TupleReadonly" });
    // SAFETY: isTupleType above establishes the TypeReference tuple target and its readonly flag.
    const tuple = type as ts.TupleTypeReference;

    if (!tuple.target.readonly) return unresolved({ _tag: "TupleReadonly" });
    const elements = checker.getTypeArguments(tuple);

    if (
      elements.length !== result.codes.length ||
      elements.some(
        (element, index) => !element.isStringLiteral() || element.value !== result.codes[index],
      )
    )
      return unresolved({ _tag: "TupleMismatch" });

    return result;
  };

  const walked = walk(operand);

  if ("reason" in walked) return walked;
  const checked = crossCheck(operand, walked);

  return "reason" in checked
    ? checked
    : {
        codes: checked.codes,
        spreads: [
          { declarationId, operand: operand.getText(), location: positionOf(spread) },
          ...checked.spreads,
        ],
      };
};
