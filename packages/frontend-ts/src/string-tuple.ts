import type { SpreadSource } from "@effx/compiler";
import { type Resolver, origin } from "./resolve.ts";
import { positionOf, ts } from "./ts.ts";

interface ResolvedTuple {
  readonly codes: ReadonlyArray<string>;
  readonly spreads: ReadonlyArray<SpreadSource>;
}

interface UnresolvedTuple {
  readonly spread: ts.SpreadElement;
  readonly reason: string;
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
  const unresolved = (reason: string): UnresolvedTuple => ({ spread, reason });

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

      if (found === undefined) return unresolved("unresolved tuple operand");

      if (active.has(found.symbol)) return unresolved("cyclic tuple initializer");
      const declaration = found.declaration;

      if (
        !ts.isVariableDeclaration(declaration) ||
        (declaration.parent.flags & ts.NodeFlags.Const) === 0 ||
        declaration.initializer === undefined
      )
        return unresolved("operand must resolve to a const tuple initializer");

      active.add(found.symbol);
      const result = walk(declaration.initializer);
      active.delete(found.symbol);

      if ("reason" in result) return result;

      // Check the referenced value before any surrounding assertion can hide a mutable alias hop.
      return crossCheck(node, result);
    }

    if (!ts.isArrayLiteralExpression(node))
      return unresolved("operand must resolve to a readonly const tuple of string literals");

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
        return unresolved(`tuple element \`${element.getText()}\` must be a string literal`);
      }
    }

    return crossCheck(node, { codes, spreads });
  };

  const crossCheck = (expression: ts.Expression, result: ResolvedTuple): TupleResult => {
    const type = checker.getTypeAtLocation(expression);

    if (!checker.isTupleType(type)) return unresolved("operand is not a readonly const tuple");
    // SAFETY: isTupleType above establishes the TypeReference tuple target and its readonly flag.
    const tuple = type as ts.TupleTypeReference;

    if (!tuple.target.readonly) return unresolved("operand is not a readonly const tuple");
    const elements = checker.getTypeArguments(tuple);

    if (
      elements.length !== result.codes.length ||
      elements.some(
        (element, index) => !element.isStringLiteral() || element.value !== result.codes[index],
      )
    )
      return unresolved("tuple type disagrees with its runtime initializer elements or order");

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
