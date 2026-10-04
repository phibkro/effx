import { Effect, FileSystem, Path } from "effect";
import {
  CompilerFault,
  type Location,
  type WiringFacts,
  type WiringReference,
} from "@effx/compiler";
import { positionOf, ts, tryTs } from "./ts.ts";

/*
 * Spec 0021 §4: static wiring facts of a deployment program. Nothing is executed or typechecked
 * beyond TypeScript's own module resolution and alias resolution; `alchemy` need not be installed
 * (a Worker call is recognized by its import specifier). Plain data leaves this module.
 */

export interface WiringInput {
  readonly tsconfigPath: string;
  /** Absolute path of the Alchemy program or Worker module. */
  readonly entry: string;
  /** Absolute generated output directory. */
  readonly generatedDir: string;
  /** The generated files of the in-memory compile (absolute, `/`-separated); they need not exist on disk. */
  readonly overlay: ReadonlyArray<{ readonly path: string; readonly contents: string }>;
}

const ALCHEMY_SPECIFIER = "alchemy/Cloudflare";

const MAX_ROUNDS = 8;

const withinDirectory = (directory: string, file: string): boolean =>
  file.startsWith(directory.endsWith("/") ? directory : `${directory}/`);

const isInTypePosition = (node: ts.Node): boolean => {
  let child: ts.Node = node;

  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (ts.isExpressionWithTypeArguments(parent)) {
      const clause = parent.parent;

      const isClassExtends =
        ts.isHeritageClause(clause) &&
        clause.token === ts.SyntaxKind.ExtendsKeyword &&
        ts.isClassLike(clause.parent);

      // `class X extends call(...)`: the expression is code; only the type arguments are types.
      if (!isClassExtends || child !== parent.expression) return true;
    } else if (ts.isTypeNode(parent)) {
      return true;
    }

    if (ts.isSourceFile(parent)) return false;
    child = parent;
  }

  return false;
};

const isBindingSite = (node: ts.Identifier): boolean => {
  const parent = node.parent;

  return (
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isNamespaceExport(parent) ||
    ts.isImportEqualsDeclaration(parent)
  );
};

const stringLiteralText = (node: ts.Node | undefined): string | undefined =>
  node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : undefined;

interface AlchemyImports {
  readonly namespaces: ReadonlySet<string>;
  readonly workers: ReadonlySet<string>;
}

const alchemyImports = (file: ts.SourceFile): AlchemyImports => {
  const namespaces = new Set<string>();
  const workers = new Set<string>();

  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      stringLiteralText(statement.moduleSpecifier) !== ALCHEMY_SPECIFIER
    ) {
      continue;
    }

    const bindings = statement.importClause?.namedBindings;

    if (bindings === undefined) continue;

    if (ts.isNamespaceImport(bindings)) {
      namespaces.add(bindings.name.text);
    } else {
      for (const element of bindings.elements) {
        if ((element.propertyName ?? element.name).text === "Worker")
          workers.add(element.name.text);
      }
    }
  }

  return { namespaces, workers };
};

const isWorkerCallee = (expression: ts.Expression, imports: AlchemyImports): boolean =>
  (ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    imports.namespaces.has(expression.expression.text) &&
    expression.name.text === "Worker") ||
  (ts.isIdentifier(expression) && imports.workers.has(expression.text));

/** `main: "./path"` of an object-literal argument of a Worker call (the async Worker form). */
const mainLiteral = (call: ts.CallExpression): string | undefined => {
  for (const argument of call.arguments) {
    if (!ts.isObjectLiteralExpression(argument)) continue;

    for (const property of argument.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === "main"
      ) {
        return stringLiteralText(property.initializer);
      }
    }
  }

  return undefined;
};

export const analyzeWiring = Effect.fn("analyzeWiring")(function* (input: WiringInput) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const tsconfigPath = path.resolve(input.tsconfigPath);
  const tsconfigDir = path.dirname(tsconfigPath);
  const generatedDir = path.resolve(input.generatedDir).split(path.sep).join("/");
  const entry = path.resolve(input.entry).split(path.sep).join("/");
  const text = yield* fs.readFileString(tsconfigPath);

  const parsed = yield* tryTs("wiring", () => {
    const json = ts.parseConfigFileTextToJson(tsconfigPath, text);

    if (json.error !== undefined) {
      throw new Error(ts.flattenDiagnosticMessageText(json.error.messageText, "\n"));
    }

    return ts.parseJsonConfigFileContent(json.config, ts.sys, tsconfigDir);
  });

  return yield* tryTs("wiring", (): WiringFacts => {
    const options: ts.CompilerOptions = { ...parsed.options, noEmit: true };
    const virtual = new Map(input.overlay.map((file) => [file.path, file.contents] as const));
    const base = ts.createCompilerHost(options);

    // Module resolution probes directories first; an unbuilt output directory must still exist.
    const host: ts.CompilerHost = {
      ...base,
      fileExists: (name) => virtual.has(name) || base.fileExists(name),
      readFile: (name) => virtual.get(name) ?? base.readFile(name),
      directoryExists: (directory) =>
        [...virtual.keys()].some((name) => name.startsWith(`${directory.replace(/\/$/, "")}/`)) ||
        (base.directoryExists?.(directory) ?? false),
      getSourceFile: (name, languageVersionOrOptions, onError, shouldCreate) => {
        const contents = virtual.get(name);

        return contents === undefined
          ? base.getSourceFile(name, languageVersionOrOptions, onError, shouldCreate)
          : ts.createSourceFile(name, contents, languageVersionOrOptions);
      },
    };

    const roots: Array<string> = [entry];
    let program = ts.createProgram({ rootNames: roots, options, host });

    const isLocal = (file: ts.SourceFile): boolean =>
      !file.isDeclarationFile &&
      !program.isSourceFileFromExternalLibrary(file) &&
      !program.isSourceFileDefaultLibrary(file) &&
      !file.fileName.includes("/node_modules/") &&
      !withinDirectory(generatedDir, file.fileName);

    const resolveRelative = (from: string, specifier: string): string => {
      const candidate = path.resolve(path.dirname(from), specifier).split(path.sep).join("/");

      return /\.[cm]?[jt]s$/.test(candidate)
        ? candidate.replace(/\.[cm]?js$/, ".ts")
        : `${candidate}.ts`;
    };

    // A Worker's `main: "<literal>"` adds its implementation file as a root; iterate to a fixpoint.
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const added: Array<string> = [];

      for (const file of program.getSourceFiles().filter(isLocal)) {
        const imports = alchemyImports(file);

        const visit = (node: ts.Node): void => {
          if (ts.isCallExpression(node) && isWorkerCallee(node.expression, imports)) {
            const main = mainLiteral(node);

            if (main !== undefined) {
              const resolved = resolveRelative(file.fileName, main);

              if (!roots.includes(resolved) && host.fileExists(resolved)) added.push(resolved);
            }
          }

          ts.forEachChild(node, visit);
        };

        visit(file);
      }

      if (added.length === 0) break;
      roots.push(...added);
      program = ts.createProgram({ rootNames: roots, options, host });
    }

    const checker = program.getTypeChecker();
    const workers: Array<Location> = [];
    const references: Array<WiringReference> = [];
    const undecidable: Array<{ location: Location; reason: string }> = [];

    const referenceTo = (file: string, name: string, node: ts.Node): void => {
      references.push({ file, name, location: positionOf(node) });
    };

    /** Unresolved import whose path lies in the generated directory = a stale reference. */
    const staleTarget = (symbol: ts.Symbol): { file: string; name: string } | undefined => {
      const declaration = symbol.declarations?.[0];

      if (declaration === undefined) return undefined;
      const imported = ts.isImportSpecifier(declaration) ? declaration : undefined;

      const importDeclaration = imported
        ? imported.parent.parent.parent
        : ts.isNamespaceImport(declaration)
          ? declaration.parent.parent
          : undefined;

      const specifier = stringLiteralText(importDeclaration?.moduleSpecifier);

      if (specifier === undefined || !specifier.startsWith(".")) return undefined;
      const file = resolveRelative(declaration.getSourceFile().fileName, specifier);

      return withinDirectory(generatedDir, file) && !host.fileExists(file)
        ? { file, name: imported ? (imported.propertyName ?? imported.name).text : "" }
        : undefined;
    };

    for (const file of program.getSourceFiles().filter(isLocal)) {
      const imports = alchemyImports(file);

      const visit = (node: ts.Node): void => {
        if (ts.isCallExpression(node)) {
          if (isWorkerCallee(node.expression, imports)) workers.push(positionOf(node));

          if (
            node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            stringLiteralText(node.arguments[0]) === undefined
          ) {
            undecidable.push({
              location: positionOf(node),
              reason: "import() with a non-literal specifier",
            });
          }
        }

        if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression)) {
          const symbol = checker.getSymbolAtLocation(node.expression);

          const target =
            symbol !== undefined && symbol.flags & ts.SymbolFlags.Alias
              ? checker.getAliasedSymbol(symbol)
              : undefined;

          const origin = target?.declarations?.[0]?.getSourceFile().fileName;

          if (origin !== undefined && withinDirectory(generatedDir, origin)) {
            const literal = stringLiteralText(node.argumentExpression);

            if (literal === undefined) {
              undecidable.push({
                location: positionOf(node),
                reason: `computed access on the namespace import ${node.expression.text} of a generated module`,
              });
            } else {
              referenceTo(origin, literal, node);
            }
          }
        }

        if (ts.isIdentifier(node) && !isBindingSite(node) && !isInTypePosition(node)) {
          const symbol = ts.isShorthandPropertyAssignment(node.parent)
            ? checker.getShorthandAssignmentValueSymbol(node.parent)
            : checker.getSymbolAtLocation(node);

          if (symbol !== undefined) {
            const isAlias = (symbol.flags & ts.SymbolFlags.Alias) !== 0;
            const target = isAlias ? checker.getAliasedSymbol(symbol) : symbol;
            const origin = target.declarations?.[0]?.getSourceFile().fileName;

            if (origin !== undefined && withinDirectory(generatedDir, origin)) {
              // `ns.Export` makes the identifier the namespace itself; its member is the fact.
              if (!(target.flags & ts.SymbolFlags.Module)) referenceTo(origin, target.name, node);
            } else if (isAlias) {
              const stale = staleTarget(symbol);

              if (stale !== undefined && stale.name !== "")
                referenceTo(stale.file, stale.name, node);
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(file);
    }

    return { workers, references, undecidable };
  }).pipe(
    Effect.mapError(
      (fault) => new CompilerFault({ stage: "wiring", message: fault.message, cause: fault.cause }),
    ),
  );
});
