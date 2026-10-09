import type { ImportBinding, SourceImport } from "@effx/compiler";
import { symbolRefOf } from "@effx/compiler";
import { ts } from "../ts.ts";
import { type LiftContext, position, range } from "./context.ts";

const importKind = (node: ts.ImportDeclaration | ts.ExportDeclaration): "type" | "value" => {
  if (ts.isExportDeclaration(node)) {
    if (node.isTypeOnly) return "type";
    const clause = node.exportClause;

    return clause !== undefined &&
      ts.isNamedExports(clause) &&
      clause.elements.length > 0 &&
      clause.elements.every((element) => element.isTypeOnly)
      ? "type"
      : "value";
  }

  const clause = node.importClause;

  if (clause?.phaseModifier === ts.SyntaxKind.TypeKeyword) return "type";
  const bindings = clause?.namedBindings;

  return clause?.name === undefined &&
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
    ? "type"
    : "value";
};

/**
 * One analyzed file's module edges, exact end, and import insertion point.
 *
 * A static specifier resolves through the checker's own module symbol first. TypeScript's resolver is the
 * fallback for a module the program did not load, so Core can still name a known leaf or fail closed.
 * Dynamic imports are never resolved: they stay explicit unresolved edges. `importsEnd` follows every
 * edge to the end of its top-level statement, never into the middle of a statement.
 */
export const sourceImports = (context: LiftContext, file: ts.SourceFile) => {
  const { program, checker } = context.resolver.project;
  const imports: Array<SourceImport> = [];
  let importsEnd = 0;
  let statementEnd = 0;

  const binding = (name: ts.Identifier | ts.StringLiteral, output: Array<ImportBinding>): void => {
    const ref = context.reference(name);

    if (ref !== undefined) output.push({ local: name.text, ref: symbolRefOf(ref) });
  };

  const resolvedFile = (specifier: ts.StringLiteralLike): string | undefined =>
    checker.getSymbolAtLocation(specifier)?.declarations?.find(ts.isSourceFile)?.fileName ??
    ts.resolveModuleName(
      specifier.text,
      file.fileName,
      program.getCompilerOptions(),
      ts.sys,
      undefined,
      undefined,
      program.getModeForUsageLocation(file, specifier),
    ).resolvedModule?.resolvedFileName;

  const edge = (
    node: ts.Node,
    specifier: ts.Expression,
    kind: "type" | "value",
    bindings: Array<ImportBinding>,
  ): void => {
    const target = ts.isStringLiteralLike(specifier) ? resolvedFile(specifier) : undefined;
    const text = ts.isStringLiteralLike(specifier) ? specifier.text : specifier.getText(file);

    imports.push(
      target === undefined
        ? { _tag: "Unresolved", specifier: text, kind, range: range(node), bindings }
        : {
            _tag: "Resolved",
            specifier: text,
            module: context.resolver.moduleOf(target),
            kind,
            range: range(node),
            bindings,
          },
    );
    importsEnd = node.end;
  };

  const visitDynamic = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];

      imports.push({
        _tag: "Unresolved",
        specifier:
          argument !== undefined && ts.isStringLiteralLike(argument)
            ? argument.text
            : (argument?.getText(file) ?? node.getText(file)),
        kind: "dynamic",
        range: range(node),
        bindings: [],
      });
      importsEnd = Math.max(importsEnd, statementEnd);
    }

    ts.forEachChild(node, visitDynamic);
  };

  for (const statement of file.statements) {
    statementEnd = statement.end;

    if (ts.isImportDeclaration(statement)) {
      const bindings: Array<ImportBinding> = [];
      const clause = statement.importClause;

      if (clause?.name !== undefined) binding(clause.name, bindings);

      if (clause?.namedBindings !== undefined) {
        if (ts.isNamespaceImport(clause.namedBindings))
          binding(clause.namedBindings.name, bindings);
        else for (const element of clause.namedBindings.elements) binding(element.name, bindings);
      }

      edge(statement, statement.moduleSpecifier, importKind(statement), bindings);
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier !== undefined) {
      const bindings: Array<ImportBinding> = [];

      if (statement.exportClause !== undefined && ts.isNamedExports(statement.exportClause))
        for (const element of statement.exportClause.elements) binding(element.name, bindings);

      edge(statement, statement.moduleSpecifier, importKind(statement), bindings);
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      const bindings: Array<ImportBinding> = [];

      binding(statement.name, bindings);
      edge(
        statement,
        statement.moduleReference.expression,
        statement.isTypeOnly ? "type" : "value",
        bindings,
      );
    }

    ts.forEachChild(statement, visitDynamic);
  }

  return { imports, importsEnd: position(file, importsEnd), end: position(file, file.end) };
};
