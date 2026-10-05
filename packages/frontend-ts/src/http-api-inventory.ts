import {
  type Collected,
  type HttpApiGroupInventory,
  StageResult,
  HttpDiagnostics,
} from "@effx/compiler";
import type { SymbolRef } from "@effx/ir";
import type { Project } from "./project.ts";
import { positionOf, ts, tryTs } from "./ts.ts";

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
): ReadonlyArray<HttpApiGroupInventory> | { readonly failure: string } => {
  if (!closed(checker, type)) return { failure: "root must be a finite closed required shape" };
  const groups = property(checker, type, "groups", node);

  if (groups === undefined || !closed(checker, groups))
    return { failure: "root.groups must be a finite required map" };
  const result: Array<HttpApiGroupInventory> = [];

  for (const group of groups.getProperties()) {
    if (!required(group)) return { failure: `groups.${group.getName()} must be required` };
    const groupType = checker.getTypeOfSymbolAtLocation(group, node);
    const name = group.getName();

    if (
      !closed(checker, groupType) ||
      (groupType.getProperty("~effect/http-api/HttpApiGroup") === undefined &&
        groupType.getProperty("~effect/httpapi/HttpApiGroup") === undefined) ||
      !identifierMatches(checker, groupType, name, node)
    )
      return {
        failure: `groups.${name} must be a closed branded HttpApiGroup with matching literal identifier`,
      };
    const endpoints = property(checker, groupType, "endpoints", node);

    if (endpoints === undefined || !closed(checker, endpoints))
      return { failure: `groups.${name}.endpoints must be a finite required map` };
    const keys: Array<string> = [];

    for (const endpoint of endpoints.getProperties()) {
      if (!required(endpoint))
        return { failure: `groups.${name}.endpoints.${endpoint.getName()} must be required` };
      const endpointType = checker.getTypeOfSymbolAtLocation(endpoint, node);
      const key = endpoint.getName();

      if (
        !closed(checker, endpointType) ||
        (endpointType.getProperty("~effect/http-api/HttpApiEndpoint") === undefined &&
          endpointType.getProperty("~effect/httpapi/HttpApiEndpoint") === undefined) ||
        !identifierMatches(checker, endpointType, key, node)
      )
        return {
          failure: `groups.${name}.endpoints.${key} must be a closed branded HttpApiEndpoint with matching literal identifier`,
        };
      keys.push(key);
    }

    result.push({ root, group: name, endpoints: keys.toSorted() });
  }

  return result.toSorted((a, b) => a.group.localeCompare(b.group));
};

export interface HttpApiRootCandidate {
  readonly type: ts.Type;
  readonly declaration: ts.Declaration;
}

export const httpApiRootKey = (root: SymbolRef): string =>
  `${root.module.length}:${root.module}${root.export.length}:${root.export}${root.member ?? ""}`;

/** The Program owns checker state. Building/discarding a resolver does no checker work. */
export const makeHttpApiInventoryResolver =
  (
    project: Project,
    roots: ReadonlyMap<string, HttpApiRootCandidate>,
  ): NonNullable<Collected["resolveHttpApiInventory"]> =>
  (root) =>
    tryTs("http-api-inventory", (): StageResult<ReadonlyArray<HttpApiGroupInventory>> => {
      const candidate = roots.get(httpApiRootKey(root));

      if (candidate === undefined)
        return StageResult.skip([
          HttpDiagnostics.EFFX2415.emit({ _tag: "NoCandidate", root: root.export }),
        ]);
      const proof = httpApiInventory(project.checker, candidate.type, root, candidate.declaration);

      if (!("failure" in proof)) return StageResult.succeed(proof);
      const unresolved = unresolvedImports(project, candidate.declaration);

      return StageResult.skip([
        HttpDiagnostics.EFFX2415.emit(
          {
            _tag: "UnprovenRoot",
            root: root.export,
            inventoryIssue: unresolved.length > 0 ? unresolved.join("; ") : proof.failure,
          },
          { location: positionOf(candidate.declaration) },
        ),
      ]);
    });

/** Follow only source dependencies of the authored root; unrelated missing imports are not evidence. */
const unresolvedImports = (project: Project, root: ts.Declaration): ReadonlyArray<string> => {
  const visited = new Set<ts.Node>();
  const failures = new Set<string>();
  const diagnostics = new Map<ts.SourceFile, ReadonlyArray<ts.Diagnostic>>();

  const visit = (node: ts.Node): void => {
    if (visited.has(node)) return;
    visited.add(node);

    if (ts.isIdentifier(node)) {
      const symbol = project.checker.getSymbolAtLocation(node);

      if (symbol === undefined) return;

      for (const declaration of symbol?.declarations ?? []) {
        let owner: ts.Node = declaration;

        while (!ts.isSourceFile(owner) && !ts.isImportDeclaration(owner)) owner = owner.parent;

        if (ts.isImportDeclaration(owner)) {
          const module = owner.moduleSpecifier;
          const source = owner.getSourceFile();
          let sourceDiagnostics = diagnostics.get(source);

          if (sourceDiagnostics === undefined) {
            sourceDiagnostics = project.program.getSemanticDiagnostics(source);
            diagnostics.set(source, sourceDiagnostics);
          }

          const missing = sourceDiagnostics.some(
            (diagnostic) =>
              diagnostic.code === 2307 &&
              diagnostic.start !== undefined &&
              diagnostic.start >= module.getStart(source) &&
              diagnostic.start < module.end,
          );

          if (missing)
            failures.add(`unresolved import ${node.text} from ${module.getText(source)}`);
          else if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
            const target = project.checker.getAliasedSymbol(symbol);

            for (const nested of target.declarations ?? [])
              if (
                !nested.getSourceFile().isDeclarationFile &&
                !nested.getSourceFile().fileName.includes("/node_modules/")
              )
                visit(nested);
          }
        } else if (
          !declaration.getSourceFile().isDeclarationFile &&
          !declaration.getSourceFile().fileName.includes("/node_modules/")
        )
          visit(declaration);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(root);

  return [...failures].toSorted();
};
