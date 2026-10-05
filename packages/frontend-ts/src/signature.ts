import type { Diagnostic, HandlerSignature, TypeRef } from "@effx/compiler";
import { CoreDiagnostics } from "@effx/compiler";
import {
  type Resolver,
  exportedSymbol,
  isSchemaValueType,
  isServiceValueType,
  origin,
  schemaRefOf,
  serviceIdOf,
  staticTypeOf,
} from "./resolve.ts";
import { positionOf, ts } from "./ts.ts";

/**
 * `Effect.Effect<A, E, R>` as the TypeScript checker sees it: an object type reference whose
 * target symbol is `Effect` declared under the `effect` package. Verified against effect 4.0.0
 * with TypeScript 6.0.3: `checker.getTypeArguments` returns exactly `[A, E, R]` (spec 0002).
 */
const effectTypeArguments = (
  checker: ts.TypeChecker,
  type: ts.Type,
): readonly [ts.Type, ts.Type, ts.Type] | undefined => {
  if (!(type.flags & ts.TypeFlags.Object)) return undefined;
  // SAFETY: TypeFlags.Object was checked above.
  const objectType = type as ts.ObjectType;

  // SAFETY: ObjectFlags.Reference was checked above.
  const reference = objectType as ts.TypeReference;
  const symbol = reference.target.getSymbol();
  const file = symbol?.declarations?.[0]?.getSourceFile().fileName;

  if (symbol?.name !== "Effect" || file === undefined || !/[\\/]effect[\\/]/.test(file))
    return undefined;
  const args = checker.getTypeArguments(reference);
  const [a, e, r] = args;

  return a !== undefined && e !== undefined && r !== undefined && args.length === 3
    ? [a, e, r]
    : undefined;
};

const constituents = (type: ts.Type): ReadonlyArray<ts.Type> =>
  type.flags & ts.TypeFlags.Never ? [] : type.isUnion() ? type.types : [type];

/** Only literal HttpApi status annotations on an exported error schema count as proven. */
const literalHttpStatus = (resolver: Resolver, declaration: ts.Declaration): number | undefined => {
  const source = ts.isClassDeclaration(declaration)
    ? declaration.heritageClauses?.find((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    : ts.isVariableDeclaration(declaration)
      ? declaration.initializer
      : undefined;

  if (source === undefined) return undefined;

  const visit = (node: ts.Node): number | undefined => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) &&
      node.name.text === "httpApiStatus" &&
      ts.isNumericLiteral(node.initializer)
    ) {
      const record = node.parent;
      const call = record.parent;

      const taggedErrorOptions =
        ts.isObjectLiteralExpression(record) &&
        ts.isCallExpression(call) &&
        call.arguments[2] === record &&
        ts.isCallExpression(call.expression) &&
        ts.isPropertyAccessExpression(call.expression.expression) &&
        call.expression.expression.name.text === "TaggedError";

      const schemaAnnotation =
        ts.isObjectLiteralExpression(record) &&
        ts.isCallExpression(call) &&
        call.arguments[0] === record &&
        ts.isPropertyAccessExpression(call.expression) &&
        call.expression.name.text === "annotate";

      if (taggedErrorOptions || schemaAnnotation) {
        const status = Number(node.initializer.text);

        return status >= 100 && status <= 599 ? status : undefined;
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "status" &&
      node.arguments[0] !== undefined &&
      ts.isNumericLiteral(node.arguments[0])
    ) {
      const symbol = resolver.project.checker.getSymbolAtLocation(node.expression.name);
      const file = symbol === undefined ? undefined : origin(resolver, symbol)?.file;

      if (
        file?.includes("/effect/src/http-api/HttpApiSchema.ts") === true ||
        file?.includes("/effect/src/unstable/httpapi/HttpApiSchema.ts") === true
      ) {
        const status = Number(node.arguments[0].text);

        return status >= 100 && status <= 599 ? status : undefined;
      }
    }

    return ts.forEachChild(node, visit);
  };

  return visit(source);
};

/** The literal tag of an exported `Schema.TaggedError` class; absent means no static proof. */
const literalErrorTag = (declaration: ts.Declaration): string | undefined => {
  if (!ts.isClassDeclaration(declaration)) return undefined;

  for (const clause of declaration.heritageClauses ?? []) {
    if (clause.token !== ts.SyntaxKind.ExtendsKeyword) continue;

    for (const member of clause.types) {
      const outer = member.expression;

      if (
        ts.isCallExpression(outer) === false ||
        ts.isCallExpression(outer.expression) === false ||
        ts.isPropertyAccessExpression(outer.expression.expression) === false ||
        outer.expression.expression.name.text !== "TaggedError"
      )
        continue;
      const first = outer.arguments[0];

      if (first !== undefined && ts.isStringLiteral(first)) return first.text;
    }
  }

  return undefined;
};

type MutableSchemaTypeRef = {
  -readonly [K in keyof Extract<TypeRef, { readonly _tag: "Schema" }>]: Extract<
    TypeRef,
    { readonly _tag: "Schema" }
  >[K];
};

/** One `E`/`R`/`A` constituent → `TypeRef` by the shape of its value side (spec 0002 §E/R inference step 3). */
const typeRefOf = (resolver: Resolver, type: ts.Type): TypeRef => {
  const checker = resolver.project.checker;
  const symbol = type.getSymbol();
  const opaque: TypeRef = { _tag: "Opaque", display: checker.typeToString(type) };

  if (symbol === undefined) return opaque;
  const staticType = staticTypeOf(resolver, symbol);
  const exported = exportedSymbol(resolver, symbol);

  if (staticType === undefined || exported === undefined) return opaque;

  if (isSchemaValueType(staticType)) {
    const httpStatus = literalHttpStatus(resolver, exported.declaration);
    const errorTag = literalErrorTag(exported.declaration);

    const result: MutableSchemaTypeRef = {
      _tag: "Schema",
      ref: schemaRefOf(exported),
    };

    if (httpStatus !== undefined) result.httpStatus = httpStatus;

    if (errorTag !== undefined) result.errorTag = errorTag;

    return result;
  }

  if (isServiceValueType(staticType)) {
    return { _tag: "Service", id: serviceIdOf(exported.ref), symbol: exported.ref };
  }

  return opaque;
};

export interface InferredSignature {
  readonly signature: HandlerSignature | undefined;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

/** Infers `{ success, errors, requirements }` from a handler's return type, or `EFFX1105`. */
export const inferSignature = (
  resolver: Resolver,
  declarationId: string,
  returnType: ts.Type,
  at: ts.Node,
): InferredSignature => {
  const checker = resolver.project.checker;
  const args = effectTypeArguments(checker, returnType);

  if (args === undefined) {
    return {
      signature: undefined,
      diagnostics: [
        CoreDiagnostics.EFFX1105.emit(
          { subject: declarationId, returnType: checker.typeToString(returnType) },
          { location: positionOf(at) },
        ),
      ],
    };
  }

  const [a, e, r] = args;

  return {
    signature: {
      success: typeRefOf(resolver, a),
      errors: constituents(e).map((type) => typeRefOf(resolver, type)),
      requirements: constituents(r).map((type) => typeRefOf(resolver, type)),
    },
    diagnostics: [],
  };
};
