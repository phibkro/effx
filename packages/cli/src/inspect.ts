import { Array as Arr, Match, Option, Order, Predicate, Schema } from "effect";
import { Extensions } from "@effx/compiler";
import {
  type GraphIndex,
  IRGraph,
  type Node,
  type OperationNode,
  type SchemaRef,
  StableId,
  type Transport,
} from "@effx/ir";

/*
 * Pure rendering of one operation as the tree in the research report §"CLI and inspector"
 * (spec 0003 §"inspect format"). Reads the IR through the graph index only.
 */

/** `schema:src/user/User.Self` → `User.Self`: the last path segment of the id name. */
export const schemaDisplay = (ref: SchemaRef): string => {
  const name = StableId.nameOf(ref.symbolId);

  return name.slice(name.lastIndexOf("/") + 1);
};

const isOperation = Predicate.isTagged("Operation");

/**
 * Spec 0003 name resolution: a full StableId verbatim, else `operation:<name>`, else the unique
 * node whose name is `name`.
 */
export const resolveName = (index: GraphIndex, name: string): Option.Option<Node> => {
  if (StableId.isStableId(name)) {
    const exact = IRGraph.nodeOf(index, name);

    if (Option.isSome(exact)) return exact;
  }

  const operation = IRGraph.nodeOf(index, StableId.make("operation", name));

  if (Option.isSome(operation)) return operation;

  const named = Arr.filter(
    Arr.fromIterable(IRGraph.withPrefix(index, "")),
    (id) => StableId.nameOf(id) === name,
  );

  return named.length === 1 ? IRGraph.nodeOf(index, named[0]!) : Option.none();
};

const transportLine = (transport: Transport): string =>
  Match.value(transport).pipe(
    Match.tagsExhaustive({
      http: ({ method, path }) => `${method} ${path}`,
      rpc: ({ name }) => `RPC ${name}`,
      cli: ({ command }) => `CLI ${command.join(" ")}`,
    }),
  );

const section = (title: string, items: ReadonlyArray<string>): ReadonlyArray<string> => [
  "",
  title,
  ...(items.length === 0 ? ["  (none)"] : items.map((item) => `  ${item}`)),
];

const authorityLines = (index: GraphIndex, operation: OperationNode): ReadonlyArray<string> =>
  IRGraph.outgoing(index, operation.id, "AuthorizedBy").flatMap((edge) =>
    Option.match(IRGraph.nodeOf(index, edge.to), {
      onNone: () => [`${StableId.nameOf(edge.to)} (missing)`],
      onSome: (node) =>
        node._tag === "Capability"
          ? [
              node.name,
              `resource: ${StableId.nameOf(node.resource)}`,
              ...(node.focus === undefined ? [] : [`focus: ${StableId.nameOf(node.focus)}`]),
            ]
          : [StableId.nameOf(node.id)],
    }),
  );

/** Built once: the compiler's own schema is the only description of the access data. */
const decodeAccessContract = Schema.decodeUnknownOption(Extensions.AccessContractData);

/** The explicit Command/SnapshotRead claim of `Http.Access` is shown only when it is `true`. */
const accessClaimLines = (index: GraphIndex, operation: OperationNode): ReadonlyArray<string> => {
  const contracts = IRGraph.incoming(index, operation.id, "ExtensionOf")
    .filter((edge) => edge.qualifier === "AccessContract")
    .flatMap((edge) =>
      Option.match(IRGraph.nodeOf(index, edge.from), {
        onNone: () => [],
        onSome: (node) =>
          node._tag === "Extension" && node.extension === "access-contract"
            ? Option.toArray(decodeAccessContract(node.data))
            : [],
      }),
    );

  return contracts.some((access) => access.snapshotDecisionForCommand === true)
    ? ["snapshotDecisionForCommand: true"]
    : [];
};

const exposedLines = (index: GraphIndex, operation: OperationNode): ReadonlyArray<string> =>
  IRGraph.outgoing(index, operation.id, "ExposedAs")
    .toSorted(Order.mapInput(Order.String, (edge) => edge.to))
    .flatMap((edge) =>
      Option.match(IRGraph.nodeOf(index, edge.to), {
        onNone: () => [`${edge.to} (missing)`],
        onSome: (node) => (node._tag === "Exposure" ? [transportLine(node.transport)] : []),
      }),
    );

export const renderOperation = (index: GraphIndex, operation: OperationNode): string =>
  [
    `Operation ${operation.name}`,
    ...section("Kind", [operation.kind]),
    ...section("Contract", [
      `${schemaDisplay(operation.input)} → ${schemaDisplay(operation.success)}`,
    ]),
    ...section(
      `Errors${operation.errors.inferred ? " (inferred)" : ""}`,
      operation.errors.values.map(schemaDisplay).toSorted(Order.String),
    ),
    ...section(
      `Requirements${operation.requirements.inferred ? " (inferred)" : ""}`,
      operation.requirements.values.map(StableId.nameOf).toSorted(Order.String),
    ),
    ...section("Authority", [
      ...authorityLines(index, operation),
      ...accessClaimLines(index, operation),
    ]),
    ...section("Exposed", exposedLines(index, operation)),
  ].join("\n");

/** The inspect text for `name`, or `None` when it names no operation. */
export const inspect = (index: GraphIndex, name: string): Option.Option<string> =>
  Option.flatMap(resolveName(index, name), (node) =>
    isOperation(node) ? Option.some(renderOperation(index, node)) : Option.none(),
  );
