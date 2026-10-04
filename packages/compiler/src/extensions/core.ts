import { Match, Option, Result, Schema } from "effect";
import { Builtins } from "@effx/runtime";
import {
  type Edge,
  type GraphIndex,
  IRGraph,
  Node,
  type OperationNode,
  type SchemaRef,
  StableId,
} from "@effx/ir";
import { type Declaration, TypeRef, symbolOf } from "../Collected.ts";
import { type Diagnostic, error, warning } from "../Diagnostic.ts";
import { type Analysis, Contribution, type Extension } from "../Extension.ts";
import {
  type ArgsCodec,
  type Implementation,
  decodeSchemaOf,
  decoderOf,
  extension,
  implement,
} from "../annotation.ts";
import { findAnnotation } from "../args.ts";
import { HttpContractData } from "./http-contract.ts";
import { notAnOperation } from "./not-an-operation.ts";

export { notAnOperation };

// ---------------------------------------------------------------------------
// Operation identity
// ---------------------------------------------------------------------------

/** The decode Schema of `Query` and `Command` options (named: the derived type is not portable across packages). */
export const OperationArgs: ArgsCodec<typeof Builtins.Query> = decodeSchemaOf(Builtins.Query);

const operationName = (declaration: Declaration): Option.Option<string> => {
  const annotation = findAnnotation(declaration, "Query") ?? findAnnotation(declaration, "Command");

  if (annotation === undefined) return Option.none();
  const decoded = Schema.decodeOption(OperationArgs)(annotation.args);
  const explicit = Option.flatMap(decoded, ([args]) => Option.fromUndefinedOr(args.name));

  return Option.some(
    Option.getOrElse(explicit, () =>
      declaration.member === undefined
        ? declaration.export
        : `${declaration.export}.${declaration.member}`,
    ),
  );
};

/** Shared rule for every extension: which operation a declaration defines. */
export const operationIdOf = (declaration: Declaration): Option.Option<StableId.StableId> =>
  Option.map(operationName(declaration), (name) => StableId.make("operation", name));

const schemaNode = (ref: SchemaRef): Node => ({ _tag: "Schema", id: ref.symbolId, ref });

const serviceIdOf = (symbol: { readonly export: string }): StableId.StableId =>
  StableId.make("service", symbol.export);

// ---------------------------------------------------------------------------
// Declared vs inferred (ADR 0005)
// ---------------------------------------------------------------------------

const decodeErrors = decoderOf(Builtins.Errors);

const decodeRequirements = decoderOf(Builtins.Requirements);

interface Resolved<A> {
  readonly values: ReadonlyArray<A>;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
}

interface Requirement {
  readonly id: StableId.StableId;
  readonly node: Node;
}

const declaredErrors = (declaration: Declaration): Option.Option<Resolved<SchemaRef>> => {
  const annotation = findAnnotation(declaration, "Errors");

  if (annotation === undefined) return Option.none();

  return Option.some(
    Result.match(decodeErrors(annotation, declaration), {
      onFailure: (diagnostic) => ({ values: [], diagnostics: [diagnostic] }),
      onSuccess: (args) => ({ values: args.map((arg) => arg.ref), diagnostics: [] }),
    }),
  );
};

const declaredRequirements = (declaration: Declaration): Option.Option<Resolved<Requirement>> => {
  const annotation = findAnnotation(declaration, "Requirements");

  if (annotation === undefined) return Option.none();

  return Option.some(
    Result.match(decodeRequirements(annotation, declaration), {
      onFailure: (diagnostic) => ({ values: [], diagnostics: [diagnostic] }),
      onSuccess: (args) => ({
        values: args.map((arg): Requirement => ({
          id: serviceIdOf(arg.ref),
          node: {
            _tag: "Service",
            id: serviceIdOf(arg.ref),
            name: arg.ref.export,
            symbol: arg.ref,
          },
        })),
        diagnostics: [],
      }),
    }),
  );
};

const inferredErrors = (
  declaration: Declaration,
  types: ReadonlyArray<TypeRef>,
): Resolved<SchemaRef> => {
  const values: Array<SchemaRef> = [];
  const diagnostics: Array<Diagnostic> = [];

  for (const type of types) {
    TypeRef.matchOrElse(
      type,
      {
        Schema: ({ ref }) => values.push(ref),
        Opaque: ({ display }) =>
          diagnostics.push(
            error(
              "EFFX2203",
              `${declaration.id}: inferred error \`${display}\` is not schema-addressable; map it with @Errors`,
            ),
          ),
      },
      () => 0,
    );
  }

  return { values, diagnostics };
};

const inferredRequirements = (
  declaration: Declaration,
  types: ReadonlyArray<TypeRef>,
): Resolved<Requirement> => {
  const values: Array<Requirement> = [];
  const diagnostics: Array<Diagnostic> = [];

  for (const type of types) {
    TypeRef.matchOrElse(
      type,
      {
        Service: ({ id, symbol }) =>
          values.push({ id, node: { _tag: "Service", id, name: symbol.export, symbol } }),
        Opaque: ({ display }) =>
          diagnostics.push(
            error(
              "EFFX2304",
              `${declaration.id}: cannot assign a stable effx identity to requirement \`${display}\`; declare or register the service`,
            ),
          ),
      },
      () => 0,
    );
  }

  return { values, diagnostics };
};

const setDifference = (left: ReadonlyArray<string>, right: ReadonlyArray<string>): Array<string> =>
  left.filter((item) => !right.includes(item)).toSorted();

// ---------------------------------------------------------------------------
// Interpreters
// ---------------------------------------------------------------------------

const operation = (
  definition: typeof Builtins.Query | typeof Builtins.Command,
  kind: OperationNode["kind"],
): Implementation =>
  implement(definition, {
    notOperation: notAnOperation,
    read: ([args], { declaration }) => {
      const external = declaration.binding === "external";

      const hasAuthoredHandler =
        (declaration.kind === "builder" || declaration.kind === "staticMethod") &&
        declaration.member !== undefined;

      if (
        external
          ? declaration.kind !== "builder" ||
            hasAuthoredHandler ||
            declaration.handlerSignature !== undefined
          : !hasAuthoredHandler || declaration.handlerSignature === undefined
      ) {
        return Contribution.diagnostics(
          error(
            "EFFX1106",
            external
              ? `${declaration.id}: external operation must not carry a local handler or signature`
              : `${declaration.id}: local operation requires an authored, typed handler`,
          ),
        );
      }

      const id = Option.getOrThrow(operationIdOf(declaration));
      const signature = declaration.handlerSignature;

      const declaredErrorSet = declaredErrors(declaration);

      const errors = Option.getOrElse(declaredErrorSet, () =>
        external
          ? { values: [], diagnostics: [] }
          : inferredErrors(declaration, signature?.errors ?? []),
      );

      const declaredRequirementSet = declaredRequirements(declaration);

      const requirements = Option.getOrElse(declaredRequirementSet, () =>
        external
          ? { values: [], diagnostics: [] }
          : inferredRequirements(declaration, signature?.requirements ?? []),
      );

      const node: OperationNode = {
        _tag: "Operation",
        id,
        name: StableId.nameOf(id),
        kind,
        input: args.input.ref,
        success: args.success.ref,
        errors: { values: errors.values, inferred: !external && Option.isNone(declaredErrorSet) },
        requirements: {
          values: requirements.values.map((r) => r.id),
          inferred: !external && Option.isNone(declaredRequirementSet),
        },
        ...(external ? { binding: "external" as const } : { handler: symbolOf(declaration) }),
      };

      const nodes: Array<Node> = [
        node,
        schemaNode(args.input.ref),
        schemaNode(args.success.ref),
        ...errors.values.map(schemaNode),
        ...requirements.values.map((r) => r.node),
      ];

      const edges: Array<Edge> = [
        { kind: "InputOf", from: args.input.ref.symbolId, to: id },
        { kind: "SuccessOf", from: args.success.ref.symbolId, to: id },
        ...errors.values.map((ref): Edge => ({ kind: "ErrorOf", from: ref.symbolId, to: id })),
        ...requirements.values.map((r): Edge => ({ kind: "Requires", from: id, to: r.id })),
      ];

      return Contribution.make(nodes, edges, [...errors.diagnostics, ...requirements.diagnostics]);
    },
  });

/**
 * Local @Errors asserts exact inference; external @Errors declares the raw binding's error set.
 * Malformed arguments are reported once, by the operation interpreter that reads them.
 */
const errorsAssertion = implement(Builtins.Errors, {
  notOperation: notAnOperation,
  malformed: "ignore",
  read: (args, { declaration }) => {
    if (declaration.binding === "external") return Contribution.empty;
    const signature = declaration.handlerSignature;

    if (signature === undefined) return Contribution.empty;
    const declared = args.map((arg) => arg.ref.symbolId);

    const inferred = inferredErrors(declaration, signature.errors).values.map(
      (ref) => ref.symbolId,
    );

    const undeclared = setDifference(inferred, declared);
    const stale = setDifference(declared, inferred);

    return Contribution.diagnostics(
      ...undeclared.map((id) =>
        error(
          "EFFX2201",
          `${declaration.id}: handler fails with ${id} but @Errors does not declare it`,
        ),
      ),
      ...stale.map((id) =>
        error(
          "EFFX2202",
          `${declaration.id}: @Errors declares ${id} but the handler cannot fail with it`,
        ),
      ),
    );
  },
});

/** Local @Requirements asserts exact inference; external requirements are declarations. */
const requirementsAssertion = implement(Builtins.Requirements, {
  notOperation: notAnOperation,
  malformed: "ignore",
  read: (args, { declaration }) => {
    if (declaration.binding === "external") return Contribution.empty;
    const signature = declaration.handlerSignature;

    if (signature === undefined) return Contribution.empty;
    const declared = args.map((arg) => serviceIdOf(arg.ref));

    const inferred = inferredRequirements(declaration, signature.requirements).values.map(
      (r) => r.id,
    );

    const undeclared = setDifference(inferred, declared);
    const stale = setDifference(declared, inferred);

    return Contribution.diagnostics(
      ...undeclared.map((id) =>
        error(
          "EFFX2302",
          `${declaration.id}: handler requires ${id} but @Requirements does not declare it`,
        ),
      ),
      ...stale.map((id) =>
        error(
          "EFFX2303",
          `${declaration.id}: @Requirements declares ${id} but the handler no longer requires it`,
        ),
      ),
    );
  },
});

const persistentModel = implement(Builtins.PersistentModel, {
  read: ([args]) => {
    // Model identity is the schema's export, so `@PersistentModel class User` and
    // `Model.persistent(User, …)` name the same model (spec 0002).
    const modelName = args.schema.ref.export;
    const id = StableId.make("model", modelName);

    const views = Object.entries(args.views ?? {}).map(([name, view]) => ({
      name,
      schema: view.ref,
    }));

    const focuses = Object.entries(args.focus ?? {}).map(([name, path]): Node => ({
      _tag: "Focus",
      id: StableId.make("focus", `${modelName}.${name}`),
      root: id,
      path,
    }));

    const nodes: Array<Node> = [
      {
        _tag: "Model",
        id,
        name: modelName,
        schema: args.schema.ref,
        table: args.table,
        views,
      },
      schemaNode(args.schema.ref),
      ...views.map((view) => schemaNode(view.schema)),
      ...focuses,
    ];

    const edges: Array<Edge> = [
      { kind: "PersistsAs", from: id, to: args.schema.ref.symbolId, qualifier: args.table },
      ...views.map((view): Edge => ({
        kind: "ViewOf",
        from: view.schema.symbolId,
        to: id,
        qualifier: view.name,
      })),
    ];

    return Contribution.make(nodes, edges);
  },
});

const authorize = implement(Builtins.Authorize, {
  notOperation: notAnOperation,
  read: ([args], { ctx }) => {
    const operationId = Option.getOrThrow(ctx.operationId);
    const id = StableId.make("capability", args.name);
    const resource = StableId.make("model", args.resource);

    const focus =
      args.focus === undefined
        ? undefined
        : ({
            _tag: "Focus",
            id: StableId.make("focus", `${args.resource}.${args.focus.join(".")}`),
            root: resource,
            path: args.focus,
          } satisfies Node);

    const capability: Node =
      focus === undefined
        ? { _tag: "Capability", id, name: args.name, resource }
        : { _tag: "Capability", id, name: args.name, resource, focus: focus.id };

    const edges: Array<Edge> = [{ kind: "AuthorizedBy", from: operationId, to: id }];

    if (focus !== undefined) edges.push({ kind: "Focuses", from: id, to: focus.id });

    return Contribution.make(focus === undefined ? [capability] : [capability, focus], edges);
  },
});

// ---------------------------------------------------------------------------
// Analyses
// ---------------------------------------------------------------------------

const duplicateIds: Analysis = (_ir, index) =>
  index.duplicates.map((id) =>
    error("EFFX1001", `duplicate StableId ${id} with differing content`),
  );

const missingTargets: Analysis = (_ir, index) =>
  IRGraph.missingTargets(index).map(({ edge, missing }) =>
    error(
      "EFFX1002",
      `edge ${edge.kind} ${edge.from} → ${edge.to} references missing node(s) ${missing.join(", ")}`,
    ),
  );

/** Every extension node needs a graph-visible owner; an orphan cannot be generated safely. */
const orphanExtensions: Analysis = (ir, index) =>
  ir.nodes.flatMap((node) =>
    node._tag === "Extension" && IRGraph.outgoing(index, node.id, "ExtensionOf").length === 0
      ? [error("EFFX1003", `extension ${node.id} has no ExtensionOf owner edge`)]
      : [],
  );

/** Cached IR can bypass source collection; reject invalid binding/handler pairs there too. */
const invalidOperationBinding: Analysis = (ir) =>
  ir.nodes.flatMap((node) =>
    node._tag === "Operation" && (node.binding === "external") !== (node.handler === undefined)
      ? [
          error(
            "EFFX1106",
            `${node.name}: external bindings cannot have a handler; local operations require one`,
          ),
        ]
      : [],
  );

/** A raw HTTP binding cannot substitute for an RPC, CLI or Foldkit implementation. */
const externalExecutableProjection: Analysis = (ir, index) =>
  ir.nodes.flatMap((node) => {
    if (node._tag !== "Operation" || node.binding !== "external") return [];

    const transports = IRGraph.outgoing(index, node.id, "ExposedAs").flatMap((edge) => {
      const exposure = Option.getOrUndefined(IRGraph.nodeOf(index, edge.to));

      return exposure?._tag === "Exposure" && exposure.transport._tag !== "http"
        ? [
            error(
              "EFFX1107",
              `${node.name}: external HTTP binding cannot implement ${exposure.transport._tag}`,
            ),
          ]
        : [];
    });

    const foldkit = IRGraph.incoming(index, node.id, "ExtensionOf").filter(
      (edge) => edge.qualifier === "UiCommand",
    );

    return [
      ...transports,
      ...foldkit.map(() =>
        error("EFFX1107", `${node.name}: external HTTP binding cannot implement Foldkit.Command`),
      ),
    ];
  });

/** The exception belongs to the operation's validated contract, not to any unrelated annotation. */
const hasQueryPayloadContract = (operation: OperationNode, index: GraphIndex): boolean =>
  IRGraph.incoming(index, operation.id, "ExtensionOf").some((link) => {
    if (link.qualifier !== "HttpContract") return false;
    const contract = Option.getOrUndefined(IRGraph.nodeOf(index, link.from));

    if (
      contract?._tag !== "Extension" ||
      contract.extension !== "http-contract" ||
      contract.tag !== "HttpContract"
    )
      return false;

    const data = Schema.decodeUnknownOption(HttpContractData)(contract.data);

    return Option.isSome(data) && data.value.payloadIsQuery && data.value.payload !== undefined;
  });

/** ADR 0006/0010: a Query is a claim; only an explicit POST payload is a read exception. */
const queryOverNonGet: Analysis = (ir, index) =>
  ir.nodes.flatMap((node) =>
    Node.matchOrElse(
      node,
      {
        Operation: (operation) =>
          operation.kind !== "Query"
            ? []
            : IRGraph.outgoing(index, operation.id, "ExposedAs").flatMap((edge) =>
                Option.match(IRGraph.nodeOf(index, edge.to), {
                  onNone: () => [],
                  onSome: (target) =>
                    Node.matchOrElse(
                      target,
                      {
                        Exposure: (exposure) =>
                          Match.value(exposure.transport).pipe(
                            Match.tag("http", (http) =>
                              http.method === "GET" ||
                              (http.method === "POST" && hasQueryPayloadContract(operation, index))
                                ? []
                                : [
                                    error(
                                      "EFFX2401",
                                      `${operation.name} is a Query but is exposed as HTTP ${http.method} ${http.path}; use GET or declare a Command`,
                                    ),
                                  ],
                            ),
                            Match.orElse(() => []),
                          ),
                      },
                      () => [],
                    ),
                }),
              ),
      },
      () => [],
    ),
  );

const inferredOpaqueWarning: Analysis = (ir) =>
  ir.nodes.flatMap((node) =>
    Node.matchOrElse(
      node,
      {
        Operation: (operation) =>
          operation.errors.inferred && operation.errors.values.length === 0
            ? [
                warning(
                  "EFFX2204",
                  `${operation.name}: no schema-addressable errors inferred; boundary will expose none`,
                ),
              ]
            : [],
      },
      () => [],
    ),
  );

export const core: Extension = extension(
  "core",
  [
    operation(Builtins.Query, "Query"),
    operation(Builtins.Command, "Command"),
    errorsAssertion,
    requirementsAssertion,
    persistentModel,
    authorize,
  ],
  {
    analyses: [
      duplicateIds,
      missingTargets,
      orphanExtensions,
      invalidOperationBinding,
      externalExecutableProjection,
      queryOverNonGet,
      inferredOpaqueWarning,
    ],
  },
);
