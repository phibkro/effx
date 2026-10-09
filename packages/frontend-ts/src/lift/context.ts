import type { SchemaRef, SymbolRef } from "@effx/ir";
import {
  type Finding,
  type FindingKind,
  type MiddlewareFact,
  type NativeCallee,
  NativeKind,
  type RefLike,
  type SchemaFact,
  type SourcePosition,
  type SourceRange,
  type TargetProfile,
  isNativeModule,
  refIdentity,
} from "@effx/compiler";
import {
  type Resolver,
  exportedSymbol,
  isHeadersMarked,
  isSchemaValueType,
  origin,
  schemaRefOf,
} from "../resolve.ts";
import { aliased, ts } from "../ts.ts";

export const position = (file: ts.SourceFile, offset: number): SourcePosition => {
  const point = file.getLineAndCharacterOfPosition(offset);

  return { offset, line: point.line + 1, col: point.character + 1 };
};

export const range = (node: ts.Node): SourceRange => {
  const file = node.getSourceFile();

  return {
    file: file.fileName,
    start: position(file, node.getStart(file)),
    end: position(file, node.end),
  };
};

/** One postfix call suffix, not the receiver's entire declaration chain. */
export const suffixRange = (call: ts.CallExpression): SourceRange => {
  const file = call.getSourceFile();

  const start = ts.isPropertyAccessExpression(call.expression)
    ? call.expression.expression.end
    : call.getStart(file);

  return { file: file.fileName, start: position(file, start), end: position(file, call.end) };
};

export const finding = (node: ts.Node, kind: FindingKind, enclosingCall?: SymbolRef): Finding => {
  const value: Finding = { kind, construct: node.getText(), range: range(node) };

  return enclosingCall === undefined
    ? value
    : { ...value, enclosingCall: { callee: enclosingCall } };
};

export const unwrap = (input: ts.Expression): ts.Expression => {
  let node = input;

  while (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    node = node.expression;

  return node;
};

export const propertyName = (name: ts.PropertyName): string | undefined =>
  ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)
    ? name.text
    : undefined;

/** Per-analysis checker state. It has no runtime, resources, or application values. */
export class LiftContext {
  readonly natives = new Map<string, NativeCallee>();
  readonly schemas = new Map<string, SchemaFact>();
  readonly markers = new Map<string, MiddlewareFact>();
  private readonly nativeFiles = new Map<string, NativeKind | undefined>();

  constructor(
    readonly resolver: Resolver,
    readonly target: TargetProfile,
  ) {}

  private nativeKind(file: string): NativeKind | undefined {
    if (this.nativeFiles.has(file)) return this.nativeFiles.get(file);
    const project = this.resolver.project;
    const module = this.resolver.moduleOf(file);

    const kind = NativeKind.literals.find(
      (name) => module.endsWith(`/${name}`) && isNativeModule(this.target, name, module),
    );

    const resolved =
      project.resolveEffectModule?.(module) === true
        ? ts.resolveModuleName(
            module,
            project.rootNames[0] ?? `${project.rootDir}/__effx_target__.ts`,
            project.program.getCompilerOptions(),
            ts.sys,
          ).resolvedModule?.resolvedFileName
        : undefined;

    const result = resolved === file ? kind : undefined;
    this.nativeFiles.set(file, result);

    return result;
  }

  native(node: ts.Expression): NativeCallee | undefined {
    const symbol = this.resolver.project.checker.getSymbolAtLocation(node);
    const found = symbol === undefined ? undefined : origin(this.resolver, symbol);

    if (found === undefined) return undefined;
    const kind = this.nativeKind(found.file);

    if (kind === undefined) return undefined;
    const module = this.resolver.moduleOf(found.file);
    const exported = exportedSymbol(this.resolver, found.symbol);

    const ref: SymbolRef | undefined = ts.isSourceFile(found.declaration)
      ? { module: module.slice(0, -kind.length - 1), export: kind }
      : exported?.ref;

    if (ref === undefined) return undefined;
    const value: NativeCallee = { kind, target: this.target, ref };
    this.natives.set(`${refIdentity(ref)}\u0000`, value);

    return value;
  }

  reference(node: ts.Expression, symbol?: ts.Symbol): RefLike | undefined {
    const checker = this.resolver.project.checker;
    const selected = symbol ?? checker.getSymbolAtLocation(node);
    const native = this.native(node);

    if (selected === undefined) return undefined;
    const exported = exportedSymbol(this.resolver, selected);

    if (exported === undefined) return native?.ref;
    const type = checker.getTypeAtLocation(node);

    if (isSchemaValueType(type)) {
      const ref = schemaRefOf(exported);
      this.schemaFact(ref, type, node);

      return ref;
    }

    const ref = exported.ref;
    const security = type.getProperty("security");

    const securityType =
      security === undefined ? undefined : checker.getTypeOfSymbolAtLocation(security, node);

    const branded =
      type.getProperty("~effect/http-api/HttpApiMiddleware") !== undefined ||
      type.getProperty("~effect/httpapi/HttpApiMiddleware") !== undefined ||
      type.getProperty("~effect/http-api/HttpApiMiddleware/Security") !== undefined ||
      type.getProperty("~effect/httpapi/HttpApiMiddleware/Security") !== undefined;

    if (branded)
      this.markers.set(refIdentity(ref), {
        ref,
        security:
          securityType !== undefined &&
          (securityType.flags & ts.TypeFlags.Never) === 0 &&
          (type.getProperty("~effect/http-api/HttpApiMiddleware/Security") !== undefined ||
            type.getProperty("~effect/httpapi/HttpApiMiddleware/Security") !== undefined),
      });

    return ref;
  }

  private schemaFact(ref: SchemaRef, type: ts.Type, node: ts.Node): void {
    const key = refIdentity(ref);

    if (this.schemas.has(key)) return;
    const checker = this.resolver.project.checker;
    const fields = type.getProperty("fields");
    let fact: SchemaFact = isHeadersMarked(type) ? { ref, headers: true } : { ref };

    if (fields !== undefined) {
      const fieldsType = checker.getTypeOfSymbolAtLocation(fields, node);

      if (checker.getIndexInfosOfType(fieldsType).length === 0) {
        const allKeys: Array<string> = [];
        const requiredKeys: Array<string> = [];

        for (const field of checker.getPropertiesOfType(fieldsType)) {
          allKeys.push(field.name);
          const fieldType = checker.getTypeOfSymbolAtLocation(field, node);
          const marker = fieldType.getProperty("~type.optionality");

          const optionality =
            marker === undefined ? undefined : checker.getTypeOfSymbolAtLocation(marker, node);

          if (optionality?.isStringLiteral() && optionality.value === "required")
            requiredKeys.push(field.name);
        }

        fact = { ...fact, allKeys: allKeys.sort(), requiredKeys: requiredKeys.sort() };
      }
    }

    this.schemas.set(key, fact);
  }

  /** Export identity, not the local alias spelling. */
  symbol(node: ts.Node): SymbolRef | undefined {
    const checker = this.resolver.project.checker;
    const selected = checker.getSymbolAtLocation(node);

    return selected === undefined
      ? undefined
      : exportedSymbol(this.resolver, aliased(checker, selected))?.ref;
  }
}
