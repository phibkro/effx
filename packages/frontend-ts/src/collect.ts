import { Schema } from "effect";
import { AnnotationArg as AnnotationArgSchema, SymbolArg, error } from "@effx/compiler";
import type {
  Annotation,
  AnnotationArg,
  Collected,
  Declaration,
  Diagnostic,
  HandlerSignature,
} from "@effx/compiler";
import { lowerAnnotationName, lowerExpression } from "./lower.ts";
import {
  type Resolver,
  isFromRuntime,
  isSchemaValueType,
  runtimeName,
  schemaRefOf,
} from "./resolve.ts";
import { inferSignature } from "./signature.ts";
import { isExported, positionOf, ts } from "./ts.ts";

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

const unsupported = (sink: Sink, node: ts.Node, message: string): void => {
  sink.diagnostics.push(error("EFFX1104", message, positionOf(node)));
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

/** Check the static Type of a Schema value, not its initializer or runtime contents. */
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

const lowerArguments = (
  resolver: Resolver,
  sink: Sink,
  declarationId: string,
  args: ReadonlyArray<ts.Expression>,
  annotationName?: string,
): ReadonlyArray<AnnotationArg> | undefined => {
  const out: Array<AnnotationArg> = [];

  for (const arg of args) {
    const lowered = lowerExpression(
      resolver,
      declarationId,
      arg,
      annotationName === "Http.Problems",
      annotationName === "Http.Contract",
      annotationName === "Http.Group"
        ? "group-object"
        : annotationName === "Http.In"
          ? "group-association"
          : annotationName === "Http.Access"
            ? "access-object"
            : annotationName === "Http.Contract"
              ? "contract-object"
              : undefined,
    );

    sink.diagnostics.push(...lowered.diagnostics);

    if (lowered.value === undefined) return undefined;
    out.push(lowered.value);

    if (annotationName === "Foldkit.Command") {
      for (const field of ["success", "failure"] as const) {
        const checker = resolver.project.checker;
        const member = checker.getTypeAtLocation(arg).getProperty(field);

        if (member === undefined) continue; // Args decoding reports the missing field.

        const property = ts.isObjectLiteralExpression(arg)
          ? arg.properties.find(
              (candidate): candidate is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
                (ts.isPropertyAssignment(candidate) ||
                  ts.isShorthandPropertyAssignment(candidate)) &&
                (ts.isIdentifier(candidate.name) || ts.isStringLiteral(candidate.name)) &&
                candidate.name.text === field,
            )
          : undefined;

        const value =
          property === undefined
            ? undefined
            : ts.isPropertyAssignment(property)
              ? property.initializer
              : property.name;

        const type =
          value === undefined
            ? checker.getTypeOfSymbolAtLocation(member, arg)
            : checker.getTypeAtLocation(value);

        if (!isTaggedMessage(resolver, type, arg)) {
          sink.diagnostics.push(
            error(
              "EFFX2601",
              `${declarationId}: Foldkit.Command ${field} must be an exported tagged Message schema`,
              positionOf(arg),
            ),
          );

          return undefined;
        }
      }
    }
  }

  return out;
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
        unsupported(
          sink,
          decorator,
          `${declarationId}: @${bare.name} must be called, e.g. @${bare.name}(...)`,
        );
      continue;
    }

    const callee = runtimeCallee(resolver, expression.expression);

    if (callee === undefined) continue;
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
      error("EFFX2404", `${className}: multiple @Http.Group declarations`, positionOf(node)),
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
        unsupported(sink, node, `${className}: a @Http.Group class must be exported`);
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
      unsupported(sink, node, `${className}: @${annotation.name} is not a class decorator`);
      continue;
    }

    if (!isExported(node)) {
      unsupported(sink, node, `${className}: a @PersistentModel class must be exported`);
      continue;
    }

    const schema: AnnotationArg = {
      _tag: "Schema",
      ref: schemaRefOf({ ref: { module, export: className }, idPath: resolver.idPathOf(file) }),
    };

    const args = withSchema(annotation.args, schema);

    if (args === undefined) {
      unsupported(sink, node, `${className}: @PersistentModel takes exactly one options object`);
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
        unsupported(
          sink,
          member,
          `${id}: @Http.Group is a class decorator, not a method decorator`,
        );
        continue;
      }

      const isStatic = ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static;

      if (!isStatic) {
        unsupported(
          sink,
          member,
          `${id}: effx decorators are supported on static methods only (spec 0002)`,
        );
        continue;
      }

      if (!isExported(node)) {
        unsupported(sink, member, `${id}: the class holding effx operations must be exported`);
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
        unsupported(
          sink,
          member,
          `${className}: effx decorators are supported on static methods only (spec 0002)`,
        );
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

const CHAIN_ANNOTATIONS = new Map<string, string>([
  ["query", "Query"],
  ["in", "Http.In"],
  ["command", "Command"],
  ["http.get", "Http.Get"],
  ["http.post", "Http.Post"],
  ["http.put", "Http.Put"],
  ["http.patch", "Http.Patch"],
  ["http.delete", "Http.Delete"],
  ["http.contract", "Http.Contract"],
  ["http.access", "Http.Access"],
  ["http.problems", "Http.Problems"],
  ["foldkit.command", "Foldkit.Command"],
  ["rpc", "Rpc"],
  ["cli", "Cli"],
  ["authorize", "Authorize"],
  ["errors", "Errors"],
  ["requirements", "Requirements"],
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

  if (!collectOperations && chain.root !== "Model" && chain.root !== "Http") return;

  if (chain.root === "Http" && !collectGroup) return;
  const id = declarator.name.text;
  const module = resolver.moduleOf(declarator.getSourceFile().fileName);

  if (!isExported(declarator)) {
    unsupported(sink, declarator, `${id}: effx builder values must be exported`);

    return;
  }

  if (chain.root === "Model") {
    const [step, ...rest] = chain.steps;

    if (step === undefined || step.names.join(".") !== "persistent" || rest.length > 0) {
      unsupported(sink, declarator, `${id}: expected Model.persistent(Schema, options)`);

      return;
    }

    const args = lowerArguments(resolver, sink, id, step.args);

    if (args === undefined) return;
    const [schema, options] = args;

    const merged =
      schema === undefined || options === undefined ? undefined : withSchema([options], schema);

    if (merged === undefined) {
      unsupported(sink, declarator, `${id}: expected Model.persistent(Schema, options)`);

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
      unsupported(sink, declarator, `${id}: expected Http.group(options)`);

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
    unsupported(
      sink,
      declarator,
      `${id}: an Operation chain must end with .handler(fn) or .declare()`,
    );

    return;
  }

  const annotations: Array<Annotation> = [];

  for (const step of chain.steps.slice(0, -1)) {
    const name = CHAIN_ANNOTATIONS.get(step.names.join("."));

    if (name === undefined) {
      unsupported(sink, step.call, `${id}: unknown builder step .${step.names.join(".")}(...)`);

      return;
    }

    if (
      name === "Http.In" &&
      (step.args.length !== 1 || annotations.some((annotation) => annotation.name === "Http.In"))
    ) {
      sink.diagnostics.push(
        error(
          "EFFX2404",
          `${id}: exactly one group may be associated with .in(Group)`,
          positionOf(step.call),
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
    unsupported(sink, handler, `${id}: .handler(...) expects a function`);
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
export const collect = (resolver: Resolver): Collected => {
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

  return { declarations: sink.declarations, diagnostics: sink.diagnostics };
};
