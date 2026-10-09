import {
  Terms,
  type Finding,
  type OptionEntry,
  type OptionsSlot,
  type Term,
  type TermPath,
  type TermSlot,
  type TermSpan,
  symbolRefOf,
} from "@effx/compiler";
import type { SymbolRef } from "@effx/ir";
import { ts } from "../ts.ts";
import { LiftContext, finding, propertyName, range, unwrap } from "./context.ts";
import { contextKey } from "./keys.ts";

/** A slot is all-or-nothing; all sibling findings survive a failed descendant. */
export const lowerTerm = (context: LiftContext, input: ts.Expression): TermSlot => {
  const spans: Array<TermSpan> = [];
  const findings: Array<Finding> = [];

  const visit = (
    input_: ts.Expression,
    path: TermPath,
    enclosing?: SymbolRef,
  ): Term | undefined => {
    const node = unwrap(input_);
    spans.push({ path, range: range(input_) });

    const reject = (kind: Finding["kind"]): undefined => {
      findings.push(finding(node, kind, enclosing));

      return undefined;
    };

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return Terms.lit(node.text);

    if (ts.isNumericLiteral(node)) return Terms.lit(Number(node.text));

    if (node.kind === ts.SyntaxKind.TrueKeyword) return Terms.lit(true);

    if (node.kind === ts.SyntaxKind.FalseKeyword) return Terms.lit(false);

    if (node.kind === ts.SyntaxKind.NullKeyword) return Terms.lit(null);

    if (ts.isParenthesizedExpression(node)) {
      const term = visit(node.expression, [...path, "term"], enclosing);

      return term === undefined ? undefined : Terms.paren(term);
    }

    if (
      ts.isPrefixUnaryExpression(node) &&
      ts.isNumericLiteral(node.operand) &&
      (node.operator === ts.SyntaxKind.MinusToken || node.operator === ts.SyntaxKind.PlusToken)
    ) {
      return Terms.lit(
        (node.operator === ts.SyntaxKind.MinusToken ? -1 : 1) * Number(node.operand.text),
      );
    }

    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "key" &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "effect"
      ) {
        const key = contextKey(context.resolver, node);

        if (key !== undefined) return Terms.ref(key.ref);
      }

      const reference = context.reference(node);

      if (reference !== undefined) return Terms.ref(reference);

      if (ts.isPropertyAccessExpression(node)) {
        const receiver = visit(node.expression, [...path, "term"], enclosing);

        return receiver === undefined
          ? undefined
          : node.questionDotToken === undefined
            ? Terms.member(receiver, node.name.text)
            : Terms.optionalMember(receiver, node.name.text);
      }

      const symbol = context.resolver.project.checker.getSymbolAtLocation(node);

      return reject(
        symbol === undefined || symbol.declarations === undefined
          ? "unresolved"
          : "local-reference",
      );
    }

    if (ts.isCallExpression(node)) {
      const direct = context.reference(node.expression);
      const callee = visit(node.expression, [...path, "callee"], enclosing);
      const nextEnclosing = direct === undefined ? enclosing : symbolRefOf(direct);
      const args: Array<Term> = [];
      let complete = callee !== undefined;

      for (let index = 0; index < node.arguments.length; index++) {
        const argument = node.arguments[index];

        if (argument === undefined) continue;
        const value = visit(argument, [...path, "args", index], nextEnclosing);

        if (value === undefined) complete = false;
        else args.push(value);
      }

      return complete && callee !== undefined ? Terms.call(callee, args) : undefined;
    }

    if (ts.isObjectLiteralExpression(node)) {
      const entries: Array<{ readonly key: string; readonly value: Term }> = [];
      let complete = true;

      for (let index = 0; index < node.properties.length; index++) {
        const property = node.properties[index];

        if (property === undefined) continue;

        if (ts.isSpreadAssignment(property)) {
          findings.push(finding(property, "spread", enclosing));
          complete = false;
          continue;
        }

        const key = propertyName(property.name);

        if (key === undefined) {
          findings.push(finding(property.name, "computed-key", enclosing));
          complete = false;
        }

        let value: Term | undefined;

        if (ts.isPropertyAssignment(property))
          value = visit(property.initializer, [...path, "entries", index, "value"], enclosing);
        else if (ts.isShorthandPropertyAssignment(property)) {
          const symbol =
            context.resolver.project.checker.getShorthandAssignmentValueSymbol(property);

          const ref = symbol === undefined ? undefined : context.reference(property.name, symbol);
          spans.push({ path: [...path, "entries", index, "value"], range: range(property.name) });

          if (ref === undefined)
            findings.push(finding(property.name, "local-reference", enclosing));
          else value = Terms.ref(ref);
        } else findings.push(finding(property, "unsupported-syntax", enclosing));

        if (value === undefined) complete = false;

        if (key !== undefined && value !== undefined)
          entries.push({ key: JSON.stringify(key), value });
      }

      return complete ? Terms.obj(entries) : undefined;
    }

    if (ts.isArrayLiteralExpression(node)) {
      const items: Array<Term> = [];
      let complete = true;

      for (let index = 0; index < node.elements.length; index++) {
        const item = node.elements[index];

        if (item === undefined) continue;
        const value = visit(item, [...path, "items", index], enclosing);

        if (value === undefined) complete = false;
        else items.push(value);
      }

      return complete ? Terms.arr(items) : undefined;
    }

    if (ts.isConditionalExpression(node)) {
      const test = visit(node.condition, [...path, "test"], enclosing);
      const consequent = visit(node.whenTrue, [...path, "consequent"], enclosing);
      const alternate = visit(node.whenFalse, [...path, "alternate"], enclosing);

      return test === undefined || consequent === undefined || alternate === undefined
        ? undefined
        : Terms.cond(test, consequent, alternate);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken
    ) {
      const left = visit(node.left, [...path, "left"], enclosing);
      const right = visit(node.right, [...path, "right"], enclosing);

      return left === undefined || right === undefined ? undefined : Terms.strictEqual(left, right);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
    ) {
      const head = visit(node.left, [...path, "head"], enclosing);
      const tail = visit(node.right, [...path, "tail", 0], enclosing);

      return head === undefined || tail === undefined ? undefined : Terms.nullish(head, [tail]);
    }

    if (ts.isSpreadElement(node)) return reject("spread");

    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return reject("closure");

    return reject(
      ts.isTemplateExpression(node) || ts.isBinaryExpression(node)
        ? "non-literal"
        : "unsupported-syntax",
    );
  };

  const term = visit(input, []);
  const first = findings[0];

  return first === undefined && term !== undefined
    ? { _tag: "Lowered", term, range: range(input), spans }
    : {
        _tag: "Unlowered",
        range: range(input),
        findings:
          first === undefined
            ? [finding(input, "unsupported-syntax")]
            : [first, ...findings.slice(1)],
      };
};

export const missingSlot = (node: ts.Node): TermSlot => ({
  _tag: "Unlowered",
  range: range(node),
  findings: [finding(node, "unsupported-syntax")],
});

/** Decompose options per property so one unsupported value cannot erase the other causes. */
export const lowerOptions = (
  context: LiftContext,
  input: ts.Expression | undefined,
): OptionsSlot => {
  if (input === undefined) return { _tag: "Absent" };
  let node = unwrap(input);

  while (ts.isParenthesizedExpression(node)) node = unwrap(node.expression);

  if (!ts.isObjectLiteralExpression(node))
    return {
      _tag: "Unlowered",
      range: range(input),
      findings: [finding(node, "non-literal")],
    };

  const entries: Array<OptionEntry> = [];

  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      entries.push({ _tag: "Unsupported", finding: finding(property, "spread") });
      continue;
    }

    const name = propertyName(property.name);

    if (name === undefined) {
      entries.push({ _tag: "Unsupported", finding: finding(property.name, "computed-key") });

      if (ts.isPropertyAssignment(property)) {
        const value = lowerTerm(context, property.initializer);

        if (value._tag === "Unlowered")
          for (const issue of value.findings) entries.push({ _tag: "Unsupported", finding: issue });
      }

      continue;
    }

    if (ts.isPropertyAssignment(property)) {
      entries.push({
        _tag: "Property",
        name,
        value: lowerTerm(context, property.initializer),
        range: range(property),
      });
      continue;
    }

    if (ts.isShorthandPropertyAssignment(property)) {
      const symbol = context.resolver.project.checker.getShorthandAssignmentValueSymbol(property);
      const ref = symbol === undefined ? undefined : context.reference(property.name, symbol);
      const at = range(property.name);
      entries.push({
        _tag: "Property",
        name,
        range: range(property),
        value:
          ref === undefined
            ? {
                _tag: "Unlowered",
                range: at,
                findings: [finding(property.name, "local-reference")],
              }
            : {
                _tag: "Lowered",
                term: Terms.ref(ref),
                range: at,
                spans: [{ path: [], range: at }],
              },
      });
      continue;
    }

    entries.push({ _tag: "Unsupported", finding: finding(property, "unsupported-syntax") });
  }

  return { _tag: "Entries", range: range(input), entries };
};
