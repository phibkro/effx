import { Schema } from "effect";
import { Builtins } from "@effx/runtime";
import {
  HttpDiagnostics,
  SymbolArg,
  type Diagnostic,
  type GroupBinding,
  type GroupBindingReference,
  type GroupBindingTypeParameter,
} from "@effx/compiler";
import { lowerExpression } from "./lower.ts";
import { exportedSymbol, type Resolver } from "./resolve.ts";
import { isExported, positionOf, ts } from "./ts.ts";

const isSymbol = Schema.is(SymbolArg);

type FactoryHolder = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

const isFactoryHolder = (holder: ts.Node | undefined): holder is FactoryHolder =>
  holder !== undefined &&
  (ts.isArrowFunction(holder) ||
    ts.isFunctionExpression(holder) ||
    ts.isFunctionDeclaration(holder));

/**
 * A type reference written in a mirrored type parameter must be importable under the same written
 * name, so the generated clause can keep its source syntax. Type parameters of the same declaration
 * need no import and are skipped.
 */
const typeReferenceOf = (
  resolver: Resolver,
  name: ts.EntityName,
): GroupBindingReference | undefined => {
  const symbol = resolver.project.checker.getSymbolAtLocation(name);
  const declaration = symbol?.declarations?.[0];

  if (symbol === undefined || declaration === undefined) return undefined;

  if (ts.isTypeParameterDeclaration(declaration)) return undefined;

  const ref =
    exportedSymbol(resolver, symbol)?.ref ??
    ((ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) &&
    isExported(declaration)
      ? {
          module: resolver.moduleOf(declaration.getSourceFile().fileName),
          export: declaration.name.text,
        }
      : undefined);

  return ref === undefined ? undefined : { ref, name: name.getText() };
};

const typeParameterOf = (
  resolver: Resolver,
  parameter: ts.TypeParameterDeclaration,
): GroupBindingTypeParameter => {
  const references = new Map<string, GroupBindingReference>();

  const collect = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node)) {
      const reference = typeReferenceOf(resolver, node.typeName);

      if (reference !== undefined)
        references.set(`${reference.ref.module}\0${reference.name}`, reference);
    }

    ts.forEachChild(node, collect);
  };

  if (parameter.constraint !== undefined) collect(parameter.constraint);

  if (parameter.default !== undefined) collect(parameter.default);

  return {
    name: parameter.name.text,
    constraint: parameter.constraint?.getText() ?? "",
    default: parameter.default?.getText() ?? "",
    references: [...references.values()],
  };
};

/**
 * Type parameters of an exported factory, in declaration order, with their constraint, default and
 * referenced symbols preserved. The bound projection mirrors them so a generic handler factory's
 * context, requirements and defaults survive its call site.
 */
const factoryTypeParameters = (
  resolver: Resolver,
  declaration: ts.Declaration,
): ReadonlyArray<GroupBindingTypeParameter> => {
  const holder = ts.isVariableDeclaration(declaration) ? declaration.initializer : declaration;

  if (!isFactoryHolder(holder)) return [];

  return (holder.typeParameters ?? []).map((parameter) => typeParameterOf(resolver, parameter));
};

/** Read references only. In particular, no initializer or backend function is executed. */
export const collectGroupBinding = (
  resolver: Resolver,
  declaration: ts.VariableDeclaration,
  call: ts.CallExpression,
  bindings: Array<GroupBinding>,
  diagnostics: Array<Diagnostic>,
): void => {
  if (resolver.project.resolution?.emit === "contract" || !isExported(declaration)) return;
  const subject = declaration.name.getText();
  const options = { location: positionOf(call) };
  const [group, fields] = call.arguments;

  if (group === undefined) {
    diagnostics.push(HttpDiagnostics.EFFX2420.emit({ subject }, options));

    return;
  }

  const lowered = lowerExpression(resolver, subject, group, Builtins.HttpIn.plan.items[0]);

  if (!isSymbol(lowered.value)) {
    diagnostics.push(HttpDiagnostics.EFFX2420.emit({ subject }, options));

    return;
  }

  if (
    call.arguments.length !== 2 ||
    fields === undefined ||
    !ts.isObjectLiteralExpression(fields)
  ) {
    diagnostics.push(HttpDiagnostics.EFFX2423.emit({ subject }, options));

    return;
  }

  const entries = new Map<
    string,
    { readonly expression: ts.Expression; readonly symbol: ts.Symbol | undefined }
  >();

  for (const field of fields.properties) {
    if (
      (!ts.isPropertyAssignment(field) && !ts.isShorthandPropertyAssignment(field)) ||
      (!ts.isIdentifier(field.name) && !ts.isStringLiteral(field.name)) ||
      entries.has(field.name.text)
    ) {
      diagnostics.push(HttpDiagnostics.EFFX2423.emit({ subject }, options));

      return;
    }

    const expression = ts.isPropertyAssignment(field) ? field.initializer : field.name;

    const symbol = ts.isShorthandPropertyAssignment(field)
      ? resolver.project.checker.getShorthandAssignmentValueSymbol(field)
      : resolver.project.checker.getSymbolAtLocation(expression);

    entries.set(field.name.text, { expression, symbol });
  }

  if (
    !entries.has("handlers") ||
    entries.has("guards") === entries.has("guardFor") ||
    [...entries.keys()].some((key) => key !== "handlers" && key !== "guards" && key !== "guardFor")
  ) {
    diagnostics.push(HttpDiagnostics.EFFX2423.emit({ subject }, options));

    return;
  }

  const references = new Map<
    string,
    {
      readonly ref: GroupBinding["handlers"];
      readonly typeParameters: ReadonlyArray<GroupBindingTypeParameter>;
    }
  >();

  for (const [key, value] of entries) {
    const exported =
      value.symbol === undefined ? undefined : exportedSymbol(resolver, value.symbol);

    const callable = resolver.project.checker.getSignaturesOfType(
      resolver.project.checker.getTypeAtLocation(value.expression),
      ts.SignatureKind.Call,
    );

    if (exported === undefined || callable.length === 0) {
      diagnostics.push(HttpDiagnostics.EFFX2421.emit({ subject: subject + "." + key }, options));

      return;
    }

    references.set(key, {
      ref: exported.ref,
      typeParameters: factoryTypeParameters(resolver, exported.declaration),
    });
  }

  const ref = lowered.value.ref;

  if (
    bindings.some(
      (binding) =>
        binding.group.module === ref.module &&
        binding.group.export === ref.export &&
        binding.group.member === ref.member,
    )
  ) {
    diagnostics.push(HttpDiagnostics.EFFX2422.emit({ subject }, options));

    return;
  }

  const handlers = references.get("handlers")!;
  const guards = references.get("guards");
  const guardFor = references.get("guardFor");

  bindings.push({
    group: ref,
    handlers: handlers.ref,
    handlersTypeParameters: [...handlers.typeParameters],
    guardsTypeParameters: guards === undefined ? [] : guards.typeParameters.map(({ name }) => name),
    ...(guards === undefined ? { guardFor: guardFor!.ref } : { guards: guards.ref }),
  });
};
