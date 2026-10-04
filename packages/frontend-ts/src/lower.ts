import { Schema } from "effect";
import type { SchemaRef } from "@effx/ir";
import type { Plan } from "@effx/runtime";
import { type AnnotationArg, type Diagnostic, SchemaArg, error } from "@effx/compiler";
import {
  type Resolver,
  exportedSymbol,
  isFromRuntime,
  isHeadersMarked,
  isSchemaValueType,
  isServiceValueType,
  origin,
  runtimeName,
  schemaRefOf,
} from "./resolve.ts";
import { isExported, positionOf, ts } from "./ts.ts";

/** Top-level exported functions are valid application symbols, not Schema or service values. */
const exportedAccessFunction = (resolver: Resolver, symbol: ts.Symbol) => {
  const found = origin(resolver, symbol);

  return found !== undefined &&
    ts.isFunctionDeclaration(found.declaration) &&
    found.declaration.name !== undefined &&
    isExported(found.declaration)
    ? { module: resolver.moduleOf(found.file), export: found.declaration.name.text }
    : undefined;
};

export interface Lowered {
  readonly value: AnnotationArg | undefined;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const ok = (value: AnnotationArg): Lowered => ({ value, diagnostics: [] });

const reject = (declarationId: string, node: ts.Node, reason: string): Lowered => ({
  value: undefined,
  diagnostics: [
    error(
      "EFFX1102",
      `${declarationId}: cannot lower \`${node.getText()}\` to an annotation argument: ${reason}`,
      positionOf(node),
    ),
  ],
});

const invalidGroup = (declarationId: string, node: ts.Node): Lowered => ({
  value: undefined,
  diagnostics: [
    error(
      "EFFX2404",
      `${declarationId}: .in(...) requires an exported Http.group value or @Http.Group class`,
      positionOf(node),
    ),
  ],
});

const groupReference = (
  resolver: Resolver,
  declarationId: string,
  node: ts.Expression,
): Lowered => {
  const symbol = resolver.project.checker.getSymbolAtLocation(node);
  const exported = symbol === undefined ? undefined : exportedSymbol(resolver, symbol);
  const root = resolver.project.rootDir;
  const projectPrefix = root.endsWith("/") ? root : `${root}/`;

  if (
    exported === undefined ||
    exported.ref.member !== undefined ||
    !exported.declaration.getSourceFile().fileName.startsWith(projectPrefix)
  )
    return invalidGroup(declarationId, node);
  const declaration = exported.declaration;
  let group = false;

  if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
    const initializer = declaration.initializer;

    if (ts.isCallExpression(initializer) && ts.isPropertyAccessExpression(initializer.expression)) {
      const callee = initializer.expression;
      const owner = callee.expression;

      const runtime = ts.isIdentifier(owner)
        ? resolver.project.checker.getSymbolAtLocation(owner)
        : undefined;

      group =
        runtime !== undefined &&
        isFromRuntime(resolver, runtime) &&
        runtimeName(resolver, runtime) === "Http" &&
        callee.name.text === "group";
    }
  } else if (ts.isClassDeclaration(declaration)) {
    group = (ts.getDecorators(declaration) ?? []).some((decorator) => {
      const expression = decorator.expression;

      if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression))
        return false;
      const callee = expression.expression;
      const owner = callee.expression;

      const runtime = ts.isIdentifier(owner)
        ? resolver.project.checker.getSymbolAtLocation(owner)
        : undefined;

      return (
        runtime !== undefined &&
        isFromRuntime(resolver, runtime) &&
        runtimeName(resolver, runtime) === "Http" &&
        callee.name.text === "Group"
      );
    });
  }

  return group ? ok({ _tag: "Symbol", ref: exported.ref }) : invalidGroup(declarationId, node);
};

/** Read source const strings without evaluating an application expression. */
const sourceString = (
  resolver: Resolver,
  expression: ts.Expression,
  seen = new Set<ts.Symbol>(),
): string | undefined => {
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression))
    return expression.text;

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  )
    return sourceString(resolver, expression.expression, seen);

  if (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression)) return undefined;
  const symbol = resolver.project.checker.getSymbolAtLocation(expression);

  if (symbol === undefined || seen.has(symbol)) return undefined;
  seen.add(symbol);
  const declaration = origin(resolver, symbol)?.declaration;

  return declaration !== undefined &&
    ts.isVariableDeclaration(declaration) &&
    (declaration.parent.flags & ts.NodeFlags.Const) !== 0 &&
    declaration.initializer !== undefined
    ? sourceString(resolver, declaration.initializer, seen)
    : undefined;
};

/** Runtime source constructors produce plain annotation values, never evaluated application code. */
const runtimeCall = (
  resolver: Resolver,
  declarationId: string,
  call: ts.CallExpression,
): Lowered | undefined => {
  const callee = call.expression;

  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression))
    return undefined;
  const rootSymbol = resolver.project.checker.getSymbolAtLocation(callee.expression);

  if (rootSymbol === undefined || !isFromRuntime(resolver, rootSymbol)) return undefined;
  const name = `${runtimeName(resolver, rootSymbol)}.${callee.name.text}`;

  if (
    name === "Capability.one" ||
    name === "Capability.any" ||
    name === "Capability.all" ||
    name === "Concealment.notFound"
  ) {
    const words: Array<string> = [];

    for (const argument of call.arguments) {
      const word = sourceString(resolver, argument);

      if (word === undefined || word.length === 0)
        return reject(declarationId, call, `${name} requires static nonempty string arguments`);
      words.push(word);
    }

    if (words.length === 0 || (name === "Capability.one" && words.length !== 1))
      return reject(
        declarationId,
        call,
        `${name} requires ${name === "Capability.one" ? "one" : "at least one"} string argument`,
      );

    if (name === "Capability.one") return ok({ _tag: "One", capability: words[0]! });

    if (name === "Concealment.notFound") return ok({ _tag: "NotFound", stages: words });

    return ok({ _tag: name === "Capability.any" ? "Any" : "All", capabilities: words });
  }

  if (name === "Focus.key") {
    const [, ...path] = call.arguments;
    const words = path.map((segment) => (ts.isStringLiteral(segment) ? segment.text : undefined));

    return words.every((word): word is string => word !== undefined)
      ? ok(words)
      : reject(declarationId, call, "Focus.key path segments must be string literals");
  }

  if (name === "Capability.make") {
    const [nameArg, options] = call.arguments;

    if (
      nameArg === undefined ||
      !ts.isStringLiteral(nameArg) ||
      options === undefined ||
      !ts.isObjectLiteralExpression(options)
    ) {
      return reject(declarationId, call, 'expected Capability.make("name", { resource, focus? })');
    }

    const lowered = lowerObject(resolver, declarationId, options, undefined, undefined);

    if (lowered.value === undefined) return lowered;
    const record = lowered.value;
    const resource = resourceName(record);

    if (resource === undefined)
      return reject(declarationId, options, "resource must be an exported Schema model class");
    const focusValue = record["focus"];

    if (Object.hasOwn(record, "focus") && !isStringArray(focusValue)) {
      return reject(declarationId, options, "focus must be a Focus.key(...) path");
    }

    const focus = isStringArray(focusValue) ? focusValue : undefined;

    return ok(
      focus === undefined
        ? { name: nameArg.text, resource }
        : { name: nameArg.text, resource, focus },
    );
  }

  return undefined;
};

const isSchemaArg = Schema.is(SchemaArg);

const stringArraySchema = Schema.Array(Schema.String);

const isSchemaStringArray = Schema.is(stringArraySchema);

const isStringArray = (value: AnnotationArg | undefined): value is ReadonlyArray<string> =>
  value !== undefined && Array.isArray(value) && isSchemaStringArray(value);

/** A lowered `resource: User` is `{ _tag: "Schema", ref }`; the model name is the schema's export. */
const resourceName = (record: { readonly [key: string]: AnnotationArg }): string | undefined => {
  const resource = record["resource"];

  return isSchemaArg(resource) ? resource.ref.export : undefined;
};

interface LoweredRecord {
  readonly value: { readonly [key: string]: AnnotationArg } | undefined;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

const unwrap = (plan: Plan | undefined): Plan | undefined =>
  plan?._tag === "Injected" || plan?._tag === "Refine" ? unwrap(plan.plan) : plan;

/** A union position lowers an identifier by its Symbol/Schema member; every other form generically. */
const identifierPlan = (plan: Plan | undefined): Plan | undefined => {
  const inner = unwrap(plan);

  if (inner?._tag !== "Union") return inner;

  return inner.members.find((member) => member._tag === "Symbol" || member._tag === "Schema");
};

const DEFAULT_MESSAGE = {
  callable: "metadata.annotator must be an exported callable symbol",
  "exported-function": "commandIdentity must be an exported callable function",
  "exported-value": "access symbol must be an exported value",
  registry: "registry must be an exported value symbol",
} as const;

const checkMessage = (plan: Extract<Plan, { readonly _tag: "Symbol" }>): string =>
  plan.message ??
  (plan.check === "callable" ||
  plan.check === "exported-function" ||
  plan.check === "exported-value" ||
  plan.check === "registry"
    ? DEFAULT_MESSAGE[plan.check]
    : plan.check);

/** `isTaggedMessage` of a Foldkit Message: a Schema whose `Type` has a literal-union `_tag`. */
const isTaggedMessage = (resolver: Resolver, schemaValue: ts.Type, node: ts.Node): boolean => {
  if (!isSchemaValueType(schemaValue)) return false;

  const checker = resolver.project.checker;
  const typeMember = schemaValue.getProperty("Type");

  if (typeMember === undefined) return false;
  const messageType = checker.getTypeOfSymbolAtLocation(typeMember, node);
  const tagMember = messageType.getProperty("_tag");

  if (tagMember === undefined) return false;
  const tag = checker.getTypeOfSymbolAtLocation(tagMember, node);
  const cases = tag.isUnion() ? tag.types : [tag];

  return cases.length > 0 && cases.every((item) => (item.flags & ts.TypeFlags.StringLiteral) !== 0);
};

const lowerObject = (
  resolver: Resolver,
  declarationId: string,
  object: ts.ObjectLiteralExpression,
  plan: Plan | undefined,
  annotationName: string | undefined,
): LoweredRecord => {
  const out: Record<string, AnnotationArg> = {};
  const diagnostics: Array<Diagnostic> = [];

  const unwrapped = unwrap(plan);
  const struct = unwrapped?._tag === "Struct" ? unwrapped : undefined;

  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) {
      const rejected = reject(
        declarationId,
        property,
        "only `key: value` and shorthand properties are supported",
      );

      return { value: undefined, diagnostics: [...diagnostics, ...rejected.diagnostics] };
    }

    const key =
      ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)
        ? property.name.text
        : undefined;

    if (key === undefined) {
      const rejected = reject(declarationId, property, "computed keys are not supported");

      return { value: undefined, diagnostics: [...diagnostics, ...rejected.diagnostics] };
    }

    if (Object.hasOwn(out, key) && struct?.rejectDuplicate?.includes(key) === true) {
      const rejected = reject(declarationId, property, `duplicate ${key} declaration`);

      return { value: undefined, diagnostics: [...diagnostics, ...rejected.diagnostics] };
    }

    const lowered = lowerExpression(
      resolver,
      declarationId,
      ts.isPropertyAssignment(property) ? property.initializer : property.name,
      struct?.fields[key],
      annotationName,
    );

    diagnostics.push(...lowered.diagnostics);

    if (lowered.value === undefined) return { value: undefined, diagnostics };
    out[key] = lowered.value;
  }

  // Tagged-message Schema fields (Foldkit.Command) are checked once the whole object lowered.
  if (struct !== undefined) {
    const checker = resolver.project.checker;

    for (const [field, fieldPlan] of Object.entries(struct.fields)) {
      if (fieldPlan._tag !== "Schema" || fieldPlan.taggedMessage !== true) continue;

      const member = checker.getTypeAtLocation(object).getProperty(field);

      if (member === undefined) continue; // Args decoding reports the missing field.

      const property = object.properties.find(
        (candidate): candidate is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
          (ts.isPropertyAssignment(candidate) || ts.isShorthandPropertyAssignment(candidate)) &&
          (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
          candidate.name.text === field,
      );

      const value =
        property === undefined
          ? undefined
          : ts.isPropertyAssignment(property)
            ? property.initializer
            : property.name;

      const type =
        value === undefined
          ? checker.getTypeOfSymbolAtLocation(member, object)
          : checker.getTypeAtLocation(value);

      if (!isTaggedMessage(resolver, type, object)) {
        diagnostics.push(
          error(
            "EFFX2601",
            `${declarationId}: ${annotationName ?? "annotation"} ${field} must be an exported tagged Message schema`,
            positionOf(object),
          ),
        );

        return { value: undefined, diagnostics };
      }
    }
  }

  return { value: out, diagnostics };
};

/** The generic primitive requires a source literal, never an inferred or executed name. */
export const lowerAnnotationName = (declarationId: string, call: ts.CallExpression): Lowered => {
  const node = call.arguments[0];

  return node === undefined
    ? reject(declarationId, call, "Annotate requires a literal annotation name")
    : ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? ok(node.text)
      : reject(declarationId, node, "annotation name must be a string literal");
};

/** A lowered Schema reference: `fields` when the position records them, `marker` when wrapped by `Http.headers`. */
const schemaValue = (
  ref: SchemaRef,
  fields: ReadonlyArray<string> | undefined,
  marked: boolean,
): AnnotationArg => {
  if (fields === undefined)
    return marked ? { _tag: "Schema", ref, marker: "headers" } : { _tag: "Schema", ref };

  return marked
    ? { _tag: "Schema", ref, fields, marker: "headers" }
    : { _tag: "Schema", ref, fields };
};

/**
 * A Schema value at a `Schema` plan position (spec 0020 `A.schema`, spec 0024 §2.2). `fieldKeys` records the
 * static field keys of a struct-like Schema (the `header-fields` enrichment). A position without
 * `fieldsOptional` rejects a Schema that exposes none; with it the keys are simply absent ("unknown"). A
 * Schema wrapped by `Http.headers` is a headers-channel Schema: it always records its required keys (what
 * `Http.Contract.headers` records) and, like a headers position, needs static keys.
 */
const lowerSchema = (
  resolver: Resolver,
  declarationId: string,
  node: ts.Expression,
  type: ts.Type,
  ref: SchemaRef,
  plan: Extract<Plan, { readonly _tag: "Schema" }> | undefined,
): Lowered => {
  const checker = resolver.project.checker;
  const marked = isHeadersMarked(type);

  const fieldKeys =
    plan?.fieldKeys === undefined ? undefined : marked ? "required" : plan.fieldKeys;

  if (fieldKeys === undefined) return ok(schemaValue(ref, undefined, marked));

  const optional = plan?.fieldsOptional === true && !marked;
  const fieldsSymbol = type.getProperty("fields");

  if (fieldsSymbol === undefined)
    return optional
      ? ok(schemaValue(ref, undefined, marked))
      : reject(declarationId, node, "schema must expose static fields");

  const fieldsType = checker.getTypeOfSymbolAtLocation(fieldsSymbol, node);

  // A struct typed with the generic `Schema.Struct.Fields` has an index signature, not static keys.
  if (optional && checker.getIndexInfosOfType(fieldsType).length > 0)
    return ok(schemaValue(ref, undefined, marked));

  const fields = checker
    .getPropertiesOfType(fieldsType)
    .filter((field) => {
      if (fieldKeys !== "required") return true;
      const fieldType = checker.getTypeOfSymbolAtLocation(field, node);
      const marker = fieldType.getProperty("~type.optionality");

      if (marker === undefined) return false;
      const optionality = checker.getTypeOfSymbolAtLocation(marker, node);

      return optionality.isStringLiteral() && optionality.value === "required";
    })
    .map((field) => field.name)
    .toSorted();

  return ok(schemaValue(ref, fields, marked));
};

/** Spec 0002 §Argument lowering, directed by the annotation's lowering plan (spec 0020 §2.2). */
export const lowerExpression = (
  resolver: Resolver,
  declarationId: string,
  node: ts.Expression,
  plan: Plan | undefined,
  annotationName?: string,
): Lowered => {
  const checker = resolver.project.checker;

  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return lowerExpression(resolver, declarationId, node.expression, plan, annotationName);

  const leaf = identifierPlan(plan);
  const symbolPlan = leaf?._tag === "Symbol" ? leaf : undefined;

  if (symbolPlan?.check === "exported-group") {
    return ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)
      ? groupReference(resolver, declarationId, node)
      : invalidGroup(declarationId, node);
  }

  if (
    symbolPlan?.check === "callable" &&
    !ts.isIdentifier(node) &&
    !ts.isPropertyAccessExpression(node)
  )
    return reject(declarationId, node, checkMessage(symbolPlan));

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return ok(node.text);

  if (ts.isNumericLiteral(node)) return ok(Number(node.text));

  if (node.kind === ts.SyntaxKind.TrueKeyword) return ok(true);

  if (node.kind === ts.SyntaxKind.FalseKeyword) return ok(false);

  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return ok({ _tag: "Lambda" });

  if (ts.isArrayLiteralExpression(node)) {
    const items: Array<AnnotationArg> = [];
    const diagnostics: Array<Diagnostic> = [];
    const inner = unwrap(plan);
    const itemPlan = inner?._tag === "Array" ? inner.item : undefined;

    for (const element of node.elements) {
      const lowered = lowerExpression(resolver, declarationId, element, itemPlan, annotationName);

      diagnostics.push(...lowered.diagnostics);

      if (lowered.value === undefined) return { value: undefined, diagnostics };
      items.push(lowered.value);
    }

    return { value: items, diagnostics };
  }

  if (ts.isObjectLiteralExpression(node))
    return lowerObject(resolver, declarationId, node, plan, annotationName);

  if (ts.isCallExpression(node)) {
    return (
      runtimeCall(resolver, declarationId, node) ??
      reject(declarationId, node, "unsupported runtime constructor call")
    );
  }

  if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const root = checker.getSymbolAtLocation(node.expression);

      if (root !== undefined && isFromRuntime(resolver, root)) {
        const name = `${runtimeName(resolver, root)}.${node.name.text}`;

        if (name === "Capability.none") return ok({ _tag: "None" });

        if (name === "Concealment.reveal") return ok({ _tag: "Reveal" });
      }
    }

    // At a shorthand property, getSymbolAtLocation(name) is the property symbol, not its value.
    const shorthand =
      ts.isIdentifier(node) &&
      ts.isShorthandPropertyAssignment(node.parent) &&
      node.parent.name === node
        ? checker.getShorthandAssignmentValueSymbol(node.parent)
        : undefined;

    const symbol = shorthand ?? checker.getSymbolAtLocation(node);

    if (symbol === undefined) return reject(declarationId, node, "unresolved symbol");

    const type =
      shorthand === undefined
        ? checker.getTypeAtLocation(node)
        : checker.getTypeOfSymbolAtLocation(symbol, node);

    const exported = exportedSymbol(resolver, symbol);

    if (symbolPlan?.check === "callable") {
      const ref =
        checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0
          ? (exported?.ref ?? exportedAccessFunction(resolver, symbol))
          : undefined;

      return ref === undefined
        ? reject(declarationId, node, checkMessage(symbolPlan))
        : ok({ _tag: "Symbol", ref });
    }

    if (symbolPlan?.check === "httpapi-root") {
      if (
        exported === undefined ||
        exported.ref.member !== undefined ||
        (type.getProperty("~effect/http-api/HttpApi") === undefined &&
          type.getProperty("~effect/httpapi/HttpApi") === undefined)
      )
        return reject(declarationId, node, "HTTP root must be an exported concrete HttpApi value");

      const identifier = type.getProperty("identifier");

      const literal =
        identifier === undefined ? undefined : checker.getTypeOfSymbolAtLocation(identifier, node);

      return literal !== undefined && literal.isStringLiteral()
        ? ok({ _tag: "Symbol", ref: exported.ref, identifier: literal.value })
        : reject(declarationId, node, "HTTP root identifier must be a string literal");
    }

    // Only these fields accept arbitrary exported application symbols.
    if (symbolPlan?.check === "exported-value") {
      const ref = exported?.ref ?? exportedAccessFunction(resolver, symbol);

      return ref === undefined
        ? reject(declarationId, node, checkMessage(symbolPlan))
        : ok({ _tag: "Symbol", ref });
    }

    if (symbolPlan?.check === "exported-function") {
      const ref =
        exportedAccessFunction(resolver, symbol) ??
        (checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0
          ? exported?.ref
          : undefined);

      return ref === undefined
        ? reject(declarationId, node, checkMessage(symbolPlan))
        : ok({ _tag: "Symbol", ref });
    }

    // This exception is local to the registry position; no application code is evaluated.
    if (symbolPlan?.check === "registry") {
      return exported === undefined
        ? reject(declarationId, node, checkMessage(symbolPlan))
        : ok({ _tag: "Symbol", ref: exported.ref });
    }

    if (isSchemaValueType(type)) {
      if (exported === undefined) {
        return reject(
          declarationId,
          node,
          "schema must be an exported top-level symbol or an exported class's static member",
        );
      }

      const ref = schemaRefOf(exported);

      return lowerSchema(
        resolver,
        declarationId,
        node,
        type,
        ref,
        leaf?._tag === "Schema" ? leaf : undefined,
      );
    }

    if (isServiceValueType(type)) {
      if (exported === undefined)
        return reject(declarationId, node, "service must be an exported class");

      const securityProperty =
        symbolPlan?.check === "security-marker" ? type.getProperty("security") : undefined;

      const securityType =
        securityProperty === undefined
          ? undefined
          : checker.getTypeOfSymbolAtLocation(securityProperty, node);

      const isSecurity =
        securityType !== undefined &&
        (securityType.flags & ts.TypeFlags.Never) === 0 &&
        (type.getProperty("~effect/http-api/HttpApiMiddleware/Security") !== undefined ||
          type.getProperty("~effect/httpapi/HttpApiMiddleware/Security") !== undefined);

      return ok(
        isSecurity
          ? { _tag: "Symbol", ref: exported.ref, security: true }
          : { _tag: "Symbol", ref: exported.ref },
      );
    }

    // A const holding a runtime plain value (Capability / Focus): lower its initializer.
    const found = origin(resolver, symbol);

    if (
      found !== undefined &&
      ts.isVariableDeclaration(found.declaration) &&
      found.declaration.initializer !== undefined
    ) {
      return lowerExpression(resolver, declarationId, found.declaration.initializer, undefined);
    }

    return reject(
      declarationId,
      node,
      `\`${checker.typeToString(type)}\` is neither a Schema, a service class, nor a runtime value`,
    );
  }

  return reject(declarationId, node, `unsupported expression kind ${ts.SyntaxKind[node.kind]}`);
};
