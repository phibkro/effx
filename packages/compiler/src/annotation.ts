import { Option, Result, Schema } from "effect";
import type { DiagnosticEntry } from "@effx/diagnostics";
import type {
  ArgsPlan,
  CapabilityMarker,
  DefinitionData,
  JsonValue,
  Plan,
  ReadParameters,
  RootSymbolMarker,
  SchemaMarker,
  SymbolMarker,
} from "@effx/runtime";
import { type ApplicationIR, type ExtensionNode, StableId, SymbolRef } from "@effx/ir";
import type { Annotation, Declaration } from "./Collected.ts";
import { type Diagnostic, error } from "./Diagnostic.ts";
import { SchemaArg, SymbolArg, decodeArgs } from "./args.ts";
import {
  Contribution,
  type Analysis,
  type EndpointFragment,
  type Extension,
  type Generator,
  type Interpreter,
  type InterpretContext,
} from "./Extension.ts";
import { printable } from "./print-args.ts";
import type { DefinitionEntry } from "./SourceFrontend.ts";

/**
 * The Schema a lowered argument list decodes against, derived from the SAME plan the frontend lowers by
 * (spec 0020 §2.3). Structure is deliberately identical to the hand-written schemas it replaces, so
 * `EFFX1102` messages (which embed the Schema's issue text) do not change.
 */
const RootSymbol = Schema.TaggedStruct("Symbol", { ref: SymbolRef, identifier: Schema.String });

const capabilityValue = Schema.Struct({
  name: Schema.String,
  resource: Schema.String,
  focus: Schema.optionalKey(Schema.Array(Schema.String)),
});

export const schemaOfPlan = (plan: Plan): Schema.Top => {
  switch (plan._tag) {
    case "String":
      return plan.nonEmpty === true ? Schema.NonEmptyString : Schema.String;
    case "Number":
      return Schema.Finite;
    case "Int":
      return Schema.Int;
    case "Boolean":
      return Schema.Boolean;
    case "Literal":
      return Schema.Literals(plan.values);
    case "Struct": {
      const optional = new Set(plan.optional);

      return Schema.Struct(
        Object.fromEntries(
          Object.entries(plan.fields).map(([key, field]) => {
            const schema = schemaOfPlan(field);

            return [key, optional.has(key) ? Schema.optionalKey(schema) : schema];
          }),
        ),
      );
    }

    case "Array": {
      const item = schemaOfPlan(plan.item);
      const base = plan.unique === true ? Schema.UniqueArray(item) : Schema.Array(item);

      return plan.nonEmpty === true ? base.check(Schema.isMinLength(1)) : base;
    }

    case "Record":
      return Schema.Record(Schema.String, schemaOfPlan(plan.value));
    case "Json":
      return Schema.Json;
    case "JsonObject":
      return Schema.JsonObject;
    case "TaggedUnion":
      return Schema.TaggedUnion(
        Object.fromEntries(
          Object.entries(plan.cases).map(([tag, fields]) => [
            tag,
            Object.fromEntries(
              Object.entries(fields).map(([key, field]) => [key, schemaOfPlan(field)]),
            ),
          ]),
        ),
      );
    case "Union":
      return Schema.Union(plan.members.map(schemaOfPlan));
    case "Schema":
      return SchemaArg;
    case "Symbol":
      return plan.check === "httpapi-root" ? RootSymbol : SymbolArg;
    case "Capability":
      return capabilityValue;
    case "Injected":
      return schemaOfPlan(plan.plan);
    case "Refine":
      return schemaOfPlan(plan.plan).check(...plan.checks);
    case "Invalid":
      return Schema.Never;
  }
};

/** `Schema.Tuple(items)` for fixed arguments, `Schema.TupleWithRest` / `Schema.Array` for variadic ones. */
export const argsSchemaOf = (plan: ArgsPlan): Schema.Top => {
  const items = plan.items.map(schemaOfPlan);

  if (plan.rest === undefined) return Schema.Tuple(items);

  const rest = schemaOfPlan(plan.rest);

  return items.length === 0
    ? Schema.Array(rest)
    : Schema.TupleWithRest(Schema.Tuple(items), [rest]);
};

/**
 * Resolves the runtime's `Read` markers to the real decoded types, so `read` receives exactly what the
 * derived Schema decodes (no second type declaration).
 */
export type Resolved<T> = T extends JsonValue
  ? T // marker-free JSON (also: the recursive `JsonValue` itself must not be mapped over)
  : T extends SchemaMarker
    ? typeof SchemaArg.Type
    : T extends RootSymbolMarker
      ? typeof RootSymbol.Type
      : T extends SymbolMarker
        ? typeof SymbolArg.Type
        : T extends CapabilityMarker
          ? typeof capabilityValue.Type
          : T extends ReadonlyArray<unknown>
            ? { readonly [I in keyof T]: Resolved<T[I]> }
            : T extends object
              ? { readonly [K in keyof T]: Resolved<T[K]> }
              : T;

/** The decoded argument tuple of a definition. */
export type ReadArgs<D> = D extends { readonly Args?: infer Input }
  ? Resolved<ReadParameters<Exclude<Input, undefined>>>
  : never;

/** What `read` receives besides the decoded arguments. */
export interface ReadContext {
  /** The lowered annotation `args` were decoded from; its `definition` is the definition's own export. */
  readonly annotation: Annotation;
  readonly declaration: Declaration;
  readonly ctx: InterpretContext;
}

export interface Implementation<D extends DefinitionData = DefinitionData> {
  readonly definition: D;
  readonly diagnosticEntries?: ReadonlyArray<DiagnosticEntry>;
  readonly interpreter: Interpreter;
  readonly analyses: ReadonlyArray<Analysis>;
  readonly generators: ReadonlyArray<Generator>;
}

export interface ImplementOptions<Read> {
  /** Explanations owned by this implementation, collected by extension(). */
  readonly diagnosticEntries?: ReadonlyArray<DiagnosticEntry>;
  /** IR analyses that belong to this annotation (diagnostics only). */
  readonly analyze?: Analysis | ReadonlyArray<Analysis>;
  /** A free generator over the IR: new generated files, never a rewrite of source (spec 0020 §6). */
  readonly write?: Generator;
  /** Source→IR. Omitted: the default declarative `Extension` node (spec 0020 §2.3), added by the framework. */
  readonly read?: (args: Read, at: ReadContext) => Contribution;
  /** A framework guard run before the duplicate check (e.g. `Http.Group`'s declaration-kind check). */
  readonly before?: (
    annotation: { readonly name: string },
    declaration: Declaration,
  ) => Diagnostic | undefined;
  /** Duplicate-annotation diagnostic for `cardinality: "one"`; defaults to `EFFX2402`. */
  readonly duplicate?: { readonly code: string };
  /** Diagnostic for an operation-target annotation on a declaration that is not an operation. */
  readonly notOperation?: (
    annotation: { readonly name: string },
    declaration: Declaration,
  ) => Diagnostic;
  /**
   * What malformed arguments contribute. Default `"report"`: the `EFFX1102` diagnostic. `"ignore"`: nothing,
   * for an assertion annotation whose arguments another interpreter already decodes and reports
   * (`@Errors`/`@Requirements` are decoded and reported by the operation they sit on).
   */
  readonly malformed?: "report" | "ignore";
}

/** The decode Schema of a definition: lowered `args` in, what `read` receives out. */
export type ArgsCodec<D extends DefinitionData = DefinitionData> = Schema.Codec<
  ReadArgs<D>,
  Annotation["args"]
>;

/**
 * The derived decode Schema, typed as decoding the lowered `args` of an annotation into what `read`
 * receives. Also what callers outside an interpreter decode with (the `Http.Group` / operation-argument
 * pre-pass).
 */
export const decodeSchemaOf = <D extends DefinitionData>(definition: D): ArgsCodec<D> => {
  const schema: Schema.Top = argsSchemaOf(definition.plan);

  // SAFETY: `schemaOfPlan` derives this Schema from the same plan whose lowering the frontend runs, and
  // `Resolved<ReadParameters<…>>` is declared to be exactly its `Type`; the runtime half cannot import Schema
  // markers, so the two are tied only here (checked by the differential and identity gates).
  return schema as ArgsCodec<D>;
};

/**
 * Decodes an annotation's lowered arguments against `decodeSchemaOf(definition)`. Also how an
 * interpreter reads a SIBLING annotation (`@Query` reads `@Errors`) with the same typed result as `read`.
 */
export const decoderOf = <D extends DefinitionData>(
  definition: D,
): ((
  annotation: Annotation,
  declaration: Declaration,
) => Result.Result<ReadArgs<D>, Diagnostic>) => {
  const schema = decodeSchemaOf(definition);

  return (annotation, declaration) => decodeArgs(schema, annotation, declaration);
};

/** The id of the declarative `Extension` node of `definition` on `operationId`: `ext:<name>/<operation>`. */
const extensionNodeId = (
  definition: DefinitionData,
  operationId: StableId.StableId,
): StableId.StableId => StableId.make("ext", `${definition.name}/${StableId.nameOf(operationId)}`);

/**
 * The `data` of the declarative `Extension` node (spec 0020 §2.3, §6): `args` is the decoded argument tuple
 * as JSON, `definition` the export of the definition itself when the frontend recorded one (a default
 * writer imports it; a hand-built `Collected` has none).
 */
interface DeclarativeData<Read> {
  readonly definition?: SymbolRef;
  readonly args: Read;
}

/**
 * The default `read` of a data-only annotation (spec 0020 §2.3): one `Extension` node
 * `ext:<name>/<operation>` carrying `DeclarativeData`, linked to its operation by `ExtensionOf`
 * (qualifier = the annotation name). No code is needed for an annotation that only records.
 */
const declarativeRead =
  <Read>(definition: DefinitionData) =>
  (args: Read, { annotation, ctx }: ReadContext): Contribution => {
    if (Option.isNone(ctx.operationId)) return Contribution.empty;
    const operationId = ctx.operationId.value;
    const id = extensionNodeId(definition, operationId);

    // SAFETY: decoded arguments are plain JSON by construction of the plan algebra (no live values).
    const jsonArgs = args as ExtensionNode["data"];

    const data: ExtensionNode["data"] =
      annotation.definition === undefined
        ? { args: jsonArgs }
        : { definition: annotation.definition, args: jsonArgs };

    return Contribution.make(
      [{ _tag: "Extension", id, extension: definition.name, tag: definition.name, data }],
      [{ kind: "ExtensionOf", from: id, to: operationId, qualifier: definition.name }],
    );
  };

/** The decode Schema of a declarative node's `data` (see `DeclarativeData`). */
const declarativeSchema = <D extends DefinitionData>(definition: D) =>
  Schema.Struct({
    definition: Schema.optionalKey(SymbolRef),
    args: decodeSchemaOf(definition),
  });

/** The `data` of the declarative node of `definition` on `operationId`, when the operation has one. */
const declarativeNode = (
  definition: DefinitionData,
  ir: ApplicationIR,
  operationId: StableId.StableId,
): Option.Option<ExtensionNode["data"]> => {
  const id = extensionNodeId(definition, operationId);

  const node = ir.nodes.find(
    (candidate) =>
      candidate._tag === "Extension" &&
      candidate.id === id &&
      candidate.extension === definition.name,
  );

  return node?._tag === "Extension" ? Option.some(node.data) : Option.none();
};

/**
 * What the default `read` of `definition` recorded on `operationId`: `DeclarativeData` whose `args` is
 * decoded against `decodeSchemaOf(definition)`. `None` when the operation has no such node (the annotation
 * is absent, or the definition has a custom `read` and so writes no declarative node) or its `data` no
 * longer decodes (an IR written by another definition version).
 */
const declarativeOf = <D extends DefinitionData>(
  definition: D,
  ir: ApplicationIR,
  operationId: StableId.StableId,
): Option.Option<DeclarativeData<ReadArgs<D>>> =>
  Option.flatMap(
    declarativeNode(definition, ir, operationId),
    Schema.decodeUnknownOption(declarativeSchema(definition)),
  );

/**
 * The typed reader of the declarative node the default `read` writes (spec 0020 §2.3): the decoded
 * arguments `definition` recorded on `operationId`, decoded again against `decodeSchemaOf(definition)`.
 * `None` when the operation has no such node or its `data` no longer decodes (see `declarativeOf`).
 * Pure: analyses and generators call it on the normalized IR.
 */
export const dataOf = <D extends DefinitionData>(
  definition: D,
  ir: ApplicationIR,
  operationId: StableId.StableId,
): Option.Option<ReadArgs<D>> =>
  Option.map(declarativeOf(definition, ir, operationId), (recorded) => recorded.args);

/** What the default writer reads of a declarative node: the definition's export and the arguments as JSON. */
const decodeWritten = Schema.decodeUnknownOption(
  Schema.Struct({
    definition: Schema.optionalKey(SymbolRef),
    args: Schema.Array(Schema.Json),
  }),
);

/** The value the default writer prints: one argument is the value itself, several are an array (none: `[]`). */
const writtenValue = (args: ReadonlyArray<Schema.Json>): Schema.Json => {
  const [only, ...more] = args;

  return only !== undefined && more.length === 0 ? only : args;
};

/**
 * The default writer of a definition with an `effect` clause (spec 0020 §4, §6): on an operation that carries
 * the annotation's declarative node, `.annotate(<Definition>.effect.key, <value>)`, where `<Definition>` is
 * the imported definition export. `tsc` then checks the value against the key's shape
 * (`HttpApiEndpoint.annotate<I, S>(key: Context.Key<I, S>, value: NoInfer<S>)`). No fragment when the node
 * has no `definition` (a hand-built `Collected`) or the value is unprintable (`effectAnalysis` reports it).
 */
const endpointFragment =
  (definition: DefinitionData): EndpointFragment =>
  (operation, { ir }) => {
    const written = Option.flatMap(declarativeNode(definition, ir, operation.id), decodeWritten);

    if (Option.isNone(written)) return [];
    const ref = written.value.definition;

    if (ref === undefined) return [];

    return Result.match(printable(writtenValue(written.value.args)), {
      onFailure: () => [],
      onSuccess: (value) => [
        {
          render: (imports) => {
            const name = imports.add(ref.module, ref.export);
            const owner = ref.member === undefined ? name : `${name}.${ref.member}`;

            return `.annotate(${owner}.effect.key, ${value(imports)})`;
          },
        },
      ],
    });
  };

/**
 * `EFFX1102` for a recorded argument the default writer cannot print (a lowered `Lambda`, a non-finite
 * number): the effect clause promises the value reaches the generated code, so it is an error, not a drop.
 */
const effectAnalysis =
  (definition: DefinitionData): Analysis =>
  (ir) =>
    ir.nodes.flatMap((node) => {
      if (node._tag !== "Extension" || node.extension !== definition.name) return [];
      const written = decodeWritten(node.data);

      if (Option.isNone(written)) return [];

      return Result.match(printable(writtenValue(written.value.args)), {
        onSuccess: () => [],
        onFailure: ({ path, kind }) => [
          error(
            "EFFX1102",
            `${node.id}: @${definition.name} has an effect clause, but its argument ${path} is a ${kind} and cannot be written as source`,
          ),
        ],
      });
    });

/**
 * Binds the compiler half to a definition value. The framework owns the repeated guards (target,
 * cardinality) and the decode; `read` sees only typed, decoded arguments.
 */
export const implement = <D extends DefinitionData>(
  definition: D,
  options: ImplementOptions<ReadArgs<D>> = {},
): Implementation<D> => {
  const decode = decoderOf(definition);
  const read = options.read ?? declarativeRead<ReadArgs<D>>(definition);

  const interpreter: Interpreter = (annotation, declaration, ctx) => {
    const guard = options.before?.(annotation, declaration);

    if (guard !== undefined) return Contribution.diagnostics(guard);

    if (definition.target === "operation" && Option.isNone(ctx.operationId)) {
      return Contribution.diagnostics(
        options.notOperation === undefined
          ? error(
              "EFFX2402",
              `${declaration.id}: @${annotation.name} requires an operation declaration`,
            )
          : options.notOperation(annotation, declaration),
      );
    }

    if (
      definition.cardinality === "one" &&
      declaration.annotations.filter((item) => item.name === definition.name).length > 1
    ) {
      return Contribution.diagnostics(
        error(
          options.duplicate?.code ?? "EFFX2402",
          `${declaration.id}: duplicate @${definition.name} annotations`,
        ),
      );
    }

    return Result.match(decode(annotation, declaration), {
      onFailure: (diagnostic) =>
        options.malformed === "ignore" ? Contribution.empty : Contribution.diagnostics(diagnostic),
      onSuccess: (args) => read(args, { annotation, declaration, ctx }),
    });
  };

  const implementation: Implementation<D> = {
    definition,
    interpreter,
    analyses:
      options.analyze === undefined
        ? []
        : Array.isArray(options.analyze)
          ? options.analyze
          : [options.analyze],
    generators: options.write === undefined ? [] : [options.write],
  };

  return options.diagnosticEntries === undefined
    ? implementation
    : { ...implementation, diagnosticEntries: options.diagnosticEntries };
};

/**
 * An `Extension` whose interpreters are derived from its implementations. A definition with an `effect`
 * clause also gets its default endpoint fragment and the analysis that reports an argument the fragment
 * cannot print (spec 0020 §6), both in implementation order.
 */
export const extension = (
  name: string,
  implementations: ReadonlyArray<Implementation>,
  rest: Partial<Pick<Extension, "analyses" | "generators" | "expand" | "diagnosticEntries">> = {},
): Extension => {
  const effectful = implementations.flatMap((implementation) =>
    implementation.definition.effect === undefined ? [] : [implementation.definition],
  );

  const derived: Extension = {
    name,
    diagnosticEntries: [
      ...implementations.flatMap((implementation) => implementation.diagnosticEntries ?? []),
      ...(rest.diagnosticEntries ?? []),
    ],
    interpreters: Object.fromEntries(
      implementations.map((implementation) => [
        implementation.definition.name,
        implementation.interpreter,
      ]),
    ),
    annotations: implementations.map((implementation) => implementation.definition),
    analyses: [
      ...implementations.flatMap((implementation) => implementation.analyses),
      ...effectful.map(effectAnalysis),
      ...(rest.analyses ?? []),
    ],
    generators: [
      ...implementations.flatMap((implementation) => implementation.generators),
      ...(rest.generators ?? []),
    ],
  };

  const withFragments =
    effectful.length === 0 ? derived : { ...derived, fragments: effectful.map(endpointFragment) };

  return rest.expand === undefined ? withFragments : { ...withFragments, expand: rest.expand };
};

/** Plan and target of every definition the extensions declare, by annotation name (frontend input). */
export const definitionsOf = (
  extensions: ReadonlyArray<Extension>,
): ReadonlyMap<string, DefinitionEntry> =>
  new Map(
    extensions.flatMap((extension) =>
      (extension.annotations ?? []).map((definition): readonly [string, DefinitionEntry] => [
        definition.name,
        { plan: definition.plan, target: definition.target },
      ]),
    ),
  );

const nameGrammar = /^[A-Za-z][A-Za-z0-9._-]*$/u;

/**
 * Definition-level errors: `EFFX1302` (a name outside the grammar, or declared by two definitions),
 * `EFFX1301` (an `A.fromSchema` node the frontend cannot lower, collected by `define`) and `EFFX1304`
 * (two definitions share one `effect.key` id: the key is the runtime identity of the annotation, so the
 * second would overwrite the first on the same endpoint). The other half of `EFFX1304`, a key id that is
 * not a literal in source, belongs to the lift (spec 0019): nothing here reads source.
 */
export const definitionDiagnostics = (
  extensions: ReadonlyArray<Extension>,
): ReadonlyArray<Diagnostic> => {
  const seen = new Map<string, string>();
  const keys = new Map<string, string>();
  const diagnostics: Array<Diagnostic> = [];

  for (const extension of extensions) {
    for (const definition of extension.annotations ?? []) {
      if (!nameGrammar.test(definition.name)) {
        diagnostics.push(
          error(
            "EFFX1302",
            `annotation name ${JSON.stringify(definition.name)} (extension ${extension.name}) must match [A-Za-z][A-Za-z0-9._-]*`,
          ),
        );
      }

      for (const problem of definition.diagnostics) {
        diagnostics.push(error(problem.code, problem.message));
      }

      const owner = seen.get(definition.name);

      if (owner === undefined) {
        seen.set(definition.name, extension.name);
      } else {
        diagnostics.push(
          error(
            "EFFX1302",
            `annotation name ${definition.name} is defined by extension ${owner} and by extension ${extension.name}`,
          ),
        );
      }

      if (definition.effect === undefined) continue;
      const key = definition.effect.key.key;
      const keyOwner = keys.get(key);

      if (keyOwner === undefined) {
        keys.set(key, definition.name);
      } else {
        diagnostics.push(
          error(
            "EFFX1304",
            `effect key ${JSON.stringify(key)} is used by annotation ${keyOwner} and by annotation ${definition.name} (extension ${extension.name})`,
          ),
        );
      }
    }
  }

  return diagnostics;
};
