import { Schema } from "effect";
import { Builtins, type ArgsPlan, type Plan } from "@effx/runtime";
import {
  AnnotationArg as AnnotationArgSchema,
  SymbolArg,
  CoreDiagnostics,
  HttpDiagnostics,
} from "@effx/compiler";
import type {
  Annotation,
  AnnotationArg,
  Collected,
  Declaration,
  DefinitionEntry,
  Diagnostic,
  HandlerSignature,
} from "@effx/compiler";
import { type AppliedUse, leafViolations } from "./leaf.ts";
import { lowerAnnotationName, lowerExpression } from "./lower.ts";
import {
  type Resolver,
  exportedSymbol,
  isFromRuntime,
  runtimeName,
  schemaRefOf,
} from "./resolve.ts";
import { inferSignature } from "./signature.ts";
import { isExported, positionOf, ts } from "./ts.ts";
import { type HttpApiRootCandidate, makeHttpApiInventoryResolver } from "./http-api-inventory.ts";

const annotationArgRecord = Schema.Record(Schema.String, AnnotationArgSchema);

const isAnnotationArgRecordValue = Schema.is(annotationArgRecord);

const isSymbolArg = Schema.is(SymbolArg);

const isAnnotationName = Schema.is(Schema.String);

const isAnnotationArgRecord = (
  value: AnnotationArg | undefined,
): value is Readonly<Record<string, AnnotationArg>> =>
  value !== undefined && !Array.isArray(value) && isAnnotationArgRecordValue(value);

interface Sink {
  readonly declarations: Array<Declaration>;
  readonly diagnostics: Array<Diagnostic>;
}

type CollectedDraft = { -readonly [K in keyof Collected]: Collected[K] };

const unsupported = (
  sink: Sink,
  node: ts.Node,
  params: Parameters<typeof CoreDiagnostics.EFFX1104.emit>[0],
): void => {
  sink.diagnostics.push(CoreDiagnostics.EFFX1104.emit(params, { location: positionOf(node) }));
};

/** `Query` / `Http.Get` / `Operation` …: the runtime export a callee refers to, or `undefined` when it is not from the runtime. */
const runtimeCallee = (
  resolver: Resolver,
  callee: ts.Expression,
): { readonly name: string; readonly tail: ReadonlyArray<string> } | undefined => {
  const tail: Array<string> = [];
  let current: ts.Expression = callee;

  while (ts.isPropertyAccessExpression(current)) {
    tail.unshift(current.name.text);
    current = current.expression;
  }

  if (!ts.isIdentifier(current)) return undefined;
  const symbol = resolver.project.checker.getSymbolAtLocation(current);

  if (symbol === undefined || !isFromRuntime(resolver, symbol)) return undefined;

  return { name: runtimeName(resolver, symbol), tail };
};

/** Lowering plans of the built-in annotations, derived from their definitions (spec 0020). */
const PLANS: ReadonlyMap<string, ArgsPlan> = new Map(
  Builtins.all.map((definition) => [definition.name, definition.plan]),
);

/** A definition declared by an extension: the registry minus the built-in table, whose uses keep their own diagnostics. */
const userDefinition = (resolver: Resolver, name: string): DefinitionEntry | undefined =>
  PLANS.has(name) ? undefined : resolver.definitions?.get(name);

const argumentPlan = (plan: ArgsPlan | undefined, index: number): Plan | undefined =>
  plan === undefined ? undefined : (plan.items[index] ?? plan.rest);

const lowerArguments = (
  resolver: Resolver,
  sink: Sink,
  declarationId: string,
  args: ReadonlyArray<ts.Expression>,
  annotationName?: string,
): ReadonlyArray<AnnotationArg> | undefined => {
  const out: Array<AnnotationArg> = [];

  const plan =
    annotationName === undefined
      ? undefined
      : (resolver.definitions?.get(annotationName)?.plan ?? PLANS.get(annotationName));

  for (const [index, arg] of args.entries()) {
    const lowered = lowerExpression(
      resolver,
      declarationId,
      arg,
      argumentPlan(plan, index),
      annotationName,
    );

    sink.diagnostics.push(...lowered.diagnostics);

    if (lowered.value === undefined) return undefined;
    out.push(lowered.value);
  }

  return out;
};

/** The `~effx/Annotation/Applied` brand's literal annotation name on a call's static type, if any. */
const appliedName = (resolver: Resolver, call: ts.CallExpression): string | undefined => {
  const checker = resolver.project.checker;
  const brand = checker.getTypeAtLocation(call).getProperty("~effx/Annotation/Applied");

  if (brand === undefined) return undefined;
  const name = checker.getTypeOfSymbolAtLocation(brand, call).getProperty("name");

  if (name === undefined) return undefined;
  const literal = checker.getTypeOfSymbolAtLocation(name, call);

  return literal.isStringLiteral() ? literal.value : undefined;
};

/**
 * An applied extension-declared annotation (decorator or `.with(...)`): its lowered arguments, plus the
 * definition's own export (the callee of the applied call) so a default writer can import it. A callee
 * that is not an exported value leaves `definition` out, as for a hand-built `Collected`.
 */
const lowerApplied = (
  resolver: Resolver,
  sink: Sink,
  declarationId: string,
  call: ts.CallExpression,
  name: string,
): Annotation | undefined => {
  resolver.appliedUses?.push({ name, call });
  const args = lowerArguments(resolver, sink, declarationId, call.arguments, name);

  if (args === undefined) return undefined;
  const callee = resolver.project.checker.getSymbolAtLocation(call.expression);
  const definition = callee === undefined ? undefined : exportedSymbol(resolver, callee)?.ref;

  return definition === undefined ? { name, args } : { name, args, definition };
};

/** Decorators of a class or member that come from `@effx/runtime`, as annotations in source order. */
const decoratorAnnotations = (
  resolver: Resolver,
  sink: Sink,
  declarationId: string,
  node: ts.HasDecorators,
  includeGroup = true,
): ReadonlyArray<Annotation> => {
  const annotations: Array<Annotation> = [];

  for (const decorator of ts.getDecorators(node) ?? []) {
    const expression = decorator.expression;

    if (!ts.isCallExpression(expression)) {
      const bare = runtimeCallee(resolver, expression);

      if (!includeGroup && bare?.name === "Http" && bare.tail.join(".") === "Group") continue;

      if (bare !== undefined)
        unsupported(sink, decorator, {
          _tag: "BareDecorator",
          subject: declarationId,
          annotation: bare.name,
        });
      continue;
    }

    const callee = runtimeCallee(resolver, expression.expression);

    if (callee === undefined) {
      // Not a runtime export: an extension-declared annotation is recognised by the brand of its type.
      const applied = appliedName(resolver, expression);

      if (applied === undefined) continue;
      const lowered = lowerApplied(resolver, sink, declarationId, expression, applied);

      if (lowered !== undefined) annotations.push(lowered);
      continue;
    }

    const name = [callee.name, ...callee.tail].join(".");

    if (!includeGroup && name === "Http.Group") continue;

    if (name === "Annotate") {
      const [, ...rest] = expression.arguments;
      const loweredName = lowerAnnotationName(declarationId, expression);
      sink.diagnostics.push(...loweredName.diagnostics);

      if (!isAnnotationName(loweredName.value)) continue;
      const args = lowerArguments(resolver, sink, declarationId, rest, loweredName.value);

      if (args !== undefined) annotations.push({ name: loweredName.value, args });
      continue;
    }

    const args = lowerArguments(resolver, sink, declarationId, expression.arguments, name);

    if (args !== undefined) annotations.push({ name, args });
  }

  return annotations;
};

const withSchema = (
  args: ReadonlyArray<AnnotationArg>,
  schema: AnnotationArg,
): ReadonlyArray<AnnotationArg> | undefined => {
  const [options, ...rest] = args;

  if (options === undefined || rest.length !== 0 || !isAnnotationArgRecord(options))
    return undefined;

  return [{ ...options, schema }];
};

const collectClass = (
  resolver: Resolver,
  sink: Sink,
  node: ts.ClassDeclaration,
  collectOperations: boolean,
  collectGroup = true,
): void => {
  if (node.name === undefined) return;
  const className = node.name.text;
  const file = node.getSourceFile().fileName;
  const module = resolver.moduleOf(file);

  const classAnnotations = decoratorAnnotations(resolver, sink, className, node, collectGroup);

  if (classAnnotations.filter((annotation) => annotation.name === "Http.Group").length > 1) {
    sink.diagnostics.push(
      HttpDiagnostics.EFFX2404.emit(
        { _tag: "MultipleDeclarations", subject: className },
        { location: positionOf(node) },
      ),
    );

    return;
  }

  for (const annotation of classAnnotations) {
    if (
      !collectOperations &&
      annotation.name !== "PersistentModel" &&
      annotation.name !== "Http.Group"
    )
      continue;

    if (annotation.name === "Http.Group") {
      if (!isExported(node)) {
        unsupported(sink, node, { _tag: "GroupExport", subject: className });
        continue;
      }

      sink.declarations.push({
        id: className,
        kind: "class",
        module,
        export: className,
        annotations: [annotation],
        location: positionOf(node),
      });
      continue;
    }

    if (annotation.name !== "PersistentModel") {
      if (userDefinition(resolver, annotation.name)?.target === "operation") {
        sink.diagnostics.push(
          CoreDiagnostics.EFFX1303.emit(
            { _tag: "Class", subject: className, annotation: annotation.name },
            { location: positionOf(node) },
          ),
        );
      } else {
        unsupported(sink, node, {
          _tag: "ClassDecorator",
          subject: className,
          annotation: annotation.name,
        });
      }

      continue;
    }

    if (!isExported(node)) {
      unsupported(sink, node, { _tag: "ModelExport", subject: className });
      continue;
    }

    const schema: AnnotationArg = {
      _tag: "Schema",
      ref: schemaRefOf({ ref: { module, export: className }, idPath: resolver.idPathOf(file) }),
    };

    const args = withSchema(annotation.args, schema);

    if (args === undefined) {
      unsupported(sink, node, { _tag: "ModelOptions", subject: className });
      continue;
    }

    sink.declarations.push({
      id: className,
      kind: "model",
      module,
      export: className,
      annotations: [{ name: "PersistentModel", args }],
      location: positionOf(node),
    });
  }

  if (!collectOperations) return;

  for (const member of node.members) {
    if (ts.isMethodDeclaration(member)) {
      const memberName = member.name.getText();
      const id = `${className}.${memberName}`;
      const annotations = decoratorAnnotations(resolver, sink, id, member);

      if (annotations.length === 0) continue;

      if (annotations.some((annotation) => annotation.name === "Http.Group")) {
        unsupported(sink, member, { _tag: "GroupMethod", subject: id });
        continue;
      }

      const isStatic = ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static;

      if (!isStatic) {
        unsupported(sink, member, { _tag: "StaticMethod", subject: id });
        continue;
      }

      if (!isExported(node)) {
        unsupported(sink, member, { _tag: "OperationClassExport", subject: id });
        continue;
      }

      const signature = resolver.project.checker.getSignatureFromDeclaration(member);

      const inferred =
        signature === undefined
          ? undefined
          : inferSignature(
              resolver,
              id,
              resolver.project.checker.getReturnTypeOfSignature(signature),
              member,
            );

      if (inferred !== undefined) sink.diagnostics.push(...inferred.diagnostics);

      const declaration: Declaration = {
        id,
        kind: "staticMethod",
        module,
        export: className,
        member: memberName,
        annotations,
        location: positionOf(member),
      };

      if (inferred?.signature === undefined) {
        sink.declarations.push(declaration);
      } else {
        sink.declarations.push({ ...declaration, handlerSignature: inferred.signature });
      }
    } else if (ts.canHaveDecorators(member)) {
      const stray = decoratorAnnotations(
        resolver,
        sink,
        `${className}.${member.name?.getText() ?? "?"}`,
        member,
      );

      if (stray.length > 0) {
        unsupported(sink, member, { _tag: "StaticMethod", subject: className });
      }
    }
  }
};

interface ChainStep {
  readonly names: ReadonlyArray<string>;
  readonly args: ReadonlyArray<ts.Expression>;
  readonly call: ts.CallExpression;
}

/** `Operation.query(a).http.get(b).handler(c)` → root `Operation`, steps `[query a] [http get b] [handler c]`. */
const unwindChain = (
  resolver: Resolver,
  initializer: ts.CallExpression,
): { readonly root: string; readonly steps: ReadonlyArray<ChainStep> } | undefined => {
  const steps: Array<ChainStep> = [];
  let node: ts.Expression = initializer;

  for (;;) {
    if (!ts.isCallExpression(node)) return undefined;
    const names: Array<string> = [];
    let callee: ts.Expression = node.expression;

    while (ts.isPropertyAccessExpression(callee)) {
      names.unshift(callee.name.text);
      callee = callee.expression;
    }

    if (names.length === 0) return undefined;
    steps.unshift({ names, args: node.arguments, call: node });

    if (ts.isCallExpression(callee)) {
      node = callee;
      continue;
    }

    if (!ts.isIdentifier(callee)) return undefined;
    const symbol = resolver.project.checker.getSymbolAtLocation(callee);

    if (symbol === undefined || !isFromRuntime(resolver, symbol)) return undefined;

    return { root: runtimeName(resolver, symbol), steps };
  }
};

/** The builder step each built-in definition declares, plus the untyped `.annotate(name, ...args)` (spec 0015). */
const CHAIN_ANNOTATIONS = new Map<string, string>([
  ...Builtins.all.flatMap((definition) =>
    definition.builder === undefined ? [] : [[definition.builder, definition.name] as const],
  ),
  ["annotate", "Annotate"],
]);

const collectBuilder = (
  resolver: Resolver,
  sink: Sink,
  declarator: ts.VariableDeclaration,
  collectOperations: boolean,
  collectGroup = true,
): void => {
  if (
    !ts.isIdentifier(declarator.name) ||
    declarator.initializer === undefined ||
    !ts.isCallExpression(declarator.initializer)
  )
    return;
  const chain = unwindChain(resolver, declarator.initializer);

  if (chain === undefined) return;

  // `Http.headers(schema)` marks a Schema value (spec 0024 §2.2); it is no builder chain and declares nothing.
  if (chain.root === "Http" && chain.steps[0]?.names.join(".") === "headers") return;

  if (!collectOperations && chain.root !== "Model" && chain.root !== "Http") return;

  if (chain.root === "Http" && !collectGroup) return;
  const id = declarator.name.text;
  const module = resolver.moduleOf(declarator.getSourceFile().fileName);

  if (!isExported(declarator)) {
    unsupported(sink, declarator, { _tag: "BuilderExport", subject: id });

    return;
  }

  if (chain.root === "Model") {
    const [step, ...rest] = chain.steps;

    if (step === undefined || step.names.join(".") !== "persistent" || rest.length > 0) {
      unsupported(sink, declarator, { _tag: "ModelBuilder", subject: id });

      return;
    }

    const args = lowerArguments(resolver, sink, id, step.args);

    if (args === undefined) return;
    const [schema, options] = args;

    const merged =
      schema === undefined || options === undefined ? undefined : withSchema([options], schema);

    if (merged === undefined) {
      unsupported(sink, declarator, { _tag: "ModelBuilder", subject: id });

      return;
    }

    sink.declarations.push({
      id,
      kind: "model",
      module,
      export: id,
      annotations: [{ name: "PersistentModel", args: merged }],
      location: positionOf(declarator),
    });

    return;
  }

  if (chain.root === "Http") {
    const [step, ...rest] = chain.steps;

    if (
      step === undefined ||
      step.names.join(".") !== "group" ||
      rest.length > 0 ||
      step.args.length !== 1
    ) {
      unsupported(sink, declarator, { _tag: "GroupBuilder", subject: id });

      return;
    }

    const args = lowerArguments(resolver, sink, id, step.args, "Http.Group");

    if (args === undefined) return;

    sink.declarations.push({
      id,
      kind: "builder",
      module,
      export: id,
      annotations: [{ name: "Http.Group", args }],
      location: positionOf(declarator),
    });

    return;
  }

  if (chain.root !== "Operation") return;
  const last = chain.steps.at(-1);

  if (
    last === undefined ||
    !(
      (last.names.join(".") === "handler" && last.args.length === 1) ||
      (last.names.join(".") === "declare" && last.args.length === 0)
    )
  ) {
    unsupported(sink, declarator, { _tag: "ChainEnd", subject: id });

    return;
  }

  const annotations: Array<Annotation> = [];

  for (const step of chain.steps.slice(0, -1)) {
    if (step.names.join(".") === "with") {
      const [applied] = step.args;

      const appliedAnnotation =
        step.args.length === 1 && applied !== undefined && ts.isCallExpression(applied)
          ? appliedName(resolver, applied)
          : undefined;

      if (
        applied === undefined ||
        !ts.isCallExpression(applied) ||
        appliedAnnotation === undefined
      ) {
        unsupported(sink, step.call, { _tag: "AppliedCall", subject: id });

        return;
      }

      const definition = userDefinition(resolver, appliedAnnotation);

      if (definition !== undefined && definition.target !== "operation") {
        sink.diagnostics.push(
          CoreDiagnostics.EFFX1303.emit(
            {
              _tag: "Builder",
              subject: id,
              annotation: appliedAnnotation,
              target: definition.target,
            },
            { location: positionOf(step.call) },
          ),
        );

        return;
      }

      const lowered = lowerApplied(resolver, sink, id, applied, appliedAnnotation);

      if (lowered !== undefined) annotations.push(lowered);
      continue;
    }

    const name = CHAIN_ANNOTATIONS.get(step.names.join("."));

    if (name === undefined) {
      unsupported(sink, step.call, {
        _tag: "UnknownStep",
        subject: id,
        step: step.names.join("."),
      });

      return;
    }

    if (
      name === "Http.In" &&
      (step.args.length !== 1 || annotations.some((annotation) => annotation.name === "Http.In"))
    ) {
      sink.diagnostics.push(
        HttpDiagnostics.EFFX2404.emit(
          { _tag: "MultipleIn", subject: id },
          { location: positionOf(step.call) },
        ),
      );

      return;
    }

    if (name === "Annotate") {
      const [, ...rest] = step.args;
      const loweredName = lowerAnnotationName(id, step.call);
      sink.diagnostics.push(...loweredName.diagnostics);

      if (!isAnnotationName(loweredName.value)) continue;
      const args = lowerArguments(resolver, sink, id, rest, loweredName.value);

      if (args !== undefined) annotations.push({ name: loweredName.value, args });
      continue;
    }

    const args = lowerArguments(resolver, sink, id, step.args, name);

    if (args !== undefined) annotations.push({ name, args });
  }

  if (last.names.join(".") === "declare") {
    sink.declarations.push({
      id,
      kind: "builder",
      module,
      export: id,
      annotations,
      binding: "external",
      location: positionOf(declarator),
    });

    return;
  }

  const handler = last.args[0]!;
  const handlerType = resolver.project.checker.getTypeAtLocation(handler);
  const callSignature = handlerType.getCallSignatures()[0];
  let handlerSignature: HandlerSignature | undefined;

  if (callSignature === undefined) {
    unsupported(sink, handler, { _tag: "HandlerFunction", subject: id });
  } else {
    const inferred = inferSignature(
      resolver,
      id,
      resolver.project.checker.getReturnTypeOfSignature(callSignature),
      handler,
    );

    sink.diagnostics.push(...inferred.diagnostics);
    handlerSignature = inferred.signature;
  }

  const declaration: Declaration = {
    id,
    kind: "builder",
    module,
    export: id,
    member: "handler",
    annotations,
    location: positionOf(declarator),
  };

  if (handlerSignature === undefined) {
    sink.declarations.push(declaration);
  } else {
    sink.declarations.push({ ...declaration, handlerSignature });
  }
};

const isProjectFile = (file: ts.SourceFile, rootPrefix: string): boolean =>
  !file.isDeclarationFile &&
  !file.fileName.includes("/node_modules/") &&
  file.fileName.startsWith(rootPrefix);

/** Root operations select imported groups by their lowered .in(SymbolRef), never by mere import. */
export const collect = (
  baseResolver: Resolver,
  definitions?: ReadonlyMap<string, DefinitionEntry>,
): Collected => {
  const appliedUses: Array<AppliedUse> = [];
  const spreads: NonNullable<Collected["spreads"]>[number][] = [];
  const httpApiRoots = new Map<string, HttpApiRootCandidate>();

  const resolver: Resolver =
    definitions === undefined
      ? { ...baseResolver, appliedUses, spreads, httpApiRoots }
      : { ...baseResolver, definitions, appliedUses, spreads, httpApiRoots };

  const sink: Sink = { declarations: [], diagnostics: [] };
  const rootDir = resolver.project.rootDir;
  const rootPrefix = rootDir.endsWith("/") ? rootDir : `${rootDir}/`;
  const rootNames = new Set(resolver.project.rootNames);

  const files = resolver.project.program
    .getSourceFiles()
    .filter((file) => isProjectFile(file, rootPrefix));

  const roots = new Map<string, Sink>();
  const groups = new Set<string>();

  const collectFile = (file: ts.SourceFile, target: Sink, root: boolean): void => {
    const module = resolver.moduleOf(file.fileName);

    for (const statement of file.statements) {
      if (ts.isClassDeclaration(statement)) {
        const selected =
          statement.name !== undefined && groups.has(`${module}\0${statement.name.text}`);

        collectClass(resolver, target, statement, root, root || selected);
      } else if (ts.isVariableStatement(statement)) {
        for (const declarator of statement.declarationList.declarations) {
          const selected =
            ts.isIdentifier(declarator.name) && groups.has(`${module}\0${declarator.name.text}`);

          collectBuilder(resolver, target, declarator, root, root || selected);
        }
      }
    }
  };

  // Cache root lowering so each root is visited once, while retaining program-file order.
  for (const file of files) {
    if (!rootNames.has(file.fileName)) continue;
    const collected: Sink = { declarations: [], diagnostics: [] };
    collectFile(file, collected, true);
    roots.set(file.fileName, collected);

    for (const declaration of collected.declarations) {
      for (const annotation of declaration.annotations) {
        if (annotation.name !== "Http.In") continue;
        const ref = annotation.args[0];

        if (isSymbolArg(ref)) groups.add(`${ref.ref.module}\0${ref.ref.export}`);
      }
    }
  }

  for (const file of files) {
    const root = roots.get(file.fileName);

    if (root !== undefined) {
      sink.declarations.push(...root.declarations);
      sink.diagnostics.push(...root.diagnostics);
    } else {
      collectFile(file, sink, false);
    }
  }

  const declarationFiles = new Set(
    sink.declarations.flatMap((declaration) =>
      declaration.location === undefined ? [] : [declaration.location.file],
    ),
  );

  sink.diagnostics.push(...leafViolations(resolver, appliedUses, declarationFiles));

  const result: CollectedDraft = {
    declarations: sink.declarations,
    diagnostics: sink.diagnostics,
  };

  if (spreads.length > 0) result.spreads = spreads;

  if (httpApiRoots.size > 0)
    result.resolveHttpApiInventory = makeHttpApiInventoryResolver(resolver.project, httpApiRoots);

  return result;
};
