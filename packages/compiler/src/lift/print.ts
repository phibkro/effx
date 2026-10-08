import { Predicate, Result, Schema } from "effect";
import type { SchemaRef, SymbolRef } from "@effx/ir";
import { SchemaArg, SymbolArg } from "../args.ts";
import type { Annotation, AnnotationArg, Collected, Declaration } from "../Collected.ts";
import type { CodeReference } from "./result.ts";
import { defaultGenerationContext } from "../Extension.ts";
import { Imports } from "../generate/emit.ts";
import { entriesOf, isObjectArg } from "./arg.ts";
import { symbolRefOf } from "./refs.ts";
import { relativeModule } from "./relative.ts";

/*
 * The suggestion printer (spec 0019 §4.2 items 1 and 2): a `Collected` as the `.effx.ts` text a person would
 * write, in builder form. The same printer prints the verbose lift and its dense rewrite, because the dense
 * form is just a `Collected` with `Http.In` associations and group defaults. Output is deterministic and
 * complete: every reference becomes a real import resolved from the suggestion's own module key, names
 * never collide, and an argument that has no source form is an error instead of a placeholder.
 */

export interface PrintOptions {
  /** The module key of the suggestion file; imports are written relative to it. */
  readonly module: string;
  /** Tuples a problem identifier's codes are referenced by (`LiftResult.codeReferences`). */
  readonly codeReferences?: ReadonlyArray<CodeReference> | undefined;
}

const RefArg = Schema.Union([SchemaArg, SymbolArg]);

const CapabilityArg = Schema.Union([
  Schema.TaggedStruct("None", {}),
  Schema.TaggedStruct("One", { capability: Schema.String }),
  Schema.TaggedStruct("Any", { capabilities: Schema.Array(Schema.String) }),
  Schema.TaggedStruct("All", { capabilities: Schema.Array(Schema.String) }),
]);

const ConcealmentArg = Schema.Union([
  Schema.TaggedStruct("Reveal", {}),
  Schema.TaggedStruct("NotFound", { stages: Schema.Array(Schema.String) }),
]);

const LambdaArg = Schema.TaggedStruct("Lambda", {});

const isRef = Schema.is(RefArg);

const isCapability = Schema.is(CapabilityArg);

const isConcealment = Schema.is(ConcealmentArg);

const isLambda = Schema.is(LambdaArg);

const identifier = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

const quote = (text: string): string => JSON.stringify(text);

const keyText = (key: string): string => (identifier.test(key) ? key : quote(key));

const pad = (width: number): string => " ".repeat(width);

/** Arrays and objects longer than this break one entry per line. */
const width = 88;

const verbs: ReadonlyMap<string, string> = new Map([
  ["Http.Get", "get"],
  ["Http.Post", "post"],
  ["Http.Put", "put"],
  ["Http.Patch", "patch"],
  ["Http.Delete", "delete"],
]);

const methods: ReadonlyMap<string, string> = new Map([
  ["Http.Contract", "contract"],
  ["Http.Problems", "problems"],
  ["Http.Access", "access"],
]);

const callOf = (name: string, strings: ReadonlyArray<string>): string =>
  `${name}(${strings.map(quote).join(", ")})`;

/** Prints `collected`, or names everything that has no source form. */
export const printSuggestion = (
  collected: Collected,
  options: PrintOptions,
): Result.Result<string, string> => {
  const problems: Array<string> = [];

  const imports = new Imports({
    ...defaultGenerationContext,
    target: collected.project?.target ?? defaultGenerationContext.target,
    allowImportingTsExtensions: collected.project?.allowImportingTsExtensions ?? false,
  });

  imports.reserve(...collected.declarations.map((declaration) => declaration.export));

  const runtime = (name: string): string => imports.add("@effx/runtime", name);

  const local = (reference: SchemaRef | SymbolRef): string => {
    const symbol = symbolRefOf(reference);
    const member = symbol.member === undefined ? "" : `.${symbol.member}`;

    if (symbol.module === options.module) return `${symbol.export}${member}`;

    const specifier = relativeModule(options.module, symbol.module);

    if (Result.isFailure(specifier)) {
      problems.push(specifier.failure);

      return symbol.export;
    }

    return `${imports.add(specifier.success, symbol.export)}${member}`;
  };

  /** Values that are always one expression: references, capability and concealment builder calls. */
  const leaf = (arg: AnnotationArg, key: string | undefined): string | undefined => {
    if (!isObjectArg(arg)) return undefined;

    if (isRef(arg)) return local(arg.ref);

    if (key === "capabilities" && isCapability(arg)) {
      const capability = runtime("Capability");

      switch (arg._tag) {
        case "None":
          return `${capability}.none`;
        case "One":
          return `${capability}.${callOf("one", [arg.capability])}`;
        case "Any":
          return `${capability}.${callOf("any", arg.capabilities)}`;
        case "All":
          return `${capability}.${callOf("all", arg.capabilities)}`;
      }
    }

    if (key === "concealment" && isConcealment(arg)) {
      const concealment = runtime("Concealment");

      return arg._tag === "Reveal"
        ? `${concealment}.reveal`
        : `${concealment}.${callOf("notFound", arg.stages)}`;
    }

    return undefined;
  };

  const flat = (arg: AnnotationArg, key: string | undefined): string => {
    if (Predicate.isString(arg)) return quote(arg);

    if (Predicate.isNumber(arg) || Predicate.isBoolean(arg)) return String(arg);

    if (!isObjectArg(arg)) return `[${arg.map((item) => flat(item, undefined)).join(", ")}]`;

    const named = leaf(arg, key);

    if (named !== undefined) return named;

    if (isLambda(arg)) {
      problems.push("a lambda argument has no declaration form");

      return "undefined";
    }

    const entries = entriesOf(arg);

    return entries.length === 0
      ? "{}"
      : `{ ${entries.map(([name, item]) => `${keyText(name)}: ${flat(item, name)}`).join(", ")} }`;
  };

  /** A value at `indent`: on one line when it fits (and is not forced open), else one entry per line. */
  const value = (
    arg: AnnotationArg,
    key: string | undefined,
    indent: number,
    open: boolean,
  ): string => {
    const text = flat(arg, key);

    if (Predicate.isString(arg) || Predicate.isNumber(arg) || Predicate.isBoolean(arg)) return text;

    if (isObjectArg(arg)) {
      const named = leaf(arg, key);

      if (named !== undefined) return text;
    }

    if (!open && text.length + indent <= width) return text;

    if (!isObjectArg(arg))
      return arg.length === 0
        ? "[]"
        : `[\n${arg.map((item) => `${pad(indent + 2)}${value(item, undefined, indent + 2, false)},`).join("\n")}\n${pad(indent)}]`;

    const entries = entriesOf(arg);

    return entries.length === 0
      ? "{}"
      : `{\n${entries.map(([name, item]) => `${pad(indent + 2)}${keyText(name)}: ${value(item, name, indent + 2, false)},`).join("\n")}\n${pad(indent)}}`;
  };

  const annotationOf = (declaration: Declaration, name: string): Annotation | undefined =>
    declaration.annotations.find((annotation) => annotation.name === name);

  const printGroup = (declaration: Declaration): string => {
    const arg = annotationOf(declaration, "Http.Group")?.args[0];

    return arg === undefined
      ? ""
      : `export const ${declaration.export} = ${runtime("Http")}.group(${value(arg, undefined, 0, true)});`;
  };

  /** `Http.Problems` options with the exported tuple of its identifier in place of a copy of the codes. */
  const withTuple = (arg: AnnotationArg): AnnotationArg => {
    if (!isObjectArg(arg)) return arg;

    const entries = entriesOf(arg);
    const identifier = entries.find(([name]) => name === "identifier")?.[1];

    const tuple = Predicate.isString(identifier)
      ? options.codeReferences?.find((candidate) => candidate.identifier === identifier)
      : undefined;

    if (tuple === undefined) return arg;

    const reference: AnnotationArg = { _tag: "Symbol", ref: tuple.ref };

    return Object.fromEntries(
      entries.map(([name, item]) => [name, name === "codes" ? reference : item]),
    );
  };

  const printOperation = (declaration: Declaration, operation: Annotation): string => {
    const builder = operation.name === "Query" ? "query" : "command";
    const head = operation.args[0];

    const steps = declaration.annotations.flatMap((annotation): ReadonlyArray<string> => {
      const arg = annotation.args[0];
      const verb = verbs.get(annotation.name);
      const method = methods.get(annotation.name);

      if (annotation === operation) return [];

      if (annotation.name === "Http.In" && arg !== undefined)
        return [`.in(${flat(arg, undefined)})`];

      if (verb !== undefined && Predicate.isString(arg)) return [`.http.${verb}(${quote(arg)})`];

      if (method !== undefined && arg !== undefined)
        return [
          `.http.${method}(${value(annotation.name === "Http.Problems" ? withTuple(arg) : arg, undefined, 2, true)})`,
        ];

      problems.push(`${declaration.id}: annotation ${annotation.name} has no builder form`);

      return [];
    });

    return [
      `export const ${declaration.export} = ${runtime("Operation")}.${builder}(${head === undefined ? "" : value(head, undefined, 0, true)})`,
      ...steps.map((step) => `  ${step}`),
      "  .declare();",
    ].join("\n");
  };

  const statements = collected.declarations.flatMap((declaration): ReadonlyArray<string> => {
    const operation = annotationOf(declaration, "Query") ?? annotationOf(declaration, "Command");

    if (annotationOf(declaration, "Http.Group") !== undefined) return [printGroup(declaration)];

    if (operation !== undefined) return [printOperation(declaration, operation)];

    problems.push(`${declaration.id}: a declaration that is neither a group nor an operation`);

    return [];
  });

  if (problems.length > 0) return Result.fail(Array.from(new Set(problems)).join("; "));

  return Result.succeed(
    [
      "// Suggested by `effx lift`. Review the decisions before accepting it.",
      ...imports.render(),
      "",
      statements.join("\n\n"),
      "",
    ].join("\n"),
  );
};
