import {
  type HandlerRegistration,
  type NativeKind,
  type StepRecord,
  nativeName,
} from "@effx/compiler";
import { aliased, ts } from "../ts.ts";
import { httpApiKind } from "../resolve.ts";
import { LiftContext, finding, range, suffixRange, unwrap } from "./context.ts";
import { lowerTerm } from "./term.ts";

export interface DeclarationChain {
  readonly kind: Extract<NativeKind, "HttpApiEndpoint" | "HttpApiGroup" | "HttpApi">;
  readonly head: ts.CallExpression;
  readonly steps: ReadonlyArray<StepRecord>;
}

/** Match a parameter by checker identity, never by its local spelling. */
const pipeStep = (context: LiftContext, input: ts.Expression): StepRecord | undefined => {
  const node = unwrap(input);

  if (!ts.isArrowFunction(node) || node.parameters.length !== 1) return undefined;
  const parameter = node.parameters[0];

  if (parameter === undefined || !ts.isIdentifier(parameter.name)) return undefined;
  const checker = context.resolver.project.checker;
  const parameterSymbol = checker.getSymbolAtLocation(parameter.name);
  let body: ts.Expression | undefined;

  if (ts.isBlock(node.body)) {
    const statement = node.body.statements[0];

    if (
      node.body.statements.length === 1 &&
      statement !== undefined &&
      ts.isReturnStatement(statement)
    )
      body = statement.expression;
  } else body = node.body;

  if (body === undefined) return undefined;
  const call = unwrap(body);

  if (!ts.isCallExpression(call) || call.arguments.length === 0 || parameterSymbol === undefined)
    return undefined;
  const argument = call.arguments[0];

  if (
    argument === undefined ||
    !ts.isIdentifier(unwrap(argument)) ||
    checker.getSymbolAtLocation(unwrap(argument)) !== parameterSymbol
  )
    return undefined;
  let uses = 0;

  const count = (node_: ts.Node): void => {
    if (ts.isIdentifier(node_) && checker.getSymbolAtLocation(node_) === parameterSymbol) uses++;
    ts.forEachChild(node_, count);
  };

  count(call);

  if (uses !== 1) return undefined;

  return {
    _tag: "Apply",
    form: "pipe",
    callee: lowerTerm(context, call.expression),
    args: call.arguments.slice(1).map((item) => lowerTerm(context, item)),
    range: range(input),
  };
};

/** Discover the native constructor while retaining every postfix and outer application step. */
export const declarationChain = (
  context: LiftContext,
  input: ts.Expression,
): DeclarationChain | undefined => {
  const steps: Array<StepRecord> = [];

  const walk = (input_: ts.Expression): Omit<DeclarationChain, "steps"> | undefined => {
    let node = unwrap(input_);

    while (ts.isParenthesizedExpression(node)) node = unwrap(node.expression);

    if (!ts.isCallExpression(node)) return undefined;
    const native = context.native(node.expression);

    if (
      native !== undefined &&
      (native.kind === "HttpApiEndpoint" ||
        native.kind === "HttpApiGroup" ||
        native.kind === "HttpApi")
    )
      return { kind: native.kind, head: node };

    if (ts.isPropertyAccessExpression(node.expression)) {
      const head = walk(node.expression.expression);

      if (head !== undefined) {
        if (node.expression.name.text === "pipe") {
          for (const argument of node.arguments) {
            const step = pipeStep(context, argument);
            steps.push(
              step ?? {
                _tag: "Method",
                name: "pipe",
                args: [lowerTerm(context, argument)],
                range: range(argument),
              },
            );
          }

          if (node.arguments.length === 0)
            steps.push({ _tag: "Method", name: "pipe", args: [], range: suffixRange(node) });
        } else
          steps.push({
            _tag: "Method",
            name: node.expression.name.text,
            args: node.arguments.map((argument) => lowerTerm(context, argument)),
            range: suffixRange(node),
          });

        return head;
      }
    }

    const first = node.arguments[0];
    const head = first === undefined ? undefined : walk(first);

    if (head !== undefined) {
      steps.push({
        _tag: "Apply",
        form: "wrapper",
        callee: lowerTerm(context, node.expression),
        args: node.arguments.slice(1).map((argument) => lowerTerm(context, argument)),
        range: range(node),
      });

      return head;
    }

    const kind = httpApiKind(context.resolver.project.checker.getTypeAtLocation(node));

    return kind === undefined ? undefined : { kind, head: node };
  };

  const head = walk(input);

  return head === undefined ? undefined : { ...head, steps };
};

/** Bindings are read from the real callback even when it is wrapped in Effect.succeed. */
export const bindingRegistrations = (context: LiftContext, callback: ts.Expression) => {
  const node = unwrap(callback);
  const registrations: Array<HandlerRegistration> = [];

  if (
    (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) ||
    node.parameters.length !== 1
  ) {
    registrations.push({ _tag: "Unsupported", finding: finding(node, "closure") });

    return registrations;
  }

  const parameter = node.parameters[0];
  const checker = context.resolver.project.checker;

  const parameterSymbol =
    parameter === undefined ? undefined : checker.getSymbolAtLocation(parameter.name);

  const receiver = (input_: ts.Expression): ts.Symbol | undefined => {
    const expression = unwrap(input_);

    if (ts.isIdentifier(expression)) {
      const symbol = checker.getSymbolAtLocation(expression);

      return symbol === undefined ? undefined : aliased(checker, symbol);
    }

    return ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)
      ? receiver(expression.expression.expression)
      : undefined;
  };

  const visit = (node_: ts.Node): void => {
    if (
      ts.isCallExpression(node_) &&
      ts.isPropertyAccessExpression(node_.expression) &&
      parameterSymbol !== undefined &&
      receiver(node_.expression.expression) === parameterSymbol
    ) {
      const name = node_.expression.name.text;

      if (name === "handleRaw" || name === "handle") {
        const key = node_.arguments[0];
        const handler = node_.arguments[1];
        const ref = handler === undefined ? undefined : context.symbol(unwrap(handler));

        if (key === undefined || handler === undefined || node_.arguments.length !== 2)
          registrations.push({
            _tag: "Unsupported",
            finding: finding(node_, "unsupported-syntax"),
          });
        else
          registrations.push({
            _tag: "Registered",
            kind: name === "handleRaw" ? "raw" : "normal",
            key: lowerTerm(context, key),
            handler:
              ref !== undefined
                ? { _tag: "Exported", ref }
                : ts.isArrowFunction(unwrap(handler)) || ts.isFunctionExpression(unwrap(handler))
                  ? { _tag: "Inline", range: range(handler) }
                  : { _tag: "Unavailable", finding: finding(handler, "local-reference") },
            range: suffixRange(node_),
          });
      } else
        registrations.push({ _tag: "Unsupported", finding: finding(node_, "unsupported-syntax") });
    }

    ts.forEachChild(node_, visit);
  };

  visit(node.body);

  return registrations.sort(
    (left, right) =>
      (left._tag === "Registered" ? left.range : left.finding.range).start.offset -
      (right._tag === "Registered" ? right.range : right.finding.range).start.offset,
  );
};

export const isBuilderGroup = (context: LiftContext, node: ts.CallExpression): boolean => {
  const native = context.native(node.expression);

  return native?.kind === "HttpApiBuilder" && nativeName(native) === "group";
};
