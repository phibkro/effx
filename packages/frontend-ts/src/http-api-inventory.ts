import type { HttpApiGroupInventory } from "@effx/compiler";
import type { SymbolRef } from "@effx/ir";
import { ts } from "./ts.ts";

/** A finite map must not conceal additional keys or a choice of shapes. */
const closed = (checker: ts.TypeChecker, type: ts.Type): boolean =>
  (type.flags &
    (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)) ===
    0 &&
  !type.isUnion() &&
  (type.flags & (ts.TypeFlags.Object | ts.TypeFlags.Intersection)) !== 0 &&
  checker.getIndexInfosOfType(type).length === 0;

const required = (symbol: ts.Symbol): boolean =>
  (symbol.flags & ts.SymbolFlags.Optional) === 0 && !symbol.getName().startsWith("__@");

const property = (
  checker: ts.TypeChecker,
  type: ts.Type,
  name: string,
  node: ts.Node,
): ts.Type | undefined => {
  const symbol = type.getProperty(name);

  return symbol === undefined || !required(symbol)
    ? undefined
    : checker.getTypeOfSymbolAtLocation(symbol, node);
};

const identifierMatches = (
  checker: ts.TypeChecker,
  type: ts.Type,
  key: string,
  node: ts.Node,
): boolean => {
  const id = property(checker, type, "identifier", node);

  return id !== undefined && id.isStringLiteral() && id.value === key;
};

/** Reads only checker types. No application expression is evaluated, and partial inventories never escape. */
export const httpApiInventory = (
  checker: ts.TypeChecker,
  type: ts.Type,
  root: SymbolRef,
  node: ts.Node,
): ReadonlyArray<HttpApiGroupInventory> | undefined => {
  if (!closed(checker, type)) return undefined;
  const groups = property(checker, type, "groups", node);

  if (groups === undefined || !closed(checker, groups)) return undefined;
  const result: Array<HttpApiGroupInventory> = [];

  for (const group of groups.getProperties()) {
    if (!required(group)) return undefined;
    const groupType = checker.getTypeOfSymbolAtLocation(group, node);
    const name = group.getName();

    if (
      !closed(checker, groupType) ||
      (groupType.getProperty("~effect/http-api/HttpApiGroup") === undefined &&
        groupType.getProperty("~effect/httpapi/HttpApiGroup") === undefined) ||
      !identifierMatches(checker, groupType, name, node)
    )
      return undefined;
    const endpoints = property(checker, groupType, "endpoints", node);

    if (endpoints === undefined || !closed(checker, endpoints)) return undefined;
    const keys: Array<string> = [];

    for (const endpoint of endpoints.getProperties()) {
      if (!required(endpoint)) return undefined;
      const endpointType = checker.getTypeOfSymbolAtLocation(endpoint, node);
      const key = endpoint.getName();

      if (
        !closed(checker, endpointType) ||
        (endpointType.getProperty("~effect/http-api/HttpApiEndpoint") === undefined &&
          endpointType.getProperty("~effect/httpapi/HttpApiEndpoint") === undefined) ||
        !identifierMatches(checker, endpointType, key, node)
      )
        return undefined;
      keys.push(key);
    }

    result.push({ root, group: name, endpoints: keys.toSorted() });
  }

  return result.toSorted((a, b) => a.group.localeCompare(b.group));
};
