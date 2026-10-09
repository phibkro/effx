import type { Path } from "effect";
import { type SchemaRef, StableId, type SymbolRef } from "@effx/ir";
import type { DefinitionEntry, SpreadSource } from "@effx/compiler";
import type { HttpApiRootCandidate } from "./http-api-inventory.ts";
import type { AppliedUse } from "./leaf.ts";
import type { Project } from "./project.ts";
import {
  HEADERS_TYPE_ID,
  KEY_TYPE_ID,
  SCHEMA_TYPE_ID,
  SERVICE_TYPE_ID,
  aliased,
  declarationOf,
  ts,
  typeHasProperty,
} from "./ts.ts";

export interface Resolver {
  readonly project: Project;
  /** Local import as seen from <projectRoot>/.effx/generated, independent of the chosen outDir. */
  readonly moduleOf: (file: string) => string;
  /** StableId identity path relative to the source projectRoot, independent of emission. */
  readonly idPathOf: (file: string) => string;
  /** Extension-declared definitions by annotation name (spec 0020); built-ins are always known. */
  readonly definitions?: ReadonlyMap<string, DefinitionEntry>;
  /** Applications of extension-declared annotations seen while collecting (spec 0020 EFFX1306). */
  readonly appliedUses?: Array<AppliedUse>;
  readonly spreads?: Array<SpreadSource>;
  readonly httpApiRoots?: Map<string, HttpApiRootCandidate>;
}

const stripExtension = (file: string): string => file.replace(/(\.d)?\.[cm]?[jt]sx?$/, "");

const packageSpecifier = (file: string): string | undefined => {
  const marker = file.lastIndexOf("/node_modules/");

  return marker < 0
    ? undefined
    : stripExtension(file.slice(marker + "/node_modules/".length)).replace(/\/dist\//, "/");
};

/** The forward and lift frontends share canonical imports and StableId paths. */
export const makeResolver = (project: Project, path: Path.Path): Resolver => {
  const posix = (relative: string): string => stripExtension(relative).split(path.sep).join("/");

  return {
    project,
    moduleOf: (file) => {
      const external = packageSpecifier(file);

      if (external !== undefined) return external;
      const relative = posix(path.relative(path.join(project.rootDir, ".effx", "generated"), file));

      return relative.startsWith(".") ? relative : `./${relative}`;
    },
    idPathOf: (file) => {
      const external = packageSpecifier(file);

      if (external !== undefined) return external;
      const relative = posix(path.relative(project.rootDir, file));

      return relative.startsWith(".") ? relative.replace(/^(\.\.?\/)+/, "") : relative;
    },
  };
};

/** Real declaring-module exports, including `const X; export { X as Public }`. */
const exportName = (
  resolver: Resolver,
  symbol: ts.Symbol,
  declaration: ts.Declaration,
): string | undefined => {
  const checker = resolver.project.checker;
  const module = checker.getSymbolAtLocation(declaration.getSourceFile());

  if (module === undefined) return undefined;
  const exports = checker.getExportsOfModule(module);

  const direct = exports.find(
    (entry) => entry.name === symbol.name && aliased(checker, entry) === symbol,
  );

  return (direct ?? exports.find((entry) => aliased(checker, entry) === symbol))?.name;
};

/** Where a symbol is declared, after following import aliases. */
export const origin = (
  resolver: Resolver,
  symbol: ts.Symbol,
):
  | { readonly symbol: ts.Symbol; readonly declaration: ts.Declaration; readonly file: string }
  | undefined => {
  const target = aliased(resolver.project.checker, symbol);
  const declaration = declarationOf(target);

  if (declaration === undefined) return undefined;

  return { symbol: target, declaration, file: declaration.getSourceFile().fileName };
};

/** Is this symbol declared inside the resolved `@effx/runtime` package? Never a name-string test. */
export const isFromRuntime = (resolver: Resolver, symbol: ts.Symbol): boolean => {
  const root = resolver.project.runtimeRoot;

  if (root === undefined) return false;
  const found = origin(resolver, symbol);

  return found !== undefined && found.file.startsWith(root);
};

/** Original export name of a runtime symbol (robust to `import { Query as Q }`). */
export const runtimeName = (resolver: Resolver, symbol: ts.Symbol): string =>
  aliased(resolver.project.checker, symbol).name;

export interface Exported {
  readonly ref: SymbolRef;
  readonly idPath: string;
  readonly declaration: ts.Declaration;
}

/**
 * An exported value symbol as an import target: `{ module, export, member? }`.
 * Static class members (`User.Public`) resolve to their class with `member`.
 */
export const exportedSymbol = (resolver: Resolver, symbol: ts.Symbol): Exported | undefined => {
  const found = origin(resolver, symbol);

  if (found === undefined) return undefined;
  const { declaration } = found;
  const module = resolver.moduleOf(found.file);
  const idPath = resolver.idPathOf(found.file);

  if (ts.isPropertyDeclaration(declaration) && ts.isClassDeclaration(declaration.parent)) {
    const modifiers = ts.getModifiers(declaration) ?? [];

    if (
      !modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword) ||
      modifiers.some(
        (modifier) =>
          modifier.kind === ts.SyntaxKind.PrivateKeyword ||
          modifier.kind === ts.SyntaxKind.ProtectedKeyword,
      ) ||
      !ts.isIdentifier(declaration.name)
    )
      return undefined;
    const owner = declaration.parent;

    const ownerSymbol =
      owner.name === undefined
        ? undefined
        : resolver.project.checker.getSymbolAtLocation(owner.name);

    const ownerName =
      ownerSymbol === undefined ? undefined : exportName(resolver, ownerSymbol, owner);

    if (ownerName === undefined) return undefined;

    return {
      ref: { module, export: ownerName, member: declaration.name.getText() },
      idPath,
      declaration,
    };
  }

  const name = exportName(resolver, found.symbol, declaration);

  if (name === undefined) return undefined;

  if (ts.isFunctionDeclaration(declaration) && declaration.name !== undefined) {
    return { ref: { module, export: name }, idPath, declaration };
  }

  if (ts.isClassDeclaration(declaration) && declaration.name !== undefined) {
    return { ref: { module, export: name }, idPath, declaration };
  }

  if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
    return { ref: { module, export: name }, idPath, declaration };
  }

  return undefined;
};

/** `schema:<idPath>/<export>[.<member>]` — identity is `rootDir`-relative, never `outDir`-relative. */
export const schemaRefOf = (exported: Pick<Exported, "ref" | "idPath">): SchemaRef => ({
  module: exported.ref.module,
  export: exported.ref.export,
  symbolId: StableId.make(
    "schema",
    `${exported.idPath}/${exported.ref.export}${exported.ref.member === undefined ? "" : `.${exported.ref.member}`}`,
  ),
});

export const serviceIdOf = (ref: SymbolRef): StableId.StableId =>
  StableId.make("service", ref.export);

/** The value side of a symbol (for classes: the constructor type, where Effect stamps its ids). */
export const staticTypeOf = (resolver: Resolver, symbol: ts.Symbol): ts.Type | undefined => {
  const declaration = declarationOf(symbol);

  return declaration === undefined
    ? undefined
    : resolver.project.checker.getTypeOfSymbolAtLocation(symbol, declaration);
};

export const isSchemaValueType = (type: ts.Type): boolean => typeHasProperty(type, SCHEMA_TYPE_ID);

/** A Schema value wrapped by `Http.headers(...)`: its static type carries the `~effx/Http/Headers` brand. */
export const isHeadersMarked = (type: ts.Type): boolean => typeHasProperty(type, HEADERS_TYPE_ID);

export const isServiceValueType = (type: ts.Type): boolean =>
  typeHasProperty(type, SERVICE_TYPE_ID) ||
  (typeHasProperty(type, KEY_TYPE_ID) && typeHasProperty(type, "key"));

/** The installed stable brands discover shape, never native callee authority. */
export const httpApiKind = (
  type: ts.Type,
): "HttpApiEndpoint" | "HttpApiGroup" | "HttpApi" | undefined => {
  if (typeHasProperty(type, "~effect/http-api/HttpApiEndpoint")) return "HttpApiEndpoint";

  if (typeHasProperty(type, "~effect/http-api/HttpApiGroup")) return "HttpApiGroup";

  if (typeHasProperty(type, "~effect/http-api/HttpApi")) return "HttpApi";

  return undefined;
};
