import type { DefinitionRecord } from "@effx/compiler";
import type { SymbolRef } from "@effx/ir";
import { DefinitionTypeId } from "@effx/runtime";
import { type Resolver, exportedSymbol, origin } from "../resolve.ts";
import { KEY_TYPE_ID, SERVICE_TYPE_ID, ts, typeHasProperty } from "../ts.ts";
import { propertyName, unwrap } from "./context.ts";

type KeyFact = NonNullable<DefinitionRecord["key"]>;

const transparent = (input: ts.Expression): ts.Expression => {
  let node = unwrap(input);

  while (ts.isParenthesizedExpression(node)) node = unwrap(node.expression);

  return node;
};

/** A direct field of a closed source object, never an evaluated property or a spread. */
const sourceField = (input: ts.Expression, name: string): ts.Expression | undefined => {
  const node = transparent(input);

  if (!ts.isObjectLiteralExpression(node)) return undefined;

  for (const property of node.properties) {
    if (
      ts.isSpreadAssignment(property) ||
      (property.name !== undefined && ts.isComputedPropertyName(property.name))
    )
      return undefined;
  }

  const property = node.properties.find(
    (property) => property.name !== undefined && propertyName(property.name) === name,
  );

  return property !== undefined && ts.isPropertyAssignment(property)
    ? property.initializer
    : undefined;
};

const effectKeyExpression = (declaration: ts.Declaration): ts.Expression | undefined => {
  if (
    !ts.isVariableDeclaration(declaration) ||
    declaration.initializer === undefined ||
    (declaration.parent.flags & ts.NodeFlags.Const) === 0
  )
    return undefined;

  const init = transparent(declaration.initializer);
  const options = ts.isCallExpression(init) ? init.arguments[0] : undefined;
  const effect = options === undefined ? undefined : sourceField(options, "effect");

  return effect === undefined ? undefined : sourceField(effect, "key");
};

/** Follow exact initializer references and nominal Definition.effect.key fields, never application calls. */
export const contextKey = (resolver: Resolver, input: ts.Expression): KeyFact | undefined => {
  const checker = resolver.project.checker;
  const active = new Set<ts.Symbol>();

  const walk = (input_: ts.Expression): KeyFact | undefined => {
    const node = transparent(input_);
    const type = checker.getTypeAtLocation(node);

    if (!typeHasProperty(type, KEY_TYPE_ID) && !typeHasProperty(type, SERVICE_TYPE_ID))
      return undefined;

    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === "key" &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "effect" &&
      typeHasProperty(checker.getTypeAtLocation(node.expression.expression), DefinitionTypeId)
    ) {
      const selected = checker.getSymbolAtLocation(node.expression.expression);
      const definition = selected === undefined ? undefined : origin(resolver, selected);

      if (definition === undefined || active.has(definition.symbol)) return undefined;
      const key = effectKeyExpression(definition.declaration);

      if (key === undefined) return undefined;
      active.add(definition.symbol);
      const result = walk(key);
      active.delete(definition.symbol);

      return result;
    }

    const selected = checker.getSymbolAtLocation(node);
    const found = selected === undefined ? undefined : origin(resolver, selected);
    const exported = selected === undefined ? undefined : exportedSymbol(resolver, selected);

    if (exported === undefined) return undefined;
    const member = type.getProperty("key");
    const id = member === undefined ? undefined : checker.getTypeOfSymbolAtLocation(member, node);

    if (id?.isStringLiteral()) return { ref: exported.ref, id: id.value };

    if (
      found === undefined ||
      active.has(found.symbol) ||
      !ts.isVariableDeclaration(found.declaration) ||
      found.declaration.initializer === undefined ||
      (found.declaration.parent.flags & ts.NodeFlags.Const) === 0
    )
      return undefined;

    active.add(found.symbol);
    const init = transparent(found.declaration.initializer);
    let result: KeyFact | undefined;

    if (ts.isIdentifier(init) || ts.isPropertyAccessExpression(init)) result = walk(init);
    else if (ts.isCallExpression(init)) {
      const argument = init.arguments[0];
      let callee = transparent(init.expression);

      if (ts.isCallExpression(callee) && callee.arguments.length === 0)
        callee = transparent(callee.expression);
      const symbol = checker.getSymbolAtLocation(callee);
      const native = symbol === undefined ? undefined : origin(resolver, symbol);
      const module = native === undefined ? undefined : resolver.moduleOf(native.file);
      const value = argument === undefined ? undefined : transparent(argument);

      if (
        native !== undefined &&
        module === "effect/Context" &&
        resolver.project.resolveEffectModule?.(module) === true &&
        (native.symbol.name === "Service" || native.symbol.name === "Reference") &&
        value !== undefined &&
        (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value))
      )
        result = { ref: exported.ref, id: value.text };
    }

    active.delete(found.symbol);

    return result;
  };

  return walk(input);
};

/** Static nominal brand and source-declared effect key; callbacks and runtime descriptor values stay outside the model. */
export const definitionRecord = (
  resolver: Resolver,
  declaration: ts.VariableDeclaration,
  ref: SymbolRef,
): DefinitionRecord | undefined => {
  const checker = resolver.project.checker;
  const type = checker.getTypeAtLocation(declaration.name);
  const brand = type.getProperty(DefinitionTypeId);

  if (brand === undefined) return undefined;
  const identity = checker.getTypeOfSymbolAtLocation(brand, declaration.name);
  const property = identity.getProperty("name");

  const name =
    property === undefined
      ? undefined
      : checker.getTypeOfSymbolAtLocation(property, declaration.name);

  if (name === undefined || !name.isStringLiteral()) return undefined;
  const expression = effectKeyExpression(declaration);
  const key = expression === undefined ? undefined : contextKey(resolver, expression);

  return key === undefined ? { ref, name: name.value } : { ref, name: name.value, key };
};
