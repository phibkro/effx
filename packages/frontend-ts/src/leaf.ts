import { CoreDiagnostics, type Diagnostic } from "@effx/compiler";
import { type Resolver, origin } from "./resolve.ts";
import { positionOf, ts } from "./ts.ts";

/** An application of an extension-declared annotation, remembered to check its definition module. */
export interface AppliedUse {
  readonly name: string;
  readonly call: ts.CallExpression;
}

/** Project files a module imports or re-exports at runtime (type-only imports are erased and skipped). */
const runtimeImports = (resolver: Resolver, file: ts.SourceFile): ReadonlyArray<ts.SourceFile> => {
  const checker = resolver.project.checker;
  const out: Array<ts.SourceFile> = [];

  for (const statement of file.statements) {
    const specifier =
      ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly !== true
        ? statement.moduleSpecifier
        : ts.isExportDeclaration(statement) && statement.isTypeOnly !== true
          ? statement.moduleSpecifier
          : undefined;

    if (specifier === undefined) continue;
    const target = checker.getSymbolAtLocation(specifier)?.declarations?.[0]?.getSourceFile();

    if (target !== undefined) out.push(target);
  }

  return out;
};

const isExternal = (file: ts.SourceFile): boolean =>
  file.isDeclarationFile || file.fileName.includes("/node_modules/");

/**
 * `EFFX1306` (spec 0020 §9): a definition module is evaluated with the config, so its runtime import
 * closure must not reach an application program module, i.e. a file that declares operations or groups.
 */
export const leafViolations = (
  resolver: Resolver,
  uses: ReadonlyArray<AppliedUse>,
  declarationFiles: ReadonlySet<string>,
): ReadonlyArray<Diagnostic> => {
  const diagnostics: Array<Diagnostic> = [];
  const checked = new Set<string>();

  for (const use of uses) {
    const symbol = resolver.project.checker.getSymbolAtLocation(use.call.expression);

    const file =
      symbol === undefined ? undefined : origin(resolver, symbol)?.declaration.getSourceFile();

    if (file === undefined || checked.has(file.fileName)) continue;
    checked.add(file.fileName);

    const seen = new Set<string>();
    const stack: Array<ts.SourceFile> = [file];

    while (stack.length > 0) {
      const current = stack.pop()!;

      if (seen.has(current.fileName) || isExternal(current)) continue;
      seen.add(current.fileName);

      if (declarationFiles.has(current.fileName)) {
        diagnostics.push(
          CoreDiagnostics.EFFX1306.emit(
            {
              definitionModule: file.fileName,
              annotation: use.name,
              applicationModule: current.fileName,
            },
            { location: positionOf(use.call) },
          ),
        );
        break;
      }

      stack.push(...runtimeImports(resolver, current));
    }
  }

  return diagnostics;
};
