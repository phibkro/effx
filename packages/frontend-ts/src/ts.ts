/**
 * The only module that imports the TypeScript 6 compiler API (ADR 0009). Everything else in
 * this package receives `ts` values through these helpers and never lets them escape `analyze`.
 */
import ts from "@typescript/typescript6";
import { Effect, Predicate } from "effect";
import { CompilerFault } from "@effx/compiler";

export { ts };

type MatchFiles = (
  path: string,
  extensions: readonly string[] | undefined,
  excludes: readonly string[] | undefined,
  includes: readonly string[] | undefined,
  useCaseSensitiveFileNames: boolean,
  currentDirectory: string,
  depth: number | undefined,
  getFileSystemEntries: (path: string) => {
    readonly files: readonly string[];
    readonly directories: readonly string[];
  },
  realpath: (path: string) => string,
) => string[];

/**
 * EX-0032: installed TS 6.0.3 exports matchFiles but omits it from its public declarations.
 * lib/typescript.js:8612 uses this exact ABI for sys.readDirectory; :22513-22559
 * implements the native include/exclude, depth and canonical visited-path rules.
 * This assertion describes that single ABI, not input decoding or Effect channels.
 * Retire when TS exposes a typed matcher or a public snapshot enumeration host.
 */
export const matchFiles = (...args: Parameters<MatchFiles>): string[] => {
  if (!Predicate.hasProperty(ts, "matchFiles") || !Predicate.isFunction(ts.matchFiles))
    throw new Error("TypeScript matchFiles ABI is unavailable");

  // SAFETY: EX-0032 pins this guarded runtime function to TS 6.0.3 sys.readDirectory
  // and its installed matchFiles implementation; only the omitted ABI is asserted.
  return (ts.matchFiles as MatchFiles)(...args);
};

/** Runs a synchronous compiler-API thunk, turning any throw into a `CompilerFault`. */
export const tryTs = <A>(stage: string, thunk: () => A): Effect.Effect<A, CompilerFault> =>
  Effect.try({
    try: thunk,
    catch: (cause) =>
      new CompilerFault({
        stage,
        message: `TypeScript ${ts.version} compiler API threw: ${cause instanceof Error ? cause.message : String(cause)}`,
        cause,
      }),
  });

export const typeHasProperty = (type: ts.Type, name: string): boolean =>
  type.getProperty(name) !== undefined;

/** Property names Effect stamps on its values; the frontend detects by shape, never by symbol name. */
export const SCHEMA_TYPE_ID = "~effect/Schema/Schema";

export const SERVICE_TYPE_ID = "~effect/Context/Service";

export const KEY_TYPE_ID = "~effect/Context/Key";

/** The brand `Http.headers(schema)` stamps on a Schema's static type (spec 0024 §2.2); detected by shape. */
export const HEADERS_TYPE_ID = "~effx/Http/Headers";

export const aliased = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol =>
  symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;

export const declarationOf = (symbol: ts.Symbol): ts.Declaration | undefined =>
  symbol.valueDeclaration ?? symbol.declarations?.[0];

const hasExportModifier = (node: ts.Node): boolean =>
  ts.canHaveModifiers(node) &&
  (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

export const isExported = (declaration: ts.Declaration): boolean => {
  if (hasExportModifier(declaration)) return true;
  // `export const a = …` puts the modifier on the VariableStatement, not the declarator.
  const statement = declaration.parent?.parent;

  return (
    ts.isVariableDeclaration(declaration) && statement !== undefined && hasExportModifier(statement)
  );
};

export interface Position {
  readonly file: string;
  readonly line: number;
  readonly col: number;
}

export const positionOf = (node: ts.Node): Position => {
  const file = node.getSourceFile();
  const { line, character } = file.getLineAndCharacterOfPosition(node.getStart(file));

  return { file: file.fileName, line: line + 1, col: character + 1 };
};
