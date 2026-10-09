import { Predicate } from "effect";
import {
  type BindingRecord,
  type EffectModel,
  type EndpointRecord,
  type GroupRecord,
  type ImportBinding,
  type RootRecord,
  type SourceFileRecord,
  type StepRecord,
  type TargetProfile,
  type ValueRecord,
  type WrapperFact,
  nativeName,
  symbolRefOf,
} from "@effx/compiler";
import { exportedSymbol, origin, type Resolver } from "../resolve.ts";
import { ts } from "../ts.ts";
import { LiftContext, finding, position, range, unwrap } from "./context.ts";
import { bindingRegistrations, declarationChain, isBuilderGroup } from "./declarations.ts";
import { lowerOptions, lowerTerm, missingSlot } from "./term.ts";

export interface ModelDraft {
  readonly context: LiftContext;
  readonly sources: ReadonlyArray<ts.SourceFile>;
  readonly files: ReadonlyArray<Omit<SourceFileRecord, "sha256">>;
  readonly endpoints: ReadonlyArray<EndpointRecord>;
  readonly groups: ReadonlyArray<GroupRecord>;
  readonly roots: ReadonlyArray<RootRecord>;
  readonly values: ReadonlyArray<ValueRecord>;
  readonly wrappers: ReadonlyArray<WrapperFact>;
  readonly bindings: ReadonlyArray<BindingRecord>;
}

/** Hashing happens outside this deterministic checker-to-data projection. */
export const modelDraft = (resolver: Resolver, target: TargetProfile): ModelDraft => {
  const context = new LiftContext(resolver, target);
  const checker = resolver.project.checker;

  const sources = resolver.project.program
    .getSourceFiles()
    .filter(
      (file) =>
        !file.isDeclarationFile &&
        !resolver.project.program.isSourceFileFromExternalLibrary(file) &&
        !file.fileName.includes("/node_modules/"),
    );

  const files: Array<Omit<SourceFileRecord, "sha256">> = [];
  const endpoints: Array<EndpointRecord> = [];
  const groups: Array<GroupRecord> = [];
  const roots: Array<RootRecord> = [];
  const values: Array<ValueRecord> = [];
  const wrappers: Array<WrapperFact> = [];
  const bindings: Array<BindingRecord> = [];

  const wrapper = (declaration: ts.FunctionDeclaration | ts.VariableDeclaration): void => {
    const name = declaration.name;

    if (name === undefined || !ts.isIdentifier(name)) return;
    const helper = context.symbol(name);
    const body = ts.isFunctionDeclaration(declaration) ? declaration.body : declaration.initializer;

    if (helper === undefined || body === undefined) return;

    if (
      checker.getSignaturesOfType(checker.getTypeAtLocation(name), ts.SignatureKind.Call).length ===
      0
    )
      return;
    const headerExpressions: Array<ts.Expression> = [];

    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const native = context.native(node.expression);
        const header = node.arguments[1];

        if (
          native?.kind === "HttpApiSchema" &&
          nativeName(native) === "WithHeaders" &&
          header !== undefined
        )
          headerExpressions.push(header);
      }

      ts.forEachChild(node, visit);
    };

    visit(body);

    if (headerExpressions.length === 0) {
      wrappers.push({
        helper,
        range: range(
          ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration,
        ),
        headers: { _tag: "Unknown" },
      });

      return;
    }

    const first = headerExpressions[0];

    if (first === undefined) return;
    const ref = context.reference(first);
    let headers: WrapperFact["headers"] = { _tag: "Unknown" };

    if (
      ref !== undefined &&
      "symbolId" in ref &&
      headerExpressions.every((node) => {
        const other = context.reference(node);

        return other !== undefined && "symbolId" in other && other.symbolId === ref.symbolId;
      })
    )
      headers = { _tag: "Named", ref };
    else if (headerExpressions.length === 1) {
      let expression = first;
      const symbol = checker.getSymbolAtLocation(unwrap(first));
      const found = symbol === undefined ? undefined : origin(resolver, symbol);

      if (
        found !== undefined &&
        ts.isVariableDeclaration(found.declaration) &&
        found.declaration.initializer !== undefined &&
        (found.declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
        exportedSymbol(resolver, found.symbol) === undefined
      )
        expression = found.declaration.initializer;
      headers = { _tag: "Inline", expression: lowerTerm(context, expression) };
    }

    wrappers.push({
      helper,
      range: range(ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration),
      headers,
    });
  };

  for (const file of sources) {
    const moduleSymbol = checker.getSymbolAtLocation(file);

    const exports =
      moduleSymbol === undefined
        ? []
        : checker.getExportsOfModule(moduleSymbol).map((symbol) => symbol.name);

    const topLevel: Array<string> = [];
    const imports: Array<ImportBinding> = [];
    let importsEnd = 0;

    const importBinding = (name: ts.Identifier): void => {
      const ref = context.reference(name);

      if (ref !== undefined) imports.push({ local: name.text, ref: symbolRefOf(ref) });
    };

    for (const statement of file.statements) {
      if (ts.isImportDeclaration(statement)) {
        importsEnd = statement.end;
        const clause = statement.importClause;

        if (clause?.name !== undefined) importBinding(clause.name);

        if (clause?.namedBindings !== undefined) {
          if (ts.isNamespaceImport(clause.namedBindings)) importBinding(clause.namedBindings.name);
          else for (const element of clause.namedBindings.elements) importBinding(element.name);
        }
      }

      if (
        (ts.isClassDeclaration(statement) || ts.isFunctionDeclaration(statement)) &&
        statement.name !== undefined
      )
        topLevel.push(statement.name.text);

      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name)) topLevel.push(declaration.name.text);
        }
    }

    files.push({
      file: file.fileName,
      module: resolver.moduleOf(file.fileName),
      idPath: resolver.idPathOf(file.fileName),
      exports,
      topLevel,
      imports,
      importsEnd: position(file, importsEnd),
    });

    const record = (declaration: ts.VariableDeclaration | ts.ClassDeclaration): void => {
      if (declaration.name === undefined || !ts.isIdentifier(declaration.name)) return;
      const symbol = context.symbol(declaration.name);

      if (symbol === undefined) return;
      context.reference(declaration.name);
      let expression: ts.Expression | undefined;
      const form = ts.isClassDeclaration(declaration) ? "class" : "const";

      const at = range(
        ts.isClassDeclaration(declaration) ? declaration : declaration.parent.parent,
      );

      if (ts.isClassDeclaration(declaration))
        expression = declaration.heritageClauses?.find(
          (clause) => clause.token === ts.SyntaxKind.ExtendsKeyword,
        )?.types[0]?.expression;
      else expression = declaration.initializer;

      if (expression === undefined) return;
      const chain = declarationChain(context, expression);

      if (chain !== undefined) {
        const head = chain.head;
        const callee = lowerTerm(context, head.expression);
        const first = head.arguments[0];
        const firstSlot = first === undefined ? missingSlot(head) : lowerTerm(context, first);
        const arity = chain.kind === "HttpApiEndpoint" ? 3 : chain.kind === "HttpApiGroup" ? 2 : 1;
        const steps: Array<StepRecord> = [...chain.steps];

        for (const extra of head.arguments.slice(arity))
          steps.push({ _tag: "Unsupported", finding: finding(extra, "unsupported-syntax") });

        if (chain.kind === "HttpApiEndpoint") {
          const path = head.arguments[1];
          endpoints.push({
            symbol,
            range: at,
            callee,
            key: firstSlot,
            path: path === undefined ? missingSlot(head) : lowerTerm(context, path),
            options: lowerOptions(context, head.arguments[2]),
            steps,
          });
        } else if (chain.kind === "HttpApiGroup")
          groups.push({
            symbol,
            form,
            range: at,
            callee,
            id: firstSlot,
            options: lowerOptions(context, head.arguments[1]),
            steps,
          });
        else roots.push({ symbol, form, range: at, callee, id: firstSlot, steps });
      } else if (
        ts.isVariableDeclaration(declaration) &&
        (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
        !ts.isArrowFunction(unwrap(expression)) &&
        !ts.isFunctionExpression(unwrap(expression))
      ) {
        const init = lowerTerm(context, expression);

        const items =
          init._tag === "Lowered" && init.term._tag === "Arr" ? init.term.items : undefined;

        const strings =
          items !== undefined &&
          items.every((item) => item._tag === "Lit" && Predicate.isString(item.json));

        const type = checker.getTypeAtLocation(expression);
        let readonlyTuple = false;

        if (strings && items !== undefined && checker.isTupleType(type)) {
          // SAFETY: isTupleType establishes the tuple TypeReference. The initializer supplies the values; its readonly tuple type only cross-checks them.
          const tuple = type as ts.TupleTypeReference;
          const types = checker.getTypeArguments(tuple);
          readonlyTuple =
            tuple.target.readonly &&
            types.length === items.length &&
            types.every((type, index) => {
              const item = items[index];

              return type.isStringLiteral() && item?._tag === "Lit" && type.value === item.json;
            });
        }

        values.push({
          symbol,
          range: at,
          init:
            strings && !readonlyTuple
              ? {
                  _tag: "Unlowered",
                  range: range(expression),
                  findings: [finding(expression, "non-literal")],
                }
              : init,
        });
      }
    };

    for (const statement of file.statements) {
      if (ts.isVariableStatement(statement))
        for (const declaration of statement.declarationList.declarations) {
          record(declaration);
          wrapper(declaration);
        }
      else if (ts.isClassDeclaration(statement)) record(statement);
      else if (ts.isFunctionDeclaration(statement)) wrapper(statement);
    }

    const visitBindings = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && isBuilderGroup(context, node)) {
        const root = node.arguments[0];
        const group = node.arguments[1];
        const callback = node.arguments[2];

        bindings.push({
          range: range(node),
          root: root === undefined ? missingSlot(node) : lowerTerm(context, root),
          group: group === undefined ? missingSlot(node) : lowerTerm(context, group),
          registrations:
            callback === undefined
              ? [
                  {
                    _tag: "Unsupported",
                    finding: { kind: "closure", construct: node.getText(), range: range(node) },
                  },
                ]
              : bindingRegistrations(context, callback),
          // Application authorization identities are not part of ProjectConfig. Never guess a callee by name.
          authorizeCalls: [],
        });
      }

      ts.forEachChild(node, visitBindings);
    };

    visitBindings(file);
  }

  return { context, sources, files, endpoints, groups, roots, values, wrappers, bindings };
};

export const finishModel = (
  draft: ModelDraft,
  files: ReadonlyArray<SourceFileRecord>,
): EffectModel => ({
  target: draft.context.target,
  files,
  natives: [...draft.context.natives.values()],
  schemas: [...draft.context.schemas.values()],
  markers: [...draft.context.markers.values()],
  endpoints: draft.endpoints,
  groups: draft.groups,
  roots: draft.roots,
  values: draft.values,
  wrappers: draft.wrappers,
  bindings: draft.bindings,
});
